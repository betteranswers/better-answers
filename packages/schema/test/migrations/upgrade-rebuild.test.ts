import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { DERIVED_FROM_LABEL, FULL_REBUILD_KIND, SUPERSEDES_LABEL, ULID } from "../../src/index.ts";
import { testData } from "../support/factory.ts";
import { type MigratedPostgres, withRollback } from "../support/harness.ts";
import { openMigratedPostgres } from "../support/warm-postgres.ts";
import {
  asTheMigrationOwnerOf,
  migrationStatementSaying,
  migrationStatements,
} from "./journal-statements.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

const UNMAPPED = "01J6RSSSSSSSSSSSSSSSSSSSSS";
const MAPPED = "01J6RRRRRRRRRRRRRRRRRRRRRR";
const ALSO_MAPPED = "01J6RTTTTTTTTTTTTTTTTTTTTT";

type QueuingMigration = { readonly tag: string; readonly owns: readonly string[] };

const THE_MAPS_FIRST_UPGRADE: QueuingMigration = {
  tag: "the-unresolved-references.sql",
  owns: ["TABLE public.job", "TABLE public.map_generation"],
};

const THE_LINEAGE_UPGRADE: QueuingMigration = {
  tag: "the-lineage-rebuilds.sql",
  owns: ["TABLE public.job", "TABLE public.map_edge", "TABLE public.map_unresolved_reference"],
};

type Migrator = "the bound owner" | "a superuser";

const queuingTheUpgradeRebuilds = async (
  client: pg.PoolClient,
  migrator: Migrator,
  runs: number,
  { tag, owns }: QueuingMigration,
): Promise<void> => {
  const theBlock = async () => {
    for (const statement of migrationStatements(tag)) {
      if (statement.includes("FUNCTION pg_temp.")) await client.query(statement);
    }
    for (let run = 0; run < runs; run += 1) {
      await client.query(migrationStatementSaying(tag, "SELECT pg_temp."));
    }
  };
  if (migrator === "a superuser") return theBlock();
  return asTheMigrationOwnerOf(client, owns, theBlock);
};

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

