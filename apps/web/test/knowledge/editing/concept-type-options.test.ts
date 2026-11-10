import { describe, expect, it } from "vitest";

import {
  optionsFor,
  sameConceptType,
  storedNameOf,
} from "@/features/knowledge/editing/concept-type-options.ts";

const TYPES = ["Insurance Policy", "Policy", "Procedure", "Risk Register", "Sector"] as const;

describe("the types offered for what was typed", () => {
  it("lists every type, and adds none, before anything is typed", () => {
    expect(optionsFor(TYPES, "  ")).toEqual({ listed: TYPES, adds: undefined });
  });

  it("ranks the exact type, then prefixes, then the rest", () => {
    expect(optionsFor(["Insurance Policy", "Policy", "Policy Review"], "policy")).toEqual({
      listed: ["Policy", "Policy Review", "Insurance Policy"],
      adds: undefined,
    });
  });

  it.each(["policy", "POLICY"])("offers Policy first, and no new type, for %j", (typed) => {
    expect(optionsFor(TYPES, typed)).toEqual({
      listed: ["Policy", "Insurance Policy"],
      adds: undefined,
    });
  });

  it("ignores spaces around what was typed", () => {
    expect(optionsFor(TYPES, "  Policy  ")).toEqual(optionsFor(TYPES, "Policy"));
  });

  it.each(["policies", "Policies", "POLICIES"])(
    "offers Policy, and no new type, for the plural %j",
    (typed) => {
      expect(optionsFor(TYPES, typed)).toEqual({ listed: ["Policy"], adds: undefined });
    },
  );

  it("adds the name the write stores for a missing type", () => {
    expect(optionsFor(TYPES, "purchase orders")).toEqual({ listed: [], adds: "Purchase Order" });
  });

  it("adds a name that only part of a type matches", () => {
    expect(optionsFor(TYPES, "regist")).toEqual({ listed: ["Risk Register"], adds: "Regist" });
  });

  it("adds a name when no types could be read", () => {
    expect(optionsFor([], "risk register")).toEqual({ listed: [], adds: "Risk Register" });
  });
});

describe("the type a field shows", () => {
  it("shows the stored name that a name folds to", () => {
    expect(storedNameOf(TYPES, "policy")).toBe("Policy");
    expect(storedNameOf(TYPES, "risk registers")).toBe("Risk Register");
  });

  it("shows the folded name when no stored name matches it", () => {
    expect(storedNameOf(TYPES, "certifications")).toBe("Certification");
    expect(storedNameOf([], "policy")).toBe("Policy");
    expect(storedNameOf(TYPES, "")).toBe("");
  });

  it("compares names by their folded forms", () => {
    expect(sameConceptType("Policy", "policies")).toBe(true);
    expect(sameConceptType("Policy", "Insurance Policy")).toBe(false);
  });
});
