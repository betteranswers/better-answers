import { CONFIGURED_LLM_ROUTES, LISTED_LLM_ROUTES, testData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import { attempt, type Claims } from "../src/kernel/index.ts";
import { listRoutes, LLM_PURPOSES } from "../src/llm/index.ts";
import { folded, openPostgres, withPrincipal } from "../src/store/postgres/index.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

type Seeded = { readonly workspaceId: string; readonly userId: string };

type SeededRoute = {
  readonly purpose: "answering" | "embedding";
  readonly provider: string;
  readonly model: string;

  readonly retentionTail?: string;
};

const seedWorkspace = async (routes: readonly SeededRoute[]): Promise<Seeded> => {
  const client = await db().pool.connect();
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
        retentionTail: route.retentionTail ?? null,
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
  const listed = folded(
    await withPrincipal(openPostgres(db().runtimePool), claimsFor(seeded), listRoutes),
  );
  if (!listed.ok) {
    throw new Error(`the routes were not listed: ${String(listed.error)}`, {
      cause: listed.error,
    });
  }
  return listed.value;
};

describe("a workspace's model routes", () => {
  it("answers one row per purpose in the purpose order, whatever the workspace has configured", async () => {
    const seeded = await seedWorkspace(CONFIGURED_LLM_ROUTES);

    expect(await listAs(seeded)).toEqual(LISTED_LLM_ROUTES);
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
          route.retentionTail === null &&
          !route.fixed,
      ),
    ).toBe(true);
  });

  it("reads back the retention tail a route carries, in the provider's own words", async () => {
    const tail = "Prompts and outputs are deleted within 30 days; no training on customer data.";
    const seeded = await seedWorkspace([
      {
        purpose: "answering",
        provider: "anthropic",
        model: "claude-sonnet-5",
        retentionTail: tail,
      },
    ]);

    expect((await listAs(seeded)).find((route) => route.purpose === "answering")).toMatchObject({
      retentionTail: tail,
    });
  });

  it("says a route nobody read the provider's terms for has no tail, rather than inventing one", async () => {
    const seeded = await seedWorkspace([
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
    ]);

    expect((await listAs(seeded)).find((route) => route.purpose === "answering")).toMatchObject({
      provider: "anthropic",
      retentionTail: null,
    });
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

    const visible = await withPrincipal(
      openPostgres(db().runtimePool),
      claimsFor(mine),
      async (_principal, tx) => {
        const all = await tx.query<{ workspace_id: string }>("SELECT workspace_id FROM llm_route");
        return all.rows.map((row) => row.workspace_id);
      },
    );

    expect(visible).toEqual({ ok: true, value: [mine.workspaceId] });
  });

  it("hands a caller a store failure to read, and the aborted transaction never commits", async () => {
    const seeded = await seedWorkspace([]);
    let read: Awaited<ReturnType<typeof listRoutes>> | undefined;

    await expect(
      withPrincipal(openPostgres(db().runtimePool), claimsFor(seeded), async (principal, tx) => {
        await attempt(() => tx.query("SELECT no_such_function()"));
        read = await listRoutes(principal, tx);
      }),
    ).rejects.toThrow(/did not commit/);

    expect(read).toMatchObject({ ok: false, error: expect.any(Error) });
  });
});
