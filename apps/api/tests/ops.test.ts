import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { serve } from "@hono/node-server";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { writeConcept } from "@better-answers/core/concepts";
import {
  ERASURE,
  rehearseErasure,
  seedSyntheticSubject,
  type ErasureRehearsed,
} from "@better-answers/core/erasure";
import { systemClock } from "@better-answers/core/kernel";
import { head, initRepository } from "@better-answers/core/store/git";
import { openObjects } from "@better-answers/core/store/objects";
import { openPostgres, withPrincipal } from "@better-answers/core/store/postgres";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { testData } from "@better-answers/schema/testing";

import { fetchHonouringHost } from "../src/ops/http-fetch.ts";
import { NOT_BUILT, parseSince, runOps, type OpsIo } from "../src/ops/index.ts";
import { APP_HOSTNAME, openTestGit, PUBLIC_URL, type TestApp } from "./harness.ts";
import { servedApp } from "./suite-app.ts";

/**
 * The `pnpm ops` commands the estate's restore scripts call (ADR 0022, T-005), run against a
 * real, migrated Postgres and the app itself. What is held is the contract the scripts
 * rely on — `0` did it, `1` stop, `3` not built — on the schema as it stands today, and,
 * for the *not built* answer the journal has now overtaken, on a database of this cluster
 * the journal has never been applied to (`opsBeforeTheJournal` below).
 */

type Run = { readonly exitCode: number; readonly lines: readonly string[] };

/**
 * The instants the erasures below complete at, and the `--since` each replay is given.
 *
 * They are pinned and separated on purpose. The set a replay is owed is read across *every*
 * workspace — the restore is the platform's, not one tenant's — so two cases that both erased
 * "now" would each find the other's request. Each case therefore erases at an instant of its
 * own and asks for the window that holds only that one, which is also how a dump stamp works.
 */
const FROM_THE_ROWS_AT = new Date("2026-06-01T12:00:00.000Z");
const FROM_THE_ROWS_SINCE = "2026-05-31T00:00:00Z";
const FROM_THE_COPY_AT = new Date("2026-07-01T12:00:00.000Z");
const FROM_THE_COPY_SINCE = "2026-06-15T00:00:00Z";
/**
 * The instant the replay of that one runs at, pinned because it is what the re-created request
 * completes at: a row restored from a copy carries no completion, and cannot — the table's own
 * check ties `completed_at` to a `report`, and the copy holds no report. So the routine
 * completes it on the run that actually happened, which is this one.
 */
const REPLAYED_AT = new Date("2026-07-15T09:00:00.000Z");
/** The rehearsal's own, later than both, so the two replay cases never find its request. */
const REHEARSED_AT = new Date("2026-08-01T12:00:00.000Z");

/**
 * The four beyond-use dates from `REHEARSED_AT`, worked out by hand as the core suites do
 * (`[TEST9]`): what makes the file the command wrote the *routine's* report rather than
 * something this command composed for a file.
 */
const BEYOND_USE =
  "2026-08-03T12:00:00.000Z · 2026-08-31T12:00:00.000Z · " +
  "2026-09-26T12:00:00.000Z · 2027-02-01T12:00:00.000Z";

/**
 * A real Garage, because the two erasure commands open the object door and `[TEST3]` refuses a
 * stand-in for a store as it refuses one for Postgres. It is core's own suite helper, reached
 * through `@better-answers/core/testing/objects` the way `@better-answers/schema/testing` is:
 * the helper resolves its own `testcontainers` from core, so this workspace gains no dependency.
 */
const objects = objectStoreForSuite();

const ioFor = (app: TestApp, stdin = ""): OpsIo & { readonly lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    fetch: async (url, init) => app.server.request(url, init),
    stdin: async () => stdin,
    say: (line) => {
      lines.push(line);
    },
    appHostname: APP_HOSTNAME,
    gitStoreDir: app.gitStoreDir,
    objects: objects().door,
    // The real thing, on a real path: what is under test is that the command hands the report
    // to its writer rather than composing a file of its own, and a writer that kept the body in
    // memory would prove the first half and not the second.
    writeReport: async (file, body) => {
      await writeFile(file, body, "utf8");
    },
    clock: systemClock(),
  };
};

const ops = async (
  app: TestApp,
  argv: readonly string[],
  stdin = "",
  pool: Pool = app.database.superuser,
): Promise<Run> => {
  const io = ioFor(app, stdin);
  const exitCode = await runOps(argv, pool, io);
  return { exitCode, lines: io.lines };
};

