import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The tools `check.yml` installs that are not a package manager's to install, and the one
 * rule that binds them: a version the repository already pins somewhere is **read** out of
 * that place and never restated here (`[DEPS2]`).
 *
 * There is one today. `git-filter-repo` is what the erasure routine's git step shells out to
 * (`T-124`, ADR 0020) and `ubuntu-latest` does not carry it, so the workflow installs it —
 * at the version `apps/api/Dockerfile` pins for the api image, because a history rewrite
 * proved against one version of the tool and run against another is a rewrite nobody has
 * tested. An action cannot import a constant, which is what `[DEPS2]` usually asks for, so
 * the substitute is the workflow reading the pin off the file that declares it, the way
 * `apps/worker/tests/pg_harness.py` reads the Postgres image off the module that declares
 * that one.
 *
 * This test is what keeps that shape. A literal here would look tidier than a `sed` and
 * would be a second pin ageing on its own from the moment it was written, so the assertion
 * is both halves: the step names the `ARG`, and the step carries no version of its own.
 *
 * **What it cannot see.** Whether the install actually works on a runner — that is the
 * workflow's own job, which is why the step ends by asking git to resolve the subcommand
 * rather than trusting `uv` to have put the binary somewhere git looks.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const CHECK_WORKFLOW = ".github/workflows/check.yml";

/** The file that holds the one pin, and the line in it this is all about. */
const DOCKERFILE = "apps/api/Dockerfile";
const PIN_ARG = "GIT_FILTER_REPO_VERSION";

const linesOf = (file: string): readonly string[] =>
  readFileSync(path.join(repositoryRoot, file), "utf8").split("\n");

/** A step opens at this indent; a comment at the same indent belongs to the next one. */
const STEP_OPENS = /^ {6}- /;
const COMMENT = /^ {6}#/;

type Step = { readonly at: number; readonly body: string };

/**
 * `check.yml`'s steps, each without the comment block above it.
 *
 * Read off the text rather than through a YAML parser, as `workflow-pins.test.ts` reads its
 * `uses:` lines: what is asserted below is what a person editing this file sees, and the
 * comment that tells them not to write a version here is the thing most likely to be
 * "tidied" away with the `sed` beneath it. A parser would hand back a step's `run:` script
 * with the comments already gone.
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

/** The one step that installs the rewrite tool, or a throw naming what was looked for. */
const installStep = (): Step => {
  const found = stepsIn(linesOf(CHECK_WORKFLOW)).filter((step) =>
    step.body.includes("git-filter-repo"),
  );
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    throw new Error(
      `${CHECK_WORKFLOW} has ${String(found.length)} steps naming git-filter-repo, not one`,
    );
  }
  return only;
};

/** The step the whole workflow exists to reach. */
const checkStep = (): Step => {
  const found = stepsIn(linesOf(CHECK_WORKFLOW)).find((step) => step.body.includes("pnpm check"));
  if (found === undefined) throw new Error(`${CHECK_WORKFLOW} no longer runs \`pnpm check\``);
  return found;
};

/** `1.2` or `1.2.3` anywhere in a line — what a restated pin looks like. */
const VERSION_LITERAL = /\d+\.\d+/;

describe("the tools check.yml installs for a suite (T-124)", () => {
  it("installs the rewrite tool the erasure suite runs before it runs the suite", () => {
    expect(
      installStep().at,
      "the rewrite tool is installed after `pnpm check`, so the erasure suite runs without it.",
    ).toBeLessThan(checkStep().at);
  });

  it("takes the version from the api image's pin rather than naming one", () => {
    const step = installStep();

    expect(
      step.body,
      `the step must read the version out of ${DOCKERFILE}'s \`ARG ${PIN_ARG}\`.`,
    ).toContain(PIN_ARG);
    expect(step.body, `the step must name ${DOCKERFILE} as the file it reads.`).toContain(
      DOCKERFILE,
    );
    expect(
      step.body.split("\n").filter((line) => VERSION_LITERAL.test(line)),
      `the step names a version of its own. Delete it and read ${DOCKERFILE}'s \`ARG ${PIN_ARG}\`: a version written down twice is a second pin that ages alone.`,
    ).toEqual([]);
  });

  it("reads a pin that is there and is a version, so the two assertions above are about something", () => {
    // Without this, a Dockerfile that had stopped pinning anything would leave the step
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
