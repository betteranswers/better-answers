// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  EVERYONE_WORDS,
  NAMES_WAITING_WORDS,
  WORKSPACES_WORDS,
} from "@/features/console/list-words.ts";

describe("what a console list's count says", () => {
  it.each([
    [1, "1 person on the platform."],
    [2, "2 people on the platform."],
  ])("counts %i on Everyone", (count, said) => {
    expect(EVERYONE_WORDS.counted(count)).toBe(said);
  });

  it.each([
    [0, "No name waits to be corrected."],
    [1, "1 name waits to be corrected."],
    [2, "2 names wait to be corrected."],
  ])("counts %i on Names waiting", (count, said) => {
    expect(NAMES_WAITING_WORDS.counted(count)).toBe(said);
  });

  it.each([
    [1, "1 workspace on the platform."],
    [2, "2 workspaces on the platform."],
  ])("counts %i on Every workspace", (count, said) => {
    expect(WORKSPACES_WORDS.counted(count)).toBe(said);
  });
});

describe("what a console list says a search left", () => {
  it.each([
    [0, "0 people match “priya”."],
    [1, "1 person matches “priya”."],
    [2, "2 people match “priya”."],
  ])("says %i left on Everyone", (count, said) => {
    expect(EVERYONE_WORDS.matching(count, "priya")).toBe(said);
  });

  it.each([
    [0, "0 names match “priya”."],
    [1, "1 name matches “priya”."],
    [2, "2 names match “priya”."],
  ])("says %i left on Names waiting", (count, said) => {
    expect(NAMES_WAITING_WORDS.matching(count, "priya")).toBe(said);
  });

  it.each([
    [0, "0 workspaces match “acme”."],
    [1, "1 workspace matches “acme”."],
    [2, "2 workspaces match “acme”."],
  ])("says %i left on Every workspace", (count, said) => {
    expect(WORKSPACES_WORDS.matching(count, "acme")).toBe(said);
  });
});
