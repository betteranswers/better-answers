import { appendFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { FullConfig, Reporter, Suite, TestCase } from "@playwright/test/reporter";

type Flake = {
  readonly title: string;
  readonly file: string;
  readonly line: number;
  readonly firstFailure: string;
  readonly trace: string | undefined;
};

const workspace = (): string => process.env["GITHUB_WORKSPACE"] ?? process.cwd();

const describesOf = (suite: Suite | undefined): readonly string[] =>
  suite?.type === "describe" ? [...describesOf(suite.parent), suite.title] : [];

const firstLineOf = (message: string | undefined): string =>
  stripVTControlCharacters(message ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "no error message";

/** The trace's path in the artifact CI uploads, or in the workspace when no artifact is named. */
const traceOf = (test: TestCase): string | undefined => {
  const trace = test.results
    .flatMap((result) => result.attachments)
    .find((attachment) => attachment.name === "trace")?.path;
  const outputDir = test.parent.project()?.outputDir;
  if (trace === undefined || outputDir === undefined) return undefined;
  const root = process.env["TRACE_ARTIFACT"] ?? path.relative(workspace(), outputDir);
  return `${root}/${path.relative(outputDir, trace)}`;
};

const flakeOf = (test: TestCase): Flake => ({
  title: [...describesOf(test.parent), test.title].join(" › "),
  file: path.relative(workspace(), test.location.file),
  line: test.location.line,
  firstFailure: firstLineOf(
    test.results.find((result) => result.error !== undefined)?.error?.message,
  ),
  trace: traceOf(test),
});

const escapedData = (text: string): string =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

const escapedProperty = (text: string): string =>
  escapedData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

const annotationOf = (flake: Flake): string =>
  `::warning file=${escapedProperty(flake.file)},line=${flake.line},title=Flaky browser test::` +
  `${escapedData(`${flake.title} failed, then passed on retry: ${flake.firstFailure}`)}\n`;

const cell = (text: string): string => text.replaceAll("|", "\\|");

const summaryOf = (flakes: readonly Flake[]): string =>
  [
    "",
    "### Flaky browser tests",
    "",
    "Each failed, then passed on retry, so the run stayed green. Each needs its cause found.",
    "",
    "| Test | Where | First failure | Trace |",
    "| --- | --- | --- | --- |",
    ...flakes.map(
      (flake) =>
        `| ${cell(flake.title)} | \`${flake.file}:${flake.line}\` | ${cell(flake.firstFailure)} | ` +
        `${flake.trace === undefined ? "none recorded" : `\`${flake.trace}\``} |`,
    ),
    "",
  ].join("\n");

export default class FlakyReport implements Reporter {
  #root: Suite | undefined;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.#root = suite;
  }

  onEnd(): void {
    const flakes = (this.#root?.allTests() ?? [])
      .filter((test) => test.outcome() === "flaky")
      .map(flakeOf);
    if (flakes.length === 0) return;
    process.stdout.write(flakes.map(annotationOf).join(""));
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary !== undefined) appendFileSync(summary, summaryOf(flakes));
  }

  printsToStdio(): boolean {
    return false;
  }
}
