import { describe, expect, it } from "vitest";

import { CONTENT_HASH } from "@better-answers/schema";

import type { UserPrincipal } from "../src/kernel/index.ts";
import {
  dpiaInputFor,
  NOT_RECORDED,
  PLATFORM_HELD_CATEGORIES,
  SPECIAL_CATEGORY_CONDITION,
  type DpiaInput,
} from "../src/sources/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { readingAs, seedingWith } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const acting = <T>(
  who: UserPrincipal,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => readingAs(db().runtimePool, who, work);

type Rules = Readonly<Record<string, boolean>>;

const SAFE_SET: Rules = { default_on: true, default_off: false };

const bindingIn = async (scenario: Scenario, rulesInForce: Rules = SAFE_SET): Promise<string> =>
  seedingWith(
    db().pool,
    async (seed) =>
      (await seed.sourceBinding({ workspaceId: scenario.workspaceId, rulesInForce })).id,
  );

const routeIn = async (
  scenario: Scenario,
  route: {
    readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
    readonly provider: string;
    readonly model: string;
    readonly retentionTail?: string | null;
  },
): Promise<void> => {
  await seedingWith(db().pool, async (seed) => {
    await seed.llmRoute({
      workspaceId: scenario.workspaceId,
      purpose: route.purpose,
      provider: route.provider,
      model: route.model,
      retentionTail: route.retentionTail ?? null,
    });
  });
};

const answeringRouteAndBinding = async (
  scenario: Scenario,
  retentionTail: string | null,
): Promise<string> => {
  await routeIn(scenario, {
    purpose: "answering",
    provider: "anthropic",
    model: "claude-sonnet-5",
    retentionTail,
  });
  return bindingIn(scenario);
};

const documentFor = async (scenario: Scenario, bindingId: string): Promise<DpiaInput> => {
  const read = await acting(scenario.admin, (admin, tx) => dpiaInputFor(admin, tx, { bindingId }));
  if (!read.ok) throw new Error(`the DPIA input was refused: ${String(read.error)}`);
  return read.value.document;
};

const hashFor = async (scenario: Scenario, bindingId: string): Promise<string> => {
  const read = await acting(scenario.admin, (admin, tx) => dpiaInputFor(admin, tx, { bindingId }));
  if (!read.ok) throw new Error(`the DPIA input was refused: ${String(read.error)}`);
  return read.value.hash;
};

const setRulesInForce = async (workspaceId: string, bindingId: string, rules: Rules) => {
  await db().pool.query(
    "UPDATE source_binding SET rules_in_force = $3 WHERE workspace_id = $1 AND id = $2",
    [workspaceId, bindingId, rules],
  );
};

const ALWAYS = ["special-category", "bank-details", "government-identifier"] as const;
const DEFAULT_ON = ["date-of-birth", "home-address", "personal-contact"] as const;
const DEFAULT_OFF = ["person-name", "job-title"] as const;

describe("the categories a binding's rules in force can raise", () => {
  it("names the always set and the default-on set for a binding nobody configured", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario);

    const document = await documentFor(scenario, binding);

    expect(document.personalDataCategories).toEqual([...ALWAYS, ...DEFAULT_ON]);
    for (const category of DEFAULT_OFF) {
      expect({ category, named: document.personalDataCategories.includes(category) }).toEqual({
        category,
        named: false,
      });
    }
  });

  it("names the default-off set on a binding that switched it on", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario, { default_on: true, default_off: true });

    expect((await documentFor(scenario, binding)).personalDataCategories).toEqual([
      ...ALWAYS,
      ...DEFAULT_ON,
      ...DEFAULT_OFF,
    ]);
  });

  it("drops the default-on set from a binding that switched it off, and keeps the always set", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario, { default_on: false, default_off: true });

    expect((await documentFor(scenario, binding)).personalDataCategories).toEqual([
      ...ALWAYS,
      ...DEFAULT_OFF,
    ]);
  });

  it("carries the binding's own rules in force beside the categories they raised", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario, { default_on: false, default_off: true });

    expect((await documentFor(scenario, binding)).rulesInForce).toEqual({
      default_on: false,
      default_off: true,
    });
  });
});

describe("what the platform holds whatever the binding", () => {
  it("names the four platform-held categories on two bindings with different rules in force", async () => {
    const scenario = await arrange();
    const safe = await bindingIn(scenario);
    const everything = await bindingIn(scenario, { default_on: true, default_off: true });

    const expected = [
      "human:<email> in concept files",
      "the Person concept",
      "the per-binding LMDB",
      "authored concept bodies",
    ];
    expect([...PLATFORM_HELD_CATEGORIES]).toEqual(expected);
    expect((await documentFor(scenario, safe)).platformHeldCategories).toEqual(expected);
    expect((await documentFor(scenario, everything)).platformHeldCategories).toEqual(expected);
  });

  it("carries the special-category label with the condition the platform recorded for it", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario);

    expect(SPECIAL_CATEGORY_CONDITION).toBe("none until a health-sector client");
    expect((await documentFor(scenario, binding)).specialCategory).toEqual({
      category: "special-category",
      condition: "none until a health-sector client",
    });
  });
});

