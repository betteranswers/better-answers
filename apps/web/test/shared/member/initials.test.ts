import { afterEach, describe, expect, it, vi } from "vitest";

import { initialsOf } from "@/shared/member/initials.ts";

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

  it("keeps a character outside the basic plane whole", () => {
    expect(initialsOf("😀 Okoro")).toBe("😀O");
    expect(initialsOf("𝐀da Lovelace")).toBe("𝐀L");
  });

  it("keeps an accent with its letter, composed or decomposed", () => {
    expect(initialsOf("e\u0301mile Zola")).toBe("E\u0301Z");
    expect(initialsOf("\u00e9mile Zola")).toBe("\u00c9Z");
  });

  it("keeps a flag emoji whole", () => {
    expect(initialsOf("🇬🇧 Team")).toBe("🇬🇧T");
  });

  it("gives no initials for an empty name", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});

describe("a person's initials without Intl.Segmenter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps flags, decomposed accents and joined emoji whole", async () => {
    const descriptors = Object.getOwnPropertyDescriptors(Intl);
    Reflect.deleteProperty(descriptors, "Segmenter");
    vi.stubGlobal("Intl", Object.defineProperties({}, descriptors));
    vi.resetModules();
    const { initialsOf: withoutASegmenter } = await import("@/shared/member/initials.ts");

    expect(withoutASegmenter("Sam Okoro")).toBe("SO");
    expect(withoutASegmenter("😀 Okoro")).toBe("😀O");
    expect(withoutASegmenter("e\u0301mile Zola")).toBe("E\u0301Z");
    expect(withoutASegmenter("🇬🇧 Team")).toBe("🇬🇧T");
    expect(withoutASegmenter("👩\u200D💻 Dev")).toBe("👩\u200D💻D");
  });
});
