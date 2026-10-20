import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  capFindingsIn,
  contextOf,
  findingsIn,
  findingsUnder,
  reportOf,
  routeFiles,
  tableFindingsIn,
} from "@better-answers/devtools/route-spec";
import type { Context } from "@better-answers/devtools/route-spec";

const ROUTE = "docs/specs/v01-route.md";

const context: Context = {
  root: repositoryRoot,
  decisions: new Set(["0016"]),
  glossary: new Set(["block", "strand"]),
};

const rulesIn = (text: string): readonly string[] =>
  findingsIn(ROUTE, text, context).map((finding) => finding.rule);

describe("a route file", () => {
  it.each([
    ["an ordna id", "landed as T-366 (#279)", "ordna id"],
    ["an ordna map ticket", "Sources to re-read: tickets 24, 63", "ordna ticket"],
    [
      "a machine-local path",
      "the record at `.scratch/v01-route/probes/FINDINGS.md`",
      "machine-local path",
    ],
    ["an em dash", "the queue — no subject", "em dash"],
    ["a strikethrough", "~~the stuck-ref command~~", "strikethrough"],
    ["a retired workflow word", "grill Q5", "retired workflow"],
    ["a date", "ruled 13/10/2026", "date"],
    ["a date in words", "written 9 September 2026", "date"],
    ["an ISO date", "ruled on 2026-10-13", "date"],
    ["a decision with no file", "ADR 0021 (the seam)", "unknown decision"],
    ["a link to no file", "[the plan](../plans/no-such-plan.md)", "dead link"],
    ["a path the clone lacks", "`docs/specs/no-such-file.md`", "missing path"],
    ["a word the glossary lacks", "**Words.** *block*, *stranded*", "unknown word"],
  ])("refuses %s", (_what, text, rule) => {
    expect(rulesIn(text)).toEqual([rule]);
  });

  it.each([
    ["a Linear issue and a pull request", "absorbs BA-158 (#747)"],
    ["a decision that exists", "ADR 0016 (answers assert concepts only)"],
    ["a link that resolves", "[the glossary](../../CONCEPTS.md)"],
    ["a path the clone holds", "`docs/agents/workflow.md`"],
    ["glossary words", "**Words.** *block*, *strand*"],
    ["a web link", "[OKF](https://example.com/okf)"],
    ["a template path", "the brief `docs/specs/route/<id>.md`"],
    ["a plan path with a date", "the plan `docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`"],
    ["an archived spec named by an ordna id", "[P2's spec](../archive/specs/T-028.md)"],
  ])("accepts %s", (_what, text) => {
    expect(rulesIn(text)).toEqual([]);
  });
});

const HEADER =
  "| Block | Strand | Delivers | Blocked by | Status | Next | Plan |\n| --- | --- | --- | --- | --- | --- | --- |\n";

const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |\n`;

const S3 = ["[S3](route/s3.md)", "records", "Guides", "none", "unplanned", "next", ""];

const S0 = ["S0", "knowledge", "Redaction", "none", "done", "", "[spec](../archive/specs/s0.md)"];

const tableRulesIn = (table: string, briefs: readonly string[] = ["s3.md"]): readonly string[] =>
  tableFindingsIn(ROUTE, `# Route\n\n${table}\nText after.\n`, new Set(briefs)).map(
    (finding) => finding.rule,
  );

describe("the status table", () => {
  it("accepts a linked live row and a bare done row", () => {
    expect(tableRulesIn(HEADER + row(S3) + row(S0))).toEqual([]);
  });

  it.each([
    ["no table", "Nothing here.\n", []],
    ["other columns", "| Block | Status |\n| --- | --- |\n| S3 | done |\n", []],
    ["a short row", HEADER + row(["[S3](route/s3.md)", "records", "Guides"]), []],
  ])("refuses %s as table shape", (_what, table, briefs) => {
    expect(tableRulesIn(table, briefs)).toEqual(["table shape"]);
  });

  it.each([
    ["an unknown strand", [...S3.slice(0, 1), "customers", ...S3.slice(2)], "strand"],
    ["an unknown status", [...S3.slice(0, 4), "specced", "", ""], "status word"],
    ["a next marker spelt otherwise", [...S3.slice(0, 5), "NEXT", ""], "next marker"],
    ["a blocker that is no row", [...S3.slice(0, 3), "S9", ...S3.slice(4)], "unknown block"],
    ["a live row with no link", ["S3", ...S3.slice(1)], "row without brief"],
  ])("refuses %s", (_what, cells, rule) => {
    expect(tableRulesIn(HEADER + row(cells))).toEqual([rule]);
  });

  it("refuses next on a building row", () => {
    expect(tableRulesIn(HEADER + row([...S3.slice(0, 4), "building", "next", ""]))).toEqual([
      "next marker",
    ]);
  });

  it("refuses next on a done row", () => {
    expect(tableRulesIn(HEADER + row([...S0.slice(0, 5), "next", ""]), [])).toEqual([
      "next marker",
    ]);
  });

  it("refuses two next markers on one strand", () => {
    const v1 = ["[V1](route/v1.md)", "records", "Verification", "S3", "unplanned", "next", ""];
    expect(tableRulesIn(HEADER + row(S3) + row(v1), ["s3.md", "v1.md"])).toEqual(["next marker"]);
  });

  it("refuses a brief with no live row", () => {
    expect(tableRulesIn(HEADER + row(S3), ["s3.md", "s4.md"])).toEqual(["brief without row"]);
  });

  it("refuses a brief for a done row", () => {
    expect(tableRulesIn(HEADER + row(S3) + row(S0), ["s3.md", "s0.md"])).toEqual([
      "brief for a done block",
      "brief without row",
    ]);
  });
});

describe("the word cap", () => {
  it("refuses a file one word over its cap", () => {
    expect(capFindingsIn("x.md", 601, 600).map((finding) => finding.rule)).toEqual(["over cap"]);
  });

  it("accepts a file at its cap", () => {
    expect(capFindingsIn("x.md", 600, 600)).toEqual([]);
  });
});

describe("docs/specs", () => {
  it("holds at least the route", () => {
    expect(routeFiles(repositoryRoot)).toContain(ROUTE);
  });

  it("names nothing a clone cannot open or the workflow retired", () => {
    const real = contextOf(repositoryRoot);
    expect(real.decisions.size).toBeGreaterThan(40);
    expect(real.glossary.size).toBeGreaterThan(100);

    expect(
      findingsUnder(repositoryRoot).map(reportOf),
      "each line names a route claim a fresh clone cannot follow, or a word of the retired workflow. Fix it as the line says.",
    ).toEqual([]);
  });
});
