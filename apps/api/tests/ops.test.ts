import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { find, open, trustWords } from "@better-answers/core/answering";
import { writeConcept, writeManifest } from "@better-answers/core/concepts";
import {
  ERASURE,
  rehearseErasure,
  seedSyntheticSubject,
  type ErasureRehearsed,
} from "@better-answers/core/erasure";
import { ok, type UserPrincipal } from "@better-answers/core/kernel";
import { bindUpload, bindUploadFields } from "@better-answers/core/sources";
import { fileAtHead, head, initRepository } from "@better-answers/core/store/git";
import { listObjects } from "@better-answers/core/store/objects";
import {
  folded,
  openPostgres,
  withPrincipal,
  type Answered,
  type Foldable,
  type Tx,
} from "@better-answers/core/store/postgres";
import { inputOf } from "@better-answers/core/testing/input";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import {
  countWaitingOnLocks,
  until,
  whileWritesAreRefused,
} from "@better-answers/core/testing/postgres";
import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { Doors } from "../src/doors.ts";
import { fetchHonouringHost } from "../src/ops/http-fetch.ts";
import {
  EXIT_OF_CLASS,
  NOT_BUILT,
  parseSince,
  runOps,
  SLICE_COMMANDS,
  type OpsIo,
} from "../src/ops/index.ts";
import { readTreeUnder } from "../src/ops/read-tree.ts";
import {
  APP_HOSTNAME,
  capturingLogger,
  doorsFor,
  openTestGit,
  PUBLIC_URL,
  type LogLine,
  type TestApp,
} from "./harness.ts";
import { servedApp } from "./suite-app.ts";

type Run = {
  readonly exitCode: number;
  readonly lines: readonly string[];
  readonly logs: readonly LogLine[];
};

// A replay reads every workspace, so each case erases at an instant of its own and asks
// for the window holding only that one.
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

const ioFor = (
  app: TestApp,
  stdin = "",
): OpsIo & { readonly lines: string[]; readonly logs: readonly LogLine[] } => {
  const lines: string[] = [];
  const { logger, logs } = capturingLogger();
  return {
    lines,
    logs,
    fetch: async (url, init) => app.server.request(url, init),
    stdin: async () => stdin,
    say: (line) => {
      lines.push(line);
    },
    logger,
    appHostname: APP_HOSTNAME,

    writeReport: async (file, body) => {
      await writeFile(file, body, "utf8");
    },
  };
};

type Overrides = {
  readonly doors?: Partial<Doors>;
  readonly io?: Partial<OpsIo>;
};

const doorsFrom = (app: TestApp, pool: Pool, overrides: Partial<Doors> = {}): Doors => ({
  ...doorsFor(pool, { gitStoreDir: app.gitStoreDir }),
  objects: ok(objects().door),
  ...overrides,
});

const ops = async (
  app: TestApp,
  argv: readonly string[],
  stdin = "",
  pool: Pool = app.database.superuser,
): Promise<Run> => {
  const io = ioFor(app, stdin);
  const exitCode = await runOps(argv, doorsFrom(app, pool), io);
  return { exitCode, lines: io.lines, logs: io.logs };
};

