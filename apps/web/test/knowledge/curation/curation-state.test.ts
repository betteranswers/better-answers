// @vitest-environment node

import { describe, expect, it } from "vitest";

import { COLLECTION } from "@better-answers/schema";

import {
  heldFor,
  scopeOf,
  trustChosen,
  TRUSTS,
  YOUR_COLLECTIONS,
} from "@/features/knowledge/curation/curation-state.ts";
import { ALL_KNOWLEDGE_WORDS } from "@/features/knowledge/curation/curation-words.ts";

describe("the collection filter held in the address", () => {
  it("leaves every marker clear of a collection's name", () => {
    const markers = [
      YOUR_COLLECTIONS,
      heldFor(undefined, true),
      heldFor(undefined, false),
      heldFor(YOUR_COLLECTIONS, true),
    ];

    expect(markers.filter((marker) => COLLECTION.test(marker))).toEqual([]);
  });

  it("reads a held collection back as itself", () => {
    expect(scopeOf("policies", true)).toEqual({ kind: "one", collection: "policies" });
    expect(scopeOf(heldFor("policies", true), true)).toEqual({
      kind: "one",
      collection: "policies",
    });
  });

  it("reads a cleared filter as every collection for an owner", () => {
    expect(scopeOf(heldFor(undefined, true), true)).toEqual({ kind: "every" });
    expect(scopeOf(heldFor(undefined, false), false)).toEqual({ kind: "every" });
  });

  it("opens an owner on the collections they own", () => {
    expect(scopeOf(heldFor(YOUR_COLLECTIONS, true), true)).toEqual({ kind: "owned" });
  });
});

describe("the trust filter held in the address", () => {
  it("offers each trust word the api filters by", () => {
    expect(new Set(TRUSTS)).toEqual(
      new Set(Object.keys(ALL_KNOWLEDGE_WORDS.filters.trust.choices)),
    );
  });

  it("reads a stray trust value as none", () => {
    expect(trustChosen("out-of-date")).toBe("out-of-date");
    expect(trustChosen("draft")).toBeUndefined();
    expect(trustChosen(undefined)).toBeUndefined();
  });
});
