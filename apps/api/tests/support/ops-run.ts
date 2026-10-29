import { writeFile } from "node:fs/promises";

import { Pool } from "pg";

import { err, ok } from "@better-answers/core/kernel";
import { connectUpload, connectUploadFields } from "@better-answers/core/sources";
import { getObject } from "@better-answers/core/store/objects";
import { withPrincipal } from "@better-answers/core/store/postgres";
import { inputOf } from "@better-answers/core/testing/input";
import { textOf, type ObjectStore } from "@better-answers/core/testing/objects";
import { until } from "@better-answers/core/testing/postgres";
import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { Doors } from "../../src/doors.ts";
import { runOps, type OpsIo } from "../../src/ops/index.ts";
import {
  APP_HOSTNAME,
  capturingLogger,
  doorsFor,
  type LogLine,
  type TestApp,
} from "./harness/harness.ts";

export type Run = {
  readonly exitCode: number;
  readonly lines: readonly string[];
  readonly logs: readonly LogLine[];
};

export const ioFor = (
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
    modelKeySetting: err("this suite's commands are given no envelope key"),
  };
};

export type Overrides = {
  readonly doors?: Partial<Doors>;
  readonly io?: Partial<OpsIo>;
};

export const BOOTSTRAP_ACTOR = "process:better-answers-bootstrap";

export const idOnTheDoneLine = (run: Run): string => {
  const id = /done — (\S+),/.exec(run.lines[0] ?? "")?.[1];
  if (id === undefined) throw new Error(`no id on the done line: ${run.lines.join("\n")}`);
  return id;
};

export const aShortName = (): string => `acme-${ulid().toLowerCase()}`;

export const rowsOfAction = async (app: TestApp, workspaceId: string, action: string) => {
  const found = await app.database.superuser.query<Record<string, unknown>>(
    "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND action = $2 ORDER BY at, id",
    [workspaceId, action],
  );
  return found.rows;
};

export type QueuedJob = { id: string; kind: string; reason: string | null; status: string };

export const jobsOf = async (app: TestApp, workspaceId: string): Promise<readonly QueuedJob[]> => {
  const found = await app.database.superuser.query<QueuedJob>(
    "SELECT id, kind, reason, status FROM job WHERE workspace_id = $1",
    [workspaceId],
  );
  return found.rows;
};

export type AuditEventRow = { action: string; actor: string; subject_id: string };

export const auditLogOf = async (
  app: TestApp,
  workspaceId: string,
): Promise<readonly AuditEventRow[]> => {
  const found = await app.database.superuser.query<AuditEventRow>(
    "SELECT action, actor, subject_id FROM audit_event WHERE workspace_id = $1 ORDER BY at, id",
    [workspaceId],
  );
  return found.rows;
};

export type QueuedIndexJob = { readonly id: string; readonly subject_id: string };

export const queuedIndexJob = async (
  app: TestApp,
  workspaceId: string,
): Promise<QueuedIndexJob> => {
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

export const theIndexJobEnded = async (
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

export const whatAReplayReaches = async (app: TestApp, workspaceId: string) => ({
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

export const principalOf = async (app: TestApp, workspaceId: string, userId: string) => {
  const principal = await withPrincipal(
    app.doors.postgres,
    { workspaceId, userId, issuedAt: new Date() },
    async (resolved) => resolved,
  );
  if (!principal.ok) throw new Error(`the principal did not resolve: ${principal.error}`);
  return principal.value;
};

export const opsRunner = (objects: () => ObjectStore) => {
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

  const help = async (app: TestApp): Promise<string> => (await ops(app, ["help"])).lines.join("\n");

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

  const provisioning = (app: TestApp, flags: readonly string[]): Promise<Run> =>
    opsWith(app, ["provision-workspace", ...flags], {});

  const adding = (app: TestApp, workspaceId: string, email: string, role: string): Promise<Run> =>
    opsWith(app, ["add-member", "--workspace", workspaceId, "--email", email, "--role", role], {});

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

  return {
    doorsFrom,
    ops,
    help,
    opsWith,
    opsBeforeTheJournal,
    provisioning,
    adding,
    theSyncLanded,
    boundAndIndexed,
  };
};
