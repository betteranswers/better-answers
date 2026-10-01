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
});
