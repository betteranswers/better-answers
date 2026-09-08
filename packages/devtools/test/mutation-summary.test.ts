import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  mutationSummary,
  mutationSummaryFromArgv,
} from "@better-answers/devtools/mutation-summary";
import type { Report, ReportMutant } from "@better-answers/devtools/mutation-summary";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The mutation run's job summary, read as the text a reader sees (T-090, T-107).
 *
 * What the summary is for is one question — which mutants newly survived since the last
 * run — and the cases below are the ways that question goes wrong quietly: a first run with
 * nothing to compare against listing every survivor as news, a file that gained lines above
 * a mutant reporting an unmoved survivor as new because its line number moved, and a row
 * the runner never tested counted as a survivor. Each expected line is written down
 * (`[TEST9]`): the summary is prose a person reads, so the assertion is the prose.
 *
 * The last case runs the script itself over two files in a temporary directory, so the
 * entry point the workflow calls — flags, file reading, the "no report" and "no baseline"
 * paths — is run rather than read (`[CHECK1]`).
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const script = path.join(repositoryRoot, "scripts/mutation-summary.mjs");

const scratch = mkdtempSync(path.join(tmpdir(), "mutation-summary-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const SOURCE = `export const answer = (n: number): number => n + 1;
export const label = "answer";
export const other = "other";
`;

/** The same file with a line added above every mutant, so every line number moves by one. */
const SOURCE_SHIFTED = `// a comment nobody had before\n${SOURCE}`;

type Span = { readonly line: number; readonly start: number; readonly end: number };

const mutant = (
  mutatorName: string,
  replacement: string,
  span: Span,
  status: ReportMutant["status"],
  testsCompleted?: number,
): ReportMutant => ({
  mutatorName,
  replacement,
  status,
  ...(testsCompleted === undefined ? {} : { testsCompleted }),
  location: {
    start: { line: span.line, column: span.start },
    end: { line: span.line, column: span.end },
  },
});

/** `n + 1` on line 1, `"answer"` on line 2 and `"other"` on line 3 of `SOURCE`. */
const PLUS = { line: 1, start: 46, end: 51 };
const LABEL = { line: 2, start: 22, end: 30 };
const OTHER = { line: 3, start: 22, end: 29 };

const shifted = (span: Span): Span => ({ ...span, line: span.line + 1 });

const report = (source: string, mutants: readonly ReportMutant[]): Report => ({
  files: { "src/answer.ts": { source, mutants } },
});

describe("the mutation summary (T-090)", () => {
  it("names the mutants that survive here and did not survive in the baseline", () => {
    const baseline = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
      mutant("StringLiteral", '""', LABEL, "Killed", 1),
      mutant("StringLiteral", '""', OTHER, "Survived", 1),
    ]);
    const current = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
      mutant("StringLiteral", '""', LABEL, "Survived", 1),
      mutant("StringLiteral", '""', OTHER, "Survived", 1),
    ]);

    expect(mutationSummary("api", current, baseline)).toBe(
      [
        "### api mutation score: 33.3% (1/3 mutants killed)",
        "### api new survivors: 1",
        "Survived or uncovered here, and not so in the previous run's report. Matched by the mutated text, not by line number; two identical spans in one file mutated the same way are matched by order.",
        '- `src/answer.ts:2` — StringLiteral — `""`',
        "### api mutants that ran no test: none",
        "",
      ].join("\n"),
    );
  });

  it("says there are none when every survivor already survived", () => {
    const both = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
      mutant("StringLiteral", '""', LABEL, "Survived", 1),
      mutant("StringLiteral", '""', OTHER, "NoCoverage"),
    ]);

    expect(mutationSummary("core", both, both)).toBe(
      [
        "### core mutation score: 33.3% (1/3 mutants killed)",
        "### core new survivors: none",
        "### core mutants that ran no test: none",
        "",
      ].join("\n"),
    );
  });

  it("says no baseline on a first run, and lists nothing", () => {
    const current = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
      mutant("StringLiteral", '""', LABEL, "Survived", 1),
    ]);

    expect(mutationSummary("api", current, undefined)).toBe(
      [
        "### api mutation score: 50% (1/2 mutants killed)",
        "### api new survivors: no baseline — nothing was restored to compare against, so this run's report is the next run's baseline",
        "### api mutants that ran no test: none",
        "",
      ].join("\n"),
    );
  });

  it("matches a mutant by its text when the file gained lines above it", () => {
    const baseline = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
      mutant("StringLiteral", '""', LABEL, "Survived", 1),
    ]);
    const current = report(SOURCE_SHIFTED, [
      mutant("ArithmeticOperator", "n - 1", shifted(PLUS), "Survived", 1),
      mutant("StringLiteral", '""', shifted(LABEL), "Survived", 1),
    ]);

    const summary = mutationSummary("api", current, baseline);

    expect(summary).toContain("### api new survivors: 1\n");
    expect(summary).toContain("- `src/answer.ts:2` — ArithmeticOperator — `n - 1`\n");
    expect(summary).not.toContain("src/answer.ts:3");
  });

  it("counts a mutant the baseline never held as new, and says so", () => {
    const baseline = report(SOURCE, [mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1)]);
    const current = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
      mutant("StringLiteral", '""', LABEL, "NoCoverage"),
    ]);

    expect(mutationSummary("api", current, baseline)).toContain(
      '- `src/answer.ts:2` — StringLiteral — `""` (not in the baseline)\n',
    );
  });

  it("lists a row the runner never tested as a runner fault, never as a survivor", () => {
    const baseline = report(SOURCE, [
      mutant("StringLiteral", '""', LABEL, "Survived", 0),
      mutant("StringLiteral", '""', OTHER, "Survived", 0),
    ]);
    const current = report(SOURCE, [
      mutant("StringLiteral", '""', LABEL, "Survived", 0),
      mutant("StringLiteral", '""', OTHER, "Survived", 3),
    ]);

    expect(mutationSummary("core", current, baseline)).toBe(
      [
        "### core mutation score: 0% (0/2 mutants killed)",
        "### core new survivors: 1",
        "Survived or uncovered here, and not so in the previous run's report. Matched by the mutated text, not by line number; two identical spans in one file mutated the same way are matched by order.",
        '- `src/answer.ts:3` — StringLiteral — `""` (no verdict in the baseline)',
        "### core mutants that ran no test: 1 — the runner resolved no test file for them, which is a runner fault to fix (`vitest.related`, T-107), never a survivor to triage",
        '- `src/answer.ts:2` — StringLiteral — `""`',
        "",
      ].join("\n"),
    );
  });

  it("marks a survivor the baseline ignored as one with no verdict, not as drift", () => {
    const baseline = report(SOURCE, [mutant("StringLiteral", '""', LABEL, "Ignored")]);
    const current = report(SOURCE, [mutant("StringLiteral", '""', LABEL, "Survived", 1)]);

    expect(mutationSummary("api", current, baseline)).toContain(
      '- `src/answer.ts:2` — StringLiteral — `""` (no verdict in the baseline)\n',
    );
  });

  it("keeps a multi-line replacement on one line", () => {
    const current = report(SOURCE, [
      mutant("ArrowFunction", "() => {\n  return undefined;\n}", PLUS, "Survived", 1),
    ]);

    expect(mutationSummary("api", current, undefined)).toContain(
      "### api mutation score: 0% (0/1 mutants killed)",
    );
    expect(mutationSummary("api", current, report(SOURCE, []))).toContain(
      "- `src/answer.ts:1` — ArrowFunction — `() => { return undefined; }` (not in the baseline)\n",
    );
  });
});

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

