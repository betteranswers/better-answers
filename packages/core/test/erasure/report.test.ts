import { describe, expect, it } from "vitest";

import type { ErasureFamily, ErasureMap } from "../../src/erasure/map.ts";
import {
  erasureReportOf,
  NAMES_HEADING,
  STORES_HEADING,
  type ErasureActions,
} from "../../src/erasure/report.ts";

const mapOf = (...families: readonly ErasureFamily[]): ErasureMap =>
  families.map((family) => ({ family, categories: [], locations: [] }));

const reportOf = ({
  actions = {},
  map = [],
  concepts = [],
}: {
  readonly actions?: ErasureActions;
  readonly map?: ErasureMap;
  readonly concepts?: readonly string[];
}): string =>
  erasureReportOf({
    request: { id: "subject-request-1" },
    erasure: {
      id: "erasure-1",
      anchoredAt: new Date("2026-06-01T12:00:00.000Z"),
      beyondUseHourlyAt: new Date("2026-06-03T12:00:00.000Z"),
      beyondUseDailyAt: new Date("2026-07-01T12:00:00.000Z"),
      beyondUseWeeklyAt: new Date("2026-07-27T12:00:00.000Z"),
      beyondUseMonthlyAt: new Date("2026-12-01T12:00:00.000Z"),
    },
    actions,
    map,
    concepts,
  });

const NOTHING_DONE = reportOf({});

const EVERYTHING_DONE = reportOf({
  actions: {
    "identity-user": { found: 1, pseudonymised: 1, membershipsEnded: 1 },
    "identity-invitation": { found: 2, deleted: 2 },
    "source-document": { found: 3, identifiersWithheld: 3 },
  },
  map: mapOf("identity-user", "identity-invitation", "source-document"),
  concepts: ["iri:b", "iri:a"],
});

const linesOf = (report: string, heading: string): readonly string[] => {
  const lines = report.split("\n");
  if (!lines.includes(heading)) throw new Error(`the report has no line ${heading}`);
  const after = lines.slice(lines.indexOf(heading) + 1);
  return after.slice(0, after.indexOf(""));
};

describe("the erasure report", () => {
  it("opens by naming the subject request", () => {
    expect(NOTHING_DONE.split("\n")[0]).toContain("subject-request-1");
  });

  it("separates ten paragraphs and ends with a newline", () => {
    const paragraphs = NOTHING_DONE.split("\n\n");
    expect(paragraphs).toHaveLength(10);
    expect(paragraphs.every((paragraph) => paragraph.trim() !== "")).toBe(true);
    expect(NOTHING_DONE.endsWith(".\n")).toBe(true);
  });

  it("dates each backup copy's expiry from the start, in order", () => {
    const dates = [
      "2026-06-01T12:00:00.000Z",
      "2026-06-03T12:00:00.000Z",
      "2026-07-01T12:00:00.000Z",
      "2026-07-27T12:00:00.000Z",
      "2026-12-01T12:00:00.000Z",
    ];
    const [, , expiry = "", anchored = ""] = NOTHING_DONE.split("\n\n");

    const at = dates.map((date) => expiry.indexOf(date));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at.toSorted((one, other) => one - other)).toEqual(at);
    expect(anchored).toContain(dates[0]);
  });

  it("says no export is recalled, since none was made", () => {
    expect(NOTHING_DONE).toContain(
      "This erasure cannot recall exports that were already made. No exports have been made.",
    );
  });

  it.each([
    ["nothing", NOTHING_DONE],
    ["everything", EVERYTHING_DONE],
  ])("says documents withhold the identifiers when the routine did %s", (_, report) => {
    expect(report).toContain(
      "The original files in the object store are not changed. Instead, the identifiers named in " +
        "this request are withheld from the text of every document in this workspace each time a " +
        "document is indexed, including documents added later.",
    );
  });

  it.each([
    ["nothing", NOTHING_DONE],
    ["everything", EVERYTHING_DONE],
  ])("says invitations are deleted everywhere when the routine did %s", (_, report) => {
    expect(report).toContain(
      "The erasure that removes a person from their last workspace also deletes every invitation " +
        "sent to the address they sign in with, in any workspace.",
    );
  });

  it.each([
    ["nothing", NOTHING_DONE],
    ["everything", EVERYTHING_DONE],
  ])("explains sign-in identity removal when the routine did %s", (_, report) => {
    expect(report).toContain(
      "A person's sign-in identity is removed only by the erasure that removes them from their " +
        "last workspace.",
    );
  });

  it("says none when no concept body names the person", () => {
    const named = linesOf(NOTHING_DONE, NAMES_HEADING);
    expect(named).toHaveLength(1);
    expect(named[0]).not.toMatch(/^- /u);
  });

  it("lists each concept naming the person by IRI, sorted", () => {
    expect(linesOf(EVERYTHING_DONE, NAMES_HEADING)).toEqual(["- iri:a", "- iri:b"]);
  });

  it("lists each family in map order with its counts sorted", () => {
    expect(linesOf(EVERYTHING_DONE, STORES_HEADING)).toEqual([
      "- identity-user: found 1, membershipsEnded 1, pseudonymised 1",
      "- identity-invitation: deleted 2, found 2",
      "- source-document: found 3, identifiersWithheld 3",
    ]);
  });

  it("reports nothing recorded for a mapped family with no action", () => {
    expect(
      linesOf(
        reportOf({ map: mapOf("concept-file", "bundle-commit"), actions: { "bundle-commit": {} } }),
        STORES_HEADING,
      ),
    ).toEqual(["- concept-file: nothing recorded", "- bundle-commit: nothing recorded"]);
  });
});
