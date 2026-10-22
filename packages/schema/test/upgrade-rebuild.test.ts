import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { FULL_REBUILD_KIND, ULID } from "../src/index.ts";
import { testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { asTheMigrationOwnerOf, migrationStatementSaying } from "./journal-statements.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

const MAPPED = "01J6RRRRRRRRRRRRRRRRRRRRRR";
const UNMAPPED = "01J6RSSSSSSSSSSSSSSSSSSSSS";

const THE_MIGRATION = "the-unresolved-references.sql";

const queuingTheUpgradeRebuilds = (client: pg.PoolClient, runs: number): Promise<void> =>
  asTheMigrationOwnerOf(client, ["TABLE public.job", "TABLE public.map_generation"], async () => {
    await client.query(migrationStatementSaying(THE_MIGRATION, "FUNCTION pg_temp.new_ulid"));
    await client.query(
      migrationStatementSaying(THE_MIGRATION, "FUNCTION pg_temp.queue_the_upgrade_rebuilds"),
    );
    for (let run = 0; run < runs; run += 1) {
      await client.query(migrationStatementSaying(THE_MIGRATION, "SELECT pg_temp."));
    }
  });

const rebuildsWaitingIn = async (
  client: pg.PoolClient,
  workspaceId: string,
): Promise<readonly { readonly id: string; readonly reason: string }[]> =>
  (
    await client.query<{ id: string; reason: string }>(
      "SELECT id, reason FROM job WHERE workspace_id = $1 AND kind = $2 AND status = 'queued'",
      [workspaceId, FULL_REBUILD_KIND],
    )
  ).rows;

const withTwoWorkspacesOneMapped = async (
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> => {
  await withRollback(db.pool, async (client) => {
    const seed = testData(client);
    await seed.workspace({ id: MAPPED, name: "The mapped workspace" });
    await seed.workspace({ id: UNMAPPED, name: "The unmapped workspace" });
    await seed.mapGeneration({ workspaceId: MAPPED });
    await fn(client);
  });
};

describe("the upgrade rebuild the unresolved references migration queues", () => {
  it("queues one upgrade rebuild for each workspace with a map", async () => {
    await withTwoWorkspacesOneMapped(async (client) => {
      await queuingTheUpgradeRebuilds(client, 1);

      const queued = await rebuildsWaitingIn(client, MAPPED);
      expect(queued.map(({ reason }) => reason)).toEqual(["upgrade"]);
      expect(queued[0]?.id).toMatch(ULID);
      expect(await rebuildsWaitingIn(client, UNMAPPED)).toEqual([]);
    });
  });

  it("queues no second rebuild while one still waits", async () => {
    await withTwoWorkspacesOneMapped(async (client) => {
      await queuingTheUpgradeRebuilds(client, 2);

      expect(await rebuildsWaitingIn(client, MAPPED)).toHaveLength(1);
    });
  });
});
