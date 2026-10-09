import { describe, expect, it } from "vitest";

import { conceptIriOf, IRI, ulidOfConceptIri } from "../src/concept-file.ts";
import { citedSourceOf, citedSourcesOf } from "../src/index.ts";

const MINTED = "01J6MMMMMMMMMMMMMMMMMMMMMM";

describe("the concept IRI and its ULID", () => {
  it("maps a ULID to its IRI and back", () => {
    const iri = conceptIriOf(MINTED);

    expect(iri).toBe("https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM");
    expect(ulidOfConceptIri(iri)).toBe(MINTED);
  });

  it("refuses a lower-case ULID either way", () => {
    expect(() => conceptIriOf(MINTED.toLowerCase())).toThrow("invalid_format");
    expect(
      ulidOfConceptIri("https://better-answers.com/c/01j6mmmmmmmmmmmmmmmmmmmmmm"),
    ).toBeUndefined();
  });

  it("refuses an IRI on a foreign host", () => {
    for (const foreign of [
      "https://example.test/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
      "https://better-answers.com.example.test/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
      "http://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
      "https://better-answersXcom/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
    ]) {
      expect({ foreign, ulid: ulidOfConceptIri(foreign), iri: IRI.test(foreign) }).toEqual({
        foreign,
        ulid: undefined,
        iri: false,
      });
    }
  });

  it("refuses anything around or after the ULID", () => {
    for (const padded of [
      " https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM",
      "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM#section",
      "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMMM",
      "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMI",
    ]) {
      expect({ padded, ulid: ulidOfConceptIri(padded) }).toEqual({ padded, ulid: undefined });
    }
  });
});

describe("a cited source's id", () => {
  it("reads a record's id as JavaScript writes it", () => {
    expect(
      citedSourcesOf([
        { resource: "https://example.test/audit-standard", id: "AUD-047" },
        { resource: "https://example.test/handbook", id: 12 },
        { resource: "https://example.test/rates", locator: "4" },
        { resource: "https://example.test/policy", id: null },
      ]),
    ).toEqual([
      { resource: "https://example.test/audit-standard", locator: null, id: "AUD-047" },
      { resource: "https://example.test/handbook", locator: null, id: "12" },
      { resource: "https://example.test/rates", locator: "4", id: null },
      { resource: "https://example.test/policy", locator: null, id: null },
    ]);
  });

  it("gives a string-form entry no id", () => {
    expect(citedSourceOf("https://example.test/handbook#4")).toEqual({
      resource: "https://example.test/handbook",
      locator: "4",
      id: null,
    });
  });
});
