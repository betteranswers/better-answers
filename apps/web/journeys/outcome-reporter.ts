import { appendFileSync, writeFileSync } from "node:fs";

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

import { roleIn, whyItCouldNotRun, type Outcome } from "./outcome.ts";

type Finding = {
  readonly outcome: Exclude<Outcome, "held">;
  readonly role: string;
  readonly screen: string;
  readonly step: string;
  readonly why: string;
};

const OUTSIDE_ANY_STEP = "outside any step";

/** A screen or an act is a `test.step`, and one may sit inside a fixture's step, as sign-in does. */
const failingStepsOf = (steps: readonly TestStep[]): readonly string[] => {
  const failing = steps.find((step) => step.error !== undefined);
  if (failing === undefined) return [];
  const below = failingStepsOf(failing.steps);
  return failing.category === "test.step" ? [failing.title, ...below] : below;
};

const whyOf = (result: TestResult): string | undefined =>
  whyItCouldNotRun(result.annotations) ??
  (result.status === "interrupted" ? "the run was stopped before the journey ended" : undefined);

/** The preflight plays no role, so its project names it. */
const roleOf = (test: TestCase, result: TestResult): string =>
  roleIn(result.annotations) ?? test.parent.project()?.name ?? "";

/** Built from titles and authored reasons alone: an error's message may hold an address. */
const findingOf = (test: TestCase, result: TestResult): Finding => {
  const why = whyOf(result);
  const path = failingStepsOf(result.steps);
  return {
    outcome: why === undefined ? "fail" : "could-not-run",
    role: roleOf(test, result),
    screen: path.at(0) ?? OUTSIDE_ANY_STEP,
    step: path.at(-1) ?? OUTSIDE_ANY_STEP,
    why: why ?? "",
  };
};

/** A run that judged nothing, such as one that ran no journey, never reads as held. */
const outcomeOf = (findings: readonly Finding[], everyJourneyPassed: boolean): Outcome => {
  if (findings.some((finding) => finding.outcome === "could-not-run")) return "could-not-run";
  if (findings.length > 0) return "fail";
  return everyJourneyPassed ? "held" : "could-not-run";
};

const cell = (text: string): string => text.replaceAll("|", "\\|");

const tableOf = (findings: readonly Finding[]): readonly string[] => [
  "| Outcome | Role | Screen | Step | Why it could not run |",
  "| --- | --- | --- | --- | --- |",
  ...findings.map(
    (finding) =>
      `| ${finding.outcome} | ${cell(finding.role)} | ${cell(finding.screen)} | ` +
      `${cell(finding.step)} | ${cell(finding.why)} |`,
  ),
];

const summaryOf = (outcome: Outcome, findings: readonly Finding[]): string => {
  const said =
    findings.length > 0
      ? tableOf(findings)
      : [outcome === "held" ? "Every journey passed." : "No journey ran to its end."];
  return ["", `### Journeys: ${outcome}`, "", ...said, ""].join("\n");
};

/** Writes the outcome word to `outcomeFile`, and the role, screen and step to the run's summary. */
export default class OutcomeReporter implements Reporter {
  readonly #outcomeFile: string;
  #root: Suite | undefined;
  #passed = 0;
  readonly #findings: Finding[] = [];

  constructor(options: { readonly outcomeFile: string }) {
    this.#outcomeFile = options.outcomeFile;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.#root = suite;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === "passed") this.#passed += 1;
    else if (result.status !== "skipped") this.#findings.push(findingOf(test, result));
  }

  onEnd(result: FullResult): void {
    const everyJourneyPassed =
      result.status === "passed" &&
      this.#passed > 0 &&
      this.#passed === this.#root?.allTests().length;
    const outcome = outcomeOf(this.#findings, everyJourneyPassed);
    writeFileSync(this.#outcomeFile, `${outcome}\n`);
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary !== undefined) appendFileSync(summary, summaryOf(outcome, this.#findings));
  }

  printsToStdio(): boolean {
    return false;
  }
}
