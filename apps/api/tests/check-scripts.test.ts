import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { workspacePackages } from "./workspaces.ts";

/**
 * The `check` scripts as values a test can read (`[CHECK2]`, `[CHECK3]`).
 *
 * A suite can go green by running less than it claims, and every way it can do so here is
 * a line in a manifest rather than a line of code: a test script that passes when its glob
 * matches nothing, a workspace that never joined `check`, a `check` that stops at its first
 * failing step and leaves the rest unrun. None of that is reachable through the interface
 * a test usually crosses, so the seam is the manifest itself — the shape the workflow, the
 * pre-commit hook and every agent's `pnpm check` actually run.
 *
 * Prior art for reading configuration as a value: the workflow-pins and deploy-tree tests.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

type Manifest = { readonly scripts?: Readonly<Record<string, string>> };

const manifestOf = (directory: string): Manifest => {
  const parsed: unknown = JSON.parse(read(path.join(directory, "package.json")));
  // SAFETY: the parse is asserted to be an object above, and every field this file reads
  // is optional, so a manifest missing `scripts` reads as a workspace with no scripts —
  // which is exactly what the assertions below are about.
  expect(typeof parsed, `${directory}/package.json is not an object`).toBe("object");
  return parsed as Manifest;
};

const scriptsOf = (directory: string): Readonly<Record<string, string>> =>
  manifestOf(directory).scripts ?? {};

/**
 * The workspaces with no `check` script, each with the reason it has nothing to run. The
 * root `check` skips a missing script (`--if-present`), which is what makes this list
 * necessary: without it a new package joins the workspace and is gated by nothing.
 */
const NO_CHECK: Readonly<Record<string, string>> = {
  "packages/design-system":
    "CSS tokens, a stylesheet and guideline cards as HTML — nothing executable to lint, type or test; the workspace exists so apps/web can import the stylesheet by name (ADR 0029)",
};

describe("the workspaces' scripts (T-068)", () => {
  it("holds every workspace the repository installs, not a list that ages alone", () => {
    // The assertions below go quiet if this list is empty, so it is asserted first: a
    // renamed directory or a glob shape the reader cannot parse fails here, loudly.
    const directories = workspacePackages();

    expect(directories.length).toBeGreaterThan(0);
    expect(directories).toContain("apps/api");
    expect(directories).toContain("apps/web");
    expect(directories).toContain("packages/core");
    expect(directories).toContain("packages/schema");
  });

  it("has no test script that passes when it finds no tests", () => {
    // `--passWithNoTests` turns a rotted glob into a green run: the suite reports success
    // for having run nothing at all. A workspace with no tests yet writes one instead.
    const passing = workspacePackages().flatMap((directory) => {
      const test = scriptsOf(directory)["test"];
      return test !== undefined && test.includes("--passWithNoTests")
        ? [`${directory}: ${test}`]
        : [];
    });

    expect(
      passing,
      "a workspace's test script passes with no tests. Delete the flag and write a test for what the workspace holds.",
    ).toEqual([]);
  });

  it("gates every workspace, or names the one it does not and why", () => {
    const withoutCheck = workspacePackages()
      .filter((directory) => scriptsOf(directory)["check"] === undefined)
      .sort();
    const named = Object.keys(NO_CHECK).sort();

    // Both directions (`[TEST7]`): one finds the workspace that never joined the gate, the
    // other the entry whose reason has stopped being true — a listed workspace that has
    // grown something to run and whose exemption should leave with the script that ends it.
    expect(
      withoutCheck.filter((directory) => !named.includes(directory)),
      "a pnpm workspace carries no check script and is not named in NO_CHECK. Give it a check script, or list it with the reason it has nothing to run.",
    ).toEqual([]);
    expect(
      named.filter((directory) => !withoutCheck.includes(directory)),
      "a workspace named in NO_CHECK now has a check script. Remove the entry: the reason it carried has stopped being true.",
    ).toEqual([]);
  });

  it("keeps the root check running a workspace that has a check and skipping one that has none", () => {
    // The skip is what NO_CHECK stands over: `--if-present` is what lets a workspace with
    // nothing to run stay silent instead of failing the root command.
    const recursive = Object.values(scriptsOf(".")).filter(
      (script) => script.includes("-r ") && script.includes("run check"),
    );

    expect(recursive.length, "the root runs no workspace's check").toBe(1);
    expect(recursive[0]).toContain("--if-present");
    expect(recursive[0]).toContain("--no-bail");
  });
});

/**
 * A step named on the runner's command line, in the order a `check` runs them: what a
 * workspace's gates are, and the order the failures are reported in.
 */
const GATE_STEPS = ["lint", "typecheck", "test", "e2e"] as const;

/** `node ../../scripts/check.mjs lint typecheck test` → the steps, or nothing. */
const RUNNER = /^node\s+(?:\.\.\/)*scripts\/check\.mjs\s+(?<steps>.+)$/;

const stepsOf = (check: string): readonly string[] =>
  (RUNNER.exec(check)?.groups?.["steps"] ?? "").split(/\s+/).filter((step) => step.length > 0);

