import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(initialsOf("\u00e9mile Zola")).toBe("\u00c9Z");
  });

  it("takes a flag whole", () => {
    expect(initialsOf("🇬🇧 Team")).toBe("🇬🇧T");
  });

  it("gives no initials for an empty name", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});

describe("a person's initials where the browser has no segmenter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes code points, losing an accent typed apart", async () => {
    const descriptors = Object.getOwnPropertyDescriptors(Intl);
    Reflect.deleteProperty(descriptors, "Segmenter");
    vi.stubGlobal("Intl", Object.defineProperties({}, descriptors));
    vi.resetModules();
    const { initialsOf: withoutASegmenter } = await import("@/shared/initials.ts");

    expect(withoutASegmenter("Sam Okoro")).toBe("SO");
    expect(withoutASegmenter("😀 Okoro")).toBe("😀O");
    expect(withoutASegmenter("e\u0301mile Zola")).toBe("EZ");
  });
});
