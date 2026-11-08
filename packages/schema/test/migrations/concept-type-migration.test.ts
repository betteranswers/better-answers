import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, expect, it } from "vitest";

import { conceptIriOf, migrationsFolder, ulid } from "../../src/index.ts";
import { testData } from "../support/factory.ts";
import { THE_LAST_BEFORE_0101, typesStoredBefore0101 } from "./before-the-concept-type.ts";
import { inADatabaseMigratedTo } from "./database-at.ts";

const HELD_UNDER_THE_NEW_NAMES = `
  SELECT (SELECT concept_type FROM concept_index WHERE workspace_id = $1) AS concept,
         (SELECT array_agg(concept_type ORDER BY concept_type) FROM map_node
           WHERE workspace_id = $1) AS nodes,
         (SELECT from_concept_type || ' > ' || to_concept_type FROM map_edge
           WHERE workspace_id = $1) AS edge,
         (SELECT guide_type FROM guide_definition WHERE workspace_id = $1) AS guide,
         (SELECT concept_type FROM guide_expected_fact WHERE workspace_id = $1) AS fact`;

describe("migration 0101 over a populated 0100 database", () => {
  it("keeps each type under its new name, and serves requests", async () => {
    await inADatabaseMigratedTo(THE_LAST_BEFORE_0101, async (pool) => {
      const client = await pool.connect();
      const suggestionId = ulid();
      let workspaceId = "";
      try {
        const seed = testData(client);
        workspaceId = (await seed.workspace()).id;
        const { sha } = await seed.bundleCommit({ workspaceId });
        const { iri } = await seed.conceptIdentity({ workspaceId });
        await seed.mapGeneration({ workspaceId });
        await typesStoredBefore0101(client, {
          workspaceId,
          iri,
          sha,
          product: conceptIriOf(ulid()),
          guideId: ulid(),
          suggestionId,
        });
      } finally {
        client.release();
      }

      await migrate(drizzle(pool), { migrationsFolder });

      const held = await pool.query(HELD_UNDER_THE_NEW_NAMES, [workspaceId]);
      expect(held.rows).toEqual([
        {
          concept: "Policy",
          nodes: ["Policy", "Product"],
          edge: "Policy > Product",
          guide: "Bid library",
          fact: "Insurance policy",
        },
      ]);
      const reading = await pool.connect();
      try {
        await reading.query("SELECT set_config('app.workspace_id', $1, false)", [workspaceId]);
        const served = await reading.query(
          "SELECT concept_type, kind FROM concept_write_request_for($1)",
          [suggestionId],
        );
        expect(served.rows).toEqual([{ concept_type: "Policy", kind: "edit" }]);
      } finally {
        reading.release();
      }
    });
  });
});
