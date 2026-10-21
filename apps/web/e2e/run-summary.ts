import { appendFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { FullConfig, Reporter, Suite, TestCase } from "@playwright/test/reporter";

import { actionAnnotatedBy } from "./action-timing.ts";

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

const traceOf = (test: TestCase): string | undefined => {
  const trace = test.results
    .flatMap((result) => result.attachments)
    .find((attachment) => attachment.name === "trace")?.path;
  const outputDir = test.parent.project()?.outputDir;
  if (trace === undefined || outputDir === undefined) return undefined;
  const root = process.env["TRACE_ARTIFACT"] ?? path.relative(workspace(), outputDir);
  return `${root}/${path.relative(outputDir, trace)}`;
};

const titleOf = (test: TestCase): string => [...describesOf(test.parent), test.title].join(" › ");

const flakeOf = (test: TestCase): Flake => ({
  title: titleOf(test),
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

type ActionTiming = {
  readonly title: string;
  readonly attempt: number;
  readonly action: string;
  readonly clocked: string;
};

const actionTimingsOf = (test: TestCase): readonly ActionTiming[] =>
  test.results.flatMap((result) =>
    result.annotations.flatMap((annotation) => {
      const action = actionAnnotatedBy(annotation.type);
      return action === undefined
        ? []
        : [
            {
              title: titleOf(test),
              attempt: result.retry + 1,
              action,
              clocked: annotation.description ?? "",
            },
          ];
    }),
  );

const timingsSummaryOf = (timings: readonly ActionTiming[]): string =>
  [
    "",
    "### Action timings",
    "",
    "Every clocked action, from its key to the page reading as landed, passing or not.",
    "",
    "| Test | Attempt | Action | Clocked |",
    "| --- | --- | --- | --- |",
    ...timings.map(
      (timing) =>
        `| ${cell(timing.title)} | ${String(timing.attempt)} | ${cell(timing.action)} | ${cell(timing.clocked)} |`,
    ),
    "",
  ].join("\n");

export default class RunSummary implements Reporter {
  #root: Suite | undefined;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.#root = suite;
  }

  onEnd(): void {
    const tests = this.#root?.allTests() ?? [];
    const flakes = tests.filter((test) => test.outcome() === "flaky").map(flakeOf);
    const timings = tests.flatMap(actionTimingsOf);
    process.stdout.write(flakes.map(annotationOf).join(""));
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary === undefined) return;
    if (flakes.length > 0) appendFileSync(summary, summaryOf(flakes));
    if (timings.length > 0) appendFileSync(summary, timingsSummaryOf(timings));
  }

  printsToStdio(): boolean {
    return false;
  }
}
