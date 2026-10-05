import { describe, expect, it } from "vitest";

import {
  CONFIGURED_MODEL_CHOICES,
  LISTED_MODEL_CHOICES,
  testData,
} from "@better-answers/schema/testing";

import { attempt, type Claims } from "../src/kernel/index.ts";
import { listModelChoices, LLM_PURPOSES } from "../src/llm/index.ts";
import { folded, openPostgres, withPrincipal } from "../src/store/postgres/index.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

type Seeded = { readonly workspaceId: string; readonly userId: string };

type SeededModelChoice = {
  readonly purpose: "answering" | "embedding";
  readonly provider: string;
  readonly model: string;

  readonly retentionTail?: string;
};

const seedWorkspace = async (modelChoices: readonly SeededModelChoice[]): Promise<Seeded> => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const workspace = await seed.workspace();
    const user = await seed.user();
    await seed.member({ workspaceId: workspace.id, userId: user.id, role: "Viewer" });
    for (const modelChoice of modelChoices) {
      await seed.modelChoice({
        workspaceId: workspace.id,
        purpose: modelChoice.purpose,
        provider: modelChoice.provider,
        model: modelChoice.model,
        retentionTail: modelChoice.retentionTail ?? null,
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
    await withPrincipal(openPostgres(db().runtimePool), claimsFor(seeded), listModelChoices),
  );
  if (!listed.ok) {
    throw new Error(`the model choices were not listed: ${String(listed.error)}`, {
      cause: listed.error,
    });
  }
  return listed.value;
};

describe("a workspace's model choices", () => {
  it("answers one row per purpose, in purpose order", async () => {
    const seeded = await seedWorkspace(CONFIGURED_MODEL_CHOICES);

    expect(await listAs(seeded)).toEqual(LISTED_MODEL_CHOICES);
  });

  it("shows every model choice empty where the workspace chose nothing", async () => {
    const seeded = await seedWorkspace([]);

    const listed = await listAs(seeded);

    expect(listed).toHaveLength(LLM_PURPOSES.length);
    expect(
      listed.every(
        (modelChoice) =>
          modelChoice.provider === null &&
          modelChoice.model === null &&
          modelChoice.dimensions === null &&
          modelChoice.retentionTail === null &&
          !modelChoice.fixed,
      ),
    ).toBe(true);
  });

  it("reads a model choice's retention tail in the provider's words", async () => {
    const tail = "Prompts and outputs are deleted within 30 days; no training on customer data.";
    const seeded = await seedWorkspace([
      {
        purpose: "answering",
        provider: "anthropic",
        model: "claude-sonnet-5",
        retentionTail: tail,
      },
    ]);

    expect(
      (await listAs(seeded)).find((modelChoice) => modelChoice.purpose === "answering"),
    ).toMatchObject({
      retentionTail: tail,
    });
  });

  it("answers no tail where nobody read a model choice's terms", async () => {
    const seeded = await seedWorkspace([
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
    ]);

    expect(
      (await listAs(seeded)).find((modelChoice) => modelChoice.purpose === "answering"),
    ).toMatchObject({
      provider: "anthropic",
      retentionTail: null,
    });
  });

  it("shows a member their own workspace's model choices, never another's", async () => {
    const first = await seedWorkspace([
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
    ]);
    const second = await seedWorkspace([
      { purpose: "answering", provider: "mistral", model: "mistral-large" },
    ]);

    const asFirst = await listAs(first);
    const asSecond = await listAs(second);

    expect(asFirst.find((modelChoice) => modelChoice.purpose === "answering")).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(asSecond.find((modelChoice) => modelChoice.purpose === "answering")).toMatchObject({
      provider: "mistral",
      model: "mistral-large",
    });
  });

  it("stays in one workspace by row-level security, not a predicate", async () => {
    const mine = await seedWorkspace([
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
    ]);
    await seedWorkspace([{ purpose: "answering", provider: "mistral", model: "mistral-large" }]);

    const visible = await withPrincipal(
      openPostgres(db().runtimePool),
      claimsFor(mine),
      async (_principal, tx) => {
        const all = await tx.query<{ workspace_id: string }>(
          "SELECT workspace_id FROM model_choice",
        );
        return all.rows.map((row) => row.workspace_id);
      },
    );

    expect(visible).toEqual({ ok: true, value: [mine.workspaceId] });
  });

  it("hands back a store failure, and the transaction never commits", async () => {
    const seeded = await seedWorkspace([]);
    let read: Awaited<ReturnType<typeof listModelChoices>> | undefined;

    await expect(
      withPrincipal(openPostgres(db().runtimePool), claimsFor(seeded), async (principal, tx) => {
        await attempt(() => tx.query("SELECT no_such_function()"));
        read = await listModelChoices(principal, tx);
      }),
    ).rejects.toThrow(/did not commit/);

    expect(read).toMatchObject({ ok: false, error: expect.any(Error) });
  });
});
