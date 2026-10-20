import { rmSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { reportOf, violationsUnder } from "@better-answers/devtools/route-spec";
import type { Violation } from "@better-answers/devtools/route-spec";
import { sweptFolder, writeUnder } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

type Cells = Readonly<Record<string, string>>;

const INDEX = "docs/specs/v01-route.md";

const CASE = "docs/specs/case.md";

const HEADER =
  "| Block | Strand | Delivers | Blocked by | Status | Next | Plan |\n| --- | --- | --- | --- | --- | --- | --- |\n";

const PLAN = "[the plan](../plans/2026-10-11-2309-x-plan.md)";

const UP_TO_ROOT = "../".repeat(20);

const S3: Cells = {
  Block: "[S3](route/s3.md)",
  Strand: "records",
  Delivers: "Guides",
  "Blocked by": "none",
  Status: "unplanned",
  Next: "next",
  Plan: "",
};

const P2: Cells = {
  Block: "P2",
  Strand: "people",
  Delivers: "The console",
  "Blocked by": "none",
  Status: "done",
  Next: "",
  Plan: "[spec](../archive/specs/T-028.md)",
};

const V1: Cells = {
  Block: "[V1](route/v1.md)",
  Strand: "records",
  Delivers: "Verification",
  "Blocked by": "S3",
  Status: "unplanned",
  Next: "next",
  Plan: "",
};

const row = (cells: Cells): string => `| ${Object.values(cells).join(" | ")} |\n`;

const indexOf = (table: string): string => `# The v0.1 route\n\n${table}\nText after.\n`;

const BASE: Tree = {
  "CONCEPTS.md":
    "# Concepts\n\n## The route\n\n### block\n\nA destination.\n\n### strand\n\nA chain.\n",
  "docs/solutions/architecture-patterns/adr-0016-x.md": "# ADR 0016\n",
  [INDEX]: indexOf(HEADER + row(S3) + row(P2)),
  "docs/specs/route/s3.md": "# S3\n",
  "docs/archive/specs/T-028.md": "# P2\n",
  "docs/plans/2026-10-11-2309-x-plan.md": "# The plan\n",
};

const violationsOver = (files: Tree, root = sweptFolder()): readonly Violation[] => {
  try {
    for (const [file, source] of Object.entries({ ...BASE, ...files })) {
      writeUnder(root, file, source);
    }
    return violationsUnder(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const rulesOver = (files: Tree, root?: string): readonly string[] =>
  violationsOver(files, root).map((violation) => violation.rule);

const tableRules = (table: string, briefs: readonly string[] = []): readonly string[] =>
  rulesOver({
    [INDEX]: indexOf(table),
    ...Object.fromEntries(briefs.map((brief) => [`docs/specs/route/${brief}`, "# A brief\n"])),
  });

describe("a route line", () => {
  it.each([
    ["an ordna id", "landed as T-366 (#279)", "ordna id"],
    ["an ordna map ticket", "Sources to re-read: tickets 24, 63", "ordna ticket"],
    ["a machine-local path", "the record at `.scratch/probes/FINDINGS.md`", "machine-local path"],
    ["an em dash", "the queue — no subject", "em dash"],
    ["a strikethrough", "~~the stuck-ref command~~", "strikethrough"],
    ["a retired workflow word", "grill Q5", "retired workflow"],
    ["a date", "ruled 13/10/2026", "date"],
    ["a date in words", "written 9 September 2026", "date"],
    ["an ISO date", "ruled on 2026-10-13", "date"],
    ["a decision with no file", "ADR 0021 (the seam)", "unknown decision"],
    ["a link to no file", "[the plan](../plans/no-such-plan.md)", "dead link"],
    ["a link that leaves the clone", `[hosts](${UP_TO_ROOT}etc/hosts)`, "dead link"],
    ["a root link that leaves the clone", `[hosts](/${UP_TO_ROOT}etc/hosts)`, "dead link"],
    ["a path the clone lacks", "`docs/specs/no-such-file.md`", "missing path"],
    ["a path that leaves the clone", `\`docs/${UP_TO_ROOT}etc/hosts\``, "missing path"],
    ["a word the glossary lacks", "**Words.** *block*, *stranded*", "unknown word"],
  ])("refuses %s", (_what, text, rule) => {
    expect(rulesOver({ [CASE]: `${text}\n` })).toEqual([rule]);
  });

  it("reads a route file in a folder named build", () => {
    expect(rulesOver({ "docs/specs/build/x.md": "a — b\n" })).toEqual(["em dash"]);
  });

  it("refuses a link rooted at this checkout", () => {
    const root = sweptFolder();
    expect(rulesOver({ [CASE]: `[glossary](${root}/CONCEPTS.md)\n` }, root)).toEqual(["dead link"]);
  });

  it("counts every dead link but one em dash per line", () => {
    expect(rulesOver({ [CASE]: "a — b — [x](x.md) [y](y.md)\n" })).toEqual([
      "em dash",
      "dead link",
      "dead link",
    ]);
  });

  it("refuses a machine-local link once, whether or not it exists", () => {
    const link = { [CASE]: "[probe](../../.scratch/x.md)\n" };
    expect(rulesOver({ ...link, ".scratch/x.md": "# Probe\n" })).toEqual(["machine-local path"]);
    expect(rulesOver(link)).toEqual(["machine-local path"]);
  });

  it.each([
    ["a Linear issue and a pull request", "absorbs BA-158 (#747)"],
    ["a decision that exists", "ADR 0016 (answers assert concepts only)"],
    ["a link that resolves", "[the glossary](../../CONCEPTS.md)"],
    ["a path the clone holds", "`docs/specs/route/s3.md`"],
    ["glossary words", "**Words.** *block*, *strand*"],
    ["an italic word outside a Words line", "the *stranded* block"],
    ["a web link", "[OKF](https://example.com/okf)"],
    ["a template path", "the brief `docs/specs/route/<id>.md`"],
    ["a dated plan path", "the plan `docs/plans/2026-10-11-2309-x-plan.md`"],
    ["a dated plan link", PLAN],
    ["an archived spec named by an ordna id", "[P2's spec](../archive/specs/T-028.md)"],
  ])("accepts %s", (_what, text) => {
    expect(rulesOver({ [CASE]: `${text}\n` })).toEqual([]);
  });
});

describe("the status table", () => {
  it("accepts a linked live row and a bare done row", () => {
    expect(rulesOver({})).toEqual([]);
  });

  it("accepts a blocker whose words hold a comma", () => {
    const waiting = { ...V1, "Blocked by": "S3 (the rename, the move)", Next: "" };
    expect(tableRules(HEADER + row(S3) + row(waiting), ["v1.md"])).toEqual([]);
  });

  it("accepts a building row with no plan", () => {
    expect(tableRules(HEADER + row({ ...S3, Status: "building", Next: "" }))).toEqual([]);
  });

  it.each([
    ["no table", "Nothing here.\n"],
    ["other columns", "| Block | Status |\n| --- | --- |\n| S3 | done |\n"],
    ["a short row", `${HEADER}| [S3](route/s3.md) | records | Guides |\n`],
    ["a malformed Blocked by cell", HEADER + row({ ...S3, "Blocked by": "S9 S10" })],
    ["two rows with one Block id", HEADER + row(S3) + row({ ...P2, Block: "S3" })],
    ["a line that is no row", `${HEADER + row(S3)}not a row\n${row(P2)}`],
  ])("refuses %s as table shape", (_what, table) => {
    expect(tableRules(table)).toEqual(["table shape"]);
  });

  it.each([
    ["an unknown strand", { ...S3, Strand: "customers" }, "strand"],
    ["an unknown status", { ...S3, Status: "specced", Next: "" }, "status word"],
    ["a next marker spelt otherwise", { ...S3, Next: "NEXT" }, "next marker"],
    ["a blocker that is no row", { ...S3, "Blocked by": "S9" }, "unknown block"],
    ["a row that waits on itself", { ...S3, "Blocked by": "S3 (a)" }, "blocked by itself"],
    ["a live row with no link", { ...S3, Block: "S3" }, "row without brief"],
    ["a planned row with no plan", { ...S3, Status: "planned" }, "row without plan"],
    ["next on a building row", { ...S3, Status: "building", Plan: PLAN }, "next marker"],
  ])("refuses %s", (_what, cells, rule) => {
    expect(tableRules(HEADER + row(cells))).toEqual([rule]);
  });

  it("refuses next on a done row", () => {
    expect(tableRules(HEADER + row(S3) + row({ ...P2, Next: "next" }))).toEqual(["next marker"]);
  });

  it("refuses two next markers on one strand", () => {
    expect(tableRules(HEADER + row(S3) + row(V1), ["v1.md"])).toEqual(["next marker"]);
  });

  it("refuses a brief with no row", () => {
    expect(tableRules(HEADER + row(S3), ["s4.md"])).toEqual(["brief without row"]);
  });

  it("refuses a done row's brief once", () => {
    expect(tableRules(HEADER + row(S3) + row(P2), ["p2.md"])).toEqual(["brief without row"]);
  });
});

describe("the word cap", () => {
  it("refuses a brief one word over 600", () => {
    expect(rulesOver({ "docs/specs/route/s3.md": "word ".repeat(601) })).toEqual(["over cap"]);
  });

  it("accepts a brief of 600 words", () => {
    expect(rulesOver({ "docs/specs/route/s3.md": "word ".repeat(600) })).toEqual([]);
  });
});

describe("a report", () => {
  it("names the file, line, rule, text and fix", () => {
    expect(
      violationsOver({ [CASE]: "first\nsecond\nthe queue — no subject\n" }).map(reportOf),
    ).toEqual(["docs/specs/case.md:3: em dash `—`: end the sentence or use a comma"]);
  });
});

describe("docs/specs", () => {
  it("names nothing a clone cannot open or the workflow retired", () => {
    expect(
      violationsUnder(repositoryRoot).map(reportOf),
      "each line names a route claim a fresh clone cannot follow, or a word of the retired workflow. Fix it as the line says.",
    ).toEqual([]);
  });
});
