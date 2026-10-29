import { describe, expect, it } from "vitest";

import { coverageFrom, type CoverageRow } from "../../src/guides/reads.ts";

const POLICY = { iri: "iri:employers-liability", title: "Employers' liability policy" };

const rowOf = (row: Partial<CoverageRow> & Pick<CoverageRow, "section_id">): CoverageRow => ({
  collection: "company",
  parent_id: null,
  prompt: `Prompt of ${row.section_id}`,
  write_up_id: `write-up-${row.section_id}`,
  fact_id: `fact-${row.section_id}`,
  name: `Fact of ${row.section_id}`,
  at_least: 1,
  met_by: 0,
  available: [],
  ...row,
});

const stateOf = (row: CoverageRow) => coverageFrom("guide-1", [row])?.sections[0]?.facts[0];

describe("a guide's coverage", () => {
  it("reads a fact met once its includes reach the floor", () => {
    expect(
      stateOf(rowOf({ section_id: "s", at_least: 2, met_by: 2, available: [POLICY] })),
    ).toEqual({ factId: "fact-s", name: "Fact of s", state: "met", available: [] });
  });

  it("reads a fact short of its floor as available", () => {
    expect(
      stateOf(rowOf({ section_id: "s", at_least: 2, met_by: 1, available: [POLICY] })),
    ).toEqual({ factId: "fact-s", name: "Fact of s", state: "available", available: [POLICY] });
  });

  it("reads a fact short, with nothing matching, as missing", () => {
    expect(stateOf(rowOf({ section_id: "s", at_least: 1, met_by: 0 }))).toEqual({
      factId: "fact-s",
      name: "Fact of s",
      state: "missing",
      available: [],
    });
  });

  it("lists a section expecting no fact with no facts", () => {
    expect(
      coverageFrom("guide-1", [
        rowOf({ section_id: "s", fact_id: null, name: null, at_least: null }),
      ]),
    ).toEqual({
      guideId: "guide-1",
      collection: "company",
      sections: [{ sectionId: "s", writeUpId: "write-up-s", prompt: "Prompt of s", facts: [] }],
    });
  });

  it("lists each section once with its facts in row order", () => {
    const coverage = coverageFrom("guide-1", [
      rowOf({ section_id: "s", fact_id: "first", name: "First" }),
      rowOf({ section_id: "s", fact_id: "second", name: "Second" }),
    ]);

    expect(coverage?.sections.map((section) => section.facts.map((fact) => fact.name))).toEqual([
      ["First", "Second"],
    ]);
  });

  it("lists each child section straight after its parent", () => {
    const coverage = coverageFrom("guide-1", [
      rowOf({ section_id: "security" }),
      rowOf({ section_id: "support" }),
      rowOf({ section_id: "testing", parent_id: "security" }),
    ]);

    expect(coverage?.sections.map((section) => section.sectionId)).toEqual([
      "security",
      "testing",
      "support",
    ]);
  });

  it("finds no guide in no rows", () => {
    expect(coverageFrom("guide-1", [])).toBe(undefined);
  });
});
