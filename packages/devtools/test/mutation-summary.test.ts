import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  mutationSummary,
  mutationSummaryFromArgv,
} from "@better-answers/devtools/mutation-summary";
import type { Report, ReportMutant } from "@better-answers/devtools/mutation-summary";
import { repositoryRoot } from "@better-answers/devtools/oxlint-config";
import { afterAll, describe, expect, it } from "vitest";

const script = path.join(repositoryRoot, "scripts/mutation-summary.mjs");

const scratch = mkdtempSync(path.join(tmpdir(), "mutation-summary-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const SOURCE = `export const answer = (n: number): number => n + 1;
export const label = "answer";
export const other = "other";
`;

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

const PLUS = { line: 1, start: 46, end: 51 };
const LABEL = { line: 2, start: 22, end: 30 };
const OTHER = { line: 3, start: 22, end: 29 };

const shifted = (span: Span): Span => ({ ...span, line: span.line + 1 });

const SOURCE_TWICE = `export const first = "user";
export const second = "user";
`;
const FIRST_USER = { line: 1, start: 22, end: 28 };
const SECOND_USER = { line: 2, start: 23, end: 29 };

const report = (source: string, mutants: readonly ReportMutant[]): Report => ({
  files: { "src/answer.ts": { source, mutants } },
});

describe("the mutation summary", () => {
  it("names mutants that survive here but not in the baseline", () => {
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

    expect(mutationSummary("api", current, baseline).summary).toBe(
      [
        "### api mutation score: 33.3% (1/3 mutants killed)",
        "### api new survivors: 1",
        "Survived or uncovered here, and not so in the previous run's report. Matched by the mutated text, not by line number; two identical spans in one file mutated the same way are matched by their order in the file.",
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

    expect(mutationSummary("core", both, both).summary).toBe(
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

    expect(mutationSummary("api", current, undefined).summary).toBe(
      [
        "### api mutation score: 50% (1/2 mutants killed)",
        "### api new survivors: no baseline — nothing was restored to compare against, so this run's report is the next run's baseline",
        "### api mutants that ran no test: none",
        "",
      ].join("\n"),
    );
  });

  it("pairs two identical spans by position, whatever the report's order", () => {
    const baseline = report(SOURCE_TWICE, [
      mutant("StringLiteral", '""', FIRST_USER, "Killed", 1),
      mutant("StringLiteral", '""', SECOND_USER, "Survived", 1),
    ]);
    const current = report(SOURCE_TWICE, [
      mutant("StringLiteral", '""', SECOND_USER, "Survived", 1),
      mutant("StringLiteral", '""', FIRST_USER, "Killed", 1),
    ]);

    expect(mutationSummary("api", current, baseline).summary).toContain(
      "### api new survivors: none\n",
    );
  });

  it("matches a mutant by its text, not its line number", () => {
    const baseline = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
      mutant("StringLiteral", '""', LABEL, "Survived", 1),
    ]);
    const current = report(SOURCE_SHIFTED, [
      mutant("ArithmeticOperator", "n - 1", shifted(PLUS), "Survived", 1),
      mutant("StringLiteral", '""', shifted(LABEL), "Survived", 1),
    ]);

    const summary = mutationSummary("api", current, baseline).summary;

    expect(summary).toContain("### api new survivors: 1\n");
    expect(summary).toContain("- `src/answer.ts:2` — ArithmeticOperator — `n - 1`\n");
    expect(summary).not.toContain("src/answer.ts:3");
  });

  it("marks a mutant the baseline never held as new", () => {
    const baseline = report(SOURCE, [mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1)]);
    const current = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
      mutant("StringLiteral", '""', LABEL, "NoCoverage"),
    ]);

    expect(mutationSummary("api", current, baseline).summary).toContain(
      '- `src/answer.ts:2` — StringLiteral — `""` (not in the baseline)\n',
    );
  });

  it("calls an untested row a runner fault, not a survivor", () => {
    const baseline = report(SOURCE, [
      mutant("StringLiteral", '""', LABEL, "Survived", 0),
      mutant("StringLiteral", '""', OTHER, "Survived", 0),
    ]);
    const current = report(SOURCE, [
      mutant("StringLiteral", '""', LABEL, "Survived", 0),
      mutant("StringLiteral", '""', OTHER, "Survived", 3),
    ]);

    expect(mutationSummary("core", current, baseline).summary).toBe(
      [
        "### core runner fault: 1 of its 2 covered mutants ran no test — no verdict in this report can be trusted, so the leg fails until the runner is fixed and a run with `force` tests every mutant again",
        "### core mutation score: 0% (0/2 mutants killed)",
        "### core new survivors: 1",
        "Survived or uncovered here, and not so in the previous run's report. Matched by the mutated text, not by line number; two identical spans in one file mutated the same way are matched by their order in the file.",
        '- `src/answer.ts:3` — StringLiteral — `""` (no verdict in the baseline)',
        "### core mutants that ran no test: 1 — the runner ran none of the tests that cover them, which is a runner fault to fix (the vitest-runner patch under `patches/`), never a survivor to triage",
        '- `src/answer.ts:2` — StringLiteral — `""`',
        "",
      ].join("\n"),
    );
  });

  it("names a runner fault if one mutant ran no test", () => {
    const current = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 4),
      mutant("StringLiteral", '""', LABEL, "Timeout", 2),
      mutant("StringLiteral", '""', OTHER, "Survived", 0),
    ]);

    const { summary, fault } = mutationSummary("api", current, undefined);

    expect(fault).toBe(
      "api runner fault: 1 of its 3 covered mutants ran no test — no verdict in this report can be trusted, so the leg fails until the runner is fixed and a run with `force` tests every mutant again",
    );
    expect(summary.startsWith(`### ${fault ?? ""}\n### api mutation score: 66.7%`)).toBe(true);
  });

  it("names a runner fault when a leg killed no mutant", () => {
    const current = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Survived", 2),
      mutant("StringLiteral", '""', LABEL, "Survived", 1),
      mutant("StringLiteral", '""', OTHER, "NoCoverage"),
    ]);

    expect(mutationSummary("api", current, undefined).summary).toBe(
      [
        "### api runner fault: it killed none of its 3 mutants — no verdict in this report can be trusted, so the leg fails until the runner is fixed and a run with `force` tests every mutant again",
        "### api mutation score: 0% (0/3 mutants killed)",
        "### api new survivors: no baseline — nothing was restored to compare against, so this run's report is the next run's baseline",
        "### api mutants that ran no test: none",
        "",
      ].join("\n"),
    );
  });

  it("names no fault when every covered mutant ran a test", () => {
    const current = report(SOURCE, [
      mutant("ArithmeticOperator", "n - 1", PLUS, "Timeout", 1),
      mutant("StringLiteral", '""', LABEL, "Survived", 1),
      mutant("StringLiteral", '""', OTHER, "NoCoverage"),
    ]);

    const { summary, fault } = mutationSummary("core", current, undefined);

    expect(fault).toBeUndefined();
    expect(summary).not.toContain("runner fault");
  });

  it("names no runner fault for a leg with no mutants", () => {
    const { summary, fault } = mutationSummary("core", report(SOURCE, []), undefined);

    expect(fault).toBeUndefined();
    expect(summary).toBe(
      [
        "### core mutation score: no mutants",
        "### core new survivors: no baseline — nothing was restored to compare against, so this run's report is the next run's baseline",
        "### core mutants that ran no test: none",
        "",
      ].join("\n"),
    );
  });

  it("marks a survivor the baseline ignored as having no verdict", () => {
    const baseline = report(SOURCE, [mutant("StringLiteral", '""', LABEL, "Ignored")]);
    const current = report(SOURCE, [mutant("StringLiteral", '""', LABEL, "Survived", 1)]);

    expect(mutationSummary("api", current, baseline).summary).toContain(
      '- `src/answer.ts:2` — StringLiteral — `""` (no verdict in the baseline)\n',
    );
  });

  it("keeps a multi-line replacement on one line", () => {
    const current = report(SOURCE, [
      mutant("ArrowFunction", "() => {\n  return undefined;\n}", PLUS, "Survived", 1),
    ]);

    expect(mutationSummary("api", current, undefined).summary).toContain(
      "### api mutation score: 0% (0/1 mutants killed)",
    );
    expect(mutationSummary("api", current, report(SOURCE, [])).summary).toContain(
      "- `src/answer.ts:1` — ArrowFunction — `() => { return undefined; }` (not in the baseline)\n",
    );
  });
});

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

