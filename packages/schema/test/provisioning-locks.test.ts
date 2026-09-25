import { setTimeout as sleep } from "node:timers/promises";

import type pg from "pg";
import { describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite, sqlstateOf } from "./probes.ts";

const db = postgresForSuite();

const WS_WRITING = "01J6TAAAAAAAAAAAAAAAAAAAAA";
const WS_SIGNING_UP = "01J6TBBBBBBBBBBBBBBBBBBBBB";
const WS_READ_BESIDE = "01J6TCCCCCCCCCCCCCCCCCCCCC";
const WS_SIGNING_UP_TOO = "01J6TDDDDDDDDDDDDDDDDDDDDD";
const WS_WATCHED = "01J6TEEEEEEEEEEEEEEEEEEEEE";

const PROVISION_SETTLES_WITHIN_MS = 10_000;
const POLL_MS = 10;

/** A statement that conflicts with nothing never waits, so any bound tells waiting from not. */
const SHORT_LOCK_WAIT_MS = 1_000;

const outcomeOf = (statement: Promise<unknown>, done: string): Promise<string> =>
  statement.then(() => done, sqlstateOf);

const scopeTo = (client: pg.PoolClient, workspaceId: string) =>
  client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);

/**
 * A connection of its own under app_rt, as each of the product's transactions has, so one can
 * wait on another.
 */
const opened = async (): Promise<pg.PoolClient> => {
  const client = await db().runtimePool.connect();
  await client.query("BEGIN");
  return client;
};

const closed = async (client: pg.PoolClient, { commit }: { commit: boolean }): Promise<void> => {
  try {
    await client.query(commit ? "COMMIT" : "ROLLBACK");
  } finally {
    client.release();
  }
};

const pidOf = async (client: pg.PoolClient): Promise<number> => {
  const read = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = read.rows[0]?.pid;
  if (pid === undefined) throw new Error("the backend named no pid");
  return pid;
};

const untilBlockedOrDone = async (pid: number): Promise<void> => {
  const deadline = Date.now() + PROVISION_SETTLES_WITHIN_MS;
  while (Date.now() < deadline) {
    const seen = await db().pool.query<{ ready: boolean }>(
      `SELECT wait_event_type = 'Lock' OR state LIKE 'idle in transaction%' AS ready
         FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (seen.rows[0]?.ready === true) return;
    await sleep(POLL_MS);
  }
  throw new Error(`backend ${String(pid)} neither waited on a lock nor finished its statement`);
};

const aTenantAtWork = async (
  workspaceId: string,
): Promise<{ bindingId: string; documentId: string }> => {
  const client = await opened();
  let landed = false;
  try {
    const seed = testData(client);
    await seed.workspace({ id: workspaceId, name: "At work" });
    await scopeTo(client, workspaceId);
    await client.query("SELECT create_workspace_partition($1)", [workspaceId]);
    const binding = await seed.sourceBinding({ workspaceId });
    const document = await seed.sourceDocument({ workspaceId, bindingId: binding.id });
    landed = true;
    return { bindingId: binding.id, documentId: document.id };
  } finally {
    await closed(client, { commit: landed });
  }
};

/** The order a sign-up takes them in, so the wait below is the one a real sign-up would be in. */
const provisionStarted = async (
  workspaceId: string,
): Promise<{ client: pg.PoolClient; provisioned: Promise<string> }> => {
  const client = await opened();
  await testData(client).workspace({ id: workspaceId, name: "Signing up" });
  await scopeTo(client, workspaceId);
  const pid = await pidOf(client);
  const provisioned = outcomeOf(
    client.query("SELECT create_workspace_partition($1)", [workspaceId]),
    "provisioned",
  );
  await untilBlockedOrDone(pid);
  return { client, provisioned };
};

const inAShortWait = async (
  workspaceId: string,
  work: (client: pg.PoolClient) => Promise<unknown>,
  done: string,
): Promise<string> => {
  const client = await opened();
  await client.query(`SET LOCAL lock_timeout = ${String(SHORT_LOCK_WAIT_MS)}`);
  await scopeTo(client, workspaceId);
  const outcome = await outcomeOf(work(client), done);
  await closed(client, { commit: outcome === done });
  return outcome;
};

describe("provisioning beside a transaction writing documents and chunks", () => {
  it("lets a document's writer add its chunk, aborting neither side", async () => {
    const { bindingId } = await aTenantAtWork(WS_WRITING);

    const writer = await opened();
    await scopeTo(writer, WS_WRITING);
    const document = await testData(writer).sourceDocument({ workspaceId: WS_WRITING, bindingId });

    const signUp = await provisionStarted(WS_SIGNING_UP);

    const written = await outcomeOf(
      testData(writer).chunk({
        workspaceId: WS_WRITING,
        bindingId,
        sourceDocumentId: document.id,
        locator: "chars:0-12",
        ordinal: 0,
        charStart: 0,
        charEnd: 12,
      }),
      "written",
    );
    await closed(writer, { commit: written === "written" });
    const provisioned = await signUp.provisioned;
    await closed(signUp.client, { commit: provisioned === "provisioned" });

    expect({ written, provisioned }).toEqual({ written: "written", provisioned: "provisioned" });
  });

  it("blocks no other tenant's chunk reads or writes while waiting", async () => {
    const { bindingId, documentId } = await aTenantAtWork(WS_READ_BESIDE);

    const writer = await opened();
    await scopeTo(writer, WS_READ_BESIDE);
    await testData(writer).sourceDocument({ workspaceId: WS_READ_BESIDE, bindingId });

    const signUp = await provisionStarted(WS_SIGNING_UP_TOO);

    const read = await inAShortWait(
      WS_READ_BESIDE,
      (client) => client.query('SELECT count(*) FROM "index".chunk'),
      "read",
    );
    const chunkWritten = await inAShortWait(
      WS_READ_BESIDE,
      (client) =>
        testData(client).chunk({
          workspaceId: WS_READ_BESIDE,
          bindingId,
          sourceDocumentId: documentId,
          locator: "chars:0-12",
          ordinal: 0,
          charStart: 0,
          charEnd: 12,
        }),
      "written",
    );

    await closed(writer, { commit: true });
    const provisioned = await signUp.provisioned;
    await closed(signUp.client, { commit: provisioned === "provisioned" });

    expect({ read, chunkWritten, provisioned }).toEqual({
      read: "read",
      chunkWritten: "written",
      provisioned: "provisioned",
    });
  });

  it("locks in modes blocking no chunk access or document read", async () => {
    await withRollback(db().pool, async (client) => {
      await testData(client).workspace({ id: WS_WATCHED, name: "Watched" });
      await client.query("SET LOCAL ROLE app_rt");
      await scopeTo(client, WS_WATCHED);
      await client.query("SELECT create_workspace_partition($1)", [WS_WATCHED]);

      const held = await client.query<{ relation: string; modes: string[] }>(
        `SELECT relation::regclass::text AS relation, array_agg(mode ORDER BY mode) AS modes
           FROM pg_locks
          WHERE pid = pg_backend_pid() AND locktype = 'relation'
            AND relation IN ('"index".chunk'::regclass, 'public.source_document'::regclass)
          GROUP BY relation
          ORDER BY 1`,
      );

      expect(held.rows).toEqual([
        { relation: "index.chunk", modes: ["AccessShareLock", "ShareUpdateExclusiveLock"] },
        {
          relation: "source_document",
          modes: ["AccessShareLock", "RowShareLock", "ShareRowExclusiveLock"],
        },
      ]);
    });
  });
});