describe("one run of check names every failure (T-068)", () => {
  it("runs a workspace's every gate through the runner rather than chaining them", () => {
    const chained = workspacePackages().flatMap((directory) => {
      const check = scriptsOf(directory)["check"];
      // `&&` stops at the first failure: a session is told about lint, fixes it, runs
      // check again and is only then told about types.
      return check !== undefined && (check.includes("&&") || stepsOf(check).length === 0)
        ? [`${directory}: ${check}`]
        : [];
    });

    expect(
      chained,
      "a workspace's check chains its steps. Call scripts/check.mjs with the steps instead: it runs every one and names all that failed.",
    ).toEqual([]);
  });

  it("names each of a workspace's gates as a step, and nothing that is not a script", () => {
    for (const directory of workspacePackages()) {
      const scripts = scriptsOf(directory);
      const check = scripts["check"];
      if (check === undefined) continue;

      // Both directions (`[TEST7]`): a gate the workspace has and `check` does not run is
      // a gate CI never reaches, and a step naming no script is a `check` that cannot run.
      expect(
        stepsOf(check),
        `${directory}'s check names a step that is not one of its gates, or leaves a gate out`,
      ).toEqual(GATE_STEPS.filter((step) => scripts[step] !== undefined));
    }
  });

  it("runs the root's own steps the same way, so a step is added by naming it", () => {
    const scripts = scriptsOf(".");
    const steps = stepsOf(scripts["check"] ?? "");

    expect(steps.length, "the root check does not call the runner").toBeGreaterThan(0);
    expect(steps.filter((step) => scripts[step] === undefined)).toEqual([]);
    // The two halves of the tree, each a step of the root's own list.
    expect(steps).toContain("check:workspaces");
    expect(steps).toContain("check:worker");
  });
});

/**
 * The gates a branch never narrows (`[CHECK9]`) are read off the root `check` line rather
 * than listed in the rule: every step named ahead of `check:workspaces`. That reading only
 * holds while the line keeps its shape — the whole-tree tools first, then the two tier
 * steps — so the shape is what this pins, and the rule stays true the day a gate is added.
 */
describe("the gates a branch never narrows (T-099)", () => {
  it("are the root check's own steps ahead of check:workspaces, each a tool over the whole tree", () => {
    const scripts = scriptsOf(".");
    const steps = stepsOf(scripts["check"] ?? "");
    const tiers = steps.indexOf("check:workspaces");
    const gates = steps.slice(0, tiers);

    expect(gates.length, "the root check names no gate ahead of the tiers").toBeGreaterThan(0);
    // A gate here runs one tool over the tree from the root: it recurses into no workspace
    // and starts no Postgres, which is what lets a branch run it whatever suites it skips.
    for (const gate of gates) {
      expect(
        scripts[gate],
        `${gate} recurses into the workspaces, so it is not a root gate`,
      ).not.toMatch(/pnpm -r|--filter|uv run/);
    }
    expect(steps.slice(tiers)).toEqual(["check:workspaces", "check:worker"]);
  });
});

/**
 * The runner itself, over a throwaway manifest. Reading the manifests says the steps are
 * named; only running the runner says a failing step does not take the rest with it, and
 * that the command a person or CI waits on ends non-zero when any step failed — the
 * silent pass `pnpm run --no-bail` over a script pattern turns out to be.
 */
const throwaway = mkdtempSync(path.join(tmpdir(), "check-runner-"));

afterAll(() => rmSync(throwaway, { recursive: true, force: true }));

describe("the check runner (T-068)", () => {
  it("runs every step it was given, and ends by naming the ones that failed", () => {
    writeFileSync(
      path.join(throwaway, "package.json"),
      JSON.stringify({
        name: "throwaway",
        scripts: {
          lint: "node -e \"console.log('lint ran'); process.exit(1)\"",
          typecheck: "node -e \"console.log('typecheck ran')\"",
          test: "node -e \"console.log('test ran'); process.exit(3)\"",
        },
      }),
    );

    const runner = path.join(repositoryRoot, "scripts", "check.mjs");
    const run = spawnSync("node", [runner, "lint", "typecheck", "test"], {
      cwd: throwaway,
      encoding: "utf8",
    });
    const output = `${run.stdout}${run.stderr}`;

    // The step after a failure ran, and the one after that.
    expect(output).toContain("lint ran");
    expect(output).toContain("typecheck ran");
    expect(output).toContain("test ran");
    expect(output).toContain("check failed: lint, test");
    expect(run.status).toBe(1);
  });

  it("passes only when every step passed", () => {
    writeFileSync(
      path.join(throwaway, "package.json"),
      JSON.stringify({ name: "throwaway", scripts: { lint: "node -e \"''\"" } }),
    );

    const run = spawnSync("node", [path.join(repositoryRoot, "scripts", "check.mjs"), "lint"], {
      cwd: throwaway,
      encoding: "utf8",
    });

    expect(run.stdout).toContain("check passed");
    expect(run.status).toBe(0);
  });
});
