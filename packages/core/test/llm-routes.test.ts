import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";
import {
  type MigratedPostgres,
  startMigratedPostgres,
  testData,
} from "@better-answers/schema/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Claims } from "../src/kernel/index.ts";
import { listRoutes, LLM_PURPOSES } from "../src/llm/index.ts";
import { openPostgres, withPrincipal } from "../src/store/postgres/index.ts";

/**
 * The routes capability through the `llm` slice's export (`[TEST1]`): the workspace's
 * routes as the Principal, five rows whatever is configured, and one workspace's
 * choices invisible to another's member. Seeded as the superuser through the factory
 * and read back through the runtime pool, where RLS applies.
 */

let db: MigratedPostgres;

beforeAll(async () => {
  db = await startMigratedPostgres();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

type Seeded = { readonly workspaceId: string; readonly userId: string };

/** A workspace whose Viewer can read it, with the routes the scenario names. */
const seedWorkspace = async (
  routes: readonly { purpose: "answering" | "embedding"; provider: string; model: string }[],
): Promise<Seeded> => {
  const client = await db.pool.connect();
  try {
    const seed = testData(client);
    const workspace = await seed.workspace();
    const user = await seed.user();
    await seed.member({ workspaceId: workspace.id, userId: user.id, role: "Viewer" });
    for (const route of routes) {
      await seed.llmRoute({
        workspaceId: workspace.id,
        purpose: route.purpose,
        provider: route.provider,
        model: route.model,
      });
    }
    return { workspaceId: workspace.id, userId: user.id };
  } finally {
    client.release();
  }
};

const claimsFor = (seeded: Seeded): Claims => ({
  workspaceId: seeded.workspaceId,
  userId: seeded.userId,
  issuedAt: new Date(),
});

const listAs = async (seeded: Seeded) => {
  const listed = await withPrincipal(openPostgres(db.runtimePool), claimsFor(seeded), listRoutes);
  if (!listed.ok) throw new Error(`the Principal was refused: ${listed.error}`);
  return listed.value;
};

describe("a workspace's model routes", () => {
  it("answers one row per purpose in the purpose order, whatever the workspace has configured", async () => {
    const seeded = await seedWorkspace([
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
      { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
    ]);

    expect(await listAs(seeded)).toEqual([
      { purpose: "extraction", provider: null, model: null, dimensions: null, fixed: false },
      { purpose: "enrichment", provider: null, model: null, dimensions: null, fixed: false },
      {
        purpose: "answering",
        provider: "anthropic",
        model: "claude-sonnet-5",
        dimensions: null,
        fixed: false,
      },
      { purpose: "judging", provider: null, model: null, dimensions: null, fixed: false },
      {
        purpose: "embedding",
        provider: "mistral",
        model: "mistral-embed",
        dimensions: EMBEDDING_DIMENSIONS,
        fixed: true,
      },
    ]);
  });

  it("says a workspace that has chosen nothing has chosen nothing, the embedding route included", async () => {
    const seeded = await seedWorkspace([]);

    const listed = await listAs(seeded);

    expect(listed).toHaveLength(LLM_PURPOSES.length);
    expect(
      listed.every(
        (route) =>
          route.provider === null &&
          route.model === null &&
          route.dimensions === null &&
          !route.fixed,
      ),
    ).toBe(true);
  });

  it("shows a member of one workspace their own routes and never another workspace's", async () => {
    const first = await seedWorkspace([
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
    ]);
    const second = await seedWorkspace([
      { purpose: "answering", provider: "mistral", model: "mistral-large" },
    ]);

    const asFirst = await listAs(first);
    const asSecond = await listAs(second);

    expect(asFirst.find((route) => route.purpose === "answering")).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(asSecond.find((route) => route.purpose === "answering")).toMatchObject({
      provider: "mistral",
      model: "mistral-large",
    });
  });

  it("is kept to one workspace by row-level security, not by the statement's predicate alone", async () => {
    const mine = await seedWorkspace([
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
    ]);
    await seedWorkspace([{ purpose: "answering", provider: "mistral", model: "mistral-large" }]);

    // The same transaction the capability runs in, asked for every route there is:
    // the policy — not the `WHERE workspace_id = $1` the capability also writes — is
    // what leaves the other workspace's rows out of the answer.
    const visible = await withPrincipal(
      openPostgres(db.runtimePool),
      claimsFor(mine),
      async (_principal, tx) => {
        const all = await tx.query<{ workspace_id: string }>("SELECT workspace_id FROM llm_route");
        return all.rows.map((row) => row.workspace_id);
      },
    );

    expect(visible).toEqual({ ok: true, value: [mine.workspaceId] });
  });
});