const withTheUnmappedWorkspaceFirst = async (
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> => {
  await withRollback(db.pool, async (client) => {
    const seed = testData(client);
    await seed.workspace({ id: UNMAPPED, name: "The unmapped workspace" });
    await seed.workspace({ id: MAPPED, name: "The mapped workspace" });
    await seed.mapGeneration({ workspaceId: MAPPED });
    await fn(client);
  });
};

describe.each<Migrator>(["the bound owner", "a superuser"])(
  "the upgrade rebuilds migration 0097 queues, run by %s",
  (migrator) => {
    it("queues one upgrade rebuild for each workspace with a map", async () => {
      await withTheUnmappedWorkspaceFirst(async (client) => {
        await queuingTheUpgradeRebuilds(client, migrator, 1, THE_MAPS_FIRST_UPGRADE);

        const queued = await rebuildsWaitingIn(client, MAPPED);
        expect(queued.map(({ reason }) => reason)).toEqual(["upgrade"]);
        expect(queued[0]?.id).toMatch(ULID);
        expect(await rebuildsWaitingIn(client, UNMAPPED)).toEqual([]);
      });
    });

    it("queues no second rebuild while one still waits", async () => {
      await withTheUnmappedWorkspaceFirst(async (client) => {
        await queuingTheUpgradeRebuilds(client, migrator, 2, THE_MAPS_FIRST_UPGRADE);

        expect(await rebuildsWaitingIn(client, MAPPED)).toHaveLength(1);
      });
    });

    it("skips only the workspace whose first build still waits", async () => {
      await withRollback(db.pool, async (client) => {
        const seed = testData(client);
        await seed.workspace({ id: MAPPED, name: "The mapped workspace" });
        await seed.workspace({ id: ALSO_MAPPED, name: "The other mapped workspace" });
        await seed.mapGeneration({ workspaceId: MAPPED });
        await seed.mapGeneration({ workspaceId: ALSO_MAPPED });
        await seed.job({ workspaceId: MAPPED, kind: FULL_REBUILD_KIND, reason: "first-build" });

        await queuingTheUpgradeRebuilds(client, migrator, 1, THE_MAPS_FIRST_UPGRADE);

        expect((await rebuildsWaitingIn(client, MAPPED)).map(({ reason }) => reason)).toEqual([
          "first-build",
        ]);
        expect((await rebuildsWaitingIn(client, ALSO_MAPPED)).map(({ reason }) => reason)).toEqual([
          "upgrade",
        ]);
      });
    });
  },
);

const LINKED_ONLY = "01J6RKKKKKKKKKKKKKKKKKKKKK";
const WITH_LINEAGE = "01J6RNNNNNNNNNNNNNNNNNNNNN";
const DERIVED = "01J6RDDDDDDDDDDDDDDDDDDDDD";
const SUPERSEDING = "01J6RPPPPPPPPPPPPPPPPPPPPP";

const withFourMaps = async (fn: (client: pg.PoolClient) => Promise<void>): Promise<void> => {
  await withRollback(db.pool, async (client) => {
    const seed = testData(client);
    await seed.workspace({ id: LINKED_ONLY, name: "The workspace of links only" });
    await seed.workspace({ id: WITH_LINEAGE, name: "The workspace with a lineage row" });
    await seed.workspace({ id: DERIVED, name: "The workspace with a derived edge" });
    await seed.workspace({ id: SUPERSEDING, name: "The workspace with a superseding edge" });
    await seed.mapEdge({ workspaceId: LINKED_ONLY });
    await seed.mapUnresolvedReference({ workspaceId: LINKED_ONLY, relation: "link" });
    await seed.mapUnresolvedReference({
      workspaceId: WITH_LINEAGE,
      relation: "lineage",
      targetPath: "knowledge/The handbook",
    });
    await seed.mapEdge({ workspaceId: DERIVED, label: DERIVED_FROM_LABEL });
    await seed.mapEdge({ workspaceId: SUPERSEDING, label: SUPERSEDES_LABEL });
    await fn(client);
  });
};

describe.each<Migrator>(["the bound owner", "a superuser"])(
  "the lineage rebuilds migration 0099 queues, run by %s",
  (migrator) => {
    it("queues a rebuild only for a map holding lineage", async () => {
      await withFourMaps(async (client) => {
        await queuingTheUpgradeRebuilds(client, migrator, 1, THE_LINEAGE_UPGRADE);

        for (const workspaceId of [WITH_LINEAGE, DERIVED, SUPERSEDING]) {
          const queued = await rebuildsWaitingIn(client, workspaceId);
          expect(queued.map(({ reason }) => reason)).toEqual(["upgrade"]);
          expect(queued[0]?.id).toMatch(ULID);
        }
        expect(await rebuildsWaitingIn(client, LINKED_ONLY)).toEqual([]);
      });
    });

    it("queues no second rebuild when it runs again", async () => {
      await withFourMaps(async (client) => {
        await queuingTheUpgradeRebuilds(client, migrator, 2, THE_LINEAGE_UPGRADE);

        expect(await rebuildsWaitingIn(client, WITH_LINEAGE)).toHaveLength(1);
        expect(await rebuildsWaitingIn(client, DERIVED)).toHaveLength(1);
        expect(await rebuildsWaitingIn(client, SUPERSEDING)).toHaveLength(1);
      });
    });

    it("queues a fresh rebuild beside a retry already tried", async () => {
      await withFourMaps(async (client) => {
        await testData(client).job({
          workspaceId: DERIVED,
          kind: FULL_REBUILD_KIND,
          reason: "first-build",
          attempts: 1,
        });

        await queuingTheUpgradeRebuilds(client, migrator, 1, THE_LINEAGE_UPGRADE);

        const reasons = (await rebuildsWaitingIn(client, DERIVED)).map(({ reason }) => reason);
        expect(reasons.toSorted()).toEqual(["first-build", "upgrade"]);
      });
    });
  },
);
