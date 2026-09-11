import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  boundarySchemas,
  REDACTION_ALWAYS_TIER,
  REDACTION_TIERS,
  RULES_IN_FORCE_KEYS,
  SENSITIVITIES,
} from "@better-answers/schema";

import { contractFixture } from "./contract-fixture.ts";

/**
 * The redaction agreement's TypeScript half (ADR 0031, ADR 0020): the fixture in
 * `contracts/redaction/` is the contract — the category list, the placeholder word per tier
 * and category, the special-category narrowing and the shape of the version string — and this
 * suite proves this tier reads it as the rows it keeps. The Python half runs the same
 * agreement against the tier that produces it, in `apps/worker/tests/test_redaction_contract.py`.
 *
 * **The fixture is the contract, and this tier is the reader.** The detector runs in the
 * worker and the review of a finding is an Admin's act (the S0 spec, *The tier boundary*), so
 * what this half can hold the fixture to is what the app stores and shows: the tier word on a
 * `finding` row, the class a special-category finding narrows a document to, the two keys a
 * binding's rules in force carry. T-121's category descriptors are held to the same file from
 * the other side, which is why nothing here derives from a detector that does not exist yet.
 *
 * Neither half holds the other's literals. This one asserts against this tier's own boundary
 * schemas, the way the id-shape half asserts against `ULID_PATTERN`: a fixture the app cannot
 * store is a fixture the app has not been taught, and that failure is the point.
 */

const category = z.object({
  category: z.string().min(1),
  tier: z.string().min(1),
  placeholder: z.string().min(1),
  special_category: z.boolean(),
  narrows_to: z.string().min(1).nullable(),
  why: z.string().min(1),
});

const fixtureSchema = z.object({
  description: z.string(),
  placeholder_shape: z.string().min(1),
  always_placeholder: z.string().min(1),
  narrows_to: z.string().min(1),
  tiers: z.array(
    z.object({
      tier: z.string().min(1),
      switchable: z.boolean(),
      binding_key: z.string().min(1).nullable(),
      why: z.string().min(1),
    }),
  ),
  categories: z.array(category),
  version_string: z.object({
    shape: z.string().min(1),
    separator: z.string().min(1),
    pattern: z.string().min(1),
    must_parse: z.array(z.object({ value: z.string(), why: z.string().min(1) })),
    must_not_parse: z.array(z.object({ value: z.string(), why: z.string().min(1) })),
  }),
});

const fixture = contractFixture("redaction", fixtureSchema);

describe("the redaction agreement's tiers", () => {
  it("names the three tiers this tier writes on a finding, and no fourth", () => {
    expect(fixture.tiers.map((tier) => tier.tier)).toEqual([...REDACTION_TIERS]);
  });

  it("names a tier this tier's boundary takes on a finding row, for every tier it names", () => {
    const onARow = boundarySchemas.finding.select.shape.tier;

    for (const { tier } of fixture.tiers) {
      expect({ tier, parses: onARow.safeParse(tier).success }).toEqual({ tier, parses: true });
    }
  });

  it("switches every tier but the always set, which is the one no binding may switch", () => {
    expect(fixture.tiers.filter((tier) => !tier.switchable).map((tier) => tier.tier)).toEqual([
      REDACTION_ALWAYS_TIER,
    ]);
    // The other way: an unswitchable tier has no key on a binding, and a switchable one has
    // exactly the key this tier's column carries.
    expect(
      fixture.tiers.filter((tier) => tier.binding_key === null).map((tier) => tier.tier),
    ).toEqual([REDACTION_ALWAYS_TIER]);
    expect(
      fixture.tiers.flatMap((tier) => (tier.binding_key === null ? [] : [tier.binding_key])),
    ).toEqual([...RULES_IN_FORCE_KEYS]);
  });

  it("writes a binding's rules in force in keys this tier's boundary takes, and is refused one it does not", () => {
    const switchable = fixture.tiers.flatMap((tier) =>
      tier.binding_key === null ? [] : [tier.binding_key],
    );
    const binding = {
      workspaceId: "01J6AAAAAAAAAAAAAAAAAAAAAA",
      id: "01J6VVVVVVVVVVVVVVVVVVVVVV",
      rulesInForce: Object.fromEntries(switchable.map((key) => [key, true])),
    };

    expect(boundarySchemas.sourceBinding.insert.safeParse(binding).success).toBe(true);
    // A tier the fixture does not switch is a key the column does not carry: the always set
    // written as a rule in force is refused, which is what makes *policy* mean policy.
    expect(
      boundarySchemas.sourceBinding.insert.safeParse({
        ...binding,
        rulesInForce: { ...binding.rulesInForce, [REDACTION_ALWAYS_TIER]: false },
      }).success,
    ).toBe(false);
  });
});

