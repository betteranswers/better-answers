import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type MigratedPostgres,
  startMigratedPostgres,
  withRollback,
} from "@better-answers/schema/testing";

/**
 * The llm-routing agreement's TypeScript half (ADR 0031): the fixture in
 * `contracts/llm-routing/` is the contract, and this suite proves this tier reads the
 * database's `llm_route_for` the way the fixture says — one route per workspace per
 * purpose, resolved by the database, zero rows on a missing scope. The Python half
 * runs the same cases in `apps/worker/tests/test_tier_contract.py`.
 */

type Fixture = {
  readonly workspaces: readonly { readonly id: string; readonly name: string }[];
  readonly routes: readonly {
    readonly id: string;
    readonly workspace_id: string;
    readonly purpose: string;
    readonly provider: string;
    readonly model: string;
    readonly dimensions: number | null;
  }[];
  readonly calls: readonly {
    readonly workspace_id: string;
    readonly purpose: string;
    readonly expect_route_id: string | null;
  }[];
};

const fixture = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, "../../../contracts/llm-routing/cases.json"),
    "utf8",
  ),
) as Fixture;

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
      for (const workspace of fixture.workspaces) {
        await client.query("INSERT INTO workspace (id, name) VALUES ($1, $2)", [
          workspace.id,
          workspace.name,
        ]);
      }
      for (const route of fixture.routes) {
        await client.query(
          "INSERT INTO llm_route (id, workspace_id, purpose, provider, model, dimensions) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            route.id,
            route.workspace_id,
            route.purpose,
            route.provider,
            route.model,
            route.dimensions,
          ],
        );
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
      const [workspace] = fixture.workspaces;
      const [route] = fixture.routes;
      if (workspace === undefined || route === undefined) {
        throw new Error("the fixture must seed at least one workspace and route");
      }
      await client.query("INSERT INTO workspace (id, name) VALUES ($1, $2)", [
        workspace.id,
        workspace.name,
      ]);
      await client.query(
        "INSERT INTO llm_route (id, workspace_id, purpose, provider, model, dimensions) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          route.id,
          route.workspace_id,
          route.purpose,
          route.provider,
          route.model,
          route.dimensions,
        ],
      );

      await expect(
        client.query(
          "INSERT INTO llm_route (id, workspace_id, purpose, provider, model) VALUES ('route-duplicate', $1, $2, 'other', 'other-model')",
          [route.workspace_id, route.purpose],
        ),
      ).rejects.toThrow(/duplicate key|unique/);
    });
  });
});
