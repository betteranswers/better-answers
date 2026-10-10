import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { getTableName, type Table } from "drizzle-orm";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { find, open, trustWords } from "@better-answers/core/answering";
import { STORED_DETAIL_KEYS } from "@better-answers/core/audit";
import { writeConcept, writeManifest } from "@better-answers/core/concepts";
import {
  ERASURE,
  rehearseErasure,
  seedSyntheticSubject,
  type ErasureRehearsed,
  type SubjectIdentifiers,
} from "@better-answers/core/erasure";
import { ok, type UserPrincipal } from "@better-answers/core/kernel";
import { connectUpload, connectUploadFields } from "@better-answers/core/sources";
import { fileAtHead, head, initRepository } from "@better-answers/core/store/git";
import { getObject, listObjects } from "@better-answers/core/store/objects";
import {
  folded,
  openPostgres,
  withPrincipal,
  type Answered,
  type Foldable,
  type Tx,
} from "@better-answers/core/store/postgres";
import { SWEEPS, withSweepLock } from "@better-answers/core/sweeps";
import { divergeHistory } from "@better-answers/core/testing/bundle";
import { inputOf } from "@better-answers/core/testing/input";
import { objectStoreForSuite, textOf } from "@better-answers/core/testing/objects";
import {
  countWaitingOnLocks,
  until,
  whileWritesAreRefused,
} from "@better-answers/core/testing/postgres";
import {
  bundleCommit,
  conceptIndex,
  conceptVerification,
  connectedSource,
  erasureRequest,
  ids,
  mapEdge,
  mapGeneration,
  mapNode,
  job,
  sourceDocument,
  suppression,
  ulid,
  type ConceptIri,
} from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { Doors } from "../src/doors.ts";
import type { EmailMessage, Mail } from "../src/email.ts";
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
import { connectAsHost, signIn } from "./flow.ts";
import {
  APP_HOSTNAME,
  capturingLogger,
  doorsFor,
  openTestGit,
  PUBLIC_URL,
  type LogLine,
  type TestApp,
} from "./harness.ts";
import { calledTool, rendered, rpcOf, structured } from "./mcp-call.ts";
import { aPersonHoldingEverything, signedInClient } from "./provoke.ts";
import { servedApp } from "./suite-app.ts";
import { webClientOf } from "./web-client.ts";

type Run = {
  readonly exitCode: number;
  readonly lines: readonly string[];
  readonly logs: readonly LogLine[];
};

/**
 * A replay reads every workspace, so each case erases at an instant of its own and asks for the
 * window holding only that one.
 */
const FROM_THE_ROWS_AT = new Date("2026-06-01T12:00:00.000Z");
const FROM_THE_ROWS_SINCE = "2026-05-31T00:00:00Z";
const FROM_THE_COPY_AT = new Date("2026-07-01T12:00:00.000Z");
const FROM_THE_COPY_SINCE = "2026-06-15T00:00:00Z";

const REPLAYED_AT = new Date("2026-07-15T09:00:00.000Z");

const BEFORE_THE_FINDER_AT = new Date("2026-07-20T12:00:00.000Z");
const BEFORE_THE_FINDER_SINCE = "2026-07-18T00:00:00Z";

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
    const entry = await seed.mapNode({ workspaceId });
    await seed.mapEdge({ workspaceId, fromUid: entry.uid });
    const left = await seed.mapNode({ workspaceId, gen: 2 });
    await seed.mapEdge({ workspaceId, gen: 2, fromUid: left.uid });
  } finally {
    client.release();
  }
};

const answered = (run: Run): unknown => JSON.parse(run.lines[0] ?? "");

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const BOOTSTRAP_ACTOR = "process:better-answers-bootstrap";

/** Table objects, never names, so a renamed table renames what each command must find. */
const SLICE_TABLES: Readonly<Record<string, readonly Table[]>> = {
  "map-rebuild": [mapGeneration, mapNode, mapEdge, job],
  "map-sweep": [mapGeneration, mapNode, mapEdge],
  "map-counts": [mapGeneration, mapNode, mapEdge],
  "reconcile-watermark": [conceptIndex, bundleCommit],
  "object-store-orphans": [sourceDocument],
  "reindex-connected-sources": [connectedSource, job],
  "erasure-rehearsal": [erasureRequest, suppression],
  "import-bundle": [conceptIndex, bundleCommit, conceptVerification],
};

const idOnTheDoneLine = (run: Run): string => {
  const id = /done — (\S+),/.exec(run.lines[0] ?? "")?.[1];
  if (id === undefined) throw new Error(`no id on the done line: ${run.lines.join("\n")}`);
  return id;
};

const aShortName = (): string => `acme-${ulid().toLowerCase()}`;

const provisioning = (app: TestApp, flags: readonly string[]): Promise<Run> =>
  opsWith(app, ["provision-workspace", ...flags], {});

const adding = (app: TestApp, workspaceId: string, email: string, role: string): Promise<Run> =>
  opsWith(app, ["add-member", "--workspace", workspaceId, "--email", email, "--role", role], {});

const membersOf = async (app: TestApp, workspaceId: string, userId: string) => {
  const found = await app.database.superuser.query<{ id: string; role: string }>(
    "SELECT id, role FROM member WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, userId],
  );
  return found.rows;
};

const workspaceCountOf = async (app: TestApp, userId: string): Promise<number> => {
  const found = await app.database.superuser.query("SELECT 1 FROM member WHERE user_id = $1", [
    userId,
  ]);
  return found.rowCount ?? 0;
};

const workspacesWithShortName = async (app: TestApp, shortName: string): Promise<number> => {
  const found = await app.database.superuser.query(
    "SELECT 1 FROM workspace WHERE short_name = $1",
    [shortName],
  );
  return found.rowCount ?? 0;
};