describe("the redaction agreement's categories", () => {
  it("gives every category a tier the agreement names, and names each category once", () => {
    const tiers = fixture.tiers.map((tier) => tier.tier);

    for (const { category: named, tier } of fixture.categories) {
      expect({ named, known: tiers.includes(tier) }).toEqual({ named, known: true });
    }
    expect(fixture.categories.map((entry) => entry.category).toSorted()).toEqual(
      [...new Set(fixture.categories.map((entry) => entry.category))].toSorted(),
    );
  });

  it("withholds the always set under one neutral word, and never uses that word elsewhere", () => {
    // A typed placeholder for the always set would tell the audience what class of data the
    // document holds, which is the thing the always set exists to keep back (the S0 spec,
    // *The seam*). So the word is the same for all three, and it is nobody else's.
    for (const { category: named, tier, placeholder } of fixture.categories) {
      expect({ named, placeholder }).toEqual({
        named,
        placeholder: tier === REDACTION_ALWAYS_TIER ? fixture.always_placeholder : placeholder,
      });
      expect({ named, neutral: placeholder === fixture.always_placeholder }).toEqual({
        named,
        neutral: tier === REDACTION_ALWAYS_TIER,
      });
    }
  });

  it("writes every placeholder as a bracketed word, so a reader never reads one as the text", () => {
    const shape = new RegExp(fixture.placeholder_shape);

    expect(shape.test(fixture.always_placeholder)).toBe(true);
    for (const { category: named, placeholder } of fixture.categories) {
      expect({ named, bracketed: shape.test(placeholder) }).toEqual({ named, bracketed: true });
    }
  });

  it("narrows a document to Restricted for a special-category finding and for no other", () => {
    // The narrowing verdict, both ways (`[TEST7]`): a special-category finding narrows, and a
    // category that narrows is a special-category one. The class is one this tier's boundary
    // takes on the binding the document came from — a verdict naming a class the platform
    // cannot store would be a document narrowed to nothing.
    expect(SENSITIVITIES).toContain(fixture.narrows_to);
    expect(
      boundarySchemas.sourceBinding.select.shape.sensitivity.safeParse(fixture.narrows_to).success,
    ).toBe(true);

    for (const { category: named, special_category, narrows_to } of fixture.categories) {
      expect({ named, narrows_to }).toEqual({
        named,
        narrows_to: special_category ? fixture.narrows_to : null,
      });
    }
  });
});

describe("the redaction agreement's version string", () => {
  it("parses every version string the agreement says both tiers must read", () => {
    const pattern = new RegExp(fixture.version_string.pattern);

    for (const { value, why } of fixture.version_string.must_parse) {
      expect({ why, parses: pattern.test(value) }).toEqual({ why, parses: true });
    }
    for (const { value, why } of fixture.version_string.must_not_parse) {
      expect({ why, parses: pattern.test(value) }).toEqual({ why, parses: false });
    }
  });

  it("is the two columns a finding carries, joined by the separator the agreement names", () => {
    // Built from this tier's own row rather than from a copy of the fixture's samples: the
    // version string is `rule_version` and `detector_pin` as a `finding` holds them, and the
    // re-baselining of evidence resting on a re-detection is keyed on it.
    const row = { ruleVersion: "3", detectorPin: "presidio-2.2.364+gliner-multi-pii-v1" };
    const parsed = boundarySchemas.finding.insert
      .pick({ ruleVersion: true, detectorPin: true })
      .parse(row);
    const version = `${parsed.ruleVersion}${fixture.version_string.separator}${parsed.detectorPin}`;

    expect(fixture.version_string.shape).toBe(
      `rule_version${fixture.version_string.separator}detector_pin`,
    );
    expect(new RegExp(fixture.version_string.pattern).test(version)).toBe(true);
  });
});
