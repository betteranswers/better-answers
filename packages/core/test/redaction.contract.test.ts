import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  boundarySchemas,
  REDACTION_ALWAYS_TIER,
  REDACTION_TIERS,
  RULES_IN_FORCE_KEYS,
  SENSITIVITIES,
} from "@better-answers/schema";

import { REDACTION_CATEGORIES } from "../src/sources/index.ts";
import { contractFixture } from "./contract-fixture.ts";

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
  it("names the three tiers a finding carries, and no fourth", () => {
    expect(fixture.tiers.map((tier) => tier.tier)).toEqual([...REDACTION_TIERS]);
  });

  it("names tiers this tier's boundary takes on a finding row", () => {
    const onARow = boundarySchemas.finding.select.shape.tier;

    for (const { tier } of fixture.tiers) {
      expect({ tier, parses: onARow.safeParse(tier).success }).toEqual({ tier, parses: true });
    }
  });

  it("lets a binding switch every tier but the always set", () => {
    expect(fixture.tiers.filter((tier) => !tier.switchable).map((tier) => tier.tier)).toEqual([
      REDACTION_ALWAYS_TIER,
    ]);

    expect(
      fixture.tiers.filter((tier) => tier.binding_key === null).map((tier) => tier.tier),
    ).toEqual([REDACTION_ALWAYS_TIER]);
    expect(
      fixture.tiers.flatMap((tier) => (tier.binding_key === null ? [] : [tier.binding_key])),
    ).toEqual([...RULES_IN_FORCE_KEYS]);
  });

  it("writes rules in force the boundary takes; always is refused", () => {
    const switchable = fixture.tiers.flatMap((tier) =>
      tier.binding_key === null ? [] : [tier.binding_key],
    );

    const binding = {
      workspaceId: "01J6AAAAAAAAAAAAAAAAAAAAAA",
      id: "01J6VVVVVVVVVVVVVVVVVVVVVV",
      name: "The handbook",
      connector: "upload",
      rulesInForce: Object.fromEntries(switchable.map((key) => [key, true])),
    };

    expect(boundarySchemas.sourceBinding.insert.safeParse(binding).success).toBe(true);

    expect(
      boundarySchemas.sourceBinding.insert.safeParse({
        ...binding,
        rulesInForce: { ...binding.rulesInForce, [REDACTION_ALWAYS_TIER]: false },
      }).success,
    ).toBe(false);
  });
});

describe("the redaction agreement's categories", () => {
  it("gives each category a named tier, and names it once", () => {
    const tiers = fixture.tiers.map((tier) => tier.tier);

    for (const { category: named, tier } of fixture.categories) {
      expect({ named, known: tiers.includes(tier) }).toEqual({ named, known: true });
    }
    expect(fixture.categories.map((entry) => entry.category).toSorted()).toEqual(
      [...new Set(fixture.categories.map((entry) => entry.category))].toSorted(),
    );
  });

  it("gives the always set, and only it, one neutral placeholder", () => {
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

  it("writes every placeholder as a bracketed word", () => {
    const shape = new RegExp(fixture.placeholder_shape);

    expect(shape.test(fixture.always_placeholder)).toBe(true);
    for (const { category: named, placeholder } of fixture.categories) {
      expect({ named, bracketed: shape.test(placeholder) }).toEqual({ named, bracketed: true });
    }
  });

  it("narrows to Restricted for a special-category finding and no other", () => {
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

describe("the category list the api declares and the agreement's own", () => {
  it("declares each named category at the agreement's tier and flag", () => {
    for (const { category, tier, special_category } of fixture.categories) {
      const declared = REDACTION_CATEGORIES.find((entry) => entry.category === category);

      expect({ category, declared: declared ?? null }).toEqual({
        category,
        declared: { category, tier, specialCategory: special_category },
      });
    }
  });

  it("declares no category the agreement does not name", () => {
    expect(REDACTION_CATEGORIES.map((entry) => entry.category).toSorted()).toEqual(
      fixture.categories.map((entry) => entry.category).toSorted(),
    );
  });
});

describe("the redaction agreement's version string", () => {
  it("parses every must-parse string and no must-not-parse one", () => {
    const pattern = new RegExp(fixture.version_string.pattern);

    for (const { value, why } of fixture.version_string.must_parse) {
      expect({ why, parses: pattern.test(value) }).toEqual({ why, parses: true });
    }
    for (const { value, why } of fixture.version_string.must_not_parse) {
      expect({ why, parses: pattern.test(value) }).toEqual({ why, parses: false });
    }
  });

  it("joins a finding's two columns with the agreement's separator", () => {
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