const rowsOfAction = async (app: TestApp, workspaceId: string, action: string) => {
  const found = await app.database.superuser.query<Record<string, unknown>>(
    "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND action = $2 ORDER BY at, id",
    [workspaceId, action],
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

type AuditEventRow = { action: string; actor: string; subject_id: string };

const auditLogOf = async (app: TestApp, workspaceId: string): Promise<readonly AuditEventRow[]> => {
  const found = await app.database.superuser.query<AuditEventRow>(
    "SELECT action, actor, subject_id FROM audit_event WHERE workspace_id = $1 ORDER BY at, id",
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

type QueuedIndexJob = { readonly id: string; readonly subject_id: string };

const queuedIndexJob = async (app: TestApp, workspaceId: string): Promise<QueuedIndexJob> => {
  let queued: QueuedIndexJob | undefined;
  await until(async () => {
    const found = await app.database.superuser.query<QueuedIndexJob>(
      "SELECT id, subject_id FROM job WHERE workspace_id = $1 AND kind = 'index' AND status = 'queued'",
      [workspaceId],
    );
    queued = found.rows[0];
    return queued !== undefined;
  });
  if (queued === undefined) throw new Error(`no index job was ever queued in ${workspaceId}`);
  return queued;
};

const theIndexJobEnded = async (
  app: TestApp,
  workspaceId: string,
  jobId: string,
  status: "done" | "failed",
): Promise<void> => {
  const outcome = status === "done" ? { passages: 1, lmdb_bytes: 0 } : { error: "ConversionError" };
  await app.database.superuser.query(
    `UPDATE job SET status = $3, attempts = attempts + 1, finished_at = now(), outcome = $4
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, jobId, status, outcome],
  );
};

/**
 * This suite runs no worker, so it leaves the rows the worker's sync would: each document's text in
 * one passage, and the job done.
 */
const theSyncLanded = async (
  app: TestApp,
  workspaceId: string,
  readerId: string,
): Promise<void> => {
  const run = await queuedIndexJob(app, workspaceId);
  const reader = await principalOf(app, workspaceId, readerId);
  const documents = await app.database.superuser.query<{ id: string; original_key: string }>(
    "SELECT id, original_key FROM source_document WHERE workspace_id = $1 AND connected_source_id = $2",
    [workspaceId, run.subject_id],
  );
  const client = await app.database.superuser.connect();
  try {
    for (const document of documents.rows) {
      const original = await getObject(reader, objects().door, document.original_key);
      if (!original.ok) throw new Error(`the original was not readable: ${original.error}`);
      const content = await textOf(original.value);
      await testData(client).passage({
        workspaceId,
        connectedSourceId: run.subject_id,
        sourceDocumentId: document.id,
        content,
        locator: `${document.id}/chars:0-${content.length}`,
        ordinal: 0,
        charStart: 0,
        charEnd: content.length,
      });
    }
  } finally {
    client.release();
  }
  await theIndexJobEnded(app, workspaceId, run.id, "done");
};

const theSyncFailed = async (app: TestApp, workspaceId: string): Promise<void> => {
  const run = await queuedIndexJob(app, workspaceId);
  await theIndexJobEnded(app, workspaceId, run.id, "failed");
};

const boundAndIndexed = async (
  app: TestApp,
  workspaceId: string,
  adminId: string,
  text: string,
): Promise<void> => {
  const admin = await principalOf(app, workspaceId, adminId);
  const bytes = new TextEncoder().encode(text);
  const bound = await connectUpload(
    admin,
    { postgres: app.doors.postgres, objects: objects().door },
    {
      ...inputOf(connectUploadFields, {
        connectedSourceId: ulid(),
        name: "The claims handbook",
        fileName: "claims-handbook.md",
        mediaType: "text/markdown",
        byteSize: bytes.byteLength,
      }),
      body: new Blob([bytes]).stream(),
    },
  );
  if (!bound.ok) throw new Error(`the connect was refused: ${String(bound.error)}`);
  await theSyncLanded(app, workspaceId, adminId);
};

/** Completed while the documents finder answered nothing, so its run wiped no connected source. */
const completedBeforeTheFinder = async (
  app: TestApp,
  workspaceId: string,
  at: Date,
  identifiers: SubjectIdentifiers,
): Promise<string> => {
  const client = await app.database.superuser.connect();
  try {
    const seed = testData(client);
    const request = await seed.subjectRequest({
      workspaceId,
      kind: "erasure",
      personId: null,
      identifiers,
      receivedAt: at,
    });
    const erasure = await seed.erasureRequest({
      workspaceId,
      subjectRequestId: request.id,
      anchoredAt: at,
      completedAt: at,
      report: "the report its first run wrote",
    });
    return erasure.id;
  } finally {
    client.release();
  }
};

const whatAReplayReaches = async (app: TestApp, workspaceId: string) => ({
  passages: (
    await app.database.superuser.query<{ id: string }>(
      `SELECT id FROM "index".passage WHERE workspace_id = $1 ORDER BY id`,
      [workspaceId],
    )
  ).rows,
  jobs: (
    await app.database.superuser.query<{ kind: string; reason: string | null; status: string }>(
      "SELECT kind, reason, status FROM job WHERE workspace_id = $1 ORDER BY enqueued_at, id",
      [workspaceId],
    )
  ).rows,
  erasures: (
    await app.database.superuser.query<{ id: string; completed_at: Date; report: string }>(
      "SELECT id, completed_at, report FROM erasure_request WHERE workspace_id = $1",
      [workspaceId],
    )
  ).rows,
  suppressions: (
    await app.database.superuser.query<{ identifiers: unknown }>(
      "SELECT identifiers FROM suppression WHERE workspace_id = $1",
      [workspaceId],
    )
  ).rows,
});

const tokensThePassagesHold = async (
  app: TestApp,
  workspaceId: string,
  tokens: readonly string[],
): Promise<readonly string[]> => {
  const found = await app.database.superuser.query<{ content: string }>(
    `SELECT content FROM "index".passage WHERE workspace_id = $1`,
    [workspaceId],
  );
  return tokens.filter((token) => found.rows.some((row) => row.content.includes(token)));
};

const indexJobsIn = async (app: TestApp, workspaceId: string) => {
  const found = await app.database.superuser.query<{ reason: string; status: string }>(
    "SELECT reason, status FROM job WHERE workspace_id = $1 AND kind = 'index' ORDER BY enqueued_at, id",
    [workspaceId],
  );
  return found.rows;
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

const restoreDrillNote = (
  principal: UserPrincipal,
  doors: ReturnType<typeof bundleDoors>,
  admin: Provisioned["admin"],
) =>
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
  });

const lostInTheWindow = async (
  app: TestApp,
  action: () => Promise<{ readonly ok: boolean }>,
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
    expect((await action()).ok).toBe(false);
  } finally {
    await superuser.query("DROP TRIGGER crash_in_the_window ON bundle_commit");
    await superuser.query("DROP FUNCTION crash_in_the_window()");
  }
};

describe("pnpm ops — the restore scripts' commands", () => {
  const app = servedApp();

  it("reads a dump stamp and an ISO instant alike", () => {
    expect(parseSince("20260903T020500Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("2026-09-03T02:05:00Z")?.toISOString()).toBe("2026-09-03T02:05:00.000Z");
    expect(parseSince("yesterday")).toBeUndefined();
  });

  it("answers usage to a missing or unknown command, never guessing", async () => {
    expect((await ops(app(), [])).exitCode).toBe(2);
    expect((await ops(app(), ["make-it-so"])).exitCode).toBe(2);
    expect((await ops(app(), ["map-counts"])).exitCode).toBe(2);
    expect((await ops(app(), ["replay-erasures"])).exitCode).toBe(2);
  });

  it.each(["toString", "__proto__"])(
    "answers %s, a name every object inherits, as unknown",
    async (command) => {
      const run = await ops(app(), [command, "--workspace", ulid()]);

      expect(run.exitCode).toBe(2);
      expect(run.lines.join("\n")).toContain(`unknown command: ${command}`);
    },
  );

  it("prints a refusal's word and exits with its class's code", async () => {
    const run = await ops(app(), ["map-counts", "--workspace", "not-a-workspace-id"]);

    expect(run.exitCode).toBe(2);
    expect(run.lines.join("\n")).toContain("REFUSED — malformed");
  });

  it("says which runs exit 1 whatever word they name", async () => {
    const run = await ops(app(), ["help"]);

    expect(run.lines.join("\n")).toContain(
      "a run that names the file or commit it stopped at exits 1, whatever word it names: import-bundle's unsound tree and stopped import, reconcile-watermark's stopped replay",
    );
  });

  it("gives each class its own code, telling refusals apart", () => {
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

  it("skips pnpm's -- separator, which is not a command", async () => {
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
    it("proves there is nothing to replay on a pre-journal database", async () => {
      const run = await opsBeforeTheJournal(app(), [
        "replay-erasures",
        "--since",
        "20260901T020500Z",
      ]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("replayed 0 erasures");
      expect(run.lines.join("\n")).toContain("no erasure_request table");
    });

    it("is done, replaying nothing, when no erasure followed the dump", async () => {
      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-12-01T00:00:00Z"], {});

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "replay-erasures: done — replayed 0 erasures since 2026-12-01T00:00:00.000Z",
      ]);
    });

    it("re-applies an erasure the dump undid, from the restored rows", async () => {
      const erased = await erasedAt(app(), FROM_THE_ROWS_AT);

      const run = await opsWith(app(), ["replay-erasures", "--since", FROM_THE_ROWS_SINCE], {});

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `replay-erasures: ${erased.erasureRequestId} in workspace ${erased.workspaceId} — ` +
          "completed 2026-06-01T12:00:00.000Z, read from the restored rows",
        "replay-erasures: done — replayed 1 erasure since 2026-05-31T00:00:00.000Z",
      ]);

      expect(await auditLogOf(app(), erased.workspaceId)).toContainEqual({
        action: "platform.erasure.replayed",
        actor: "process:better-answers-erasure",
        subject_id: erased.erasureRequestId,
      });
    });

    it("re-applies an erasure the rows lack, from its replay copy", async () => {
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

    it("wipes and requeues the subject's source; a rerun only logs", async () => {
      const { workspaceId, admin } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);
      const identifiers: SubjectIdentifiers = {
        emails: ["sam.okafor@meridianfenland.co.uk"],
        names: ["Sam Okafor"],
        other: [],
      };
      await boundAndIndexed(
        app(),
        workspaceId,
        admin.id,
        "Expense claims go to Sam Okafor at sam.okafor@meridianfenland.co.uk by Friday.\n",
      );
      const indexedBefore = await whatAReplayReaches(app(), workspaceId);
      const erasureRequestId = await completedBeforeTheFinder(
        app(),
        workspaceId,
        BEFORE_THE_FINDER_AT,
        identifiers,
      );

      const first = await opsWith(
        app(),
        ["replay-erasures", "--since", BEFORE_THE_FINDER_SINCE],
        {},
      );
      const afterTheFirst = await whatAReplayReaches(app(), workspaceId);
      const second = await opsWith(
        app(),
        ["replay-erasures", "--since", BEFORE_THE_FINDER_SINCE],
        {},
      );

      const replayedOnce = [
        `replay-erasures: ${erasureRequestId} in workspace ${workspaceId} — ` +
          "completed 2026-07-20T12:00:00.000Z, read from the restored rows",
        "replay-erasures: done — replayed 1 erasure since 2026-07-18T00:00:00.000Z",
      ];
      expect(indexedBefore.passages).toHaveLength(1);
      expect([first.exitCode, first.lines]).toEqual([0, replayedOnce]);
      expect(afterTheFirst).toEqual({
        passages: [],
        jobs: [
          { kind: "index", reason: "connected", status: "done" },
          { kind: "index", reason: "wiped", status: "queued" },
        ],
        erasures: [
          {
            id: erasureRequestId,
            completed_at: BEFORE_THE_FINDER_AT,
            report: "the report its first run wrote",
          },
        ],
        suppressions: [{ identifiers }],
      });
      expect([second.exitCode, second.lines]).toEqual([0, replayedOnce]);
      expect(await whatAReplayReaches(app(), workspaceId)).toEqual(afterTheFirst);
      expect(
        (await auditLogOf(app(), workspaceId)).filter(
          (row) => row.action === "platform.erasure.replayed",
        ),
      ).toHaveLength(2);
    });

    it("refuses without a repositories' root, which the rewrite needs", async () => {
      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        doors: { git: undefined },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("GIT_STORE_DIR");
      expect(run.lines.join("\n")).toContain("do not start api");
    });

    it("refuses when the image names no object store", async () => {
      const run = await opsWith(app(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        doors: { objects: undefined },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("no object store is configured");
      expect(run.lines.join("\n")).toContain("do not start api");
    });

    it("refuses an unreachable object store, not assuming nothing is owed", async () => {
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
      "%s says `not built`, exit 3, without its slice's tables",
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

    it("names absent exactly the tables the schema's objects name", async () => {
      expect([...SLICE_COMMANDS].toSorted()).toEqual(Object.keys(SLICE_TABLES).toSorted());

      for (const [command, tables] of Object.entries(SLICE_TABLES)) {
        const run = await opsBeforeTheJournal(app(), [
          command,
          "--workspace",
          "ws_synthetic",
          "--wait",
          "--list",
        ]);
        const absent = tables.map((table) => getTableName(table)).join(", ");

        expect({ command, exitCode: run.exitCode, said: run.lines }).toEqual({
          command,
          exitCode: NOT_BUILT,
          said: [
            `${command}: not built — ${absent} absent from this schema; the slice that owns them has not landed`,
          ],
        });
      }
    });

    it("answers in its own name, never another command's", async () => {
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

    describe("on the synthetic fixture's workspace, as the drill leaves it", () => {
      const synthetic = "01M2SYNTHET1CAAAAAAAAAAAAA";

      beforeAll(async () => {
        const client = await app().database.superuser.connect();
        try {
          await testData(client).workspace({ id: synthetic });
        } finally {
          client.release();
        }
        await initRepository(openTestGit(app()), synthetic);
      });

      it.each([
        {
          command: "reconcile-watermark",
          flags: [],
          exitCode: 0,
          first:
            "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
        },
        {
          command: "map-rebuild",
          flags: [],
          exitCode: 0,
          first: expect.stringMatching(/^map-rebuild: done — enqueued [0-9A-HJKMNP-TV-Z]{26}$/),
        },
        {
          command: "map-sweep",
          flags: [],
          exitCode: 0,
          first: "map-sweep: done — nothing to sweep",
        },
        {
          command: "object-store-orphans",
          flags: ["--list"],
          exitCode: 0,
          first:
            "object-store-orphans: done — 0 objects past the 24-hour grace no document names, removed none",
        },
        {
          command: "map-counts",
          flags: [],
          exitCode: 0,
          first: '{"live_gen":null,"nodes":{},"edges":{}}',
        },
        {
          command: "erasure-rehearsal",
          flags: ["--synthetic", "--run", "--report", "/dev/null"],
          exitCode: EXIT_OF_CLASS.precondition,
          first:
            "erasure-rehearsal: REFUSED — no synthetic subject stands in this workspace — phase one (--seed) has not been run here, or its subject has already been erased",
        },
      ])(
        "$command, run as the drill does, takes the synthetic id",
        async ({ command, flags, exitCode, first }) => {
          const run = await ops(app(), [command, "--workspace", synthetic, ...flags]);

          expect({ exitCode: run.exitCode, first: run.lines[0] }).toEqual({ exitCode, first });
        },
      );
    });
  });

  describe("object-store-orphans — the bytes a failed connect left", () => {
    /**
     * The store stamps an object with its own clock, so the instant the grace is judged from is
     * the suite's own, moved on.
     */
    const aDayOn = (): Date => new Date(Date.now() + 25 * 60 * 60 * 1000);

    const handbook = () => ({
      ...inputOf(connectUploadFields, {
        connectedSourceId: ulid(),
        name: "The staff handbook",
        fileName: "handbook.md",
        mediaType: "text/markdown",
        byteSize: 43,
      }),
      body: new Blob(["The handbook says what the company decided."]).stream(),
    });

    const connectedSourcesOf = async (workspaceId: string, userId: string) => {
      const admin = await principalOf(app(), workspaceId, userId);
      const doors = { postgres: openPostgres(app().database.pool), objects: objects().door };

      const bound = await connectUpload(admin, doors, handbook());
      if (!bound.ok) throw new Error(`the connect was refused: ${String(bound.error)}`);

      /**
       * The job is the transaction's last statement, so refusing it leaves the object the action put
       * before it and no row that names the object.
       */
      const failed = await whileWritesAreRefused(app().database.superuser, "job", () =>
        connectUpload(admin, doors, handbook()),
      );
      if (failed.ok) throw new Error("the connect landed where the queue was refused");
      return { admin, named: bound.value.originalKey };
    };

    it("removes only the original no document names, once past grace", async () => {
      const { workspaceId, admin: person } = await app().provision();
      const { admin, named } = await connectedSourcesOf(workspaceId, person.id);

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
      await connectedSourcesOf(workspaceId, person.id);

      const run = await ops(app(), ["object-store-orphans", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "object-store-orphans: done — removed 0 objects past the 24-hour grace no document names",
      ]);
    });

    it("crosses its refusal as word and class code, removing nothing", async () => {
      const run = await ops(app(), ["object-store-orphans", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.malformed);
      expect(run.lines).toEqual([
        "object-store-orphans: REFUSED — malformed: --workspace ws_synthetic is not a workspace id",
      ]);
    });

    it("refuses when the image has no object store to sweep", async () => {
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
    const pinned = { doors: { clock: { now: () => REHEARSED_AT } } };

    const aWorkspaceToDrillIn = async () => {
      const provisioned = await app().provision();
      await initRepository(openTestGit(app()), provisioned.workspaceId);
      return provisioned;
    };

    /** Phase one waits on the worker's sync over its document, and the suite plays the worker. */
    const seededBeside = async (workspaceId: string, worker: () => Promise<void>) => {
      const [seed] = await Promise.all([
        opsWith(
          app(),
          ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--seed"],
          pinned,
        ),
        worker(),
      ]);
      return seed;
    };

    const seeded = (workspaceId: string, readerId: string) =>
      seededBeside(workspaceId, () => theSyncLanded(app(), workspaceId, readerId));

    it("seeds the subject, answers once indexed, prints their tokens last", async () => {
      const { workspaceId, admin } = await aWorkspaceToDrillIn();

      const run = await seeded(workspaceId, admin.id);

      expect(run.exitCode).toBe(0);

      const email = `subject-${workspaceId.toLowerCase()}@erasure-rehearsal.example.test`;
      expect(run.lines).toEqual([
        `erasure-rehearsal: done — the synthetic subject of ${workspaceId} is seeded (a user row, an Admin member, one concept file and one indexed document naming them); take the dump, then run phase two`,
        `${email},human:${email},Rehearsal subject ${workspaceId}`,
      ]);
      const seededRow = await app().database.superuser.query(
        'SELECT 1 FROM "user" WHERE lower(email) = lower($1)',
        [email],
      );
      expect(seededRow.rowCount).toBe(1);
    });

    it("wipes the subject's passages in phase two, requeueing the source", async () => {
      const { workspaceId, admin } = await aWorkspaceToDrillIn();
      const email = `subject-${workspaceId.toLowerCase()}@erasure-rehearsal.example.test`;
      const name = `Rehearsal subject ${workspaceId}`;

      const seed = await seeded(workspaceId, admin.id);
      const tokens = (seed.lines.at(-1) ?? "").split(",");
      const indexedBefore = await tokensThePassagesHold(app(), workspaceId, tokens);
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

      expect(indexedBefore).toEqual([email, name]);
      expect(run.exitCode).toBe(0);
      expect(await tokensThePassagesHold(app(), workspaceId, tokens)).toEqual([]);
      expect(await indexJobsIn(app(), workspaceId)).toEqual([
        { reason: "connected", status: "done" },
        { reason: "wiped", status: "queued" },
      ]);
    });

    it("refuses phase one when indexing the subject's document fails", async () => {
      const { workspaceId } = await aWorkspaceToDrillIn();

      const run = await seededBeside(workspaceId, () => theSyncFailed(app(), workspaceId));

      const [sync] = await indexJobsIn(app(), workspaceId);
      const jobs = await jobsOf(app(), workspaceId);
      expect(run.exitCode).toBe(1);
      expect(sync).toEqual({ reason: "connected", status: "failed" });
      expect(run.lines).toEqual([
        `erasure-rehearsal: REFUSED — the synthetic subject's document is not indexed: job ${jobs[0]?.id ?? ""} is failed after 1 attempt; the job's own row says what it found`,
      ]);
    });

    it("refuses phase one when no worker indexes in time", async () => {
      const { workspaceId } = await aWorkspaceToDrillIn();

      const run = await opsWith(
        app(),
        [
          "erasure-rehearsal",
          "--workspace",
          workspaceId,
          "--synthetic",
          "--seed",
          "--wait-seconds",
          "1",
        ],
        {},
      );

      const jobs = await jobsOf(app(), workspaceId);
      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `erasure-rehearsal: REFUSED — the synthetic subject's document is not indexed: job ${jobs[0]?.id ?? ""} is still queued after 1 second, so no worker has indexed it`,
      ]);
    });

    it.each([
      ["--seed", []],
      ["--run", ["--report", "report.md"]],
    ])("answers usage to %s with a wait not in seconds", async (phase, report) => {
      const run = await ops(app(), [
        "erasure-rehearsal",
        "--workspace",
        "ws_synthetic",
        "--synthetic",
        phase,
        ...report,
        "--wait-seconds",
        "a minute",
      ]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "erasure-rehearsal: --wait-seconds takes a whole number of seconds",
      ]);
    });

    it("erases the subject, writes the routine's report, reprints the tokens", async () => {
      const { workspaceId, admin } = await aWorkspaceToDrillIn();
      const file = await reportPath();

      const seed = await seeded(workspaceId, admin.id);

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
      expect(await auditLogOf(app(), workspaceId)).toContainEqual({
        action: "platform.erasure.rehearsed",
        actor: "process:better-answers-erasure",
        subject_id: expect.any(String),
      });
    });

    it("logs the erasure's request, arm and deletions, and no address", async () => {
      const { workspaceId, admin } = await aWorkspaceToDrillIn();
      await seeded(workspaceId, admin.id);

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
          arm: "last-workspace",
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

    it("refuses phase two where phase one never ran, erasing nobody", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);
      const file = await reportPath();

      const run = await opsWith(
        app(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--run", "--report", file],
        {},
      );

      expect(run.exitCode).toBe(EXIT_OF_CLASS.precondition);
      expect(run.lines.join("\n")).toContain("no synthetic subject stands in this workspace");
    });

    it("answers usage without --synthetic, the caller's consent to run here", async () => {
      const run = await ops(app(), ["erasure-rehearsal", "--workspace", "ws_synthetic", "--seed"]);

      expect(run.exitCode).toBe(2);
      expect(run.lines.join("\n")).toContain("--synthetic is required");
    });

    it("answers usage to neither or both phases at once", async () => {
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

    it("answers usage to a reportless run, which would prove nothing", async () => {
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

  describe("map-rebuild — the map made again, on the worker's queue", () => {
    it("queues a drill's full rebuild and answers the job's id", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["map-rebuild", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      const queued = await jobsOf(app(), workspaceId);

      expect(queued).toEqual([
        { id: expect.any(String), kind: "full-rebuild", reason: "drill", status: "queued" },
      ]);
      expect(run.lines).toEqual([`map-rebuild: done — enqueued ${queued[0]?.id}`]);
    });

    it("takes the caller's reason from among the six", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), [
        "map-rebuild",
        "--workspace",
        workspaceId,
        "--reason",
        "upgrade",
      ]);

      expect(run.exitCode).toBe(0);
      expect((await jobsOf(app(), workspaceId))[0]?.reason).toBe("upgrade");
    });

    it("answers usage to a reason outside the six, queueing nothing", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), [
        "map-rebuild",
        "--workspace",
        workspaceId,
        "--reason",
        "because-i-said-so",
      ]);

      expect(run.exitCode).toBe(2);
      expect(await jobsOf(app(), workspaceId)).toEqual([]);
    });

    it("refuses a non-id workspace as malformed, naming its flag", async () => {
      const run = await ops(app(), ["map-rebuild", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "map-rebuild: REFUSED — malformed: --workspace ws_synthetic is not a workspace id",
      ]);
    });

    it.each([
      ["a --wait carrying a value", ["--wait", "soon"]],
      ["a non-numeric --wait-seconds", ["--wait-seconds", "soon"]],
      ["a --wait-seconds of zero", ["--wait-seconds", "0"]],
    ])("answers usage to %s, queueing nothing", async (_shape, flags) => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["map-rebuild", "--workspace", workspaceId, ...flags]);

      expect(run.exitCode).toBe(2);
      expect(await jobsOf(app(), workspaceId)).toEqual([]);
    });

    it("waits two minutes by default, as its usage says", async () => {
      const run = await ops(app(), ["help"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain(
        "--wait    poll the job until it is over, 120 seconds",
      );
      expect(run.lines.join("\n")).toContain("--wait-seconds <n>");
    });

    it("waits for its job, done once the worker finishes it", async () => {
      const { workspaceId } = await app().provision();

      const waiting = ops(app(), ["map-rebuild", "--workspace", workspaceId, "--wait"]);
      await finishTheJob(app(), workspaceId, "done");
      const run = await waiting;

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("rebuilt the map");
    });

    it.each(["failed", "poisoned"])(
      "refuses, stopping the restore, when the awaited job is %s",
      async (status) => {
        const { workspaceId } = await app().provision();

        const waiting = ops(app(), ["map-rebuild", "--workspace", workspaceId, "--wait"]);
        await finishTheJob(app(), workspaceId, status);
        const run = await waiting;

        expect(run.exitCode).toBe(1);
        expect(run.lines.join("\n")).toContain("REFUSED");
        expect(run.lines.join("\n")).toContain(status);
      },
    );

    it("refuses when the job is still queued after the wait", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), [
        "map-rebuild",
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

  describe("map-counts — nodes per label and edges, as JSON", () => {
    it("answers the live generation's counts on one diffable line", async () => {
      const { workspaceId } = await app().provision();
      await mapped(app(), workspaceId);

      const run = await ops(app(), ["map-counts", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);

      expect(run.lines).toHaveLength(1);
      expect(answered(run)).toEqual({
        live_gen: 1,
        nodes: { Concept: 2 },
        edges: { LINKS_TO: 1 },
      });
    });

    it("answers zero of everything for an unmapped workspace, never refusing", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["map-counts", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(answered(run)).toEqual({ live_gen: null, nodes: {}, edges: {} });
    });

    it("answers usage to a non-id workspace before reading anything", async () => {
      const run = await ops(app(), ["map-counts", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("map-sweep — the generations a finished rebuild left behind", () => {
    it("sweeps all but the live generation, saying what each held", async () => {
      const { workspaceId } = await app().provision();
      await mapped(app(), workspaceId);

      const run = await ops(app(), ["map-sweep", "--workspace", workspaceId, "--wait"]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["map-sweep: done — swept generation 2 (2 nodes, 1 edge)"]);

      const counted = await ops(app(), ["map-counts", "--workspace", workspaceId]);
      expect(answered(counted)).toEqual({
        live_gen: 1,
        nodes: { Concept: 2 },
        edges: { LINKS_TO: 1 },
      });
    });

    it("sweeps nothing when only the live generation stands", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["map-sweep", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["map-sweep: done — nothing to sweep"]);
    });

    it("answers usage to a non-id workspace before deleting anything", async () => {
      const run = await ops(app(), ["map-sweep", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("reindex-connected-sources — every source wiped and queued again", () => {
    it("wipes an indexed source and queues its wiped sync", async () => {
      const { workspaceId, admin } = await app().provision();
      await boundAndIndexed(app(), workspaceId, admin.id, "Expense claims are paid monthly.\n");

      const run = await ops(app(), ["reindex-connected-sources", "--workspace", workspaceId]);
      const after = await whatAReplayReaches(app(), workspaceId);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reindex-connected-sources: done — 1 connected source wiped (1 passage) and queued to index again",
      ]);
      expect(after.passages).toEqual([]);
      expect(after.jobs.at(-1)).toEqual({ kind: "index", reason: "wiped", status: "queued" });
    });

    it("says so when the workspace holds no connected source", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["reindex-connected-sources", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reindex-connected-sources: done — no connected source to reindex",
      ]);
    });

    it("answers usage to a non-id workspace before wiping anything", async () => {
      const run = await ops(app(), ["reindex-connected-sources", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });

  describe("the two sweeps by hand never overlap the daily pass", () => {
    it.each([
      ["map-sweep", "map-sweep: done — nothing to sweep"],
      [
        "object-store-orphans",
        "object-store-orphans: done — removed 0 objects past the 24-hour grace no document names",
      ],
    ])("%s waits for the pass's sweep lock, then runs", async (command, done) => {
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
    });
  });

  describe("reconcile-watermark — the reconciler on demand, the restore's path", () => {
    it("refuses without a repositories' root, having no bundle to reconcile", async () => {
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

    it("refuses a missing repositories' root directory, naming it", async () => {
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

    it("answers usage to a non-id workspace before opening anything", async () => {
      const run = await ops(app(), ["reconcile-watermark", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });

    it("refuses a missing repository, which means an unrestored store", async () => {
      const { workspaceId } = await app().provision();

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.precondition);
      expect(run.lines).toEqual(["reconcile-watermark: REFUSED — no-such-repository"]);
    });

    it("exits 0 when rows and bundle agree, reporting its findings", async () => {
      const { workspaceId } = await app().provision();
      await initRepository(openTestGit(app()), workspaceId);

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
      ]);
    });

    it("replays a missed commit and lands its concept's row", async () => {
      const { workspaceId, sha } = await replayedAfterTheWindow(app(), restoreDrillNote);

      const landed = await app().database.superuser.query<{ path: string; commit_sha: string }>(
        "SELECT path, commit_sha FROM concept_index WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(landed.rows).toEqual([{ path: "knowledge/restore-drill.md", commit_sha: sha }]);
    });

    it("refuses a diverged history, exiting as a precondition", async () => {
      const { workspaceId } = await replayedAfterTheWindow(app(), restoreDrillNote);
      await divergeHistory(openTestGit(app()), workspaceId);

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.precondition);
      expect(run.lines).toEqual(["reconcile-watermark: REFUSED — history-diverged"]);
    });

    it("replays a missed manifest commit, landing its row, no concept", async () => {
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
        `SELECT c.sha, c.parent_sha, c.actor, e.action, e.detail,
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
          action: "platform.reconciler.replayed",
          detail: { commitSha: sha, bundleId: "01J6BBBBBBBBBBBBBBBBBBBBBB" },
          concepts: 0,
        },
      ]);
    });
  });

  describe("smoke — the platform answers through its interface", () => {
    it("passes against the running api's health, metadata, challenge and shell", async () => {
      const run = await ops(app(), ["smoke", "--url", PUBLIC_URL, "--find", "--guide", "--ask"]);

      expect(run.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);
      expect(run.exitCode).toBe(0);
      expect(run.lines.filter((line) => line.startsWith("ok  "))).toHaveLength(4);

      expect(run.lines.filter((line) => line.startsWith("note "))).toHaveLength(3);
    });

    it("passes on the loopback, sending the app hostname as Host", async () => {
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

  describe("dump-grep — a token's tables and counts, never its lines", () => {
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

    it("names each table holding a token, with counts, or absent", async () => {
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

    it("reports a match outside any COPY section as just that", async () => {
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

    it("names a passage partition as pg_dump heads its section", async () => {
      const partitioned = [
        'COPY index."passage_01K5ZQ8WJ6T3M4N7P9R2S0V1X" (id, workspace_id, content) FROM stdin;',
        "c1\t01K5ZQ8WJ6T3M4N7P9R2S0V1X\tClaims go to jane@example.test by Friday.",
        "\\.",
        "",
      ].join("\n");

      const run = await ops(app(), ["dump-grep", "--tokens", "jane@example.test"], partitioned);

      expect(run.lines).toEqual([
        'jane…st: present in 1 line(s) of table index."passage_01K5ZQ8WJ6T3M4N7P9R2S0V1X"',
      ]);
    });

    it("counts and reports a token named twice only once", async () => {
      const run = await ops(
        app(),
        ["dump-grep", "--tokens", "other@example.test,other@example.test"],
        dump,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["othe…st: present in 1 line(s) of table public.person"]);
    });

    it("reports each distinct token once, in the order first named", async () => {
      const run = await ops(
        app(),
        ["dump-grep", "--tokens", "other@example.test,nobody@example.test,other@example.test"],
        dump,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "othe…st: present in 1 line(s) of table public.person",
        "nobo…st: absent",
      ]);
    });

    it("never counts the COPY header's column names as a row", async () => {
      const run = await ops(app(), ["dump-grep", "--tokens", "id"], dump);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["id: absent"]);
    });
  });

  describe("provision-workspace — a customer's workspace and its first Admin", () => {
    const standingOf = async (app: TestApp, id: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT w.name, w.short_name AS "shortName",
                EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'index' AND c.relname = 'passage_' || w.id) AS partition,
                (SELECT value FROM workspace_config
                  WHERE workspace_id = w.id AND key = 'mcp.tools_list_ttl_ms') AS ttl
           FROM workspace w WHERE w.id = $1`,
        [id],
      );
      return found.rows;
    };

    it("stands up workspace, partition, member, config, audit log and repository", async () => {
      const admin = await app().person(undefined, "Priya Shah");
      const shortName = aShortName();

      const run = await provisioning(app(), [
        "--name",
        "Acme",
        "--short-name",
        shortName,
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(0);
      const id = idOnTheDoneLine(run);
      expect(run.lines).toEqual([
        `provision-workspace: done — ${id}, short name ${shortName}, Admin ${admin.email}`,
      ]);
      expect(await standingOf(app(), id)).toEqual([
        { name: "Acme", shortName, partition: true, ttl: "300000" },
      ]);
      expect(await membersOf(app(), id, admin.id)).toEqual([
        { id: expect.stringMatching(ULID_SHAPE), role: "Admin" },
      ]);
      expect(await rowsOfAction(app(), id, "platform.workspace.provisioned")).toEqual([
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

    it("resolves the Admin's email regardless of case, as sign-in does", async () => {
      const admin = await app().person("Priya.Shah@Acme.Invalid");

      const run = await provisioning(app(), [
        "--name",
        "Acme",
        "--short-name",
        aShortName(),
        "--admin",
        "priya.shah@acme.invalid",
      ]);

      expect(run.exitCode).toBe(0);
      expect(await membersOf(app(), idOnTheDoneLine(run), admin.id)).toEqual([
        { id: expect.stringMatching(ULID_SHAPE), role: "Admin" },
      ]);
    });

    it("refuses no-such-user, says what to do next, writes nothing", async () => {
      const shortName = aShortName();

      const run = await provisioning(app(), [
        "--name",
        "Acme",
        "--short-name",
        shortName,
        "--admin",
        "nobody@acme.invalid",
      ]);

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        "provision-workspace: REFUSED — no-such-user: nobody@acme.invalid has not signed in; have them sign in with an email code first, or add them with add-person, then run this again",
      ]);
      expect(await workspacesWithShortName(app(), shortName)).toBe(0);
    });

    it("refuses no-display-name, says what to do next, writes nothing", async () => {
      const admin = await app().person(undefined, "");
      const shortName = aShortName();

      const run = await provisioning(app(), [
        "--name",
        "Acme",
        "--short-name",
        shortName,
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(9);
      expect(run.lines).toEqual([
        `provision-workspace: REFUSED — no-display-name: ${admin.email} has given no display name; have them sign in and give one, then run this again`,
      ]);
      expect(await workspacesWithShortName(app(), shortName)).toBe(0);
      expect(await workspaceCountOf(app(), admin.id)).toBe(0);
    });

    it("refuses slug-taken for a held short name, writing nothing", async () => {
      const first = await app().person();
      const second = await app().person();
      const shortName = aShortName();
      const held = await provisioning(app(), [
        "--name",
        "One",
        "--short-name",
        shortName,
        "--admin",
        first.email,
      ]);
      expect(held.exitCode).toBe(0);

      const run = await provisioning(app(), [
        "--name",
        "Two",
        "--short-name",
        shortName,
        "--admin",
        second.email,
      ]);

      expect(run.exitCode).toBe(8);
      expect(run.lines).toEqual([
        `provision-workspace: REFUSED — slug-taken: another workspace already holds the short name ${shortName}`,
      ]);
      expect(await workspacesWithShortName(app(), shortName)).toBe(1);
      expect(await workspaceCountOf(app(), second.id)).toBe(0);
    });

    it("refuses malformed for a blank name or short name", async () => {
      const admin = await app().person();

      const run = await provisioning(app(), [
        "--name",
        "   ",
        "--short-name",
        aShortName(),
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "provision-workspace: REFUSED — malformed: the name and the short name must each carry at least one character",
      ]);
      expect(await workspaceCountOf(app(), admin.id)).toBe(0);
    });

    it("refuses without a repositories' root, before writing anything", async () => {
      const admin = await app().person();
      const shortName = aShortName();

      const run = await opsWith(
        app(),
        [
          "provision-workspace",
          "--name",
          "Acme",
          "--short-name",
          shortName,
          "--admin",
          admin.email,
        ],
        { doors: { git: undefined } },
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("GIT_STORE_DIR");
      expect(await workspacesWithShortName(app(), shortName)).toBe(0);
    });

    it.each([
      ["no flags at all", []],
      ["no --admin", ["--name", "Acme", "--short-name", "acme"]],
      ["no --short-name", ["--name", "Acme", "--admin", "a@b.c"]],
      ["no --name", ["--short-name", "acme", "--admin", "a@b.c"]],
    ])("answers usage to %s, reading nothing", async (_shape, flags) => {
      const run = await ops(app(), ["provision-workspace", ...flags]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "provision-workspace: --name <name>, --short-name <short name> and --admin <email> are required",
      ]);
    });

    it("names both commands in the usage", async () => {
      const run = await ops(app(), ["help"]);

      expect(run.lines.join("\n")).toContain(
        "provision-workspace --name <name> --short-name <short name> --admin <email>",
      );
      expect(run.lines.join("\n")).toContain(
        "add-member --workspace <id> --email <email> --role <Admin|Editor|Viewer>",
      );
    });
  });

  describe("add-member — a signed-in person made a workspace's member", () => {
    it.each(["Admin", "Editor", "Viewer"])(
      "makes a person a %s member, with audit events",
      async (role) => {
        const { workspaceId } = await app().provision();
        const person = await app().person();

        const run = await adding(app(), workspaceId, person.email, role);

        expect(run.exitCode).toBe(0);
        expect(run.lines).toEqual([
          `add-member: done — ${person.email} added to workspace ${workspaceId} as ${role}`,
        ]);
        expect(await membersOf(app(), workspaceId, person.id)).toEqual([
          { id: expect.stringMatching(ULID_SHAPE), role },
        ]);
        expect(await rowsOfAction(app(), workspaceId, "people.member.added")).toEqual([
          { actor: BOOTSTRAP_ACTOR, subject_id: person.id, detail: { userId: person.id, role } },
        ]);
      },
    );

    it("resolves the email without regard to case, as sign-in does", async () => {
      const { workspaceId } = await app().provision();
      const person = await app().person("Sam.Okoro@Acme.Invalid");

      const run = await adding(app(), workspaceId, "sam.okoro@acme.invalid", "Viewer");

      expect(run.exitCode).toBe(0);
      expect(await membersOf(app(), workspaceId, person.id)).toEqual([
        { id: expect.stringMatching(ULID_SHAPE), role: "Viewer" },
      ]);
    });

    it("refuses no-such-user, says what to do next, writes nothing", async () => {
      const { workspaceId } = await app().provision();

      const run = await adding(app(), workspaceId, "nobody@acme.invalid", "Editor");

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        "add-member: REFUSED — no-such-user: nobody@acme.invalid has not signed in; have them sign in with an email code first, or add them with add-person, then run this again",
      ]);
      expect(await rowsOfAction(app(), workspaceId, "people.member.added")).toEqual([]);
    });

    it("refuses no-display-name, says what to do next, writes nothing", async () => {
      const { workspaceId } = await app().provision();
      const person = await app().person(undefined, "");

      const run = await adding(app(), workspaceId, person.email, "Editor");

      expect(run.exitCode).toBe(9);
      expect(run.lines).toEqual([
        `add-member: REFUSED — no-display-name: ${person.email} has given no display name; have them sign in and give one, then run this again`,
      ]);
      expect(await workspaceCountOf(app(), person.id)).toBe(0);
      expect(await rowsOfAction(app(), workspaceId, "people.member.added")).toEqual([]);
    });

    it("refuses no-such-workspace for an unknown id, and writes nothing", async () => {
      const person = await app().person();
      const nowhere = ulid();

      const run = await adding(app(), nowhere, person.email, "Editor");

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        `add-member: REFUSED — no-such-workspace: ${nowhere} is not a workspace`,
      ]);
      expect(await workspaceCountOf(app(), person.id)).toBe(0);
      expect(await auditLogOf(app(), nowhere)).toEqual([]);
    });

    it("refuses already-a-member on any repeat, never changing a role", async () => {
      const { workspaceId, admin } = await app().provision();
      const person = await app().person();
      expect((await adding(app(), workspaceId, person.email, "Editor")).exitCode).toBe(0);

      const again = await adding(app(), workspaceId, person.email, "Admin");
      const theAdmin = await adding(app(), workspaceId, admin.email, "Viewer");

      expect([again.exitCode, theAdmin.exitCode]).toEqual([8, 8]);
      expect(again.lines).toEqual([
        `add-member: REFUSED — already-a-member: ${person.email} is already a member of workspace ${workspaceId}; a role change is the Admin's action on the People page`,
      ]);
      expect((await membersOf(app(), workspaceId, person.id)).map((row) => row.role)).toEqual([
        "Editor",
      ]);
      expect((await membersOf(app(), workspaceId, admin.id)).map((row) => row.role)).toEqual([
        "Admin",
      ]);
      expect(await rowsOfAction(app(), workspaceId, "people.member.added")).toHaveLength(1);
    });

    it("answers usage to a fourth role word, and writes nothing", async () => {
      const { workspaceId } = await app().provision();
      const person = await app().person();

      const run = await adding(app(), workspaceId, person.email, "Owner");

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual(["add-member: --role must be one of Admin, Editor, Viewer"]);
      expect(await membersOf(app(), workspaceId, person.id)).toEqual([]);
    });

    it("answers usage to a non-id workspace or a missing flag", async () => {
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

  describe("add-person — a named person before their first sign-in", () => {
    const addingPerson = (app: TestApp, flags: readonly string[]): Promise<Run> =>
      opsWith(app, ["add-person", ...flags], {});

    const personsAt = async (app: TestApp, email: string) => {
      const found = await app.database.superuser.query<{
        id: string;
        name: string;
        email: string;
        email_verified: boolean;
      }>('SELECT id, name, email, email_verified FROM "user" WHERE lower(email) = lower($1)', [
        email,
      ]);
      return found.rows;
    };

    const addedRowsAbout = async (app: TestApp, personId: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT actor, subject_id, detail FROM identity_audit_event
          WHERE subject_id = $1 AND action = 'people.person.added'`,
        [personId],
      );
      return found.rows;
    };

    const addedRowCount = async (app: TestApp): Promise<number> => {
      const found = await app.database.superuser.query<{ rows: number }>(
        "SELECT count(*)::int AS rows FROM identity_audit_event WHERE action = 'people.person.added'",
      );
      return found.rows[0]?.rows ?? 0;
    };

    const aVerifier = (): string => `matthew-${ulid().toLowerCase()}@phew.invalid`;

    const sessionHolder = z.object({
      user: z.object({ id: z.string(), name: z.string(), emailVerified: z.boolean() }),
    });

    it("writes the person and its row, its id first", async () => {
      const email = aVerifier();

      const run = await addingPerson(app(), [
        "--email",
        email.toUpperCase(),
        "--name",
        "Matthew Burgess",
      ]);

      expect(run.exitCode).toBe(0);
      const personId = idOnTheDoneLine(run);
      expect(run.lines).toEqual([
        `add-person: done — ${personId}, ${email}, named Matthew Burgess; unverified until their first email-code sign-in`,
      ]);
      expect(await personsAt(app(), email)).toEqual([
        { id: personId, name: "Matthew Burgess", email, email_verified: false },
      ]);
      expect(await addedRowsAbout(app(), personId)).toEqual([
        { actor: "process:better-answers-identity", subject_id: personId, detail: {} },
      ]);
    });

    it("lets add-member take them, and their sign-in finds them", async () => {
      const { workspaceId } = await app().provision();
      const email = aVerifier();
      const added = await addingPerson(app(), ["--email", email, "--name", "Matthew Burgess"]);
      const personId = idOnTheDoneLine(added);

      const member = await adding(app(), workspaceId, email, "Admin");
      const client = app().client();
      await signIn(app(), client, email);

      expect(member.exitCode).toBe(0);
      expect(await membersOf(app(), workspaceId, personId)).toEqual([
        { id: expect.stringMatching(ULID_SHAPE), role: "Admin" },
      ]);
      const session = sessionHolder.parse(await (await client.fetch("/get-session")).json());
      expect(session.user).toEqual({ id: personId, name: "Matthew Burgess", emailVerified: true });
      expect(await personsAt(app(), email)).toEqual([
        { id: personId, name: "Matthew Burgess", email, email_verified: true },
      ]);
    });

    it.each([
      [
        "a non-address",
        ["--email", "matthew.phew.invalid", "--name", "Matthew Burgess"],
        "malformed: matthew.phew.invalid is not an email address",
      ],
      [
        "a two-line name",
        ["--email", "matthew@phew.invalid", "--name", "Matthew\nBurgess"],
        "display-name-not-one-line: a display name is one line of 1 to 100 characters, with no angle brackets or control characters",
      ],
      [
        "an angle-bracketed name",
        ["--email", "matthew@phew.invalid", "--name", "Matthew <m@phew.invalid>"],
        "display-name-angle-bracket: a display name is one line of 1 to 100 characters, with no angle brackets or control characters",
      ],
    ])("refuses %s in the malformed class, writing nothing", async (_shape, flags, said) => {
      const before = await addedRowCount(app());

      const run = await addingPerson(app(), flags);

      expect(run).toMatchObject({ exitCode: 2, lines: [`add-person: REFUSED — ${said}`] });
      expect(await personsAt(app(), flags[1] ?? "")).toEqual([]);
      expect(await addedRowCount(app())).toBe(before);
    });

    it("refuses person-exists on a repeat or a signed-in address", async () => {
      const email = aVerifier();
      await addingPerson(app(), ["--email", email, "--name", "Matthew Burgess"]);
      const signedIn = await app().person(undefined, "Priya Shah");
      const before = await addedRowCount(app());

      const again = await addingPerson(app(), ["--email", email, "--name", "Matt Burgess"]);
      const held = await addingPerson(app(), [
        "--email",
        signedIn.email.toUpperCase(),
        "--name",
        "Someone Else",
      ]);

      expect([again.exitCode, held.exitCode]).toEqual([8, 8]);
      expect([...again.lines, ...held.lines]).toEqual([
        `add-person: REFUSED — person-exists: ${email} is already a person; add-member takes them as they stand`,
        `add-person: REFUSED — person-exists: ${signedIn.email.toUpperCase()} is already a person; add-member takes them as they stand`,
      ]);
      expect((await personsAt(app(), email)).map((row) => row.name)).toEqual(["Matthew Burgess"]);
      expect((await personsAt(app(), signedIn.email)).map((row) => row.name)).toEqual([
        "Priya Shah",
      ]);
      expect(await addedRowCount(app())).toBe(before);
    });

    it("exits refused, in no word, when the store is unreachable", async () => {
      const gone = new Pool({ connectionString: app().database.connectionUri, max: 1 });
      await gone.end();

      const run = await opsWith(
        app(),
        ["add-person", "--email", aVerifier(), "--name", "Matthew Burgess"],
        { doors: { postgres: openPostgres(gone) } },
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([expect.stringMatching(/^add-person: REFUSED — .*pool/i)]);
    });

    it.each([
      ["no --name", ["--email", "matthew@phew.invalid"]],
      ["no --email", ["--name", "Matthew Burgess"]],
    ])("answers usage to %s", async (_shape, flags) => {
      const run = await ops(app(), ["add-person", ...flags]);

      expect(run).toMatchObject({
        exitCode: 2,
        lines: ["add-person: --email <address> and --name <display name> are required"],
      });
    });

    it("names the command in the usage", async () => {
      const run = await ops(app(), ["help"]);

      expect(run.lines.join("\n")).toContain("add-person --email <address> --name <display name>");
    });
  });

  describe("test-workspace — the journeys' fixture, made or repaired", () => {
    const aFixture = () => {
      const addressDomain = `${ulid().toLowerCase()}.testing.invalid`;
      return {
        addressDomain,
        shortName: `journeys-${ulid().toLowerCase()}`,
        admin: `admin@${addressDomain}`,
        editor: `editor@${addressDomain}`,
        viewer: `viewer@${addressDomain}`,
      };
    };

    type Fixture = ReturnType<typeof aFixture>;

    const flagsOf = (fixture: Fixture): readonly string[] => [
      "--domain",
      fixture.addressDomain,
      "--short-name",
      fixture.shortName,
      "--admin",
      fixture.admin,
      "--editor",
      fixture.editor,
      "--viewer",
      fixture.viewer,
    ];

    const fixing = (app: TestApp, fixture: Fixture): Promise<Run> =>
      opsWith(app, ["test-workspace", ...flagsOf(fixture)], {});

    const rolesIn = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<{ role: string; members: number }>(
        "SELECT role, count(*)::int AS members FROM member WHERE workspace_id = $1 GROUP BY role ORDER BY role",
        [workspaceId],
      );
      return found.rows;
    };

    const auditRowsIn = async (app: TestApp, workspaceId: string): Promise<number> => {
      const found = await app.database.superuser.query(
        "SELECT 1 FROM audit_event WHERE workspace_id = $1",
        [workspaceId],
      );
      return found.rowCount ?? 0;
    };

    const peopleOn = async (app: TestApp, fixture: Fixture): Promise<number> => {
      const found = await app.database.superuser.query(
        'SELECT 1 FROM "user" WHERE lower(email) LIKE $1',
        [`%@${fixture.addressDomain}`],
      );
      return found.rowCount ?? 0;
    };

    it("makes the workspace, its three people and 51 Viewers", async () => {
      const fixture = aFixture();

      const run = await fixing(app(), fixture);

      expect(run.exitCode).toBe(0);
      const id = idOnTheDoneLine(run);
      expect(run.lines).toEqual([
        `test-workspace: done — ${id}, short name ${fixture.shortName}, testing domain ${fixture.addressDomain}; provisioned, mark written, 54 people added, 53 members added`,
      ]);
      expect(await rolesIn(app(), id)).toEqual([
        { role: "Admin", members: 1 },
        { role: "Editor", members: 1 },
        { role: "Viewer", members: 52 },
      ]);
      const reconciled = await ops(app(), ["reconcile-watermark", "--workspace", id]);
      expect(reconciled.lines).toEqual([
        "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
      ]);
    });

    it("reports nothing to do on a second run, recording nothing", async () => {
      const fixture = aFixture();
      const id = idOnTheDoneLine(await fixing(app(), fixture));
      const recorded = await auditRowsIn(app(), id);

      const run = await fixing(app(), fixture);

      expect(run).toMatchObject({
        exitCode: 0,
        lines: [
          `test-workspace: done — ${id}, short name ${fixture.shortName}, testing domain ${fixture.addressDomain}; nothing to do`,
        ],
      });
      expect(await auditRowsIn(app(), id)).toBe(recorded);
    });

    it("prints the stored testing domain and short name, not input", async () => {
      const fixture = aFixture();
      const padded = {
        ...fixture,
        addressDomain: ` ${fixture.addressDomain.toUpperCase()} `,
        shortName: ` ${fixture.shortName} `,
      };

      const run = await fixing(app(), padded);

      const id = idOnTheDoneLine(run);
      expect(run.lines).toEqual([
        `test-workspace: done — ${id}, short name ${fixture.shortName}, testing domain ${fixture.addressDomain}; provisioned, mark written, 54 people added, 53 members added`,
      ]);
    });

    it("names a member outside the fixture, leaving them in place", async () => {
      const fixture = aFixture();
      const id = idOnTheDoneLine(await fixing(app(), fixture));
      const stranger = await app().person(`stranger@${fixture.addressDomain}`, "Sam Stranger");
      await app().addMember(id, stranger.id, "Editor");

      const run = await fixing(app(), fixture);

      expect(run).toMatchObject({
        exitCode: 0,
        lines: [
          `test-workspace: done — ${id}, short name ${fixture.shortName}, testing domain ${fixture.addressDomain}; nothing to do`,
          `test-workspace: stranger@${fixture.addressDomain}, an Editor, is no part of the fixture; left in place`,
        ],
      });
      expect(await membersOf(app(), id, stranger.id)).toEqual([
        { id: expect.stringMatching(ULID_SHAPE), role: "Editor" },
      ]);
    });

    it("refuses an address off the testing domain, writing nothing", async () => {
      const fixture = { ...aFixture(), viewer: "viewer@elsewhere.invalid" };

      const run = await fixing(app(), fixture);

      expect(run).toMatchObject({
        exitCode: 7,
        lines: [
          `test-workspace: REFUSED — off-testing-domain: viewer@elsewhere.invalid is not on ${fixture.addressDomain}, where every test person's address is`,
        ],
      });
      expect(await workspacesWithShortName(app(), fixture.shortName)).toBe(0);
      expect(await peopleOn(app(), fixture)).toBe(0);
    });

    it("refuses an address carrying the operator mark, writing nothing", async () => {
      const fixture = aFixture();
      await app().person(fixture.admin, "Olive Operator");
      await ops(app(), ["operator", "--email", fixture.admin, "--grant"]);

      const run = await fixing(app(), fixture);

      expect(run).toMatchObject({
        exitCode: 7,
        lines: [
          `test-workspace: REFUSED — operator-marked: ${fixture.admin} carries the operator mark, which no test person may; give another address`,
        ],
      });
      expect(await workspacesWithShortName(app(), fixture.shortName)).toBe(0);
      expect(await peopleOn(app(), fixture)).toBe(1);
    });

    it("refuses a test person who is a member elsewhere", async () => {
      const fixture = aFixture();
      const editor = await app().person(fixture.editor, "Eddie Editor");
      const { workspaceId } = await app().provision();
      await app().addMember(workspaceId, editor.id, "Viewer");

      const run = await fixing(app(), fixture);

      expect(run).toMatchObject({
        exitCode: 7,
        lines: [
          `test-workspace: REFUSED — member-elsewhere: ${fixture.editor} is a member of another workspace, and a test person belongs to the test workspace alone; give another address`,
        ],
      });
      expect(await workspacesWithShortName(app(), fixture.shortName)).toBe(0);
    });

    it("refuses a short name whose workspace it cannot adopt", async () => {
      const fixture = aFixture();
      const admin = await app().person();
      const held = await provisioning(app(), [
        "--name",
        "Held",
        "--short-name",
        fixture.shortName,
        "--admin",
        admin.email,
      ]);
      const id = idOnTheDoneLine(held);
      const recorded = await auditRowsIn(app(), id);

      const run = await fixing(app(), fixture);

      expect(run).toMatchObject({
        exitCode: 8,
        lines: [
          `test-workspace: REFUSED — slug-taken: the workspace holding the short name ${fixture.shortName} has a member or a waiting invitation off ${fixture.addressDomain}, so it is not the test workspace; it is left as it is`,
        ],
      });
      expect(await auditRowsIn(app(), id)).toBe(recorded);
      expect(await peopleOn(app(), fixture)).toBe(0);
    });

    it("refuses a test person who never gave a display name", async () => {
      const fixture = aFixture();
      await app().person(fixture.editor, "");

      const run = await fixing(app(), fixture);

      expect(run).toMatchObject({
        exitCode: 9,
        lines: [
          "test-workspace: REFUSED — no-display-name: a test person signed in and gave no display name; have them give one, then run this again",
        ],
      });
    });

    it("says the workspace stands when its repository cannot be made", async () => {
      const fixture = aFixture();
      const notADirectory = path.join(await mkdtemp(path.join(tmpdir(), "no-git-")), "a-file");
      await writeFile(notADirectory, "", "utf8");

      const run = await opsWith(app(), ["test-workspace", ...flagsOf(fixture)], {
        doors: { git: ok({ root: notADirectory }) },
      });

      expect(run.exitCode).toBe(1);
      const held = await app().database.superuser.query<{ id: string }>(
        "SELECT id FROM workspace WHERE short_name = $1",
        [fixture.shortName],
      );
      const id = held.rows[0]?.id ?? "";
      expect(run.lines).toEqual([
        expect.stringMatching(
          new RegExp(
            `^test-workspace: REFUSED — workspace ${id} stands, but its bundle repository could not be made: .+; run this again$`,
            "s",
          ),
        ),
      ]);
      const again = await fixing(app(), fixture);
      expect(again.lines).toEqual([
        `test-workspace: done — ${id}, short name ${fixture.shortName}, testing domain ${fixture.addressDomain}; nothing to do`,
      ]);
    });

    it("refuses without a repositories' root, before writing anything", async () => {
      const fixture = aFixture();

      const run = await opsWith(app(), ["test-workspace", ...flagsOf(fixture)], {
        doors: { git: undefined },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("GIT_STORE_DIR");
      expect(await workspacesWithShortName(app(), fixture.shortName)).toBe(0);
    });

    it.each([
      ["no --domain", 0],
      ["no --short-name", 2],
      ["no --admin", 4],
      ["no --editor", 6],
      ["no --viewer", 8],
    ])("answers usage to %s, writing nothing", async (_shape, at) => {
      const fixture = aFixture();
      const flags = flagsOf(fixture).toSpliced(at, 2);

      const run = await ops(app(), ["test-workspace", ...flags]);

      expect(run).toMatchObject({
        exitCode: 2,
        lines: [
          "test-workspace: --domain <testing domain>, --short-name <short name>, --admin <email>, --editor <email> and --viewer <email> are required",
        ],
      });
      expect(await workspacesWithShortName(app(), fixture.shortName)).toBe(0);
    });

    it("names the command in the usage", async () => {
      const run = await ops(app(), ["help"]);

      expect(run.lines.join("\n")).toContain(
        "test-workspace --domain <testing domain> --short-name <short name> --admin <email> --editor <email> --viewer <email>",
      );
    });
  });

  describe("rename-workspace — the platform renames a workspace", () => {
    const renaming = (app: TestApp, workspaceId: string, flags: readonly string[]): Promise<Run> =>
      opsWith(app, ["rename-workspace", "--workspace", workspaceId, ...flags], {});

    const outcomeOf = async (app: TestApp, workspaceId: string) => {
      const standing = await app.database.superuser.query<{ name: string; shortName: string }>(
        'SELECT name, short_name AS "shortName" FROM workspace WHERE id = $1',
        [workspaceId],
      );
      return {
        standing: standing.rows,
        renamed: await rowsOfAction(app, workspaceId, "platform.workspace.renamed"),
      };
    };

    const renamedEvent = (
      workspaceId: string,
      detail: {
        readonly nameChanged: boolean;
        readonly [STORED_DETAIL_KEYS.shortNameChanged]: boolean;
      },
    ) => ({ actor: BOOTSTRAP_ACTOR, subject_id: workspaceId, detail });

    const MALFORMED =
      "rename-workspace: REFUSED — malformed: give --workspace a workspace id, and --name, --short-name or both a value that is not blank";

    it("renames the name, short name or both, recording each change", async () => {
      const { workspaceId, shortName } = await app().provision({ name: "Acme" });
      const [first, second] = [aShortName(), aShortName()];

      const runs = [
        await renaming(app(), workspaceId, ["--name", "Acme Group"]),
        await renaming(app(), workspaceId, ["--short-name", first]),
        await renaming(app(), workspaceId, ["--name", "Acme Ltd", "--short-name", second]),
      ];

      expect(runs.map((run) => run.exitCode)).toEqual([0, 0, 0]);
      expect(runs.map((run) => run.lines)).toEqual([
        [
          `rename-workspace: done — workspace ${workspaceId} is named Acme Group, short name ${shortName}`,
        ],
        [
          `rename-workspace: done — workspace ${workspaceId} is named Acme Group, short name ${first}`,
        ],
        [
          `rename-workspace: done — workspace ${workspaceId} is named Acme Ltd, short name ${second}`,
        ],
      ]);
      expect(await outcomeOf(app(), workspaceId)).toEqual({
        standing: [{ name: "Acme Ltd", shortName: second }],
        renamed: [
          renamedEvent(workspaceId, {
            nameChanged: true,
            [STORED_DETAIL_KEYS.shortNameChanged]: false,
          }),
          renamedEvent(workspaceId, {
            nameChanged: false,
            [STORED_DETAIL_KEYS.shortNameChanged]: true,
          }),
          renamedEvent(workspaceId, {
            nameChanged: true,
            [STORED_DETAIL_KEYS.shortNameChanged]: true,
          }),
        ],
      });
    });

    it("takes back its own short name without refusing, writing nothing", async () => {
      const { workspaceId, shortName } = await app().provision({ name: "Acme" });

      const run = await renaming(app(), workspaceId, ["--name", "Acme", "--short-name", shortName]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `rename-workspace: done — workspace ${workspaceId} is named Acme, short name ${shortName}`,
      ]);
      expect(await outcomeOf(app(), workspaceId)).toEqual({
        standing: [{ name: "Acme", shortName }],
        renamed: [],
      });
    });

    it("refuses slug-taken for another workspace's short name", async () => {
      const taken = (await app().provision()).shortName;
      const { workspaceId, shortName } = await app().provision({ name: "Acme" });

      const run = await renaming(app(), workspaceId, [
        "--name",
        "Acme Group",
        "--short-name",
        taken,
      ]);

      expect(run.exitCode).toBe(8);
      expect(run.lines).toEqual([
        "rename-workspace: REFUSED — slug-taken: another workspace already holds that short name",
      ]);
      expect(await outcomeOf(app(), workspaceId)).toEqual({
        standing: [{ name: "Acme", shortName }],
        renamed: [],
      });
    });

    it("refuses no-such-workspace for an unknown id, and writes nothing", async () => {
      const nowhere = ulid();

      const run = await renaming(app(), nowhere, ["--name", "Acme Group"]);

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        `rename-workspace: REFUSED — no-such-workspace: ${nowhere} is not a workspace`,
      ]);
      expect(await auditLogOf(app(), nowhere)).toEqual([]);
    });

    it.each([
      ["a blank name", ["--name", "   "]],
      ["a blank short name", ["--name", "Acme Group", "--short-name", " "]],
      ["neither --name nor --short-name", []],
    ])("refuses malformed for %s, changing nothing", async (_shape, flags) => {
      const { workspaceId, shortName } = await app().provision({ name: "Acme" });

      const run = await renaming(app(), workspaceId, flags);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [MALFORMED],
      });
      expect(await outcomeOf(app(), workspaceId)).toEqual({
        standing: [{ name: "Acme", shortName }],
        renamed: [],
      });
    });

    it("refuses malformed for a workspace that is not an id", async () => {
      const run = await renaming(app(), "ws_synthetic", ["--name", "Acme Group"]);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [MALFORMED],
      });
    });

    it.each([
      ["no flags at all", []],
      ["no --workspace", ["--name", "Acme Group", "--short-name", "acme"]],
    ])("answers usage to %s, reading nothing", async (_shape, flags) => {
      const run = await ops(app(), ["rename-workspace", ...flags]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "rename-workspace: --workspace <id> is required, with --name <name>, --short-name <short name> or both",
      ]);
    });

    it("names the command in the usage", async () => {
      const run = await ops(app(), ["help"]);

      expect(run.lines.join("\n")).toContain(
        "rename-workspace --workspace <id> [--name <name>] [--short-name <short name>]",
      );
    });
  });

  describe("restore-sign-in — a person who has lost every factor, restored", () => {
    const NOTICE = "Your better-answers sign-in was restored";
    const RESTORE_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;
    const IDENTITY_ACTOR = "process:better-answers-identity";
    const RESTORED_AT = new Date("2026-10-03T09:00:00.000Z");
    const A_DAY_MS = 24 * 60 * 60_000;
    const sessionRead = z.object({ session: z.object({ id: z.string() }) });
    const CHECK_LINE =
      "restore-sign-in: run this only once you have checked who they are by a channel other than their email, and hand them the code by that same channel, never by email";

    const capturingMail = (send?: Mail["send"]) => {
      const sent: EmailMessage[] = [];
      const mail: Mail = {
        send:
          send ??
          (async (message) => {
            sent.push(message);
          }),
        publicUrl: PUBLIC_URL,
      };
      return { sent, mail };
    };

    const restoring = (email: string, io: Partial<OpsIo> = {}, doors: Partial<Doors> = {}) =>
      opsWith(app(), ["restore-sign-in", "--email", email], {
        io: { mail: capturingMail().mail, ...io },
        doors,
      });

    const codeIn = (run: Run): string => {
      const said = run.lines.find((line) => line.startsWith("restore-sign-in: their restore code"));
      const code = said?.split(": ").at(-1);
      if (code === undefined)
        throw new Error(`no restore code was printed: ${run.lines.join("\n")}`);
      return code;
    };

    const heldBy = async (personId: string) =>
      (
        await app().database.superuser.query(
          `SELECT (SELECT count(*)::int FROM passkey WHERE user_id = u.id) AS passkeys,
                  (SELECT count(*)::int FROM authenticator WHERE user_id = u.id) AS authenticators,
                  (SELECT count(*)::int FROM recovery_code WHERE user_id = u.id) AS "recoveryCodes",
                  (SELECT count(*)::int FROM session WHERE user_id = u.id) AS sessions,
                  u.authenticator_enabled AS "authenticatorEnabled",
                  u.restore_required_at AS "restoreRequiredAt"
             FROM "user" u WHERE u.id = $1`,
          [personId],
        )
      ).rows[0];

    const identityRowsOf = async (personId: string) =>
      (
        await app().database.superuser.query(
          "SELECT action, actor, detail FROM identity_audit_event WHERE subject_id = $1 ORDER BY at, id",
          [personId],
        )
      ).rows;

    const restoreRowsOf = async (email: string) =>
      (
        await app().database.superuser.query<{ value: string; expiresAt: Date }>(
          'SELECT value, expires_at AS "expiresAt" FROM verification WHERE identifier = $1',
          [`operator-restore-${email.toLowerCase()}`],
        )
      ).rows;

    it("clears the person's factors and codes, and ends their sessions", async () => {
      const { person, client } = await aPersonHoldingEverything(app());
      const before = await heldBy(person.id);

      const run = await restoring(person.email, {}, { clock: { now: () => RESTORED_AT } });

      expect(run.exitCode).toBe(0);
      expect(before).toEqual({
        passkeys: 1,
        authenticators: 1,
        recoveryCodes: 10,
        sessions: 2,
        authenticatorEnabled: true,
        restoreRequiredAt: null,
      });
      expect(await heldBy(person.id)).toEqual({
        passkeys: 0,
        authenticators: 0,
        recoveryCodes: 0,
        sessions: 0,
        authenticatorEnabled: false,
        restoreRequiredAt: RESTORED_AT,
      });
      expect(await (await client.fetch("/get-session")).json()).toBeNull();
    });

    it("drops the rows kept under the sessions it ends", async () => {
      const { person, client } = await aPersonHoldingEverything(app());
      const { session } = sessionRead.parse(await (await client.fetch("/get-session")).json());
      const asked = await client.json("/second-factor/confirm/passkey-options", {});
      const challenge = `second-factor-challenge:${session.id}`;
      const kept = async () =>
        (
          await app().database.superuser.query(
            "SELECT identifier FROM verification WHERE identifier = $1",
            [challenge],
          )
        ).rows;
      const before = await kept();

      await restoring(person.email);

      expect(asked.status).toBe(200);
      expect(before).toEqual([{ identifier: challenge }]);
      expect(await kept()).toEqual([]);
    });

    it("writes one record and sends one notice", async () => {
      const person = await app().person();
      const before = await identityRowsOf(person.id);
      const { sent, mail } = capturingMail();

      const run = await restoring(person.email, { mail });

      expect(run.lines.slice(0, 2)).toEqual([
        `restore-sign-in: done — ${person.email} holds no passkey, authenticator or recovery code now, and every session of theirs is signed out`,
        `restore-sign-in: a notice of the restore went to ${person.email}`,
      ]);
      expect((await identityRowsOf(person.id)).slice(before.length)).toEqual([
        { action: "people.person.sign_in_restored", actor: IDENTITY_ACTOR, detail: {} },
      ]);
      expect(sent.map((message) => [message.to, message.subject])).toEqual([
        [person.email, NOTICE],
      ]);
      expect(sent[0]?.text).toBe(
        [
          "Your sign-in was restored. Your passkeys, authenticator and recovery codes no longer work, and every session was signed out.",
          "",
          "If you asked for this, there is nothing more to do.",
          "",
          "If you didn't, tell better-answers support now:",
          "",
          `${PUBLIC_URL}/account`,
        ].join("\n"),
      );
      expect(sent[0]?.html).not.toContain("operator");
    });

    it("says it must follow an identity check by another channel", async () => {
      const person = await app().person();

      const run = await restoring(person.email, {}, { clock: { now: () => RESTORED_AT } });

      expect(run.lines.slice(2)).toEqual([
        `restore-sign-in: their restore code, good once until 2026-10-04T09:00:00.000Z: ${codeIn(run)}`,
        CHECK_LINE,
      ]);
      expect(codeIn(run)).toMatch(RESTORE_CODE);
    });

    it("changes nothing for an unknown address, and says so", async () => {
      const { sent, mail } = capturingMail();

      const run = await restoring("nobody@acme.invalid", { mail });

      expect(run).toMatchObject({
        exitCode: 6,
        lines: [
          "restore-sign-in: REFUSED — no-such-user: nobody@acme.invalid is no one's address here; nothing changed",
        ],
      });
      expect(sent).toEqual([]);
      expect(await restoreRowsOf("nobody@acme.invalid")).toEqual([]);
    });

    it("refuses with no email transport, changing nothing", async () => {
      const { person } = await aPersonHoldingEverything(app());
      const before = await heldBy(person.id);

      const run = await restoring(person.email, { mail: undefined });

      expect(run).toMatchObject({
        exitCode: 1,
        lines: [
          "restore-sign-in: REFUSED — no email transport is configured (SMTP_URL on the api service), so the restore notice cannot go; nothing changed",
        ],
      });
      expect(await heldBy(person.id)).toEqual(before);
      expect(await restoreRowsOf(person.email)).toEqual([]);
    });

    it("keeps the restore when its notice does not go", async () => {
      const person = await app().person();
      const { mail } = capturingMail(async () => {
        throw new Error("the relay refused the message");
      });

      const run = await restoring(person.email, { mail });

      expect(run.exitCode).toBe(0);
      expect(run.lines[1]).toBe(
        `restore-sign-in: the notice to ${person.email} did not go; tell them of the restore yourself`,
      );
      expect(codeIn(run)).toMatch(RESTORE_CODE);
      expect((await heldBy(person.id))?.restoreRequiredAt).not.toBeNull();
    });

    it("sends the next sign-in to setup, which needs the code", async () => {
      const { person } = await aPersonHoldingEverything(app());
      const code = codeIn(await restoring(person.email));
      const client = await signedInClient(app(), person.email);

      const held = await webClientOf(client).api.person.secondFactor.query();
      const adds = [
        await client.json("/authenticator/start", {}),
        await client.json("/passkeys/add-options", { name: "Phone" }),
      ];

      expect(held.restoreRequired).toBe(true);
      expect(adds.map((answer) => answer.status)).toEqual([409, 409]);
      for (const answer of adds) {
        expect(await answer.json()).toEqual({ error: "restore-code-needed" });
      }
      expect((await client.json("/second-factor/restore", { code })).status).toBe(200);
      expect((await client.json("/second-factor/replace/authenticator-start", {})).status).toBe(
        200,
      );
    });

    it("accepts the code once, however the address was typed", async () => {
      const person = await app().person();
      const code = codeIn(await restoring(person.email.toUpperCase()));
      const client = await signedInClient(app(), person.email);

      const first = await client.json("/second-factor/restore", { code });
      const again = await client.json("/second-factor/restore", { code });

      expect([first.status, again.status]).toEqual([200, 400]);
      expect(await again.json()).toEqual({ error: "restore-code-wrong" });
    });

    it("refuses the code once a day has passed", async () => {
      const restoredAgo = async (ageMs: number) => {
        const person = await app().person();
        const restoredAt = new Date(Date.now() - ageMs);
        const run = await restoring(person.email, {}, { clock: { now: () => restoredAt } });
        const client = await signedInClient(app(), person.email);
        return (await client.json("/second-factor/restore", { code: codeIn(run) })).status;
      };

      const statuses = [await restoredAgo(A_DAY_MS - 60_000), await restoredAgo(A_DAY_MS + 60_000)];

      expect(statuses).toEqual([200, 400]);
    });

    it("keeps the code out of every email and log line", async () => {
      const person = await app().person();
      const { sent, mail } = capturingMail();

      const run = await restoring(person.email, { mail });
      const code = codeIn(run);

      expect(sent).toHaveLength(1);
      expect(JSON.stringify(sent)).not.toContain(code);
      expect(JSON.stringify(run.logs)).not.toContain(code);
      expect(await restoreRowsOf(person.email)).toEqual([
        { value: expect.stringMatching(/^[0-9a-f]{64}$/), expiresAt: expect.any(Date) },
      ]);
    });

    it("voids an earlier restore code with a new restore", async () => {
      const person = await app().person();
      const earlier = codeIn(await restoring(person.email));
      const later = codeIn(await restoring(person.email));
      const client = await signedInClient(app(), person.email);

      const statuses = [
        (await client.json("/second-factor/restore", { code: earlier })).status,
        (await client.json("/second-factor/restore", { code: later })).status,
      ];

      expect(statuses).toEqual([400, 200]);
      expect(await restoreRowsOf(person.email)).toEqual([]);
    });

    it("answers usage without --email", async () => {
      const run = await opsWith(app(), ["restore-sign-in"], {});

      expect(run).toMatchObject({
        exitCode: 2,
        lines: ["restore-sign-in: --email <email> is required"],
      });
    });

    it("names the command in the usage", async () => {
      const run = await ops(app(), ["help"]);

      expect(run.lines.join("\n")).toContain("restore-sign-in --email <email>");
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

    /**
     * The fixture names its verifiers by a fixed address, so one person row serves every workspace
     * the block provisions.
     */
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
      {
        flags = [],
        from = BUNDLE_FIXTURE,
      }: { readonly flags?: readonly string[]; readonly from?: string } = {},
    ): Promise<Run> =>
      opsWith(
        app,
        ["import-bundle", "--workspace", workspaceId, "--from", from, "--as", email, ...flags],
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
        `SELECT c.sha, c.parent_sha, e.action
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

    const iriOf = async (app: TestApp, workspaceId: string, path: string): Promise<ConceptIri> => {
      const row = (await indexRowsOf(app, workspaceId)).find((each) => each.path === path);
      if (row === undefined) throw new Error(`no concept stands at ${path}`);
      return ids.conceptIri.parse(row.iri);
    };

    const REWRITTEN_LINES = [
      "import-bundle: rewrote knowledge/company/answers/support-hours.md — 1 link",
      "import-bundle: rewrote knowledge/product/answers/can-two-teams-share-one-account-advanced-plan.md — 2 links",
      "import-bundle: rewrote knowledge/product/answers/can-two-teams-share-one-account-standard-plan.md — 1 link",
    ];

    const verificationRowsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT c.path, v.actor, v.verified_at, v.content_hash, v.origin
           FROM concept_verification v
           JOIN concept_index c ON c.workspace_id = v.workspace_id AND c.iri = v.iri
          WHERE v.workspace_id = $1
          ORDER BY c.path, v.verified_at`,
        [workspaceId],
      );
      return found.rows;
    };

    const actionsOf = async (app: TestApp, workspaceId: string) => {
      const found = await app.database.superuser.query<{ action: string; events: number }>(
        `SELECT action, count(*)::int AS events FROM audit_event
          WHERE workspace_id = $1 AND action LIKE 'knowledge.%'
          GROUP BY action ORDER BY action`,
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

    it("lands the fixture, saying each concept, then each rewritten file", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, admin.email);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `import-bundle: manifest ${BUNDLE_ID} written as the bundle's first commit`,
        ...IMPORTED_PATHS.map((file) => `import-bundle: landed ${file}`),
        ...REWRITTEN_LINES,
        "import-bundle: done — landed 6, skipped 0, 7 verifications recorded (0 already present), 4 links rewritten, 0.0 seconds",
      ]);
    });

    it("commits the manifest first, then each concept, landing their rows", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      await importing(app(), workspaceId, admin.email);

      const commits = await commitsOf(app(), workspaceId);
      expect(commits).toHaveLength(10);
      expect(commits[0]).toEqual({
        sha: expect.any(String),
        parent_sha: null,
        action: "knowledge.manifest.written",
      });
      expect(commits.slice(1).map((row) => [row["action"], row["parent_sha"]])).toEqual(
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

    it("normalises the manifest, rewrites links as IRIs, leaves no email", async () => {
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
      const opening = (iri: ConceptIri) =>
        reading(app(), workspaceId, admin.id, (principal, tx) =>
          open(principal, tx, { iri }, IMPORTED_AT),
        );

      const from = await opening(
        await iriOf(app(), workspaceId, "knowledge/company/answers/support-hours.md"),
      );
      if (!from.found) throw new Error("the linking concept did not open");
      const target = /\]\((https:\/\/[^)]+)\)/.exec(from.concept?.body ?? "")?.[1] ?? "";
      const to = await opening(ids.conceptIri.parse(target));

      if (!to.found) throw new Error(`nothing stands at ${target}`);
      expect(to.concept?.frontmatter["title"]).toBe("Advanced plan");
    });

    it("imports verified events as checks that find and open show", async () => {
      const { workspaceId, admin, mona, theo } = await bundleWorkspace(app());

      await importing(app(), workspaceId, admin.email);

      const verifications = await verificationRowsOf(app(), workspaceId);
      expect(verifications).toHaveLength(7);
      expect(verifications.slice(0, 3)).toEqual([
        {
          path: "knowledge/company/answers/data-retention-period.md",
          actor: `human:${mona}`,
          verified_at: new Date("2026-04-16T00:00:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
        {
          path: "knowledge/company/answers/data-retention-period.md",
          actor: `human:${theo}`,
          verified_at: new Date("2026-06-01T09:30:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
        {
          path: "knowledge/company/answers/support-hours.md",
          actor: `human:${mona}`,
          verified_at: new Date("2026-04-16T00:00:00.000Z"),
          content_hash: null,
          origin: "imported",
        },
      ]);
      expect(await actionsOf(app(), workspaceId)).toEqual([
        { action: "knowledge.check.imported", events: 7 },
        { action: "knowledge.concept.committed", events: 9 },
        { action: "knowledge.manifest.written", events: 1 },
      ]);

      const found = await reading(app(), workspaceId, admin.id, (principal, tx) =>
        find(principal, tx, { query: "retention", limit: 10 }, IMPORTED_AT),
      );
      const [match, ...rest] = found.matches;
      expect(rest).toEqual([]);
      if (match?.layer !== "bundles") throw new Error("the match is not a concept");
      expect({
        kind: match.kind,
        title: match.title,
        tags: match.tags,
        words: trustWords(match.trust),
      }).toEqual({
        kind: "Answer",
        title: "Data retention period",
        tags: ["company", "data-protection", "g-cloud-15"],
        words: "Verified by Theo Approver · 1 June 2026 · imported",
      });

      const opened = await reading(app(), workspaceId, admin.id, (principal, tx) =>
        open(principal, tx, { iri: match.iri }, IMPORTED_AT),
      );
      if (!opened.found) throw new Error("the concept was not found");
      expect(opened.concept?.trust).toEqual({
        tier: "human-reviewed",
        status: "current",
        verifiedBy: "Theo Approver",
        verifiedAt: "2026-06-01T09:30:00.000Z",
        rider: "imported",
      });
      expect(opened.concept?.frontmatter["verified"]).toEqual([
        { by: `human:${mona}`, at: "2026-04-16T00:00:00Z" },
        { by: `human:${theo}`, at: "2026-06-01T09:30:00Z" },
      ]);
    });

    const SUPPORT_HOURS = "Support answers between 08:00 and 18:00 on working days.";

    const TWO_SOURCES = [
      "  - id: ENTRY-001",
      "    resource: ../sources/Acme_Bid_Library_v1.md",
      "    title: Acme Bid Library v1, entry ENTRY-001",
      "    locator: p.4",
      "  - id: PROD-005",
      "    resource: ../sources/Acme_Product_Library_v2.md",
      "    title: Acme Product Library v2, entry PROD-005",
    ];

    const openedOverMcp = async (sources: readonly string[], body = SUPPORT_HOURS) => {
      const { workspaceId, admin } = await bundleWorkspace(app());
      const from = await mkdtemp(path.join(tmpdir(), "bundle-"));
      await mkdir(path.join(from, "company", "answers"), { recursive: true });
      await writeFile(
        path.join(from, "manifest.yaml"),
        await readFile(path.join(BUNDLE_FIXTURE, "manifest.yaml")),
      );
      await writeFile(
        path.join(from, "company", "answers", "support-hours.md"),
        [
          "---",
          "type: Answer",
          "title: Support hours",
          `description: ${SUPPORT_HOURS}`,
          "tags: [company, support]",
          "verified:",
          `  - { by: human:${MONA}, at: 2026-04-16T00:00:00Z }`,
          "sources:",
          ...sources,
          "---",
          "",
          body,
          "",
        ].join("\n"),
      );
      await importing(app(), workspaceId, admin.email, { from });
      const iri = await iriOf(app(), workspaceId, "knowledge/company/answers/support-hours.md");
      const { accessToken } = await connectAsHost(app(), app().client(), admin, {
        scope: "knowledge:read offline_access",
      });
      return calledTool(app().client(), accessToken, "open", { iri });
    };

    it("renders imported evidence over MCP, a page as its place", async () => {
      const opened = await openedOverMcp(TWO_SOURCES);

      expect(rendered(opened).split("\n").slice(-3)).toEqual([
        "Evidence:",
        "- Acme Bid Library v1, entry ENTRY-001, p.4",
        "- Acme Product Library v2, entry PROD-005",
      ]);
    });

    it("answers no locator over MCP for none or only spaces", async () => {
      const opened = await openedOverMcp([
        ...TWO_SOURCES,
        "  - id: PROD-006",
        "    resource: ../sources/Acme_Product_Library_v2.md",
        "    title: Acme Product Library v2, entry PROD-006",
        '    locator: "   "',
      ]);

      expect(rpcOf(structured(opened)["concept"])["evidence"]).toStrictEqual([
        { id: "ENTRY-001", source: "Acme Bid Library v1, entry ENTRY-001", at: "p.4" },
        { id: "PROD-005", source: "Acme Product Library v2, entry PROD-005" },
        { id: "PROD-006", source: "Acme Product Library v2, entry PROD-006" },
      ]);
      expect(rendered(opened).split("\n").slice(-4)).toEqual([
        "Evidence:",
        "- Acme Bid Library v1, entry ENTRY-001, p.4",
        "- Acme Product Library v2, entry PROD-005",
        "- Acme Product Library v2, entry PROD-006",
      ]);
    });

    it("renders a newline-ended body over MCP without an extra blank", async () => {
      const opened = await openedOverMcp(TWO_SOURCES, `${SUPPORT_HOURS}\n`);

      expect(rendered(opened).split("\n").slice(0, 5)).toEqual([
        "# Support hours",
        "",
        SUPPORT_HOURS,
        "",
        "_Verified by Mona Reviewer · 16 April 2026 · imported_",
      ]);
    });

    it("skips what already landed on a rerun, and says so", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());
      await importing(app(), workspaceId, admin.email);

      const again = await importing(app(), workspaceId, admin.email);

      expect(again.exitCode).toBe(0);
      expect(again.lines).toEqual([
        `import-bundle: manifest ${BUNDLE_ID} already stands`,
        ...IMPORTED_PATHS.map((file) => `import-bundle: skipped ${file} — already landed`),
        "import-bundle: done — landed 0, skipped 6, 0 verifications recorded (7 already present), 0 links rewritten, 0.0 seconds",
      ]);
      expect(await commitsOf(app(), workspaceId)).toHaveLength(10);
      expect(await verificationRowsOf(app(), workspaceId)).toHaveLength(7);
    });

    it("leaves the watermark at the head, with nothing to replay", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());
      await importing(app(), workspaceId, admin.email);
      const sha = await head(await principalOf(app(), workspaceId, admin.id), openTestGit(app()));

      const run = await ops(app(), ["reconcile-watermark", "--workspace", workspaceId]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `reconcile-watermark: done — head ${sha}, watermark ${sha}, replayed 0, already landed 0`,
      ]);
    });

    it("reports what a dry run would do, writing nothing", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, admin.email, { flags: ["--dry-run"] });

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `import-bundle: dry run — the tree is sound: 6 concepts, of which 6 would land and 0 already stand; 7 verifications would be recorded (0 already present); 4 links in 3 concepts would be rewritten; manifest ${BUNDLE_ID} would be written first; nothing was written`,
      ]);
      expect(await commitsOf(app(), workspaceId)).toEqual([]);
      expect(await indexRowsOf(app(), workspaceId)).toEqual([]);
    });

    it("lands the bundle at the class the flag names", async () => {
      const { workspaceId, admin } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, admin.email, {
        flags: ["--sensitivity", "Restricted"],
      });

      expect(run.exitCode).toBe(0);
      expect(
        new Set((await indexRowsOf(app(), workspaceId)).map((row) => row.sensitivity)),
      ).toEqual(new Set(["Restricted"]));
    });

    it("refuses to run as a Viewer, and writes nothing", async () => {
      const { workspaceId } = await bundleWorkspace(app());
      const viewer = await app().person();
      await app().addMember(workspaceId, viewer.id, "Viewer");

      const run = await importing(app(), workspaceId, viewer.email);

      expect(run.exitCode).toBe(EXIT_OF_CLASS.forbidden);
      expect(run.lines).toEqual([
        `import-bundle: REFUSED — ${viewer.email} is a Viewer of this workspace; the import runs as an Admin or an Editor`,
      ]);
      expect(await commitsOf(app(), workspaceId)).toEqual([]);
    });

    it("refuses an Editor landing Restricted, which only Admins read back", async () => {
      const { workspaceId } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, MONA, {
        flags: ["--sensitivity", "Restricted"],
      });

      expect(run.exitCode).toBe(EXIT_OF_CLASS.forbidden);
      expect(run.lines).toEqual([
        `import-bundle: REFUSED — ${MONA} is not an Admin of this workspace, and a bundle landed Restricted is one only an Admin can read back for its second pass; run the import as an Admin`,
      ]);
      expect(await commitsOf(app(), workspaceId)).toEqual([]);
    });

    it("refuses a non-member's email, telling the operator to invite them", async () => {
      const { workspaceId } = await bundleWorkspace(app());

      const run = await importing(app(), workspaceId, "nobody@acme.invalid");

      expect(run.exitCode).toBe(EXIT_OF_CLASS.unauthenticated);
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
      ["no --from or --as", []],
      [
        "an unknown sensitivity",
        ["--from", "/tmp/bundle", "--as", "a@b.c", "--sensitivity", "Secret"],
      ],
      [
        "a --dry-run carrying a value",
        ["--from", "/tmp/bundle", "--as", "a@b.c", "--dry-run", "yes"],
      ],
    ])("answers usage to %s, reading nothing", async (_shape, flags) => {
      const { workspaceId } = await bundleWorkspace(app());

      const run = await ops(app(), ["import-bundle", "--workspace", workspaceId, ...flags]);

      expect(run.exitCode).toBe(2);
    });

    it("lands in a workspace provision-workspace and add-member stood up", async () => {
      const owner = await app().person(undefined, "Liam Owner");
      const provisioned = await provisioning(app(), [
        "--name",
        "Acme",
        "--short-name",
        aShortName(),
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
        "import-bundle: done — landed 6, skipped 0, 7 verifications recorded (0 already present), 4 links rewritten, 0.0 seconds",
      );
      const found = await reading(app(), workspaceId, owner.id, (principal, tx) =>
        find(principal, tx, { query: "retention", limit: 10 }, IMPORTED_AT),
      );
      const match = found.matches[0];
      if (match?.layer !== "bundles") throw new Error("the match is not a concept");
      expect(trustWords(match.trust)).toBe("Verified by Theo Approver · 1 June 2026 · imported");
    });
  });
});