describe("the routes a DPIA input lists", () => {
  it("prints the provider's own retention sentence for a route that carries one", async () => {
    const scenario = await arrange();
    const tail = "Prompts and outputs are deleted within 30 days; no training on customer data.";
    const binding = await answeringRouteAndBinding(scenario, tail);

    expect((await documentFor(scenario, binding)).routes).toEqual([
      {
        purpose: "answering",
        provider: "anthropic",
        model: "claude-sonnet-5",
        processor: "Anthropic",
        country: "United States",
        retentionTail: tail,
      },
    ]);
  });

  it("says not recorded for a route nobody read the provider's terms for", async () => {
    const scenario = await arrange();
    const binding = await answeringRouteAndBinding(scenario, null);

    expect((await documentFor(scenario, binding)).routes).toEqual([
      {
        purpose: "answering",
        provider: "anthropic",
        model: "claude-sonnet-5",
        processor: "Anthropic",
        country: "United States",
        retentionTail: NOT_RECORDED,
      },
    ]);
  });

  it("lists no purpose the workspace has not configured", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario);

    expect((await documentFor(scenario, binding)).routes).toEqual([]);
  });

  it("lists no embedding route, and never names Mistral — no v0.1 block embeds anything", async () => {
    const scenario = await arrange();
    await routeIn(scenario, {
      purpose: "embedding",
      provider: "mistral",
      model: "mistral-embed",
      retentionTail: "Zero data retention on /v1/embeddings.",
    });
    await routeIn(scenario, {
      purpose: "answering",
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    const binding = await bindingIn(scenario);

    const document = await documentFor(scenario, binding);

    expect(document.routes.map((route) => route.purpose)).toEqual(["answering"]);
    expect(JSON.stringify(document)).not.toContain("mistral");
  });
});

describe("what the platform has no row for", () => {
  it("says not recorded for a binding's scope and its retention class, rather than inventing either", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario);

    const document = await documentFor(scenario, binding);

    expect({ scope: document.scope, retentionClass: document.retentionClass }).toEqual({
      scope: NOT_RECORDED,
      retentionClass: NOT_RECORDED,
    });
  });

  it("reads the binding's class and audience off the row, because those the platform does hold", async () => {
    const scenario = await arrange();
    const binding = await seedingWith(
      db().pool,
      async (seed) =>
        (
          await seed.sourceBinding({
            workspaceId: scenario.workspaceId,
            sensitivity: "Restricted",
            rulesInForce: SAFE_SET,
          })
        ).id,
    );

    const document = await documentFor(scenario, binding);

    expect({ class: document.class, audience: document.audience }).toEqual({
      class: "Restricted",
      audience: "everyone",
    });
  });
});

describe("the hash the publish row carries", () => {
  it("is the same across two reads of a binding nothing changed", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario);

    expect(await hashFor(scenario, binding)).toBe(await hashFor(scenario, binding));
  });

  it("changes when the binding's rules in force change", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario);

    const before = await hashFor(scenario, binding);
    await setRulesInForce(scenario.workspaceId, binding, { default_on: true, default_off: true });
    const after = await hashFor(scenario, binding);

    expect(after).not.toBe(before);
  });

  it("is the shape the ledger's content-hash kind takes, so a publish row can carry it", async () => {
    const scenario = await arrange();
    const binding = await bindingIn(scenario);

    expect(CONTENT_HASH.test(await hashFor(scenario, binding))).toBe(true);
  });
});

describe("who may read a DPIA input", () => {
  it.each([
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
    ["an Editor", (scenario: Scenario) => scenario.editor],
  ] as const)(
    "refuses %s — it is the Admin's document, as the publish act is",
    async (_who, principalOf) => {
      const scenario = await arrange();
      const bindingId = await bindingIn(scenario);

      const read = await acting(principalOf(scenario), (principal, tx) =>
        dpiaInputFor(principal, tx, { bindingId }),
      );

      expect(read).toEqual({ ok: false, error: "role-forbids" });
    },
  );

  it("says no-such-binding for another workspace's binding", async () => {
    const mine = await arrange();
    const theirs = await arrange();
    const bindingId = await bindingIn(theirs);

    const read = await acting(mine.admin, (admin, tx) => dpiaInputFor(admin, tx, { bindingId }));

    expect(read).toEqual({ ok: false, error: "no-such-binding" });
  });

  it("says malformed for an id that is not the minter's shape, before any read", async () => {
    const scenario = await arrange();

    const read = await acting(scenario.admin, (admin, tx) =>
      dpiaInputFor(admin, tx, { bindingId: "not-an-id" }),
    );

    expect(read).toEqual({ ok: false, error: "malformed" });
  });
});
