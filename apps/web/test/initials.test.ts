import { describe, expect, it } from "vitest";

import { initialsOf } from "@/shared/initials.ts";

describe("a person's initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initialsOf("Bartholomew Featherstonehaugh-Whittingham")).toBe("BF");
    expect(initialsOf("priya van der Berg")).toBe("PV");
  });

  it("takes one letter from a one-word name", () => {
    expect(initialsOf("Ada")).toBe("A");
  });

  it("ignores the spaces around a name", () => {
    expect(initialsOf("  Sam   Okoro ")).toBe("SO");
  });

  it("takes a character outside the basic plane whole", () => {
    expect(initialsOf("😀 Okoro")).toBe("😀O");
    expect(initialsOf("𝐀da Lovelace")).toBe("𝐀L");
  });

  it("takes a letter with its accent, however it was typed", () => {
    expect(initialsOf("e\u0301mile Zola")).toBe("E\u0301Z");
  });

  it("takes a flag whole", () => {
    expect(initialsOf("🇬🇧 Team")).toBe("🇬🇧T");
  });

  it("gives no initials for an empty name", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});
