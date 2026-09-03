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
 * **What it can and cannot see.** Membership is exact and runs both ways (`[TEST7]`): an
 * ADR with no row and a row with no ADR are different mistakes, and only one direction
 * finds each. Staleness is read off dates, because a row carries no field saying which
 * amendment it accounts for — the newest date the row mentions against the newest date an
 * `## Amendment` heading in that ADR mentions.
 *
 * **A row that names no date is behind, not exempt.** That was this test's first shape and
 * it would have missed the case that motivated it: ADR 0008's row was undated *and* stale,
 * so a rule that only spoke where a row named a date passed it. Replayed against the
 * README as it stood on `origin/main` at `1e468de`, the rule as written now names both
 * 0008 and 0022 — and eighteen more, which is why this ticket dated every row whose ADR
 * carries a dated amendment. Every one of those is now checked on every run.
 *
 * What is still outside it: an ADR with **no** dated amendment (nothing to be behind), and
 * an amendment that changes a conclusion *without* changing the newest date — an
 * amendment written on a day the row already claims. The date is a claim about currency,
 * not a diff; a reviewer still reads the amendment.
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
 * Both date forms the repository actually writes: ISO in most amendment headings and most
 * rows, UK in a few of each (`## Amendment (27/08/2026, …)`, ADR 0033's row). Normalised to
 * ISO so a plain string sort is a chronological one.
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

/** One decision record on disk. `ADR_FILE` is the only thing that decides what is one. */
type Adr = { readonly number: string; readonly file: string };
/** One row of the index. `conclusion` is the cell after the number, pipes stripped. */
type Row = { readonly number: string; readonly conclusion: string };

const adrs = (): readonly Adr[] =>
  readdirSync(adrDirectory)
    .flatMap((file) => {
      const number = ADR_FILE.exec(file)?.groups?.["number"];
      return number === undefined ? [] : [{ number, file }];
    })
    .sort((left, right) => left.number.localeCompare(right.number));

const rows = (): readonly Row[] =>
  readFileSync(indexPath, "utf8")
    .split("\n")
    .flatMap((line) => {
      const groups = INDEX_ROW.exec(line)?.groups;
      const number = groups?.["number"];
      const conclusion = groups?.["conclusion"];
      return number === undefined || conclusion === undefined ? [] : [{ number, conclusion }];
    });

const bodyOf = (adr: Adr): string => readFileSync(path.join(adrDirectory, adr.file), "utf8");

/** The newest date any `## Amendment` heading in this ADR carries; `undefined` if none does. */
const amendedOn = (adr: Adr): string | undefined =>
  latestDateIn((bodyOf(adr).match(AMENDMENT_HEADING) ?? []).join("\n"));

/** Every value that appears more than once. */
const duplicates = (values: readonly string[]): readonly string[] => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

describe("the ADR index against the ADRs it indexes (T-040)", () => {
  it("names every decision record once, and records every decision it names", () => {
    // [TEST7] both ways: the first direction finds the ADR nobody indexed, the second the
    // row left behind by a file that was renamed or removed. The two duplicate checks are
    // the same rule again — a second row for one number would satisfy both directions
    // while making the index ambiguous about which line is the live one, and the staleness
    // check below would read whichever came last.
    const numbers = adrs().map((adr) => adr.number);
    const indexed = rows().map((row) => row.number);

    expect(numbers.filter((number) => !indexed.includes(number))).toEqual([]);
    expect(indexed.filter((number) => !numbers.includes(number))).toEqual([]);
    expect(duplicates(indexed)).toEqual([]);
    expect(duplicates(numbers)).toEqual([]);
  });

  it("dates every row at or after the newest amendment of the ADR it summarises", () => {
    const byNumber = new Map(adrs().map((adr) => [adr.number, adr]));

    const behind = rows()
      .flatMap((row) => {
        const adr = byNumber.get(row.number);
        const amended = adr === undefined ? undefined : amendedOn(adr);
        // An ADR with no dated amendment has nothing to be behind. An undated row IS
        // behind: ADR 0008's row was undated and stale on the same day, and a rule that
        // only spoke where a row named a date is the rule that let it through.
        if (amended === undefined) return [];
        const claimed = latestDateIn(row.conclusion);
        return claimed !== undefined && amended <= claimed
          ? []
          : [{ adr: row.number, rowSaysAsOf: claimed ?? "undated", amendedOn: amended }];
      })
      .sort((left, right) => left.adr.localeCompare(right.adr));

    expect(
      behind,
      "docs/adr/README.md has a row behind the ADR it summarises. Read the amendment, then write the live conclusion into the row and date it — the index is what a session is told to trust instead of the body, and an undated row is one nobody can tell has been read since.",
    ).toEqual([]);
  });

  it("carries a readable date on every amendment, and rows for the check to bite on", () => {
    // Both assertions above go quiet when a regex stops matching: no rows found is no rows
    // missing, and no amendment headings found is nothing behind. This is the guard T-039
    // wrote for its endpoint snapshot, in the same shape — a heading in a date form
    // `datesIn` cannot read would take that ADR out of the check above with nobody told.
    const undated = adrs().flatMap((adr) =>
      (bodyOf(adr).match(AMENDMENT_HEADING) ?? [])
        .filter((heading) => latestDateIn(heading) === undefined)
        .map((heading) => `${adr.number}: ${heading}`),
    );

    expect(
      undated,
      "an ADR amendment heading carries no date this test can read. Date it as `2026-09-03` (or `03/09/2026`), or the ADR silently drops out of the check above.",
    ).toEqual([]);
    expect(rows().length).toBeGreaterThan(0);
    expect(adrs().filter((adr) => amendedOn(adr) !== undefined).length).toBeGreaterThan(0);
  });
});
