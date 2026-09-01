import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type MigratedPostgres,
  startMigratedPostgres,
  testData,
  withRollback,
} from "@better-answers/schema/testing";

/**
 * The llm-routing agreement's TypeScript half (ADR 0031): the fixture in
 * `contracts/llm-routing/` is the contract, and this suite proves this tier reads the
 * database's `llm_route_for` the way the fixture says — one route per workspace per
 * purpose, resolved by the database, zero rows on a missing scope. The Python half
 * runs the same cases in `apps/worker/tests/test_tier_contract.py`.
 */

const purpose = z.enum(["extraction", "enrichment", "answering", "judging", "embedding"]);
const fixtureSchema = z.object({
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  routes: z.array(
    z.object({
      id: z.string(),
      workspace_id: z.string(),
      purpose,
      provider: z.string(),
      model: z.string(),
      dimensions: z.number().int().positive().nullable(),
    }),
  ),
  calls: z.array(
    z.object({
      workspace_id: z.string(),
      purpose,
      expect_route_id: z.string().nullable(),
    }),
  ),
});

const fixture = fixtureSchema.parse(
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../../contracts/llm-routing/cases.json"),
      "utf8",
    ),
  ),
);

let db: MigratedPostgres;

beforeAll(async () => {
  db = await startMigratedPostgres();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

describe("the llm-routing agreement", () => {
  it("resolves every fixtured call to exactly the route the fixture expects", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = testData(client);
      for (const workspace of fixture.workspaces) {
        await seed.workspace(workspace);
      }
      for (const route of fixture.routes) {
        await seed.llmRoute({
          id: route.id,
          workspaceId: route.workspace_id,
          purpose: route.purpose,
          provider: route.provider,
          model: route.model,
          dimensions: route.dimensions,
        });
      }

      await client.query("SET LOCAL ROLE app_rt");
      for (const call of fixture.calls) {
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [call.workspace_id]);
        const resolved = await client.query("SELECT id FROM llm_route_for($1::llm_purpose)", [
          call.purpose,
        ]);
        const routeId: string | null = resolved.rows[0]?.id ?? null;
        expect({ ...call, resolved: routeId }).toEqual({
          ...call,
          resolved: call.expect_route_id,
        });
      }
    });
  });

  it("refuses a second route for the same workspace and purpose", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = testData(client);
      const workspace = await seed.workspace();
      const route = await seed.llmRoute({ workspaceId: workspace.id });

      await expect(
        seed.llmRoute({ workspaceId: workspace.id, purpose: route.purpose }),
      ).rejects.toThrow(/duplicate key|unique/);
    });
  });
});