const run = (...argv: readonly string[]): Run => {
  const result = spawnSync(process.execPath, [script, ...argv], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("the mutation summary script over files (T-090)", () => {
  const reportFile = path.join(scratch, "mutation.json");
  const baselineFile = path.join(scratch, "baseline.json");
  writeFileSync(
    reportFile,
    JSON.stringify(
      report(SOURCE, [
        mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
        mutant("StringLiteral", '""', LABEL, "Survived", 1),
      ]),
    ),
  );
  writeFileSync(
    baselineFile,
    JSON.stringify(report(SOURCE, [mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1)])),
  );

  it("prints the summary for the report against the baseline and exits zero", () => {
    const result = run("--leg", "api", "--report", reportFile, "--baseline", baselineFile);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      [
        "### api mutation score: 50% (1/2 mutants killed)",
        "### api new survivors: 1",
        "Survived or uncovered here, and not so in the previous run's report. Matched by the mutated text, not by line number; two identical spans in one file mutated the same way are matched by order.",
        '- `src/answer.ts:2` — StringLiteral — `""` (not in the baseline)',
        "### api mutants that ran no test: none",
        "",
      ].join("\n"),
    );
  });

  it("says no baseline when the baseline file is absent, and no report when the report is", () => {
    const noBaseline = run(
      "--leg",
      "api",
      "--report",
      reportFile,
      "--baseline",
      path.join(scratch, "absent.json"),
    );
    expect(noBaseline.status).toBe(0);
    expect(noBaseline.stdout).toContain("### api new survivors: no baseline — ");

    const noReport = run("--leg", "core", "--report", path.join(scratch, "absent.json"));
    expect(noReport.status).toBe(0);
    expect(noReport.stdout).toBe("### core mutation score: no report\n");
  });

  it("reads a baseline it cannot parse as no baseline, never as an error", () => {
    const halfWritten = path.join(scratch, "half.json");
    writeFileSync(halfWritten, '{"files": {');

    expect(
      mutationSummaryFromArgv(["--leg", "api", "--report", reportFile, "--baseline", halfWritten]),
    ).toContain("### api new survivors: no baseline — ");
  });

  it("refuses a command line without a leg or a report", () => {
    expect(() => mutationSummaryFromArgv(["--report", reportFile])).toThrow(
      "usage: mutation-summary --leg <name> --report <path> [--baseline <path>]",
    );
  });
});
