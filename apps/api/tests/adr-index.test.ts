import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const adrDirectory = path.join(repositoryRoot, "docs", "adr");
const indexPath = path.join(adrDirectory, "README.md");

const ADR_FILE = /^(?<number>\d{4})-.+\.md$/;

const INDEX_ROW = /^\|\s*(?<number>\d{4})\s*\|(?<conclusion>.*)\|\s*$/;

const AMENDMENT_HEADING = /^##\s+Amendment\b.*$/gm;

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

type Adr = { readonly number: string; readonly file: string };

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

const amendedOn = (adr: Adr): string | undefined =>
  latestDateIn((bodyOf(adr).match(AMENDMENT_HEADING) ?? []).join("\n"));

const duplicates = (values: readonly string[]): readonly string[] => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

describe("the ADR index against the ADRs it indexes (T-040)", () => {
  it("names every decision record once, and records every decision it names", () => {
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