const opsWith = async (
  app: TestApp,
  argv: readonly string[],
  overrides: Overrides,
  pool: Pool = app.database.pool,
): Promise<Run> => {
  const io = { ...ioFor(app), ...overrides.io };
  const exitCode = await runOps(argv, doorsFrom(app, pool, overrides.doors), io);
  return { exitCode, lines: io.lines, logs: io.logs };
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

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const BOOTSTRAP_ACTOR = "process:better-answers-bootstrap";

const idOnTheDoneLine = (run: Run): string => {
  const id = /done — (\S+),/.exec(run.lines[0] ?? "")?.[1];
  if (id === undefined) throw new Error(`no id on the done line: ${run.lines.join("\n")}`);
  return id;
};

const aSlug = (): string => `acme-${ulid().toLowerCase()}`;

const provisioning = (app: TestApp, flags: readonly string[]): Promise<Run> =>
  opsWith(app, ["provision-workspace", ...flags], {});

const adding = (app: TestApp, workspaceId: string, email: string, role: string): Promise<Run> =>
  opsWith(app, ["add-member", "--workspace", workspaceId, "--email", email, "--role", role], {});

const membershipsOf = async (app: TestApp, workspaceId: string, userId: string) => {
  const found = await app.database.superuser.query<{ id: string; role: string }>(
    "SELECT id, role FROM member WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, userId],
  );
  return found.rows;
};

const membershipsHeldBy = async (app: TestApp, userId: string): Promise<number> => {
  const found = await app.database.superuser.query("SELECT 1 FROM member WHERE user_id = $1", [
    userId,
  ]);
  return found.rowCount ?? 0;
};

const workspacesWithSlug = async (app: TestApp, slug: string): Promise<number> => {
  const found = await app.database.superuser.query("SELECT 1 FROM workspace WHERE slug = $1", [
    slug,
  ]);
  return found.rowCount ?? 0;
};

const rowsOfAct = async (app: TestApp, workspaceId: string, act: string) => {
  const found = await app.database.superuser.query<Record<string, unknown>>(
    "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY at, id",
    [workspaceId, act],
  );
  return found.rows;
};

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
  postgres: app.doors.postgres,
  objects: objects().door,
  clock: { now: () => at },
  log: capturingLogger().logger,
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

const principalOf = async (app: TestApp, workspaceId: string, userId: string) => {
  const principal = await withPrincipal(
    app.doors.postgres,
    { workspaceId, userId, issuedAt: new Date() },
    async (resolved) => resolved,
  );
  if (!principal.ok) throw new Error(`the principal did not resolve: ${principal.error}`);
  return principal.value;
};

const bundleDoors = (app: TestApp) => ({
  git: openTestGit(app),
  postgres: app.doors.postgres,
  clock: app.doors.clock,
});

type Provisioned = Awaited<ReturnType<TestApp["provision"]>>;

const replayedAfterTheWindow = async (
  app: TestApp,
  write: (
    principal: UserPrincipal,
    doors: ReturnType<typeof bundleDoors>,
    admin: Provisioned["admin"],
  ) => Promise<{ readonly ok: boolean }>,
) => {
  const { workspaceId, admin } = await app.provision();
  const git = openTestGit(app);
  await initRepository(git, workspaceId);
  const principal = await principalOf(app, workspaceId, admin.id);
  await lostInTheWindow(app, () => write(principal, bundleDoors(app), admin));
  const sha = await head(principal, git);

  const run = await ops(app, ["reconcile-watermark", "--workspace", workspaceId]);

  expect(run.exitCode).toBe(0);
  expect(run.lines).toEqual([
    `reconcile-watermark: done — head ${sha}, watermark none, replayed 1, already landed 0`,
  ]);
  return { workspaceId, admin, sha };
};

const lostInTheWindow = async (
  app: TestApp,
  act: () => Promise<{ readonly ok: boolean }>,
): Promise<void> => {
  const superuser = app.database.superuser;
  await superuser.query(
    `CREATE FUNCTION crash_in_the_window() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'the process died between the commit and its rows'; END $$`,
  );
  await superuser.query(
    "CREATE TRIGGER crash_in_the_window BEFORE INSERT ON bundle_commit FOR EACH ROW EXECUTE FUNCTION crash_in_the_window()",
  );
  try {
    expect((await act()).ok).toBe(false);
  } finally {
    await superuser.query("DROP TRIGGER crash_in_the_window ON bundle_commit");
    await superuser.query("DROP FUNCTION crash_in_the_window()");
  }
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

  it("prints the word a refusal carries and exits with the code its class holds", async () => {
    const run = await ops(app(), ["graph-counts", "--workspace", "not-a-workspace-id"]);

    expect(run.exitCode).toBe(2);
    expect(run.lines.join("\n")).toContain("REFUSED — malformed");
  });

  it("gives each class a code of its own, so a wrapper can tell one refusal from another", () => {
    const codes = Object.values(EXIT_OF_CLASS);

    expect(EXIT_OF_CLASS).toEqual({
      malformed: 2,
      unauthenticated: 4,
      forbidden: 5,
      absent: 6,
      inapplicable: 7,
      conflict: 8,
      precondition: 9,
    });
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain(0);
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
        doors: { clock: { now: () => REPLAYED_AT } },
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
        doors: { git: undefined },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("GIT_STORE_DIR");
      expect(run.lines.join("\n")).toContain("do not start api");
    });

    it("refuses when the image was never told about an object store", async () => {
      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        doors: { objects: undefined },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("no object store is configured");
      expect(run.lines.join("\n")).toContain("do not start api");
    });

    it("refuses an object store that will not answer, rather than reading silence as nothing owed", async () => {
      const unreachable = doorsFor(app().database.pool, {
        objectStore: {
          endpoint: "http://127.0.0.1:1",
          region: "garage",
          bucket: "better-answers",
          accessKeyId: "key",
          secretAccessKey: "secret",
        },
      });

      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        doors: { objects: unreachable.objects },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("REFUSED");
      expect(run.lines.join("\n")).toContain("do not start api");
    });
  });

  describe("the slice-owned commands", () => {
    it.each(["erasure-rehearsal", "object-store-orphans", "import-bundle"])(
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
    it("answers in nobody else's name, so no command can be doing another's work", async () => {
      const { workspaceId } = await app().provision();

      for (const command of SLICE_COMMANDS) {
        const run = await ops(app(), [command, "--workspace", workspaceId]);
        const said = run.lines.join("\n");
        const others = SLICE_COMMANDS.filter(
          (other) => other !== command && said.includes(`${other}:`),
        );
        expect({ command, others }).toEqual({ command, others: [] });
      }
    });
  });

  describe("object-store-orphans — the bytes a failed bind left", () => {
    // The store stamps an object with its own clock, so the instant the grace is judged from
    // is the suite's own, moved on.
    const aDayOn = (): Date => new Date(Date.now() + 25 * 60 * 60 * 1000);

    const handbook = () => ({
      ...inputOf(bindUploadFields, {
        bindingId: ulid(),
        name: "The staff handbook",
        fileName: "handbook.md",
        mediaType: "text/markdown",
        byteSize: 43,
      }),
      body: new Blob(["The handbook says what the company decided."]).stream(),
    });

    const bindingsOf = async (workspaceId: string, userId: string) => {
      const admin = await principalOf(app(), workspaceId, userId);
      const doors = { postgres: openPostgres(app().database.pool), objects: objects().door };

      const bound = await bindUpload(admin, doors, handbook());
      if (!bound.ok) throw new Error(`the bind was refused: ${String(bound.error)}`);

      // The job is the transaction's last statement, so refusing it leaves the object the act
      // put before it and no row that names the object.
      const failed = await whileWritesAreRefused(app().database.superuser, "job", () =>
        bindUpload(admin, doors, handbook()),
      );
      if (failed.ok) throw new Error("the bind landed where the queue was refused");
      return { admin, named: bound.value.originalKey };
    };

    it("removes the original no document names once the grace has passed, and keeps the named one", async () => {
      const { workspaceId, admin: person } = await app().provision();
      const { admin, named } = await bindingsOf(workspaceId, person.id);

      const looked = await opsWith(
        app(),
        ["object-store-orphans", "--workspace", workspaceId, "--list"],
        { doors: { clock: { now: aDayOn } } },
      );
      expect(looked.exitCode).toBe(0);
      expect(looked.lines).toEqual([
        "object-store-orphans: done — 1 object past the 24-hour grace no document names, removed none",
      ]);

      const run = await opsWith(app(), ["object-store-orphans", "--workspace", workspaceId], {
        doors: { clock: { now: aDayOn } },
      });

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "object-store-orphans: done — removed 1 object past the 24-hour grace no document names",
      ]);
      expect(await listObjects(admin, objects().door, "")).toEqual({ ok: true, value: [named] });
    });

    it("removes nothing while the grace still holds over both", async () => {
      const { workspaceId, admin: person } = await app().provision();
      await bindingsOf(workspaceId, person.id);

      const run = await ops(app(), ["object-store-orphans", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "object-store-orphans: done — removed 0 objects past the 24-hour grace no document names",
      ]);
    });

    it("crosses its refusal as the word and the class's code, removing nothing", async () => {
      const run = await ops(app(), ["object-store-orphans", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.malformed);
      expect(run.lines).toEqual([
        "object-store-orphans: REFUSED — malformed: --workspace ws_synthetic is not a workspace id",
      ]);
    });

    it("refuses when this image was given no object store to sweep", async () => {
      const { workspaceId } = await app().provision();

      const run = await opsWith(
        app(),
        ["object-store-orphans", "--workspace", workspaceId],
        { doors: { objects: undefined } },
        app().database.superuser,
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("no object store is configured");
    });
  });

  describe("erasure-rehearsal — the drill's proof that an erasure erases", () => {
    it("seeds the synthetic subject and prints their tokens on its last line", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);

      const run = await opsWith(
        app(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--seed"],
        { doors: { clock: { now: () => REHEARSED_AT } } },
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
      const pinned = { doors: { clock: { now: () => REHEARSED_AT } } };

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

    it("leaves the operator the erasure's line in the tier's log, naming its request, its arm and what it deleted, and no address", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);
      const pinned = { doors: { clock: { now: () => REHEARSED_AT } } };
      await opsWith(
        app(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--seed"],
        pinned,
      );

      const run = await opsWith(
        app(),
        [
          "erasure-rehearsal",
          "--workspace",
          workspaceId,
          "--synthetic",
          "--run",
          "--report",
          await reportPath(),
        ],
        pinned,
      );

      const erasure = await app().database.superuser.query<{ id: string }>(
        "SELECT id FROM erasure_request WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(run.exitCode).toBe(0);
      expect(run.logs).toEqual([
        expect.objectContaining({
          level: 30,
          actor: "process:better-answers-erasure",
          erasure_request_id: erasure.rows[0]?.id,
          arm: "last-membership",
          pseudonymised: 1,
          sessions_deleted: 0,
          verifications_deleted: 0,
          accounts_deleted: 0,
          invitations_deleted_here: 0,
          invitations_deleted: 0,
          msg: "erasure: the identity step's arm, and what it pseudonymised and deleted",
        }),
      ]);
      expect(JSON.stringify(run.logs)).not.toContain("@");
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

    it("refuses a workspace that is not an id as malformed, naming the flag it came in", async () => {
      const run = await ops(app(), ["graph-rebuild", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "graph-rebuild: REFUSED — malformed: --workspace ws_synthetic is not a workspace id",
      ]);
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

  describe("the two sweeps by hand never overlap the daily pass", () => {
    it.each([
      ["graph-sweep", "graph-sweep: done — nothing to sweep"],
      [
        "object-store-orphans",
        "object-store-orphans: done — removed 0 objects past the 24-hour grace no document names",
      ],
    ])(
      "%s waits while a pass holds the sweeps' lock, and runs once it lets go",
      async (command, done) => {
        const { workspaceId } = await app().provision();
        let letGo = (): void => undefined;
        const holding = new Promise<void>((resolve) => {
          letGo = resolve;
        });
        let taken = false;
        const pass = withSweepLock(SWEEPS, openPostgres(app().database.pool), async () => {
          taken = true;
          await holding;
        });
        await until(async () => taken);

        let settled = false;
        const run = ops(app(), [command, "--workspace", workspaceId]).finally(() => {
          settled = true;
        });
        await until(async () => (await countWaitingOnLocks(app().database.superuser)) > 0);
        expect(settled).toBe(false);

        letGo();
        await pass;

        expect(await run).toEqual({ exitCode: 0, lines: [done], logs: [] });
      },
    );
  });

  describe("reconcile-watermark — the reconciler on demand, which is the restore path", () => {
    it("refuses without a repositories' root, because a bundle it cannot open is nothing to reconcile against", async () => {
      const { workspaceId } = await app().provision();

      const run = await opsWith(
        app(),
        ["reconcile-watermark", "--workspace", workspaceId],
        { doors: { git: undefined } },
        app().database.superuser,
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        "reconcile-watermark: REFUSED — no repositories' root is configured (GIT_STORE_DIR), so the bundle cannot be opened; the estate sets it to /data/git on the api service",
      ]);
    });

    it("refuses a repositories' root that names a missing directory, naming the root it was given", async () => {
      const { workspaceId } = await app().provision();
      const missing = `${app().gitStoreDir}/does-not-exist`;

      const run = await opsWith(
        app(),
        ["reconcile-watermark", "--workspace", workspaceId],
        { doors: doorsFor(app().database.superuser, { gitStoreDir: missing }) },
        app().database.superuser,
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `reconcile-watermark: REFUSED — the repositories' root is no-such-root (GIT_STORE_DIR=${missing})`,
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
      const { workspaceId, sha } = await replayedAfterTheWindow(app(), (principal, doors, admin) =>
        writeConcept(principal, doors, {
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
        }),
      );

      const landed = await app().database.superuser.query<{ path: string; commit_sha: string }>(
        "SELECT path, commit_sha FROM concept_index WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(landed.rows).toEqual([{ path: "knowledge/restore-drill.md", commit_sha: sha }]);
    });

    it("is done — exit 0 — after replaying a manifest commit a bundle's rows missed: its commit row lands, no concept does, and it stops nowhere", async () => {
      const { workspaceId, admin, sha } = await replayedAfterTheWindow(
        app(),
        (principal, doors, author) =>
          writeManifest(principal, doors, {
            manifest: {
              id: "01J6BBBBBBBBBBBBBBBBBBBBBB",
              origin: "company",
              ref: "Four bid libraries, reviewed 22 September 2026",
              owner: "Acme",
              content_version: "2026-09-22",
            },
            message: "Write the bundle's manifest",
            author: { name: author.name, email: author.email },
          }),
      );

      const rows = await app().database.superuser.query<Record<string, unknown>>(
        `SELECT c.sha, c.parent_sha, c.actor, e.act, e.detail,
                (SELECT count(*)::int FROM concept_index i WHERE i.workspace_id = c.workspace_id) AS concepts
           FROM bundle_commit c
           JOIN audit_event e ON e.workspace_id = c.workspace_id AND e.id = c.audit_event_id
          WHERE c.workspace_id = $1`,
        [workspaceId],
      );
      expect(rows.rows).toEqual([
        {
          sha,
          parent_sha: null,
          actor: `human:${admin.id}`,
          act: "platform.reconciler.replayed",
          detail: { commitSha: sha, bundleId: "01J6BBBBBBBBBBBBBBBBBBBBBB" },
          concepts: 0,
        },
      ]);
    });
  });

  describe("smoke — the platform answers through its interface", () => {
    it("passes against the running api: health, the protected-resource document, the bearer challenge, the shell", async () => {
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
        const doors = doorsFrom(app(), app().database.pool);
        expect(await runOps(["smoke", "--url", url], doors, withHost)).toBe(0);
        expect(io.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);

        const bare: OpsIo = { ...ioFor(app()), fetch: fetchHonouringHost, appHostname: undefined };
        expect(await runOps(["smoke", "--url", url], doors, bare)).toBe(1);
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

  describe("provision-workspace — a client's workspace with its first Admin, from the command line", () => {
    const standingOf = async (app: TestApp, id: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT w.name, w.slug,
                EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'index' AND c.relname = 'chunk_' || w.id) AS partition,
                (SELECT value FROM workspace_config
                  WHERE workspace_id = w.id AND key = 'mcp.tools_list_ttl_ms') AS ttl
           FROM workspace w WHERE w.id = $1`,
        [id],
      );
      return found.rows;
    };

    it("is done with the id first on its line, and the workspace, its partition, the Admin's membership, its configuration row, its ledger row and its bundle repository all stand", async () => {
      const admin = await app().person(undefined, "Priya Shah");
      const slug = aSlug();

      const run = await provisioning(app(), [
        "--name",
        "Acme",
        "--slug",
        slug,
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(0);
      const id = idOnTheDoneLine(run);
      expect(run.lines).toEqual([
        `provision-workspace: done — ${id}, slug ${slug}, Admin ${admin.email}`,
      ]);
      expect(await standingOf(app(), id)).toEqual([
        { name: "Acme", slug, partition: true, ttl: "300000" },
      ]);
      expect(await membershipsOf(app(), id, admin.id)).toEqual([
        { id: expect.stringMatching(ULID_SHAPE), role: "Admin" },
      ]);
      expect(await rowsOfAct(app(), id, "platform.workspace.provisioned")).toEqual([
        {
          actor: BOOTSTRAP_ACTOR,
          subject_id: id,
          detail: { adminUserId: admin.id, role: "Admin" },
        },
      ]);
      const reconciled = await ops(app(), ["reconcile-watermark", "--workspace", id]);
      expect(reconciled.lines).toEqual([
        "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
      ]);
    });

    it("resolves the Admin's email without regard to case, as sign-in does", async () => {
      const admin = await app().person("Priya.Shah@Acme.Invalid");

      const run = await provisioning(app(), [
        "--name",
        "Acme",
        "--slug",
        aSlug(),
        "--admin",
        "priya.shah@acme.invalid",
      ]);

      expect(run.exitCode).toBe(0);
      expect(await membershipsOf(app(), idOnTheDoneLine(run), admin.id)).toEqual([
        { id: expect.stringMatching(ULID_SHAPE), role: "Admin" },
      ]);
    });

    it("refuses no-such-user for a person who has not signed in, says what to do next, and writes nothing", async () => {
      const slug = aSlug();

      const run = await provisioning(app(), [
        "--name",
        "Acme",
        "--slug",
        slug,
        "--admin",
        "nobody@acme.invalid",
      ]);

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        "provision-workspace: REFUSED — no-such-user: nobody@acme.invalid has not signed in; have them sign in with an email code first, then run this again",
      ]);
      expect(await workspacesWithSlug(app(), slug)).toBe(0);
    });

    it("refuses no-display-name for a person who has signed in and given no display name, says what to do next, and writes nothing", async () => {
      const admin = await app().person(undefined, "");
      const slug = aSlug();

      const run = await provisioning(app(), [
        "--name",
        "Acme",
        "--slug",
        slug,
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `provision-workspace: REFUSED — no-display-name: ${admin.email} has given no display name; have them sign in and give one, then run this again`,
      ]);
      expect(await workspacesWithSlug(app(), slug)).toBe(0);
      expect(await membershipsHeldBy(app(), admin.id)).toBe(0);
    });

    it("refuses slug-taken for a slug another workspace holds, and writes nothing", async () => {
      const first = await app().person();
      const second = await app().person();
      const slug = aSlug();
      const held = await provisioning(app(), [
        "--name",
        "One",
        "--slug",
        slug,
        "--admin",
        first.email,
      ]);
      expect(held.exitCode).toBe(0);

      const run = await provisioning(app(), [
        "--name",
        "Two",
        "--slug",
        slug,
        "--admin",
        second.email,
      ]);

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `provision-workspace: REFUSED — slug-taken: another workspace already holds the slug ${slug}`,
      ]);
      expect(await workspacesWithSlug(app(), slug)).toBe(1);
      expect(await membershipsHeldBy(app(), second.id)).toBe(0);
    });

    it("refuses malformed for a blank name or slug, and writes nothing", async () => {
      const admin = await app().person();

      const run = await provisioning(app(), [
        "--name",
        "   ",
        "--slug",
        aSlug(),
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        "provision-workspace: REFUSED — malformed: the name and the slug must each carry at least one character",
      ]);
      expect(await membershipsHeldBy(app(), admin.id)).toBe(0);
    });

    it("refuses without a repositories' root before it writes anything, since a workspace with no bundle repository can take no import", async () => {
      const admin = await app().person();
      const slug = aSlug();

      const run = await opsWith(
        app(),
        ["provision-workspace", "--name", "Acme", "--slug", slug, "--admin", admin.email],
        { doors: { git: undefined } },
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("GIT_STORE_DIR");
      expect(await workspacesWithSlug(app(), slug)).toBe(0);
    });

    it.each([
      ["no flags at all", []],
      ["no --admin", ["--name", "Acme", "--slug", "acme"]],
      ["no --slug", ["--name", "Acme", "--admin", "a@b.c"]],
      ["no --name", ["--slug", "acme", "--admin", "a@b.c"]],
    ])("answers usage to %s, before it reads anything", async (_shape, flags) => {
      const run = await ops(app(), ["provision-workspace", ...flags]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "provision-workspace: --name <name>, --slug <slug> and --admin <email> are required",
      ]);
    });

    it("names both commands in the usage", async () => {
      const run = await ops(app(), ["help"]);

      expect(run.lines.join("\n")).toContain(
        "provision-workspace --name <name> --slug <slug> --admin <email>",
      );
      expect(run.lines.join("\n")).toContain(
        "add-member --workspace <id> --email <email> --role <Admin|Editor|Viewer>",
      );
    });
  });

  describe("add-member — a signed-in person made a member of a workspace, from the command line", () => {
    it.each(["Admin", "Editor", "Viewer"])(
      "is done making a signed-in person a %s, the membership row and its ledger row standing together",
      async (role) => {
        const { workspaceId } = await app().provision();
        const person = await app().person();

        const run = await adding(app(), workspaceId, person.email, role);

        expect(run.exitCode).toBe(0);
        expect(run.lines).toEqual([
          `add-member: done — ${person.email} added to workspace ${workspaceId} as ${role}`,
        ]);
        expect(await membershipsOf(app(), workspaceId, person.id)).toEqual([
          { id: expect.stringMatching(ULID_SHAPE), role },
        ]);
        expect(await rowsOfAct(app(), workspaceId, "people.member.added")).toEqual([
          { actor: BOOTSTRAP_ACTOR, subject_id: person.id, detail: { userId: person.id, role } },
        ]);
      },
    );

    it("resolves the email without regard to case, as sign-in does", async () => {
      const { workspaceId } = await app().provision();
      const person = await app().person("Sam.Okoro@Acme.Invalid");

      const run = await adding(app(), workspaceId, "sam.okoro@acme.invalid", "Viewer");

      expect(run.exitCode).toBe(0);
      expect(await membershipsOf(app(), workspaceId, person.id)).toEqual([
        { id: expect.stringMatching(ULID_SHAPE), role: "Viewer" },
      ]);
    });

    it("refuses no-such-user for a person who has not signed in, says what to do next, and writes nothing", async () => {
      const { workspaceId } = await app().provision();

      const run = await adding(app(), workspaceId, "nobody@acme.invalid", "Editor");

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        "add-member: REFUSED — no-such-user: nobody@acme.invalid has not signed in; have them sign in with an email code first, then run this again",
      ]);
      expect(await rowsOfAct(app(), workspaceId, "people.member.added")).toEqual([]);
    });

    it("refuses no-display-name for a person who has signed in and given no display name, says what to do next, and writes nothing", async () => {
      const { workspaceId } = await app().provision();
      const person = await app().person(undefined, "");

      const run = await adding(app(), workspaceId, person.email, "Editor");

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `add-member: REFUSED — no-display-name: ${person.email} has given no display name; have them sign in and give one, then run this again`,
      ]);
      expect(await membershipsHeldBy(app(), person.id)).toBe(0);
      expect(await rowsOfAct(app(), workspaceId, "people.member.added")).toEqual([]);
    });

    it("refuses no-such-workspace for an id no workspace has, and writes nothing", async () => {
      const person = await app().person();
      const nowhere = ulid();

      const run = await adding(app(), nowhere, person.email, "Editor");

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `add-member: REFUSED — no-such-workspace: ${nowhere} is not a workspace`,
      ]);
      expect(await membershipsHeldBy(app(), person.id)).toBe(0);
      expect(await ledgerOf(app(), nowhere)).toEqual([]);
    });

    it("refuses already-a-member on a repeat — the person just added, or the Admin provisioning made — and never changes a role", async () => {
      const { workspaceId, admin } = await app().provision();
      const person = await app().person();
      expect((await adding(app(), workspaceId, person.email, "Editor")).exitCode).toBe(0);

      const again = await adding(app(), workspaceId, person.email, "Admin");
      const theAdmin = await adding(app(), workspaceId, admin.email, "Viewer");

      expect([again.exitCode, theAdmin.exitCode]).toEqual([1, 1]);
      expect(again.lines).toEqual([
        `add-member: REFUSED — already-a-member: ${person.email} is already a member of workspace ${workspaceId}; a role change is the Admin's act on the People screen`,
      ]);
      expect((await membershipsOf(app(), workspaceId, person.id)).map((row) => row.role)).toEqual([
        "Editor",
      ]);
      expect((await membershipsOf(app(), workspaceId, admin.id)).map((row) => row.role)).toEqual([
        "Admin",
      ]);
      expect(await rowsOfAct(app(), workspaceId, "people.member.added")).toHaveLength(1);
    });

    it("answers usage to a fourth role word, and writes nothing", async () => {
      const { workspaceId } = await app().provision();
      const person = await app().person();

      const run = await adding(app(), workspaceId, person.email, "Owner");

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual(["add-member: --role must be one of Admin, Editor, Viewer"]);
      expect(await membershipsOf(app(), workspaceId, person.id)).toEqual([]);
    });

    it("answers usage to a workspace that is not an id, and to a missing flag, before it reads anything", async () => {
      const notAnId = await ops(app(), [
        "add-member",
        "--workspace",
        "ws_synthetic",
        "--email",
        "a@b.c",
        "--role",
        "Editor",
      ]);
      const noEmail = await ops(app(), ["add-member", "--workspace", ulid(), "--role", "Editor"]);

      expect([notAnId.exitCode, noEmail.exitCode]).toEqual([2, 2]);
      expect(noEmail.lines).toEqual([
        "add-member: --workspace <id>, --email <email> and --role <Admin|Editor|Viewer> are required",
      ]);
    });
  });

  describe("import-bundle — the company's bundle landed through the governed write", () => {
    const BUNDLE_FIXTURE = fileURLToPath(new URL("fixtures/bundle", import.meta.url));
    const BUNDLE_ID = "01J6CCCCCCCCCCCCCCCCCCCCCC";
    const IMPORTED_AT = new Date("2026-09-22T10:00:00.000Z");
    const MONA = "mona.reviewer@acme.invalid";
    const THEO = "theo.approver@acme.invalid";
    const IMPORTED_PATHS = [
      "knowledge/company/answers/data-retention-period.md",
      "knowledge/company/answers/support-hours.md",
      "knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md",
      "knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md",
      "knowledge/product/tiers/advanced-plan.md",
      "knowledge/product/tiers/standard-plan.md",
    ] as const;

    // The fixture names its verifiers by a fixed address, so one person row serves every
    // workspace the block provisions.
    const verifierIds = new Map<string, string>();

    const verifierOf = async (app: TestApp, email: string, name: string): Promise<string> => {
      const known = verifierIds.get(email);
      if (known !== undefined) return known;
      const { id } = await app.person(email, name);
      verifierIds.set(email, id);
      return id;
    };

    const bundleWorkspace = async (app: TestApp) => {
      const { workspaceId, admin } = await app.provision();
      await initRepository(openTestGit(app), workspaceId);
      const mona = await verifierOf(app, MONA, "Mona Reviewer");
      const theo = await verifierOf(app, THEO, "Theo Approver");
      await app.addMember(workspaceId, mona, "Editor");
      await app.addMember(workspaceId, theo, "Editor");
      return { workspaceId, admin, mona, theo };
    };

    const importing = (
      app: TestApp,
      workspaceId: string,
      email: string,
      more: readonly string[] = [],
    ): Promise<Run> =>
      opsWith(
        app,
        [
          "import-bundle",
          "--workspace",
          workspaceId,
          "--from",
          BUNDLE_FIXTURE,
          "--as",
          email,
          ...more,
        ],
        { io: { readTree: readTreeUnder }, doors: { clock: { now: () => IMPORTED_AT } } },
      );

    const reading = async <T>(
      app: TestApp,
      workspaceId: string,
      userId: string,
      work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
    ): Promise<Answered<T>> => {
      const read = folded<T>(
        await withPrincipal(
          app.doors.postgres,
          { workspaceId, userId, issuedAt: new Date() },
          work,
        ),
      );
      if (!read.ok) throw new Error(`the read answered ${String(read.error)}`);
      return read.value;
    };

    const commitsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT c.sha, c.parent_sha, e.act
           FROM bundle_commit c
           JOIN audit_event e ON e.workspace_id = c.workspace_id AND e.id = c.audit_event_id
          WHERE c.workspace_id = $1
          ORDER BY c.committed_at, c.sha`,
        [workspaceId],
      );
      return found.rows;
    };

    type IndexRow = {
      readonly iri: string;
      readonly path: string;
      readonly kind: string;
      readonly title: string;
      readonly status: string;
      readonly sensitivity: string;
    };

    const indexRowsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<IndexRow>(
        `SELECT iri, path, kind, title, status, sensitivity
           FROM concept_index WHERE workspace_id = $1 ORDER BY path`,
        [workspaceId],
      );
      return found.rows;
    };

    const iriOf = async (app: TestApp, workspaceId: string, path: string): Promise<string> => {
      const row = (await indexRowsOf(app, workspaceId)).find((each) => each.path === path);
      if (row === undefined) throw new Error(`no concept stands at ${path}`);
      return row.iri;
    };

    const REWRITTEN_LINES = [
      "import-bundle: rewrote knowledge/company/answers/support-hours.md — 1 link",
      "import-bundle: rewrote knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md — 2 links",
      "import-bundle: rewrote knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md — 1 link",
    ];

    const checkRowsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT c.path, v.actor, v.checked_at, v.content_hash, v.origin
           FROM concept_verification v
           JOIN concept_index c ON c.workspace_id = v.workspace_id AND c.iri = v.iri
          WHERE v.workspace_id = $1
          ORDER BY c.path, v.checked_at`,
        [workspaceId],
      );
      return found.rows;
    };

    const actsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<{ act: string; events: number }>(
        `SELECT act, count(*)::int AS events FROM audit_event
          WHERE workspace_id = $1 AND act LIKE 'knowledge.%'
          GROUP BY act ORDER BY act`,
        [workspaceId],
      );
      return found.rows;
    };

    const filesAtHead = async (app: TestApp, workspaceId: string, userId: string) => {
      const principal = await principalOf(app, workspaceId, userId);
      const git = openTestGit(app);
      const files = new Map<string, string | null>();
      for (const file of ["knowledge/manifest.yaml", ...IMPORTED_PATHS]) {
        files.set(file, await fileAtHead(principal, git, file));
      }
      return files;
    };

    it("lands the fixture bundle and says what it did, one line per concept in path order, then one per file whose links it rewrote", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, admin.email);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `import-bundle: manifest ${BUNDLE_ID} written as the bundle's first commit`,
        ...IMPORTED_PATHS.map((file) => `import-bundle: landed ${file}`),
        ...REWRITTEN_LINES,
        "import-bundle: done — landed 6, skipped 0, 7 checks recorded (0 already present), 4 links rewritten, 0.0 seconds",
      ]);
    });

    it("writes the manifest as the first commit and every concept as its own commit after it, the rows landed with kind, title, status and the class given", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      await importing(app(), workspaceId, admin.email);

      const commits = await commitsOf(app(), workspaceId);
      expect(commits).toHaveLength(10);
      expect(commits[0]).toEqual({
        sha: expect.any(String),
        parent_sha: null,
        act: "knowledge.manifest.written",
      });
      expect(commits.slice(1).map((row) => [row["act"], row["parent_sha"]])).toEqual(
        commits.slice(0, -1).map((row) => ["knowledge.concept.committed", row["sha"]]),
      );
      const rows = await indexRowsOf(app(), workspaceId);
      expect(rows.map((row) => row.path)).toEqual(IMPORTED_PATHS);
      expect(rows.map((row) => `${row.kind}: ${row.title}`)).toEqual([
        "Answer: Data retention period",
        "Answer: Support hours",
        "Answer: Can two teams share one account? (Advanced plan)",
        "Answer: Can two teams share one account? (Standard plan)",
        "Tier: Advanced plan",
        "Tier: Standard plan",
      ]);
      expect(new Set(rows.map((row) => `${row.status} ${row.sensitivity}`))).toEqual(
        new Set(["stable Internal"]),
      );
    });

    it("leaves the manifest in the platform's own form, every link an iri across domains and between split concepts, and no relative link or email in any concept file", async () => {
      const { workspaceId, admin, mona } = await bundleWorkspace(app());

      await importing(app(), workspaceId, admin.email);

      const files = await filesAtHead(app(), workspaceId, admin.id);
      expect(files.get("knowledge/manifest.yaml")).toBe(
        [
          `"id": "${BUNDLE_ID}"`,
          '"origin": "company"',
          '"ref": "Two answer libraries, reviewed 22 September 2026"',
          '"owner": "Acme Software Ltd"',
          '"content_version": "2026-09-22"',
          "",
        ].join("\n"),
      );
      for (const file of IMPORTED_PATHS) {
        expect(files.get(file)).not.toContain("@");
        expect(files.get(file)).not.toMatch(/\]\([^)]*\.md/);
        expect(files.get(file)).toContain(`"by": "human:${mona}"`);
      }
      expect(files.get("knowledge/company/answers/support-hours.md")).toContain(
        `[Advanced plan](${await iriOf(app(), workspaceId, "knowledge/product/tiers/advanced-plan.md")}) customers reach an engineer out of hours`,
      );
      expect(
        files.get("knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md"),
      ).toContain(
        `The [Standard plan's answer](${await iriOf(app(), workspaceId, "knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md")}) describes the looser default`,
      );
    });

    it("open follows a rewritten link to the concept it names", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());
      await importing(app(), workspaceId, admin.email);
      const opening = (iri: string) =>
        reading(app(), workspaceId, admin.id, (principal, tx) =>
          open(principal, tx, { iri }, IMPORTED_AT),
        );

      const from = await opening(
        await iriOf(app(), workspaceId, "knowledge/company/answers/support-hours.md"),
      );
      if (!from.found) throw new Error("the linking concept did not open");
      const target = /\]\((https:\/\/[^)]+)\)/.exec(from.concept?.body ?? "")?.[1] ?? "";
      const to = await opening(target);

      if (!to.found) throw new Error(`nothing stands at ${target}`);
      expect(to.concept?.frontmatter["title"]).toBe("Advanced plan");
    });

    it("records each verified event as an imported check with a null hash and one audit event, so find and open say Checked by the member's name · imported", async () => {
      const { workspaceId, admin, mona, theo } = await bundleWorkspace(app());

      await importing(app(), workspaceId, admin.email);

      const checks = await checkRowsOf(app(), workspaceId);
      expect(checks).toHaveLength(7);
      expect(checks.slice(0, 3)).toEqual([
        {
          path: "knowledge/company/answers/data-retention-period.md",
          actor: `human:${mona}`,
          checked_at: new Date("2026-04-16T00:00:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
        {
          path: "knowledge/company/answers/data-retention-period.md",
          actor: `human:${theo}`,
          checked_at: new Date("2026-06-01T09:30:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
        {
          path: "knowledge/company/answers/support-hours.md",
          actor: `human:${mona}`,
          checked_at: new Date("2026-04-16T00:00:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
      ]);
      expect(await actsOf(app(), workspaceId)).toEqual([
        { act: "knowledge.check.imported", events: 7 },
        { act: "knowledge.concept.committed", events: 9 },
        { act: "knowledge.manifest.written", events: 1 },
      ]);

      const found = await reading(app(), workspaceId, admin.id, (principal, tx) =>
        find(principal, tx, { query: "retention", limit: 10 }, IMPORTED_AT),
      );
      const [hit, ...rest] = found.hits;
      expect(rest).toEqual([]);
      if (hit?.layer !== "bundles") throw new Error("the hit is not a concept");
      expect({
        kind: hit.kind,
        title: hit.title,
        tags: hit.tags,
        words: trustWords(hit.trust),
      }).toEqual({
        kind: "Answer",
        title: "Data retention period",
        tags: ["company", "data-protection", "g-cloud-15"],
        words: "Checked by Theo Approver · 1 June 2026 · imported",
      });

      const opened = await reading(app(), workspaceId, admin.id, (principal, tx) =>
        open(principal, tx, { iri: hit.iri }, IMPORTED_AT),
      );
      if (!opened.found) throw new Error("the concept was not found");
      expect(opened.concept?.trust).toEqual({
        tier: "human-reviewed",
        status: "current",
        checkedBy: "Theo Approver",
        checkedAt: "2026-06-01T09:30:00.000Z",
        rider: "imported",
      });
      expect(opened.concept?.frontmatter["verified"]).toEqual([
        { by: `human:${mona}`, at: "2026-04-16T00:00:00Z" },
        { by: `human:${theo}`, at: "2026-06-01T09:30:00Z" },
      ]);
    });

    it("skips every landed concept and every present check on a rerun, rewrites no link, and says so", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());
      await importing(app(), workspaceId, admin.email);

      const again = await importing(app(), workspaceId, admin.email);

      expect(again.exitCode).toBe(0);
      expect(again.lines).toEqual([
        `import-bundle: manifest ${BUNDLE_ID} already stands`,
        ...IMPORTED_PATHS.map((file) => `import-bundle: skipped ${file} — already landed`),
        "import-bundle: done — landed 0, skipped 6, 0 checks recorded (7 already present), 0 links rewritten, 0.0 seconds",
      ]);
      expect(await commitsOf(app(), workspaceId)).toHaveLength(10);
      expect(await checkRowsOf(app(), workspaceId)).toHaveLength(7);
    });

    it("is reconciled once landed: the watermark is the head and a replay finds nothing to do", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());
      await importing(app(), workspaceId, admin.email);
      const sha = await head(await principalOf(app(), workspaceId, admin.id), openTestGit(app()));

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `reconcile-watermark: done — head ${sha}, watermark ${sha}, replayed 0, already landed 0`,
      ]);
    });

    it("reports what a run would do on a dry run and writes nothing", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, admin.email, ["--dry-run"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `import-bundle: dry run — the tree is sound: 6 concepts, of which 6 would land and 0 already stand; 7 checks would be recorded (0 already present); 4 links in 3 concepts would be rewritten; manifest ${BUNDLE_ID} would be written first; nothing was written`,
      ]);
      expect(await commitsOf(app(), workspaceId)).toEqual([]);
      expect(await indexRowsOf(app(), workspaceId)).toEqual([]);
    });

    it("lands the bundle at the class the flag names", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, admin.email, ["--sensitivity", "Restricted"]);

      expect(run.exitCode).toBe(0);
      expect(
        new Set((await indexRowsOf(app(), workspaceId)).map((row) => row.sensitivity)),
      ).toEqual(new Set(["Restricted"]));
    });

    it("refuses a Viewer as the member it runs as, and writes nothing", async () => {
      const { workspaceId } = await bundleWorkspace(app());
      const viewer = await app().person();
      await app().addMember(workspaceId, viewer.id, "Viewer");

      const run = await importing(app(), workspaceId, viewer.email);

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `import-bundle: REFUSED — ${viewer.email} is a Viewer of this workspace; the import runs as an Admin or an Editor`,
      ]);
      expect(await commitsOf(app(), workspaceId)).toEqual([]);
    });

    it("refuses an Editor asked to land the bundle Restricted, which only an Admin could read back, and writes nothing", async () => {
      const { workspaceId } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, MONA, ["--sensitivity", "Restricted"]);

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `import-bundle: REFUSED — ${MONA} is not an Admin of this workspace, and a bundle landed Restricted is one only an Admin can read back for its second pass; run the import as an Admin`,
      ]);
      expect(await commitsOf(app(), workspaceId)).toEqual([]);
    });

    it("refuses a member email nobody in the workspace has, telling the operator to invite them", async () => {
      const { workspaceId } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, "nobody@acme.invalid");

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `import-bundle: REFUSED — nobody@acme.invalid is not a member of workspace ${workspaceId}; invite them first`,
      ]);
    });

    it("refuses a directory it cannot read, naming it", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      const run = await opsWith(
        app(),
        [
          "import-bundle",
          "--workspace",
          workspaceId,
          "--from",
          "/nowhere/bundle",
          "--as",
          admin.email,
        ],
        { io: { readTree: readTreeUnder } },
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain(
        "import-bundle: REFUSED — the directory /nowhere/bundle could not be read:",
      );
    });

    it.each([
      ["no --from and no --as", []],
      [
        "a sensitivity that is not a class",
        ["--from", "/tmp/bundle", "--as", "a@b.c", "--sensitivity", "Secret"],
      ],
      [
        "a --dry-run carrying a value",
        ["--from", "/tmp/bundle", "--as", "a@b.c", "--dry-run", "yes"],
      ],
    ])("answers usage to %s, before it reads anything", async (_shape, flags) => {
      const { workspaceId } = await bundleWorkspace(app());

      const run = await ops(app(), ["import-bundle", "--workspace", workspaceId, ...flags]);

      expect(run.exitCode).toBe(2);
    });

    it("lands the bundle in a workspace the two commands stood up — provision-workspace for the running Admin, add-member for each verifier — and find reads back Checked by the verifier's name · imported", async () => {
      const owner = await app().person(undefined, "Liam Owner");
      const provisioned = await provisioning(app(), [
        "--name",
        "Acme",
        "--slug",
        aSlug(),
        "--admin",
        owner.email,
      ]);
      expect(provisioned.exitCode).toBe(0);
      const workspaceId = idOnTheDoneLine(provisioned);
      await verifierOf(app(), MONA, "Mona Reviewer");
      await verifierOf(app(), THEO, "Theo Approver");
      for (const verifier of [MONA, THEO]) {
        const added = await adding(app(), workspaceId, verifier, "Editor");
        expect(added.lines).toEqual([
          `add-member: done — ${verifier} added to workspace ${workspaceId} as Editor`,
        ]);
      }

      const run = await importing(app(), workspaceId, owner.email);

      expect(run.exitCode).toBe(0);
      expect(run.lines.at(-1)).toBe(
        "import-bundle: done — landed 6, skipped 0, 7 checks recorded (0 already present), 4 links rewritten, 0.0 seconds",
      );
      const found = await reading(app(), workspaceId, owner.id, (principal, tx) =>
        find(principal, tx, { query: "retention", limit: 10 }, IMPORTED_AT),
      );
      const hit = found.hits[0];
      if (hit?.layer !== "bundles") throw new Error("the hit is not a concept");
      expect(trustWords(hit.trust)).toBe("Checked by Theo Approver · 1 June 2026 · imported");
    });
  });
});
