import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const workflowDirectory = path.join(".github", "workflows");

const DOCKERFILE = "apps/api/Dockerfile";
const PIN_ARG = "GIT_FILTER_REPO_VERSION";

const ACTION = path.join(".github", "actions", "git-filter-repo", "action.yml");
const ACTION_USES = "./.github/actions/git-filter-repo";

type Runner = { readonly file: string; readonly suiteCommand: string };

const RUNS_THE_SUITE: readonly Runner[] = [
  { file: "check.yml", suiteCommand: "pnpm check" },

  { file: "mutation.yml", suiteCommand: "stryker run" },
];

const RUNS_NO_SUITE: readonly { readonly file: string; readonly because: string }[] = [
  {
    file: "build.yml",
    because:
      "runs named image-probe files only, never a workspace's whole suite; the one whole-suite run it has is a call to check.yml, which carries the action itself",
  },
  { file: "release.yml", because: "promotes digests between environments and runs no suite" },
];

const linesOf = (file: string): readonly string[] =>
  readFileSync(path.join(repositoryRoot, file), "utf8").split("\n");

const STEP_OPENS = /^ {6}- /;
const COMMENT = /^ {6}#/;

type Step = { readonly at: number; readonly body: string };

const stepsIn = (lines: readonly string[]): readonly Step[] => {
  const steps: Step[] = [];
  let open: { at: number; body: string[] } | undefined;
  const close = (): void => {
    if (open !== undefined) steps.push({ at: open.at, body: open.body.join("\n") });
    open = undefined;
  };
  for (const [index, line] of lines.entries()) {
    if (STEP_OPENS.test(line)) {
      close();
      open = { at: index + 1, body: [line] };
    } else if (COMMENT.test(line)) {
      close();
    } else open?.body.push(line);
  }
  close();
  return steps;
};

const workflowPath = (file: string): string => path.join(workflowDirectory, file);

const installStep = (runner: Runner): Step => {
  const found = stepsIn(linesOf(workflowPath(runner.file))).filter((step) =>
    step.body.includes(ACTION_USES),
  );
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    throw new Error(
      `${runner.file} has ${String(found.length)} steps running \`uses: ${ACTION_USES}\`, not one. ` +
        `It runs the erasure suite through \`${runner.suiteCommand}\`, and \`ubuntu-latest\` ` +
        `carries no git-filter-repo, so it installs the tool the way every other such ` +
        `workflow does — with that one line, ahead of the step that runs the suite.`,
    );
  }
  return only;
};

const suiteStep = (runner: Runner): Step => {
  const found = stepsIn(linesOf(workflowPath(runner.file))).find((step) =>
    step.body.includes(runner.suiteCommand),
  );
  if (found === undefined) {
    throw new Error(`${runner.file} no longer runs \`${runner.suiteCommand}\``);
  }
  return found;
};

const VERSION_LITERAL = /\d+\.\d+/;

const STEP_CONDITION = /^(?: {6}- | {8})if:\s*(?<condition>.+?)\s*$/m;

const conditionOf = (step: Step): string =>
  STEP_CONDITION.exec(step.body)?.groups?.["condition"] ?? "";

describe.each(RUNS_THE_SUITE)(
  "the tools $file installs for the suite it runs (T-124, T-224)",
  (runner: Runner) => {
    it("installs the rewrite tool the erasure suite runs before it runs the suite", () => {
      expect(
        installStep(runner).at,
        `the rewrite tool is installed after \`${runner.suiteCommand}\`, so the erasure suite runs without it.`,
      ).toBeLessThan(suiteStep(runner).at);
    });

    it("installs it wherever the suite runs, and on no narrower a condition", () => {
      expect(
        conditionOf(installStep(runner)),
        `the rewrite tool is installed on a narrower condition than \`${runner.suiteCommand}\` runs on, so some run of this job reaches the erasure routine's git step without it.`,
      ).toEqual(conditionOf(suiteStep(runner)));
    });
  },
);

describe("the install every one of those workflows runs (T-224)", () => {
  it("takes the version from the api image's pin rather than naming one", () => {
    const action = linesOf(ACTION);

    expect(
      action.join("\n"),
      `${ACTION} must read the version out of ${DOCKERFILE}'s \`ARG ${PIN_ARG}\`.`,
    ).toContain(PIN_ARG);
    expect(action.join("\n"), `${ACTION} must name ${DOCKERFILE} as the file it reads.`).toContain(
      DOCKERFILE,
    );
    expect(
      action.filter((line) => VERSION_LITERAL.test(line)),
      `${ACTION} names a version of its own. Delete it and read ${DOCKERFILE}'s \`ARG ${PIN_ARG}\`: a version written down twice is a second pin that ages alone.`,
    ).toEqual([]);
  });

  it("reads a pin that is there and is a version, so the assertions above are about something", () => {
    const pinned = new RegExp(`^ARG\\s+${PIN_ARG}=(?<version>\\S+)\\s*$`, "m").exec(
      readFileSync(path.join(repositoryRoot, DOCKERFILE), "utf8"),
    )?.groups?.["version"];

    expect(
      pinned,
      `${DOCKERFILE} no longer pins the rewrite tool in an \`ARG ${PIN_ARG}=\` line`,
    ).toBeDefined();
    expect(pinned ?? "").toMatch(VERSION_LITERAL);
  });
});

describe("the two tables against the workflow directory (T-224)", () => {
  const onDisk = (): readonly string[] =>
    readdirSync(path.join(repositoryRoot, workflowDirectory))
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .sort();

  const classified = (): readonly string[] =>
    [...RUNS_THE_SUITE.map((runner) => runner.file), ...RUNS_NO_SUITE.map((row) => row.file)]
      .slice()
      .sort();

  it("classifies every workflow in the directory", () => {
    expect(
      onDisk().filter((file) => !classified().includes(file)),
      "a workflow is in neither table. Put it in `RUNS_THE_SUITE` with the command it runs the suite with, or in `RUNS_NO_SUITE` with the reason it needs no rewrite tool — a workflow nobody classified is the one that runs the erasure suite and forgets the install.",
    ).toEqual([]);
  });

  it("names no workflow that is not there", () => {
    expect(
      classified().filter((file) => !onDisk().includes(file)),
      "a table names a workflow the directory does not have. Delete the row, or correct the name.",
    ).toEqual([]);
  });

  it("puts no workflow in both tables", () => {
    const both = RUNS_THE_SUITE.map((runner) => runner.file).filter((file) =>
      RUNS_NO_SUITE.some((row) => row.file === file),
    );

    expect(both, "a workflow is listed as both running the suite and running none.").toEqual([]);
  });
});
