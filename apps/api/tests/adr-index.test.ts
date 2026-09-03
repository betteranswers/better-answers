import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `docs/adr/README.md` is the one-line live conclusion of every ADR, and `AGENTS.md`
 * makes it the first thing a session reads before trusting an ADR's body — because the
 * convention here is chronological, so an opening claim can be undone by an amendment
 * further down its own file. An index that has stopped tracking its ADRs is worse than
 * no index: it is a stale conclusion a reader has been told to trust.
 *
 * The maintenance rule in the README's own header ("a PR that adds an ADR, or an
 * amendment that changes a conclusion, updates the matching line here in the same
 * commit") was a promise, and it was broken twice on 2026-09-03 alone — ADR 0008 and
 * ADR 0022 were amended and their rows were not. This is the promise as a check.
 *
 * **What it can and cannot see.** The membership check is exact and runs both ways
 * (`[TEST7]`): an ADR with no row and a row with no ADR are different mistakes and only
 * one direction finds each. The staleness check is a heuristic, and honest about it — a
 * row carries no field saying which amendment it accounts for, only prose that sometimes
 * names a date. So it compares the newest date the row mentions against the newest date
 * an `## Amendment` heading in that ADR mentions, and it only speaks where the row
 * mentions one at all. A row that names no date is not checked for staleness; that is
 * the README's style, not an oversight, and tightening it would mean dating twenty-odd
 * rows whose conclusions have not moved since they were written. What this buys is the
 * case that actually bit: a row that was dated, an amendment written after it, and
 * nobody noticing.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const adrDirectory = path.join(repositoryRoot, "docs", "adr");
const indexPath = path.join(adrDirectory, "README.md");

/** `0007-plain-postgres-and-app-owned-migrations.md` → `0007`; `README.md` is not one. */
const ADR_FILE = /^(?<number>\d{4})-.+\.md$/;
/** A row of the index: `| 0007 | Plain Postgres; … |`. The header and rule rows do not match. */
const INDEX_ROW = /^\|\s*(?<number>\d{4})\s*\|(?<conclusion>.*)\|\s*$/;
/** Every amendment in an ADR is an `## Amendment` heading; its date lives in the heading. */
const AMENDMENT_HEADING = /^##\s+Amendment\b.*$/gm;

/**
 * Both date forms the repository actually writes: ISO in most amendment headings and
 * most rows, UK in a few of each (`## Amendment (27/08/2026, …)`, ADR 0033's row).
 * Normalised to ISO so a plain string sort is a chronological one.
 */
const datesIn = (text: string): readonly string[] => [
  ...[...text.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => match[0]),
  ...[...text.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].flatMap((match) => {
    const [, day, month, year] = match;
    return day === undefined || month === undefined || year === undefined
      ? []
      : [`${year}-${month}-${day}`];
  }),
];

const latestDateIn = (text: string): string | undefined => [...datesIn(text)].sort().at(-1);

const adrNumbers = (): readonly string[] =>
  readdirSync(adrDirectory)
    .flatMap((file) => {
      const number = ADR_FILE.exec(file)?.groups?.["number"];
      return number === undefined ? [] : [number];
    })
    .sort();

const adrBody = (number: string): string => {
  const file = readdirSync(adrDirectory).find((name) => name.startsWith(`${number}-`));
  if (file === undefined) throw new Error(`no ADR file for ${number}`);
  return readFileSync(path.join(adrDirectory, file), "utf8");
};

/** number → the row's conclusion text, in the order the index lists them. */
const indexRows = (): ReadonlyMap<string, string> => {
  const rows = new Map<string, string>();
  for (const line of readFileSync(indexPath, "utf8").split("\n")) {
    const groups = INDEX_ROW.exec(line)?.groups;
    const number = groups?.["number"];
    const conclusion = groups?.["conclusion"];
    if (number !== undefined && conclusion !== undefined) rows.set(number, conclusion);
  }
  return rows;
};

describe("the ADR index against the ADRs it indexes (T-040)", () => {
  it("names every decision record, and records every decision it names", () => {
    // [TEST7] both ways: the first direction finds the ADR nobody indexed, the second the
    // row left behind by a file that was renamed or removed.
    const numbers = adrNumbers();
    const rows = indexRows();

    expect(numbers.filter((number) => !rows.has(number))).toEqual([]);
    expect([...rows.keys()].filter((number) => !numbers.includes(number))).toEqual([]);
  });

  it("carries no row whose newest date is older than its ADR's newest amendment", () => {
    const stale = [...indexRows()]
      .flatMap(([number, conclusion]) => {
        const claimed = latestDateIn(conclusion);
        const amended = latestDateIn((adrBody(number).match(AMENDMENT_HEADING) ?? []).join("\n"));
        // A row that names no date makes no claim to check; an ADR with no dated
        // amendment has nothing to be behind.
        return claimed === undefined || amended === undefined || amended <= claimed
          ? []
          : [{ adr: number, rowSaysAsOf: claimed, amendedOn: amended }];
      })
      .sort((left, right) => left.adr.localeCompare(right.adr));

    expect(
      stale,
      "docs/adr/README.md has a row older than the ADR it summarises. Read the amendment, then write the live conclusion into the row and date it — the index is what a session is told to trust instead of the body.",
    ).toEqual([]);
  });

  it("reads a dated amendment out of every amendment heading, so none goes unchecked", () => {
    // Both assertions above are silent when a regex stops matching: no rows found is no
    // rows missing, and no amendment headings found is nothing stale. This is the guard
    // T-039 wrote for its endpoint snapshot, in the same shape — a heading written in a
    // date form `datesIn` cannot read would take that ADR out of the check above without
    // anybody being told.
    const undated = adrNumbers().flatMap((number) =>
      (adrBody(number).match(AMENDMENT_HEADING) ?? [])
        .filter((heading) => latestDateIn(heading) === undefined)
        .map((heading) => `${number}: ${heading}`),
    );

    expect(
      undated,
      "an ADR amendment heading carries no date this test can read. Date it as `2026-09-03` (or `03/09/2026`), or the ADR silently drops out of the staleness check.",
    ).toEqual([]);
    expect(indexRows().size).toBeGreaterThan(0);
    expect(
      adrNumbers().filter((number) => (adrBody(number).match(AMENDMENT_HEADING) ?? []).length > 0)
        .length,
    ).toBeGreaterThan(0);
  });
});
