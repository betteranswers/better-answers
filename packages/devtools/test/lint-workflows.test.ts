import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { rootScripts } from "@better-answers/devtools/root-commands";
import { throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const scratch = mkdtempSync(path.join(tmpdir(), "lint-workflows-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const realFile = (file: string): Tree => ({
  [file]: readFileSync(path.join(repositoryRoot, file), "utf8"),
});

const CONFIGS: Tree = { ...realFile(".github/actionlint.yaml"), ...realFile(".github/zizmor.yml") };

type Ran = { readonly status: number | null; readonly said: string };

/** The root script, run from a repository holding `tree` beside the worker's locked linters. */
const ran = (script: string, tree: Tree): Ran => {
  const command = rootScripts()[script];
  if (command === undefined) throw new Error(`the root manifest has no \`${script}\` script`);
  const root = throwawayRepository(path.join(mkdtempSync(path.join(scratch, "tree-")), "repo"));
  mkdirSync(path.join(root, "apps"));
  symlinkSync(path.join(repositoryRoot, "apps", "worker"), path.join(root, "apps", "worker"));
  for (const [file, source] of Object.entries({ ...CONFIGS, ...tree })) {
    writeUnder(root, file, source);
  }
  const result = spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8" });
  return { status: result.status, said: `${result.stdout}${result.stderr}` };
};

const LOCAL_ACTION = [
  "name: greet",
  "description: Says hello.",
  "runs:",
  "  using: composite",
  "  steps:",
  "    - shell: bash",
  "      run: echo hello",
  "",
].join("\n");

const workflowRunning = (on: string, steps: readonly string[]): string =>
  [
    `on: ${on}`,
    "permissions:",
    "  contents: read",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-26.04",
    "    timeout-minutes: 5",
    "    steps:",
    ...steps,
    "",
  ].join("\n");

const CLEAN_STEPS = [
  "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  "        with:",
  "          persist-credentials: false",
  "      - uses: ./.github/actions/greet",
  "      - env:",
  "          GREETING: hello",
  '        run: echo "${GREETING}"',
];

const CLEAN_WORKFLOWS: Tree = {
  ".github/workflows/build.yml": workflowRunning("push", CLEAN_STEPS),
  ".github/actions/greet/action.yml": LOCAL_ACTION,
};

describe("actionlint, as `lint:workflows:actionlint` runs it", () => {
  it("refuses an unquoted variable in a run step", () => {
    const run = ran("lint:workflows:actionlint", {
      ".github/workflows/build.yml": workflowRunning("push", ["      - run: echo $HOME"]),
    });

    expect(run.status).not.toBe(0);
    expect(run.said).toContain("SC2086");
  });

  it("accepts a clean workflow on the runner the config names", () => {
    expect(ran("lint:workflows:actionlint", CLEAN_WORKFLOWS)).toEqual({ status: 0, said: "" });
  });
});

describe("zizmor, as `lint:workflows:zizmor` runs it", () => {
  it("refuses a pull request's title spliced into a script", () => {
    const run = ran("lint:workflows:zizmor", {
      ".github/workflows/build.yml": workflowRunning("pull_request", [
        '      - run: echo "${{ github.event.pull_request.title }}"',
      ]),
    });

    expect(run.status).not.toBe(0);
    expect(run.said).toContain("error[template-injection]");
  });

  it("refuses an action named by its tag, not a commit", () => {
    const run = ran("lint:workflows:zizmor", {
      ".github/workflows/build.yml": workflowRunning("push", [
        "      - uses: actions/checkout@v7.0.1",
        "        with:",
        "          persist-credentials: false",
      ]),
    });

    expect(run.status).not.toBe(0);
    expect(run.said).toContain("error[unpinned-uses]");
  });

  it("refuses a checkout that keeps its credential", () => {
    const run = ran("lint:workflows:zizmor", {
      ".github/workflows/build.yml": workflowRunning("push", [
        "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      ]),
    });

    expect(run.status).not.toBe(0);
    expect(run.said).toContain("warning[artipacked]");
  });

  it("refuses a workflow whose token keeps the default grant", () => {
    const run = ran("lint:workflows:zizmor", {
      ".github/workflows/build.yml": workflowRunning("push", ["      - run: echo hello"]).replace(
        "permissions:\n  contents: read\n",
        "",
      ),
    });

    expect(run.status).not.toBe(0);
    expect(run.said).toContain("warning[excessive-permissions]");
  });

  it("accepts a pinned workflow calling a local action", () => {
    const run = ran("lint:workflows:zizmor", CLEAN_WORKFLOWS);

    expect(run.said).toContain("No findings to report");
    expect(run.status).toBe(0);
  });
});

const SHELL_ROOTS = ["deploy", ".claude/hooks", "scripts"] as const;

const CLEAN_SCRIPT = ["#!/usr/bin/env bash", "set -euo pipefail", 'echo "${1:-}"', ""].join("\n");

const cleanUnderEveryRoot = (): Tree =>
  Object.fromEntries(SHELL_ROOTS.map((root) => [`${root}/clean.sh`, CLEAN_SCRIPT]));

const SOURCING: Tree = {
  ".claude/hooks/lib.sh": [
    "# shellcheck shell=bash",
    'say() { echo "${SAY_AS}: $*" >&2; }',
    "",
  ].join("\n"),
  ".claude/hooks/main.sh": [
    "#!/usr/bin/env bash",
    'SAY_AS="main"',
    '. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"',
    "say hello",
    "",
  ].join("\n"),
};

describe("shellcheck, as `lint:workflows:shellcheck` runs it", () => {
  it.each(SHELL_ROOTS)("refuses an unquoted variable in a script under %s", (root) => {
    const run = ran("lint:workflows:shellcheck", {
      ...cleanUnderEveryRoot(),
      [`${root}/unquoted.sh`]: ["#!/usr/bin/env bash", "echo $1", ""].join("\n"),
    });

    expect(run.status).not.toBe(0);
    expect(run.said).toContain(`In ${root}/unquoted.sh line 2:`);
    expect(run.said).toContain("SC2086");
  });

  it("refuses a script that does not parse", () => {
    const run = ran("lint:workflows:shellcheck", {
      ...cleanUnderEveryRoot(),
      "deploy/unclosed.sh": ["#!/usr/bin/env bash", "if true; then", "  echo open", ""].join("\n"),
    });

    expect(run.status).not.toBe(0);
    expect(run.said).toContain("In deploy/unclosed.sh line");
    expect(run.said).toMatch(/SC10\d\d \(error\)/);
  });

  it("accepts clean scripts, following one into the library it sources", () => {
    const run = ran("lint:workflows:shellcheck", { ...cleanUnderEveryRoot(), ...SOURCING });

    expect(run).toEqual({ status: 0, said: "" });
  });
});