/**
 * The same run with part of the io replaced — a store the image was never told about, a root
 * that is not there, a clock pinned to an instant. Every refusal below is a misconfigured image
 * or a store that did not come back, and both are reached by changing what the process was
 * given rather than by changing what the command does.
 */
const opsWith = async (
  app: TestApp,
  argv: readonly string[],
  overrides: Partial<OpsIo>,
  pool: Pool = app.database.pool,
): Promise<Run> => {
  const io = { ...ioFor(app), ...overrides };
  const exitCode = await runOps(argv, pool, io);
  return { exitCode, lines: io.lines };
};

/**
 * The same run, against the one database on this cluster the journal has never been applied
 * to — the cluster's own `postgres`, whose `public` holds no table at all.
 *
 * Both *absent* answers below — the replay's *nothing was ever recorded here* and a slice
 * command's *not built* — are decided by a catalogue read, and what they stand for is an
 * image running a command against a database its migrations have not reached: a restore that
 * calls the replay mid-journal, or an estate a step behind. T-120 landed the erasure
 * families, so the migrated database this file otherwise runs against can no longer show
 * either branch; they are shown here against a real, genuinely empty database rather than
 * against a table dropped or faked to make the branch reachable.
 */
const opsBeforeTheJournal = async (app: TestApp, argv: readonly string[]): Promise<Run> => {
  const uri = new URL(app.database.connectionUri);
  uri.pathname = "/postgres";
  const pool = new Pool({ connectionString: uri.toString(), max: 1 });
  try {
    return await ops(app, argv, "", pool);
  } finally {
    await pool.end();
  }
};

/**
 * A map of two concepts and the link between them in the live generation, and a rebuild's
 * leftovers in a second generation beside it — what the two graph commands are asked about.
 */
const mapped = async (app: TestApp, workspaceId: string): Promise<void> => {
  const client = await app.database.superuser.connect();
  try {
    const seed = testData(client);
    const entry = await seed.graphNode({ workspaceId });
    await seed.graphEdge({ workspaceId, fromUid: entry.uid });
    const left = await seed.graphNode({ workspaceId, gen: 2 });
    await seed.graphEdge({ workspaceId, gen: 2, fromUid: left.uid });
  } finally {
    client.release();
  }
};

/** The one line a graph command answers with, as JSON. */
const answered = (run: Run): unknown => JSON.parse(run.lines[0] ?? "");

type QueuedJob = { id: string; kind: string; reason: string | null; status: string };

/** Every job on a workspace's queue, read as the superuser so no policy can hide one. */
const jobsOf = async (app: TestApp, workspaceId: string): Promise<readonly QueuedJob[]> => {
  const found = await app.database.superuser.query<QueuedJob>(
    "SELECT id, kind, reason, status FROM job WHERE workspace_id = $1",
    [workspaceId],
  );
  return found.rows;
};

/**
 * The four doors an erasure runs over in this suite, with the clock pinned so a report's dates
 * are literals. The pool is the app's runtime role and not the superuser: `pnpm ops` connects
 * with `DATABASE_URL`, so an erasure that needed a grant the app's role has not got would pass
 * here and fail on a drill.
 */
const erasureDoors = (app: TestApp, at: Date) => ({
  git: openTestGit(app),
  postgres: openPostgres(app.database.pool),
  objects: objects().door,
  clock: { now: () => at },
});

/**
 * One erasure, completed at `at`, in a workspace of its own — arranged through the erasure
 * slice rather than through the commands below, so what each case asserts is the command's
 * answer and not another command's. This is what a dump taken before `at` would have undone,
 * and what the replay is owed.
 */
const erasedAt = async (
  app: TestApp,
  at: Date,
): Promise<ErasureRehearsed & { readonly workspaceId: string }> => {
  const { workspaceId } = await app.provision();
  await initRepository(openTestGit(app), workspaceId);
  const doors = erasureDoors(app, at);
  const seeded = await seedSyntheticSubject(ERASURE, doors, { workspaceId });
  if (!seeded.ok) throw new Error(`the seed refused: ${String(seeded.error)}`);
  const rehearsed = await rehearseErasure(ERASURE, doors, { workspaceId });
  if (!rehearsed.ok) throw new Error(`the rehearsal refused: ${String(rehearsed.error)}`);
  return { ...rehearsed.value, workspaceId };
};

type LedgerRow = { act: string; actor: string; subject_id: string };

/** A workspace's ledger, read as the superuser so no policy can hide a row from an assertion. */
const ledgerOf = async (app: TestApp, workspaceId: string): Promise<readonly LedgerRow[]> => {
  const found = await app.database.superuser.query<LedgerRow>(
    "SELECT act, actor, subject_id FROM audit_event WHERE workspace_id = $1 ORDER BY at, id",
    [workspaceId],
  );
  return found.rows;
};

