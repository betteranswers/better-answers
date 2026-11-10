import { describe, expect, it } from "vitest";

import { parse } from "@better-answers/core/kernel";
import { CONTENT_HASH } from "@better-answers/schema";

import {
  dpiaInputFor,
  dpiaReadInput,
  NOT_RECORDED,
  PLATFORM_HELD_CATEGORIES,
  SPECIAL_CATEGORY_CONDITION,
  type DpiaInput,
} from "../../src/sources/index.ts";
import { visibilitySuite } from "../fixtures/sourced-concept.ts";
import type { Scenario } from "../fixtures/workspace-with-bundle.ts";
import { inputOf } from "../support/suite-input.ts";
import { seedingWith } from "../support/suite-postgres.ts";

const { db, arrange, reading: acting } = visibilitySuite();

type Rules = Readonly<Record<string, boolean>>;

const SAFE_SET: Rules = { default_on: true, default_off: false };

const connectedSourceIn = async (
  scenario: Scenario,
  rulesInForce: Rules = SAFE_SET,
): Promise<string> =>
  seedingWith(
    db().pool,
    async (seed) =>
      (await seed.connectedSource({ workspaceId: scenario.workspaceId, rulesInForce })).id,
  );

const modelChoiceIn = async (
  scenario: Scenario,
  modelChoice: {
    readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
    readonly provider: string;
    readonly model: string;
    readonly retentionTail?: string | null;
  },
): Promise<void> => {
  await seedingWith(db().pool, async (seed) => {
    await seed.modelChoice({
      workspaceId: scenario.workspaceId,
      purpose: modelChoice.purpose,
      provider: modelChoice.provider,
      model: modelChoice.model,
      retentionTail: modelChoice.retentionTail ?? null,
    });
  });
};

const answeringModelChoiceAndConnectedSource = async (
  scenario: Scenario,
  retentionTail: string | null,
): Promise<string> => {
  await modelChoiceIn(scenario, {
    purpose: "answering",
    provider: "anthropic",
    model: "claude-sonnet-5",
    retentionTail,
  });
  return connectedSourceIn(scenario);
};

const readFor = async (scenario: Scenario, connectedSourceId: string) => {
  const read = await acting(scenario.admin, (admin, tx) =>
    dpiaInputFor(admin, tx, inputOf(dpiaReadInput, { connectedSourceId })),
  );
  if (!read.ok) throw new Error(`the DPIA input was refused: ${String(read.error)}`);
  return read.value;
};

const documentFor = async (scenario: Scenario, connectedSourceId: string): Promise<DpiaInput> =>
  (await readFor(scenario, connectedSourceId)).document;

const hashFor = async (scenario: Scenario, connectedSourceId: string): Promise<string> =>
  (await readFor(scenario, connectedSourceId)).hash;

const setRulesInForce = async (workspaceId: string, connectedSourceId: string, rules: Rules) => {
  await db().pool.query(
    "UPDATE connected_source SET rules_in_force = $3 WHERE workspace_id = $1 AND id = $2",
    [workspaceId, connectedSourceId, rules],
  );
};

const ALWAYS = ["special-category", "bank-details", "government-identifier"] as const;
const DEFAULT_ON = ["date-of-birth", "home-address", "personal-contact"] as const;
const DEFAULT_OFF = ["person-name", "job-title"] as const;

describe("the personal data categories a DPIA input lists", () => {
  it("lists the always and default-on sets for an unconfigured source", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario);

    const document = await documentFor(scenario, connectedSource);

    expect(document.personalDataCategories).toEqual([...ALWAYS, ...DEFAULT_ON]);
    for (const category of DEFAULT_OFF) {
      expect({ category, named: document.personalDataCategories.includes(category) }).toEqual({
        category,
        named: false,
      });
    }
  });

  it("adds the default-off set when a source switches it on", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario, {
      default_on: true,
      default_off: true,
    });

    expect((await documentFor(scenario, connectedSource)).personalDataCategories).toEqual([
      ...ALWAYS,
      ...DEFAULT_ON,
      ...DEFAULT_OFF,
    ]);
  });

  it("drops the default-on set when the source switches it off", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario, {
      default_on: false,
      default_off: true,
    });

    expect((await documentFor(scenario, connectedSource)).personalDataCategories).toEqual([
      ...ALWAYS,
      ...DEFAULT_OFF,
    ]);
  });

  it("includes the connected source's rules in force", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario, {
      default_on: false,
      default_off: true,
    });

    expect((await documentFor(scenario, connectedSource)).rulesInForce).toEqual({
      default_on: false,
      default_off: true,
    });
  });
});

describe("the categories the platform holds for every connected source", () => {
  it("lists the same four categories whatever a source's rules", async () => {
    const scenario = await arrange();
    const safe = await connectedSourceIn(scenario);
    const everything = await connectedSourceIn(scenario, { default_on: true, default_off: true });

    const expected = [
      "human:<email> in concept files",
      "the Person concept",
      "the per-connected-source LMDB",
      "authored concept bodies",
    ];
    expect([...PLATFORM_HELD_CATEGORIES]).toEqual(expected);
    expect((await documentFor(scenario, safe)).platformHeldCategories).toEqual(expected);
    expect((await documentFor(scenario, everything)).platformHeldCategories).toEqual(expected);
  });

  it("includes the special category with its recorded condition", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario);

    expect(SPECIAL_CATEGORY_CONDITION).toBe("none until a health-sector client");
    expect((await documentFor(scenario, connectedSource)).specialCategory).toEqual({
      category: "special-category",
      condition: "none until a health-sector client",
    });
  });
});

