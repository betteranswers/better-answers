import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { workspacePackages } from "./workspaces.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

type Manifest = { readonly scripts?: Readonly<Record<string, string>> };

const manifestOf = (directory: string): Manifest => {
  const parsed: unknown = JSON.parse(read(path.join(directory, "package.json")));

  expect(typeof parsed, `${directory}/package.json is not an object`).toBe("object");
  // SAFETY: the parse is asserted an object above, and a manifest without `scripts` reads as
  // a workspace with none.
  return parsed as Manifest;
};

const scriptsOf = (directory: string): Readonly<Record<string, string>> =>
  manifestOf(directory).scripts ?? {};

const NO_CHECK: Readonly<Record<string, string>> = {
  "packages/design-system":
    "CSS tokens, a stylesheet and guideline cards as HTML — nothing executable to lint, type or test; the workspace exists so apps/web can import the stylesheet by name (ADR 0029)",
};

describe("the workspaces' scripts (T-068)", () => {
  it("holds every workspace the repository installs, not a list that ages alone", () => {
    const directories = workspacePackages();

    expect(directories.length).toBeGreaterThan(0);
    expect(directories).toContain("apps/api");
    expect(directories).toContain("apps/web");
    expect(directories).toContain("packages/core");
    expect(directories).toContain("packages/schema");
  });

  it("has no test script that passes when it finds no tests", () => {
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
    const recursive = Object.values(scriptsOf(".")).filter(
      (script) => script.includes("-r ") && script.includes("run check"),
    );

    expect(recursive.length, "the root runs no workspace's check").toBe(1);
    expect(recursive[0]).toContain("--if-present");
    expect(recursive[0]).toContain("--no-bail");
  });
});

const GATE_STEPS = ["lint", "typecheck", "test", "e2e"] as const;

const RUNNER = /^node\s+(?:\.\.\/)*scripts\/check\.mjs\s+(?<steps>.+)$/;

const stepsOf = (check: string): readonly string[] =>
  (RUNNER.exec(check)?.groups?.["steps"] ?? "").split(/\s+/).filter((step) => step.length > 0);

describe("one run of check names every failure (T-068)", () => {
  it("runs a workspace's every gate through the runner rather than chaining them", () => {
    const chained = workspacePackages().flatMap((directory) => {
      const check = scriptsOf(directory)["check"];

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

    expect(steps).toContain("check:workspaces");
    expect(steps).toContain("check:worker");
  });
});

describe("the gates a branch never narrows (T-099)", () => {
  it("are the root check's own steps ahead of check:workspaces, each a tool over the whole tree", () => {
    const scripts = scriptsOf(".");
    const steps = stepsOf(scripts["check"] ?? "");
    const tiers = steps.indexOf("check:workspaces");
    const gates = steps.slice(0, tiers);

    expect(gates.length, "the root check names no gate ahead of the tiers").toBeGreaterThan(0);

    for (const gate of gates) {
      expect(
        scripts[gate],
        `${gate} recurses into the workspaces, so it is not a root gate`,
      ).not.toMatch(/pnpm -r|--filter|uv run/);
    }
    expect(steps.slice(tiers)).toEqual(["check:workspaces", "check:worker"]);
  });
});

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
