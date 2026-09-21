import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The tools a workflow installs that are not a package manager's to install, and the one
 * rule that binds them: a version the repository already pins somewhere is **read** out of
 * that place and never restated here (`[DEPS2]`).
 *
 * There is one tool today. `git-filter-repo` is what the erasure routine's git step shells
 * out to (`T-124`, ADR 0020) and `ubuntu-latest` does not carry it, so a workflow that runs
 * the erasure suite installs it — at the version `apps/api/Dockerfile` pins for the api
 * image, because a history rewrite proved against one version of the tool and run against
 * another is a rewrite nobody has tested. An action cannot import a constant, which is what
 * `[DEPS2]` usually asks for, so the substitute is the install reading the pin off the file
 * that declares it, the way `apps/worker/tests/pg_harness.py` reads the Postgres image off
 * the module that declares that one.
 *
 * **One action, and every workflow that runs the suite.** The install began as a step
 * written into `check.yml` and copied nowhere, so `mutation.yml` simply went without: both
 * its legs died in Stryker's initial test run for three nights, mutating nothing and scoring
 * nothing, and a job that is red for a fortnight is a job nobody reads (`T-224`; a red
 * mutation job means the harness broke, never a score). The install is now one composite
 * action both workflows say `uses:` to, and the two tables below are checked against the
 * directory in both directions — every workflow is either a row that runs such a suite or a
 * row that runs none, with the reason in words, so a workflow file nobody classified is red
 * rather than silently unheld.
 *
 * This test is what keeps that shape. A literal version in the action would look tidier than
 * a `sed` and would be a second pin ageing on its own from the moment it was written, so the
 * assertion is both halves: the action names the `ARG`, and it carries no version of its own.
 *
 * **What it cannot see.** Whether the install actually works on a runner — that is the
 * workflows' own job, which is why the action ends by asking git to resolve the subcommand
 * rather than trusting `uv` to have put the binary somewhere git looks.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const workflowDirectory = path.join(".github", "workflows");

/** The file that holds the one pin, and the line in it this is all about. */
const DOCKERFILE = "apps/api/Dockerfile";
const PIN_ARG = "GIT_FILTER_REPO_VERSION";

/** The one install, and what a workflow writes to run it. */
const ACTION = path.join(".github", "actions", "git-filter-repo", "action.yml");
const ACTION_USES = "./.github/actions/git-filter-repo";

/**
 * A workflow that runs a suite shelling out to the rewrite tool, and the command it runs
 * that suite with — the step the install has to precede. The command is matched against a
 * step's own text, so it is spelled the way the workflow spells it.
 */
type Runner = { readonly file: string; readonly suiteCommand: string };

const RUNS_THE_SUITE: readonly Runner[] = [
  // `pnpm check` runs every workspace's suite, `packages/core`'s erasure suite among them.
  { file: "check.yml", suiteCommand: "pnpm check" },
  // Stryker runs the whole suite of the workspace it is mutating before it runs a mutant —
  // its initial test run — so both legs reach the erasure routine's git step: `core` through
  // that suite itself, `api` through the rehearsal's.
  { file: "mutation.yml", suiteCommand: "stryker run" },
];

/**
 * The rest of the directory, and why the tool is nothing to them. A workflow that starts
 * running a workspace's suite moves to the table above; one that does not says here why not,
 * because "it has no such step" and "nobody thought about it" look identical in a diff.
 */
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

/** A step opens at this indent; a comment at the same indent belongs to the next one. */
const STEP_OPENS = /^ {6}- /;
const COMMENT = /^ {6}#/;

type Step = { readonly at: number; readonly body: string };

/**
 * A workflow's steps, each without the comment block above it.
 *
 * Read off the text rather than through a YAML parser, as `workflow-pins.test.ts` reads its
 * `uses:` lines: what is asserted below is what a person editing these files sees, and a
 * step's `if:` is a line that would otherwise have to be looked for in a parsed object
 * rather than where it was written.
 */
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

/** The one step that runs the install action, or a throw naming what was looked for. */
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

/** The step the whole workflow exists to reach. */
const suiteStep = (runner: Runner): Step => {
  const found = stepsIn(linesOf(workflowPath(runner.file))).find((step) =>
    step.body.includes(runner.suiteCommand),
  );
  if (found === undefined) {
    throw new Error(`${runner.file} no longer runs \`${runner.suiteCommand}\``);
  }
  return found;
};

/** `1.2` or `1.2.3` anywhere in a line — what a restated pin looks like. */
const VERSION_LITERAL = /\d+\.\d+/;

/** A step's own condition, which would take the install off some of the job's legs. */
const STEP_CONDITION = /^ {8}if:/m;

describe.each(RUNS_THE_SUITE)(
  "the tools $file installs for the suite it runs (T-124, T-224)",
  (runner: Runner) => {
    it("installs the rewrite tool the erasure suite runs before it runs the suite", () => {
      expect(
        installStep(runner).at,
        `the rewrite tool is installed after \`${runner.suiteCommand}\`, so the erasure suite runs without it.`,
      ).toBeLessThan(suiteStep(runner).at);
    });

    it("installs it on every leg of the job, not some of them", () => {
      expect(
        STEP_CONDITION.test(installStep(runner).body),
        "the install step carries an `if:`, so some leg of this job reaches the erasure routine's git step without the tool — which is the failure the step was added for, narrowed rather than fixed.",
      ).toBe(false);
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
    // Without this, a Dockerfile that had stopped pinning anything would leave the action
    // reading an empty string and both assertions above still quietly passing.
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
    // The other direction: a table naming a deleted or renamed file holds nothing, and every
    // assertion above it would keep passing on the rows that remain.
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
