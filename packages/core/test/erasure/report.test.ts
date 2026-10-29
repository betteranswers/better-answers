import { describe, expect, it } from "vitest";

import type { ErasureFamily, ErasureMap } from "../../src/erasure/map.ts";
import { erasureReportOf, type ErasureActions } from "../../src/erasure/report.ts";

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
  const after = report.split("\n").slice(report.split("\n").indexOf(heading) + 1);
  return after.slice(0, after.indexOf(""));
};

describe("the erasure report", () => {
  it("opens by naming the subject request", () => {
    expect(NOTHING_DONE.split("\n")[0]).toBe(
      "Erasure report for subject request subject-request-1.",
    );
  });

  it("sets each paragraph apart with one blank line", () => {
    expect(NOTHING_DONE.split("\n\n").map((paragraph) => paragraph.slice(0, 20))).toEqual([
      "Erasure report for s",
      "Every actor identifi",
      "Backup copies taken ",
      "The anchor above is ",
      "Names inside concept",
      "Where this person wa",
      "A person's sign-in i",
      "Invitations sent to ",
      "The original files i",
      "Exports already issu",
    ]);
    expect(NOTHING_DONE.endsWith("None have been issued.\n")).toBe(true);
  });

  it("says its anchor is the lock, not the last dump", () => {
    expect(NOTHING_DONE).toContain(
      "The anchor above is the instant this routine took the erasure lock, not the stamp of the " +
        "last dump before it: this routine reads no backup record, so the last dump precedes the anchor and " +
        "every date above is the latest a copy can expire.",
    );
  });

  it("dates each backup copy's expiry from the anchor", () => {
    expect(NOTHING_DONE).toContain(
      "Backup copies taken before 2026-06-01T12:00:00.000Z are beyond use: restored only in a " +
        "disaster, encrypted at rest, deletable only by the escrowed credential, expiring on " +
        "2026-06-03T12:00:00.000Z · 2026-07-01T12:00:00.000Z · 2026-07-27T12:00:00.000Z · " +
        "2026-12-01T12:00:00.000Z. Should a restore from such a copy occur, this request is " +
        "re-applied before the platform serves reads.",
    );
  });

  it("says no export is recalled, since none was issued", () => {
    expect(NOTHING_DONE).toContain(
      "Exports already issued are not recalled. None have been issued.",
    );
  });

  it.each([
    ["nothing", NOTHING_DONE],
    ["everything", EVERYTHING_DONE],
  ])("says the identifiers are withheld from documents, having done %s", (_, report) => {
    expect(report).toContain(
      "The original files in the object store are untouched; the identifiers named in this request " +
        "are withheld from the text of every document in this workspace, those held now and those " +
        "bound later, each time a document is indexed; and the documents found above are indexed " +
        "again now.",
    );
    expect(report).not.toContain("The object store is untouched");
  });

  it.each([
    ["nothing", NOTHING_DONE],
    ["everything", EVERYTHING_DONE],
  ])("says invitations are deleted wherever sent, having done %s", (_, report) => {
    expect(report).toContain(
      "Invitations sent to the address a person signs in with are deleted wherever they were sent, " +
        "by the request that erases them from their last workspace; the invitation line above counts this " +
        "workspace's alone.",
    );
  });

  it.each([
    ["nothing", NOTHING_DONE],
    ["everything", EVERYTHING_DONE],
  ])("says when a sign-in identity is removed, having done %s", (_, report) => {
    expect(report).toContain(
      "A person's sign-in identity is removed from the platform by the request that erases " +
        "them from their last workspace.",
    );
  });

  it("says so plainly when no concept body names the person", () => {
    expect(linesOf(NOTHING_DONE, "Names inside concept bodies, for the owner to edit:")).toEqual([
      "None: no concept body names this person.",
    ]);
  });

  it("lists each concept naming the person by IRI, sorted", () => {
    expect(linesOf(EVERYTHING_DONE, "Names inside concept bodies, for the owner to edit:")).toEqual(
      ["- iri:a", "- iri:b"],
    );
  });

  it("words each family in map order, its fields sorted", () => {
    expect(
      linesOf(EVERYTHING_DONE, "Where this person was held, and what the routine did:"),
    ).toEqual([
      "- identity-user: found 1, membershipsEnded 1, pseudonymised 1",
      "- identity-invitation: deleted 2, found 2",
      "- source-document: found 3, identifiersWithheld 3",
    ]);
  });

  it("says nothing recorded for a mapped family left untouched", () => {
    expect(
      linesOf(
        reportOf({ map: mapOf("concept-file", "bundle-commit"), actions: { "bundle-commit": {} } }),
        "Where this person was held, and what the routine did:",
      ),
    ).toEqual(["- concept-file: nothing recorded", "- bundle-commit: nothing recorded"]);
  });
});