const run = (...argv: readonly string[]): Run => {
  const result = spawnSync(process.execPath, [script, ...argv], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("the mutation summary script over files", () => {
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

  it("prints the report's summary against the baseline and exits zero", () => {
    const result = run("--leg", "api", "--report", reportFile, "--baseline", baselineFile);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      [
        "### api mutation score: 50% (1/2 mutants killed)",
        "### api new survivors: 1",
        "Survived or uncovered here, and not so in the previous run's report. Matched by the mutated text, not by line number; two identical spans in one file mutated the same way are matched by their order in the file.",
        '- `src/answer.ts:2` — StringLiteral — `""` (not in the baseline)',
        "### api mutants that ran no test: none",
        "",
      ].join("\n"),
    );
  });

  it("says no baseline or no report for an absent file", () => {
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

  it("reads an unparseable baseline as no baseline, never an error", () => {
    const halfWritten = path.join(scratch, "half.json");
    writeFileSync(halfWritten, '{"files": {');

    expect(
      mutationSummaryFromArgv(["--leg", "api", "--report", reportFile, "--baseline", halfWritten])
        .summary,
    ).toContain("### api new survivors: no baseline — ");
  });

  it("refuses a command line without a leg or a report", () => {
    expect(() => mutationSummaryFromArgv(["--report", reportFile])).toThrow(
      "usage: mutation-summary --leg <name> --report <path> [--baseline <path>] [--checkpoint <path>]",
    );
  });
});

describe("the summary script over a runner fault and its checkpoint", () => {
  const untestedFile = path.join(scratch, "untested.json");
  writeFileSync(
    untestedFile,
    JSON.stringify(
      report(SOURCE, [
        mutant("ArithmeticOperator", "n - 1", PLUS, "Survived", 0),
        mutant("StringLiteral", '""', LABEL, "Survived", 0),
        mutant("StringLiteral", '""', OTHER, "NoCoverage"),
      ]),
    ),
  );
  const FAULT =
    "core runner fault: 2 of its 2 covered mutants ran no test — no verdict in this report can be trusted, so the leg fails until the runner is fixed and a run with `force` tests every mutant again";

  it("exits non-zero, naming the fault in summary and error", () => {
    const result = run("--leg", "core", "--report", untestedFile);

    expect(result.status).toBe(1);
    expect(result.stdout.startsWith(`### ${FAULT}\n### core mutation score: 0% (0/3`)).toBe(true);
    expect(result.stderr).toBe(`${FAULT}\n`);
  });

  it("reads the checkpoint when a cut-short run wrote no report", () => {
    const result = run(
      "--leg",
      "core",
      "--report",
      path.join(scratch, "absent.json"),
      "--checkpoint",
      untestedFile,
    );

    const fromCheckpoint = FAULT.replace(
      "ran no test —",
      "ran no test, read from the checkpoint since the run wrote no report —",
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`### ${fromCheckpoint}\n### core mutation score: no report\n`);
    expect(result.stderr).toBe(`${fromCheckpoint}\n`);
  });

  it("prefers the report over the checkpoint when both exist", () => {
    const testedFile = path.join(scratch, "tested.json");
    writeFileSync(
      testedFile,
      JSON.stringify(
        report(SOURCE, [
          mutant("ArithmeticOperator", "n - 1", PLUS, "Killed", 1),
          mutant("StringLiteral", '""', LABEL, "Survived", 1),
        ]),
      ),
    );

    const tested = mutationSummaryFromArgv([
      "--leg",
      "core",
      "--report",
      testedFile,
      "--checkpoint",
      untestedFile,
    ]);

    expect(tested.fault).toBeUndefined();
    expect(tested.summary).toContain("### core mutation score: 50% (1/2 mutants killed)\n");
  });

  it("passes a leg with no report and no checkpoint", () => {
    const result = run(
      "--leg",
      "api",
      "--report",
      path.join(scratch, "absent.json"),
      "--checkpoint",
      path.join(scratch, "absent.json"),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("### api mutation score: no report\n");
  });
});
