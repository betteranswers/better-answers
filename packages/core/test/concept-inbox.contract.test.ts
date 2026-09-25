import { describe, expect, it } from "vitest";
import { z } from "zod";

import { testData, withRollback } from "@better-answers/schema/testing";

import { contractFixture } from "./contract-fixture.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const fixtureSchema = z.object({
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  concepts: z.array(
    z.object({
      workspace_id: z.string(),
      iri: z.string(),
      merge_key: z.string(),
      path: z.string(),
      content_hash: z.string(),
    }),
  ),
  set: z.object({
    role: z.string(),
    workspace_id: z.string(),
    set_id: z.string(),
    kind: z.string(),
    proposer: z.string(),
    requests: z.array(z.record(z.string(), z.unknown())),
  }),
  expect_summary: z.array(
    z.object({
      why: z.string(),
      suggestion_id: z.string(),
      status: z.string(),
      kind: z.string(),
      merge_key: z.string(),
      resolved_iri: z.string().nullable(),
      base_moved: z.boolean(),
    }),
  ),
  refusals: z.array(
    z.object({
      why: z.string(),
      role: z.string(),
      workspace_id: z.string(),
      statement: z.string(),
      sqlstate: z.string(),
    }),
  ),
});

const fixture = contractFixture("concept-inbox", fixtureSchema);

const db = postgresForSuite();

const seedFixture = async (client: Parameters<Parameters<typeof withRollback>[1]>[0]) => {
  const seed = testData(client);
  for (const workspace of fixture.workspaces) await seed.workspace(workspace);
  for (const concept of fixture.concepts) {
    await seed.conceptIdentity({
      workspaceId: concept.workspace_id,
      iri: concept.iri,
      mergeKey: concept.merge_key,
    });
    await seed.conceptIndex({
      workspaceId: concept.workspace_id,
      iri: concept.iri,
      path: concept.path,
      contentHash: concept.content_hash,
    });
  }
};

const submitFixtureSet = async (client: Parameters<Parameters<typeof withRollback>[1]>[0]) => {
  await client.query(`SET LOCAL ROLE ${fixture.set.role}`);
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [fixture.set.workspace_id]);
  const submitted = await client.query<{ submit_suggestion_set: string }>(
    "SELECT * FROM submit_suggestion_set($1, $2, $3, $4::jsonb)",
    [
      fixture.set.set_id,
      fixture.set.kind,
      fixture.set.proposer,
      JSON.stringify(fixture.set.requests),
    ],
  );
  await client.query("RESET ROLE");
  return submitted;
};

describe("the concept-inbox agreement", () => {
  it("submits a set in one call and re-renders its summary", async () => {
    await withRollback(db().pool, async (client) => {
      await seedFixture(client);

      const submitted = await submitFixtureSet(client);
      expect(submitted.rowCount).toBe(fixture.set.requests.length);

      await client.query("SET LOCAL ROLE app_rt");
      const summary = await client.query<Record<string, unknown>>(
        "SELECT suggestion_id, status, kind, merge_key, resolved_iri, base_moved FROM suggestion_set_summary($1)",
        [fixture.set.set_id],
      );

      expect(summary.rows).toEqual(
        fixture.expect_summary.map((expected) => ({
          suggestion_id: expected.suggestion_id,
          status: expected.status,
          kind: expected.kind,
          merge_key: expected.merge_key,
          resolved_iri: expected.resolved_iri,
          base_moved: expected.base_moved,
        })),
      );
    });
  });

  it("refuses each closed road with the code the fixture names", async () => {
    for (const refusal of fixture.refusals) {
      await withRollback(db().pool, async (client) => {
        await seedFixture(client);
        await submitFixtureSet(client);

        await client.query(`SET LOCAL ROLE ${refusal.role}`);
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [
          refusal.workspace_id,
        ]);
        const refused = await client
          .query(refusal.statement)
          .then(() => undefined)
          .catch((cause: unknown) => cause);

        expect({
          why: refusal.why,
          code:
            refused instanceof Error && "code" in refused && typeof refused.code === "string"
              ? refused.code
              : undefined,
        }).toEqual({ why: refusal.why, code: refusal.sqlstate });
      });
    }
  });
});