describe("the model choices a DPIA input lists", () => {
  it("includes the retention sentence a model choice records", async () => {
    const scenario = await arrange();
    const tail = "Prompts and outputs are deleted within 30 days; no training on customer data.";
    const connectedSource = await answeringModelChoiceAndConnectedSource(scenario, tail);

    expect((await documentFor(scenario, connectedSource)).modelChoices).toEqual([
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

  it("says not recorded for a missing retention sentence", async () => {
    const scenario = await arrange();
    const connectedSource = await answeringModelChoiceAndConnectedSource(scenario, null);

    expect((await documentFor(scenario, connectedSource)).modelChoices).toEqual([
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

  it("names a known provider's sub-processor, else says not recorded", async () => {
    const scenario = await arrange();
    await modelChoiceIn(scenario, {
      purpose: "extraction",
      provider: "mistral",
      model: "mistral-large",
    });
    await modelChoiceIn(scenario, { purpose: "enrichment", provider: "local", model: "llama-4" });
    await modelChoiceIn(scenario, { purpose: "judging", provider: "openai", model: "gpt-6" });
    const connectedSource = await connectedSourceIn(scenario);

    expect((await documentFor(scenario, connectedSource)).modelChoices).toEqual([
      {
        purpose: "extraction",
        provider: "mistral",
        model: "mistral-large",
        processor: "Mistral AI",
        country: "European Union",
        retentionTail: NOT_RECORDED,
      },
      {
        purpose: "enrichment",
        provider: "local",
        model: "llama-4",
        processor: "no sub-processor",
        country: "the platform's own estate",
        retentionTail: NOT_RECORDED,
      },
      {
        purpose: "judging",
        provider: "openai",
        model: "gpt-6",
        processor: NOT_RECORDED,
        country: NOT_RECORDED,
        retentionTail: NOT_RECORDED,
      },
    ]);
  });

  it("lists nothing when the workspace has no model choice", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario);

    expect((await documentFor(scenario, connectedSource)).modelChoices).toEqual([]);
  });

  it("leaves out the embedding model choice and its provider", async () => {
    const scenario = await arrange();
    await modelChoiceIn(scenario, {
      purpose: "embedding",
      provider: "mistral",
      model: "mistral-embed",
      retentionTail: "Zero data retention on /v1/embeddings.",
    });
    await modelChoiceIn(scenario, {
      purpose: "answering",
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    const connectedSource = await connectedSourceIn(scenario);

    const document = await documentFor(scenario, connectedSource);

    expect(document.modelChoices.map((modelChoice) => modelChoice.purpose)).toEqual(["answering"]);
    expect(JSON.stringify(document)).not.toContain("mistral");
  });
});

describe("the DPIA input's scope, retention, class and audience", () => {
  it("says not recorded for the scope and retention class", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario);

    const document = await documentFor(scenario, connectedSource);

    expect({ scope: document.scope, retentionClass: document.retentionClass }).toEqual({
      scope: NOT_RECORDED,
      retentionClass: NOT_RECORDED,
    });
  });

  it("reads the class and audience from the connected source's row", async () => {
    const scenario = await arrange();
    const connectedSource = await seedingWith(
      db().pool,
      async (seed) =>
        (
          await seed.connectedSource({
            workspaceId: scenario.workspaceId,
            sensitivity: "Restricted",
            rulesInForce: SAFE_SET,
          })
        ).id,
    );

    const document = await documentFor(scenario, connectedSource);

    expect({ class: document.class, audience: document.audience }).toEqual({
      class: "Restricted",
      audience: "everyone",
    });
  });
});

describe("the DPIA hash a publish records", () => {
  it("is the same across two reads of an unchanged source", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario);

    expect(await hashFor(scenario, connectedSource)).toBe(await hashFor(scenario, connectedSource));
  });

  it("changes when the connected source's rules in force change", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario);

    const before = await hashFor(scenario, connectedSource);
    await setRulesInForce(scenario.workspaceId, connectedSource, {
      default_on: true,
      default_off: true,
    });
    const after = await hashFor(scenario, connectedSource);

    expect(after).not.toBe(before);
  });

  it("matches the audit log's content-hash format", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceIn(scenario);

    expect(CONTENT_HASH.test(await hashFor(scenario, connectedSource))).toBe(true);
  });
});

describe("who may read a DPIA input", () => {
  it.each([
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
    ["an Editor", (scenario: Scenario) => scenario.editor],
  ] as const)("refuses %s, because only an Admin may read it", async (_who, principalOf) => {
    const scenario = await arrange();
    const connectedSourceId = await connectedSourceIn(scenario);

    const read = await acting(principalOf(scenario), (principal, tx) =>
      dpiaInputFor(principal, tx, inputOf(dpiaReadInput, { connectedSourceId })),
    );

    expect(read).toEqual({ ok: false, error: "role-forbids" });
  });

  it("refuses another workspace's connected source as not found", async () => {
    const mine = await arrange();
    const theirs = await arrange();
    const connectedSourceId = await connectedSourceIn(theirs);

    const read = await acting(mine.admin, (admin, tx) =>
      dpiaInputFor(admin, tx, inputOf(dpiaReadInput, { connectedSourceId })),
    );

    expect(read).toEqual({ ok: false, error: "no-such-binding" });
  });

  it("rejects a connected source id in the wrong format", () => {
    expect(parse(dpiaReadInput, { connectedSourceId: "not-an-id" })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { connectedSourceId: "bad-format" } },
    });
  });
});
