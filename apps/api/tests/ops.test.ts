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

type Run = { readonly exitCode: number; readonly lines: readonly string[] };

const FROM_THE_ROWS_AT = new Date("2026-06-01T12:00:00.000Z");
const FROM_THE_ROWS_SINCE = "2026-05-31T00:00:00Z";
const FROM_THE_COPY_AT = new Date("2026-07-01T12:00:00.000Z");
const FROM_THE_COPY_SINCE = "2026-06-15T00:00:00Z";

const REPLAYED_AT = new Date("2026-07-15T09:00:00.000Z");

const REHEARSED_AT = new Date("2026-08-01T12:00:00.000Z");

const BEYOND_USE =
  "2026-08-03T12:00:00.000Z · 2026-08-31T12:00:00.000Z · " +
  "2026-09-26T12:00:00.000Z · 2027-02-01T12:00:00.000Z";

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

const answered = (run: Run): unknown => JSON.parse(run.lines[0] ?? "");

type QueuedJob = { id: string; kind: string; reason: string | null; status: string };

const jobsOf = async (app: TestApp, workspaceId: string): Promise<readonly QueuedJob[]> => {
  const found = await app.database.superuser.query<QueuedJob>(
    "SELECT id, kind, reason, status FROM job WHERE workspace_id = $1",
    [workspaceId],
  );
  return found.rows;
};

const erasureDoors = (app: TestApp, at: Date) => ({
  git: openTestGit(app),
  postgres: openPostgres(app.database.pool),
  objects: objects().door,
  clock: { now: () => at },
});

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

const ledgerOf = async (app: TestApp, workspaceId: string): Promise<readonly LedgerRow[]> => {
  const found = await app.database.superuser.query<LedgerRow>(
    "SELECT act, actor, subject_id FROM audit_event WHERE workspace_id = $1 ORDER BY at, id",
    [workspaceId],
  );
  return found.rows;
};

const reportPath = async (): Promise<string> =>
  path.join(await mkdtemp(path.join(tmpdir(), "ops-rehearsal-")), "erasure-report.txt");

const finishTheJob = async (app: TestApp, workspaceId: string, status: string): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
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
    expect((await ops(app(), ["graph-counts"])).exitCode).toBe(2);
    expect((await ops(app(), ["replay-erasures"])).exitCode).toBe(2);
  });

  it("reads through the -- separator pnpm forwards, and does not read it as a command", async () => {
    const run = await opsBeforeTheJournal(app(), [
      "--",
      "replay-erasures",
      "--since",
      "20260904T000000Z",
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.lines.join("\n")).toContain("replayed 0 erasures");
    expect((await ops(app(), ["--"])).exitCode).toBe(2);
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

      expect(await ledgerOf(app(), erased.workspaceId)).toContainEqual({
        act: "platform.erasure.replayed",
        actor: "process:better-answers-erasure",
        subject_id: erased.erasureRequestId,
      });
    });

    it("re-applies one the restored rows do not hold at all, from its replay copy alone", async () => {
      const erased = await erasedAt(app(), FROM_THE_COPY_AT);

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

      expect(run.lines).toEqual([
        `replay-erasures: ${erased.erasureRequestId} in workspace ${erased.workspaceId} — ` +
          "completed 2026-07-15T09:00:00.000Z, re-created from its replay copy",
        "replay-erasures: done — replayed 1 erasure since 2026-06-15T00:00:00.000Z",
      ]);
      const restored = await app().database.superuser.query<{ id: string; pseudonym: string }>(
        "SELECT id, pseudonym FROM erasure_request WHERE workspace_id = $1",
        [erased.workspaceId],
      );

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

      expect(run.lines.filter((line) => line.startsWith("note "))).toHaveLength(3);
    });

    it("passes on the loopback the way the drill reaches it, by sending the app hostname as Host through node:http", async () => {
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

  describe("dump-grep — which table holds a token and in how many lines, never the line", () => {
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
      const run = await ops(app(), ["dump-grep", "--tokens", "id"], dump);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["id: absent"]);
    });
  });
});