/** A file in a directory of this run's own, for `--report <file>`. */
const reportPath = async (): Promise<string> =>
  path.join(await mkdtemp(path.join(tmpdir(), "ops-rehearsal-")), "erasure-report.txt");

/**
 * The worker's end of the job, as a test stands in for it: the row this command queued,
 * moved to a status it never leaves. The queue's own `claim_job` takes the oldest claimable
 * job rather than one named by id — it is the worker's protocol and the queue agreement is
 * where it is proved — so a test that wants *this* job finished moves this job's row, and
 * what is under test here is the command's reading of a status it did not write.
 */
const finishTheJob = async (app: TestApp, workspaceId: string, status: string): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    // The row's own CHECK ties an outcome to the two finishes and to nothing else, so the
    // stand-in writes one exactly where the worker would.
    const moved = await app.database.superuser.query(
      `UPDATE job SET status = $2, finished_at = now(),
              outcome = CASE WHEN $2 IN ('done', 'failed') THEN '{"generation": 2}'::jsonb END
        WHERE workspace_id = $1 AND status = 'queued'`,
      [workspaceId, status],
    );
    if ((moved.rowCount ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`nothing was ever queued in ${workspaceId}`);
};

describe("pnpm ops — the restore scripts' commands", () => {
  const app = servedApp();

  it("reads a dump stamp and an ISO instant as the same moment", () => {
    expect(parseSince("20260903T020500Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("2026-09-03T02:05:00Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("yesterday")).toBeUndefined();
  });

  it("answers usage, not a guess, to no command or an unknown one", async () => {
    expect((await ops(app(), [])).exitCode).toBe(2);
    expect((await ops(app(), ["make-it-so"])).exitCode).toBe(2);
    expect((await ops(app(), ["graph-counts"])).exitCode).toBe(2); // no --workspace
    expect((await ops(app(), ["replay-erasures"])).exitCode).toBe(2); // no --since
  });

  it("reads through the -- separator pnpm forwards, and does not read it as a command", async () => {
    // `pnpm ops replay-erasures …` arrives as `-- replay-erasures …` (first drill, 04/09/2026).
    // Run where the replay's own answer is *done*, so what is held here is the parse — the
    // command ran and said its piece — and not the verdict the two tests below hold.
    const run = await opsBeforeTheJournal(app(), [
      "--",
      "replay-erasures",
      "--since",
      "20260904T000000Z",
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.lines.join("\n")).toContain("replayed 0 erasures");
    expect((await ops(app(), ["--"])).exitCode).toBe(2); // a bare separator is still no command
  });

  describe("replay-erasures — mandatory in every restore, never quietly a no-op", () => {
    it("proves there is nothing to replay against a database the journal has not reached", async () => {
      const run = await opsBeforeTheJournal(app(), [
        "replay-erasures",
        "--since",
        "20260901T020500Z",
      ]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("replayed 0 erasures");
      expect(run.lines.join("\n")).toContain("no erasure_request table");
    });

    it("is done with nothing replayed when the table is there and no erasure followed the dump", async () => {
      // Later than every erasure this file arranges, so the answer is the *empty set* over a
      // migrated schema — which is a different fact from the case above, where the table the
      // set would be read from does not exist. A restore reads the same word for both.
      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-12-01T00:00:00Z"], {});

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "replay-erasures: done — replayed 0 erasures since 2026-12-01T00:00:00.000Z",
      ]);
    });

    it("re-applies an erasure the dump undid, reading it from the rows the restore brought back", async () => {
      const erased = await erasedAt(app(), FROM_THE_ROWS_AT);

      const run = await opsWith(app(), ["replay-erasures", "--since", FROM_THE_ROWS_SINCE], {});

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `replay-erasures: ${erased.erasureRequestId} in workspace ${erased.workspaceId} — ` +
          "completed 2026-06-01T12:00:00.000Z, read from the restored rows",
        "replay-erasures: done — replayed 1 erasure since 2026-05-31T00:00:00.000Z",
      ]);
      // The act is the platform's own (`[AUDIT4]`), its subject the erasure request replayed
      // (`[AUDIT1]`), and it sits beside the rehearsal that arranged this one.
      expect(await ledgerOf(app(), erased.workspaceId)).toContainEqual({
        act: "platform.erasure.replayed",
        actor: "process:better-answers-erasure",
        subject_id: erased.erasureRequestId,
      });
    });

    it("re-applies one the restored rows do not hold at all, from its replay copy alone", async () => {
      const erased = await erasedAt(app(), FROM_THE_COPY_AT);
      // A dump older than the request: the erasure happened, its copy is in the object store,
      // and neither row is in what came back. Deleted as the superuser because this is the
      // restore's own state and not an act the platform has.
      await app().database.superuser.query("DELETE FROM erasure_request WHERE workspace_id = $1", [
        erased.workspaceId,
      ]);
      await app().database.superuser.query("DELETE FROM subject_request WHERE workspace_id = $1", [
        erased.workspaceId,
      ]);

      const run = await opsWith(app(), ["replay-erasures", "--since", FROM_THE_COPY_SINCE], {
        clock: { now: () => REPLAYED_AT },
      });

      expect(run.exitCode).toBe(0);
      // The completion is **this run's**, not the first run's, and the line says so honestly:
      // the copy carries no report and the table refuses a completion without one, so the row
      // it re-creates is completed by the routine that actually ran here. The erasure request's
      // own id is the first run's, which is what a ledger row from before the dump joins on.
      expect(run.lines).toEqual([
        `replay-erasures: ${erased.erasureRequestId} in workspace ${erased.workspaceId} — ` +
          "completed 2026-07-15T09:00:00.000Z, re-created from its replay copy",
        "replay-erasures: done — replayed 1 erasure since 2026-06-15T00:00:00.000Z",
      ]);
      const restored = await app().database.superuser.query<{ id: string; pseudonym: string }>(
        "SELECT id, pseudonym FROM erasure_request WHERE workspace_id = $1",
        [erased.workspaceId],
      );
      // The copy's own pseudonym, not a second one: a subject with two names for one erasure is
      // a subject the ledger rows from before the restore no longer resolve to.
      expect(restored.rows).toEqual([
        { id: erased.erasureRequestId, pseudonym: expect.any(String) },
      ]);
    });

    it("refuses without a repositories' root, because an erasure it cannot rewrite is not replayed", async () => {
      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        gitStoreDir: undefined,
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("GIT_STORE_DIR");
      expect(run.lines.join("\n")).toContain("do not start api");
    });

    it("refuses when the image was never told about an object store", async () => {
      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        objects: undefined,
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("no object store is configured");
      expect(run.lines.join("\n")).toContain("do not start api");
    });

    it("refuses an object store that will not answer, rather than reading silence as nothing owed", async () => {
      // The store did not come back, or came back on another address: *none* is the one answer
      // a restore must never hear from a listing it could not make (the S0 spec, seam 4).
      const unreachable = openObjects({
        endpoint: "http://127.0.0.1:1",
        region: "garage",
        bucket: "better-answers",
        accessKeyId: "key",
        secretAccessKey: "secret",
      });
      if (!unreachable.ok) throw new Error(`the door refused its settings: ${unreachable.error}`);

      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        objects: unreachable.value,
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("REFUSED");
      expect(run.lines.join("\n")).toContain("do not start api");
    });
  });

  describe("the slice-owned commands", () => {
    it.each(["erasure-rehearsal", "object-store-orphans"])(
      "%s says `not built` — exit 3 — against a schema its slice's tables are absent from",
      async (command) => {
        const run = await opsBeforeTheJournal(app(), [
          command,
          "--workspace",
          "ws_synthetic",
          "--wait",
          "--list",
        ]);

        expect(run.exitCode).toBe(NOT_BUILT);
        expect(run.lines.join("\n")).toContain("not built");
      },
    );

    it("object-store-orphans refuses — exit 1 — now its tables are there and the implementation is not", async () => {
      // T-053 landed the graph tables, T-055 `source_document` and T-120 the erasure families,
      // so *not built* has stopped being true against a migrated schema; T-058 filled in the
      // three graph commands below and T-125 the two erasure ones, and the orphan sweep waits
      // on the sources slice. That is exactly the state the third answer is for: the tables
      // exist and this image has no implementation, which is a refusal a restore must stop on
      // rather than a silence.
      const run = await ops(app(), ["object-store-orphans", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("REFUSED");
    });
  });

  describe("erasure-rehearsal — the drill's proof that an erasure erases", () => {
    it("seeds the synthetic subject and prints their tokens on its last line", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);

      const run = await opsWith(
        app(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--seed"],
        { clock: { now: () => REHEARSED_AT } },
      );

      expect(run.exitCode).toBe(0);
      // The last line and nothing after it: the drill reads it with `tail -1` and hands it
      // straight to `dump-grep --tokens`, which splits on the comma and trims.
      const email = `subject-${workspaceId.toLowerCase()}@erasure-rehearsal.example.test`;
      expect(run.lines.at(-1)).toBe(`${email},human:${email},Rehearsal subject ${workspaceId}`);
      const seeded = await app().database.superuser.query(
        'SELECT 1 FROM "user" WHERE lower(email) = lower($1)',
        [email],
      );
      expect(seeded.rowCount).toBe(1);
    });

    it("erases them, writes the routine's own report to the file, and prints the tokens again", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);
      const file = await reportPath();
      const pinned = { clock: { now: () => REHEARSED_AT } };
      // Phase one, then phase two, with nothing carried between them but the workspace id —
      // which is what lets the drill take a `pg_dump` in the middle.
      const seed = await opsWith(
        app(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--seed"],
        pinned,
      );

      const run = await opsWith(
        app(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--run", "--report", file],
        pinned,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines.at(-1)).toBe(seed.lines.at(-1));
      const request = await app().database.superuser.query<{ id: string }>(
        "SELECT id FROM subject_request WHERE workspace_id = $1",
        [workspaceId],
      );
      // The report is the routine's, not a document this command composed: it names *this*
      // run's request, and it carries the four beyond-use dates the lock instant fixes. The
      // core suite holds the wording word for word; what is held here is that the file the
      // writer was handed is that report.
      const written = await readFile(file, "utf8");
      expect(written).toContain(`Erasure report for subject request ${request.rows[0]?.id ?? ""}.`);
      expect(written).toContain(
        "Backup copies taken before 2026-08-01T12:00:00.000Z are beyond use: restored only in a " +
          "disaster, encrypted at rest, deletable only by the escrowed credential, expiring on " +
          `${BEYOND_USE}.`,
      );
      expect(written).toContain("Exports already issued are not recalled.");
      expect(await ledgerOf(app(), workspaceId)).toContainEqual({
        act: "platform.erasure.rehearsed",
        actor: "process:better-answers-erasure",
        subject_id: expect.any(String),
      });
    });

    it("refuses phase two in a workspace phase one never ran in, rather than erasing whoever is there", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);
      const file = await reportPath();

      const run = await opsWith(
        app(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--run", "--report", file],
        {},
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("no synthetic subject stands in this workspace");
    });

    it("answers usage without --synthetic, which is the caller saying this may happen here", async () => {
      const run = await ops(app(), ["erasure-rehearsal", "--workspace", "ws_synthetic", "--seed"]);

      expect(run.exitCode).toBe(2);
      expect(run.lines.join("\n")).toContain("--synthetic is required");
    });

    it("answers usage to neither phase and to both at once, because the dump goes between them", async () => {
      const both = await ops(app(), [
        "erasure-rehearsal",
        "--workspace",
        "ws_synthetic",
        "--synthetic",
        "--seed",
        "--run",
      ]);
      const neither = await ops(app(), [
        "erasure-rehearsal",
        "--workspace",
        "ws_synthetic",
        "--synthetic",
      ]);

      expect([both.exitCode, neither.exitCode]).toEqual([2, 2]);
      expect(both.lines.join("\n")).toContain("exactly one of --seed");
    });

    it("answers usage to a run with nowhere to put its report, which would prove nothing", async () => {
      const run = await ops(app(), [
        "erasure-rehearsal",
        "--workspace",
        "ws_synthetic",
        "--synthetic",
        "--run",
      ]);

      expect(run.exitCode).toBe(2);
      expect(run.lines.join("\n")).toContain("--report <file>");
    });
  });

  describe("graph-rebuild — the map made again, on the worker's queue", () => {
    it("queues a full rebuild for the drill and answers the id of the job it queued", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["graph-rebuild", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      const queued = await jobsOf(app(), workspaceId);
      // The reason defaults to the drill's, because the restore drill is the caller.
      expect(queued).toEqual([
        { id: expect.any(String), kind: "full-rebuild", reason: "drill", status: "queued" },
      ]);
      expect(run.lines).toEqual([`graph-rebuild: done — enqueued ${queued[0]?.id}`]);
    });

    it("takes one of ADR 0023's six reasons when the caller names one", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), [
        "graph-rebuild",
        "--workspace",
        workspaceId,
        "--reason",
        "upgrade",
      ]);

      expect(run.exitCode).toBe(0);
      expect((await jobsOf(app(), workspaceId))[0]?.reason).toBe("upgrade");
    });

    it("answers usage to a reason that is not one of the six, and queues nothing", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), [
        "graph-rebuild",
        "--workspace",
        workspaceId,
        "--reason",
        "because-i-said-so",
      ]);

      expect(run.exitCode).toBe(2);
      expect(await jobsOf(app(), workspaceId)).toEqual([]);
    });

    it("answers usage to a workspace that is not an id, before it queues anything", async () => {
      const run = await ops(app(), ["graph-rebuild", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });

    it.each([
      ["a --wait carrying a value", ["--wait", "soon"]],
      ["a --wait-seconds that is not a whole number of seconds", ["--wait-seconds", "soon"]],
      ["a --wait-seconds of no seconds at all", ["--wait-seconds", "0"]],
    ])("answers usage to %s, and queues nothing", async (_shape, flags) => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["graph-rebuild", "--workspace", workspaceId, ...flags]);

      expect(run.exitCode).toBe(2);
      expect(await jobsOf(app(), workspaceId)).toEqual([]);
    });

    it("waits the rebuild's own budget by default — ADR 0032's two minutes — and says so in its usage", async () => {
      // The budget is the promise, not a multiple of a measurement: a rebuild that has not
      // finished in two minutes is the thing an operator has to look at, and a longer wait
      // is asked for explicitly with --wait-seconds rather than granted by the default.
      const run = await ops(app(), ["help"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain(
        "--wait    poll the job until it is over, 120 seconds",
      );
      expect(run.lines.join("\n")).toContain("--wait-seconds <n>");
    });

    it("waits for the job it queued and is done once the worker has finished it", async () => {
      const { workspaceId } = await app().provision();

      const waiting = ops(app(), ["graph-rebuild", "--workspace", workspaceId, "--wait"]);
      await finishTheJob(app(), workspaceId, "done");
      const run = await waiting;

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("rebuilt the map");
    });

    it.each(["failed", "poisoned"])(
      "refuses — so the restore stops — when the job it waited for is %s",
      async (status) => {
        const { workspaceId } = await app().provision();

        const waiting = ops(app(), ["graph-rebuild", "--workspace", workspaceId, "--wait"]);
        await finishTheJob(app(), workspaceId, status);
        const run = await waiting;

        expect(run.exitCode).toBe(1);
        expect(run.lines.join("\n")).toContain("REFUSED");
        expect(run.lines.join("\n")).toContain(status);
      },
    );

    it("refuses when the job is still queued at the end of the wait it was given", async () => {
      const { workspaceId } = await app().provision();

      // A one-second wait, because nothing claims the job in this process: the drill's own
      // wait is the two-minute budget and this flag is what an estate with a slower worker
      // says explicitly.
      const run = await ops(app(), [
        "graph-rebuild",
        "--workspace",
        workspaceId,
        "--wait-seconds",
        "1",
      ]);

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("still queued");
      expect((await jobsOf(app(), workspaceId))[0]?.status).toBe("queued");
    });
  });

  describe("graph-counts — nodes per label and edges, as JSON, for the drill's diff", () => {
    it("answers the live generation and the source entities beside it, on one line a diff can read", async () => {
      const { workspaceId } = await app().provision();
      await mapped(app(), workspaceId);

      const run = await ops(app(), ["graph-counts", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      // One line, because the drill redirects it to a file and diffs it against the counts
      // production's last good sync run stamped (`restore-drill.sh` step 6).
      expect(run.lines).toHaveLength(1);
      expect(answered(run)).toEqual({
        live_gen: 1,
        nodes: { Concept: 2 },
        edges: { LINKS_TO: 1 },
      });
    });

    it("is done over a workspace nobody has mapped, answering zero of everything rather than refusing", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["graph-counts", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(answered(run)).toEqual({ live_gen: null, nodes: {}, edges: {} });
    });

    it("answers usage to a workspace that is not an id, before it reads anything", async () => {
      const run = await ops(app(), ["graph-counts", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("graph-sweep — the generations a finished rebuild left behind", () => {
    it("removes every generation but the live one and says which, with what each held", async () => {
      const { workspaceId } = await app().provision();
      await mapped(app(), workspaceId);

      const run = await ops(app(), ["graph-sweep", "--workspace", workspaceId, "--wait"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["graph-sweep: done — swept generation 2 (2 nodes, 1 edge)"]);
      // The live generation is untouched, which is what the counts read back says.
      const counted = await ops(app(), ["graph-counts", "--workspace", workspaceId]);
      expect(answered(counted)).toEqual({
        live_gen: 1,
        nodes: { Concept: 2 },
        edges: { LINKS_TO: 1 },
      });
    });

    it("is done with nothing to sweep over a workspace whose map is only its live generation", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["graph-sweep", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["graph-sweep: done — nothing to sweep"]);
    });

    it("answers usage to a workspace that is not an id, before it deletes anything", async () => {
      const run = await ops(app(), ["graph-sweep", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("reconcile-watermark — the reconciler on demand, which is the restore path", () => {
    it("refuses without a repositories' root, because a bundle it cannot open is nothing to reconcile against", async () => {
      const { workspaceId } = await app().provision();
      const io: OpsIo & { readonly lines: string[] } = { ...ioFor(app()), gitStoreDir: undefined };

      const exitCode = await runOps(
        ["reconcile-watermark", "--workspace", workspaceId],
        app().database.superuser,
        io,
      );

      expect(exitCode).toBe(1);
      expect(io.lines.join("\n")).toContain("REFUSED");
      expect(io.lines.join("\n")).toContain("GIT_STORE_DIR");
    });

    it("refuses a repositories' root that names a missing directory, the same as an absent one", async () => {
      const { workspaceId } = await app().provision();
      const io: OpsIo & { readonly lines: string[] } = {
        ...ioFor(app()),
        gitStoreDir: `${app().gitStoreDir}/does-not-exist`,
      };

      const exitCode = await runOps(
        ["reconcile-watermark", "--workspace", workspaceId],
        app().database.superuser,
        io,
      );

      expect(exitCode).toBe(1);
      expect(io.lines).toEqual([
        `reconcile-watermark: REFUSED — the repositories' root is no-such-root (GIT_STORE_DIR=${app().gitStoreDir}/does-not-exist)`,
      ]);
    });

    it("answers usage to a workspace that is not an id, before it opens anything", async () => {
      const run = await ops(app(), ["reconcile-watermark", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });

    it("refuses a workspace whose repository is not there, which on a restore is a store that was not restored", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual(["reconcile-watermark: REFUSED — no-such-repository"]);
    });

    it("is done — exit 0 — once the rows and the bundle agree, and says what the run found", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
      ]);
    });

    it("is done — exit 0 — after replaying the commit a bundle's rows missed, and the concept's row has landed", async () => {
      const { workspaceId, admin } = await app().provision();
      const git = openTestGit(app());
      await initRepository(git, workspaceId);
      const principal = await withPrincipal(
        openPostgres(app().database.pool),
        { workspaceId, userId: admin.id, issuedAt: new Date() },
        async (resolved) => resolved,
      );
      if (!principal.ok) throw new Error(`the principal did not resolve: ${principal.error}`);
      // The crash window, as `packages/core/test/reconciler.test.ts` opens it: while the
      // trigger stands, the act's commit lands and its rows do not — the restore path's shape.
      const superuser = app().database.superuser;
      await superuser.query(
        `CREATE FUNCTION crash_in_the_window() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN RAISE EXCEPTION 'the process died between the commit and its rows'; END $$`,
      );
      await superuser.query(
        "CREATE TRIGGER crash_in_the_window BEFORE INSERT ON bundle_commit FOR EACH ROW EXECUTE FUNCTION crash_in_the_window()",
      );
      try {
        const lost = await writeConcept(
          principal.value,
          { git, postgres: openPostgres(app().database.pool), clock: systemClock() },
          {
            mergeKey: "note:restore-drill",
            path: "knowledge/restore-drill.md",
            kind: "Note",
            title: "Restore drill",
            frontmatter: { title: "Restore drill", type: "Note" },
            body: "The rows are behind the bundle until the reconciler runs.",
            message: "Record the restore drill note",
            author: { name: admin.name, email: admin.email },
            expects: { head: null },
            status: "stable",
          },
        );
        expect(lost.ok).toBe(false);
      } finally {
        await superuser.query("DROP TRIGGER crash_in_the_window ON bundle_commit");
        await superuser.query("DROP FUNCTION crash_in_the_window()");
      }
      const sha = await head(principal.value, git);

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `reconcile-watermark: done — head ${sha}, watermark none, replayed 1, already landed 0`,
      ]);
      const landed = await superuser.query<{ path: string; commit_sha: string }>(
        "SELECT path, commit_sha FROM concept_index WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(landed.rows).toEqual([{ path: "knowledge/restore-drill.md", commit_sha: sha }]);
    });
  });

  describe("smoke — the platform answers through its interface", () => {
    it("passes against the running app: health, the protected-resource document, the bearer challenge, the shell", async () => {
      const run = await ops(app(), ["smoke", "--url", PUBLIC_URL, "--find", "--guide", "--ask"]);

      expect(run.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);
      expect(run.exitCode).toBe(0);
      expect(run.lines.filter((line) => line.startsWith("ok  "))).toHaveLength(4);
      // The three entries are named and honestly deferred, never reported as passed.
      expect(run.lines.filter((line) => line.startsWith("note "))).toHaveLength(3);
    });

    it("passes on the loopback the way the drill reaches it, by sending the app hostname as Host through node:http", async () => {
      // The drill and the production restore call `smoke --url http://127.0.0.1:3000` from
      // inside the stack. The fence carries /health alone on the loopback, and Node's fetch
      // drops a `host` header, so this is the one path a harness `server.request` cannot prove.
      let listener: ReturnType<typeof serve> | undefined;
      const port = await new Promise<number>((resolve) => {
        listener = serve({ fetch: app().server.fetch, port: 0, hostname: "127.0.0.1" }, (info) =>
          resolve(info.port),
        );
      });
      const url = `http://127.0.0.1:${port}`;
      try {
        const io = ioFor(app());
        const withHost: OpsIo = { ...io, fetch: fetchHonouringHost };
        expect(await runOps(["smoke", "--url", url], app().database.pool, withHost)).toBe(0);
        expect(io.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);

        // And without the hostname the fence refuses everything but /health — the failure
        // the header exists to prevent, shown rather than assumed.
        const bare: OpsIo = { ...ioFor(app()), fetch: fetchHonouringHost, appHostname: undefined };
        expect(await runOps(["smoke", "--url", url], app().database.pool, bare)).toBe(1);
      } finally {
        await new Promise<void>((resolve) => listener?.close(() => resolve()));
      }
    });

    it("fails when the surface does not answer", async () => {
      const run = await ops(app(), ["smoke", "--url", "https://nowhere.example.test"]);

      expect(run.exitCode).toBe(1);
    });
  });

  /**
   * **Which table, and how many lines in it** — the drill's step 10 reads these lines and decides
   * whether an erasure erased (`deploy/restore-drill.sh`; the S0 spec, *The two ops commands*).
   *
   * Per `COPY` section rather than per dump, because after an erasure the honest answer is not
   * "absent": `subject_request` and `suppression` keep the subject's identifier set **by design**
   * — a restore from a dump older than the request has to re-create the suppressions from it —
   * so a whole-database dump taken after the routine still holds the address and the display
   * name, in exactly those two tables and nowhere else. A reader told only that *something* holds
   * the value cannot tell that apart from an erasure that missed a store.
   *
   * What does not change: the line itself is never quoted, whatever it says. A dump is personal
   * data and this output is what a regulator reads.
   */
  describe("dump-grep — which table holds a token and in how many lines, never the line", () => {
    /** One dump of the shape `pg_dump --format=plain` writes, schema-qualified as it writes them. */
    const dump = [
      "SET search_path = public;",
      "COPY public.person (id, email) FROM stdin;",
      "1\tjane@example.test",
      "2\tother@example.test",
      "\\.",
      "COPY public.subject_request (id, identifiers) FROM stdin;",
      'r1\t{"emails": ["jane@example.test"]}',
      "\\.",
      "COPY public.suppression (id, identifiers) FROM stdin;",
      's1\t{"emails": ["jane@example.test"]}',
      's2\t{"emails": ["jane@example.test"]}',
      "\\.",
      "",
    ].join("\n");

    it("names every table a token is in with its count, and says absent for one in none", async () => {
      const run = await ops(
        app(),
        ["dump-grep", "--tokens", "jane@example.test,nobody@example.test"],
        dump,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "jane…st: present in 1 line(s) of table public.person",
        "jane…st: present in 1 line(s) of table public.subject_request",
        "jane…st: present in 2 line(s) of table public.suppression",
        "nobo…st: absent",
      ]);
      // The other row of `person` was read and never repeated: not the line, not ever.
      expect(run.lines.join("\n")).not.toContain("other@example.test");
    });

    it("reports a match outside every COPY section as exactly that, because schema is not rows", async () => {
      const outside = [
        "SET search_path = public;",
        "CREATE FUNCTION greet() RETURNS text AS $$ select 'jane@example.test' $$;",
        "COPY public.person (id, email) FROM stdin;",
        "1\tsomebody@example.test",
        "\\.",
        "",
      ].join("\n");

      const run = await ops(app(), ["dump-grep", "--tokens", "jane@example.test"], outside);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["jane…st: present in 1 line(s) outside any COPY section"]);
    });

    it("does not count the COPY header, whose column names are the schema and not a row", async () => {
      // `id` is a column name of all three sections above and a value in none of them.
      const run = await ops(app(), ["dump-grep", "--tokens", "id"], dump);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["id: absent"]);
    });
  });
});
