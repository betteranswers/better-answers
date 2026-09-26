import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot, workspacePackages } from "@better-answers/devtools/paths";

import { gatesNamed } from "./workspaces.ts";

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

/** A manifest without `scripts` reads as a workspace with none. */
const manifest = z.object({ scripts: z.record(z.string(), z.string()).optional() });
type Manifest = z.infer<typeof manifest>;

const manifestOf = (directory: string): Manifest => {
  const parsed = manifest.safeParse(JSON.parse(read(path.join(directory, "package.json"))));
  if (!parsed.success) {
    throw new Error(`${directory}/package.json is not a manifest: ${parsed.error.message}`);
  }
  return parsed.data;
};

const scriptsOf = (directory: string): Readonly<Record<string, string>> =>
  manifestOf(directory).scripts ?? {};

const NO_CHECK: Readonly<Record<string, string>> = {
  "packages/design-system":
    "CSS tokens, a stylesheet and guideline cards as HTML — nothing executable to lint, type or test; the workspace exists so apps/web can import the stylesheet by name",
};

describe("the workspaces' scripts", () => {
  it("reads every workspace the repository installs, not a fixed list", () => {
    const directories = workspacePackages();

    expect(directories.length).toBeGreaterThan(0);
    expect(directories).toContain("apps/api");
    expect(directories).toContain("apps/web");
    expect(directories).toContain("packages/core");
    expect(directories).toContain("packages/schema");
  });

  it("has no test script that passes with no tests", () => {
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

  it("gates every workspace, or names why one has no check", () => {
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

  it("runs each workspace's check from the root, skipping one without", () => {
    const recursive = Object.values(scriptsOf(".")).filter(
      (script) => script.includes("-r ") && script.includes("run check"),
    );

    expect(recursive.length, "the root runs no workspace's check").toBe(1);
    expect(recursive[0]).toContain("--if-present");
    expect(recursive[0]).toContain("--no-bail");
  });
});

/**
 * The tree's oxlint runs once from the root; a workspace copy would annotate every warning
 * twice, on paths CI cannot place on a diff.
 */
const GATE_STEPS = ["lint:python", "lint:python-format", "typecheck", "test", "e2e"] as const;

const RUNNER = /^node\s+(?:\.\.\/)*scripts\/check\.mjs\s+(?<steps>.+)$/;

const stepsOf = (check: string): readonly string[] =>
  (RUNNER.exec(check)?.groups?.["steps"] ?? "").split(/\s+/).filter((step) => step.length > 0);

describe("one run of check names every failure", () => {
  it("runs a workspace's gates through the runner, never chained", () => {
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

  it("names exactly a workspace's gates as its steps", () => {
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

  it("runs the root's own steps through the same runner", () => {
    const scripts = scriptsOf(".");
    const steps = stepsOf(scripts["check"] ?? "");

    expect(steps.length, "the root check does not call the runner").toBeGreaterThan(0);
    expect(steps.filter((step) => scripts[step] === undefined)).toEqual([]);

    expect(steps).toContain("check:workspaces");
    expect(steps).toContain("check:worker");
  });
});

describe("the gates a branch never narrows", () => {
  it("come before the tiers, each running over the whole tree", () => {
    const scripts = scriptsOf(".");
    /** Expanded, because the root check names `check:gates` and the gates are that script's. */
    const steps = gatesNamed(scripts["check"] ?? "");
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

/** A runner's command word, which pnpm resolves to its `.bin` shim. */
const SHIMMED_RUNNERS: readonly string[] = ["vitest", "stryker"];

/** The package whose runner each script starts. */
const RUNNER_SCRIPTS: Readonly<Record<string, string>> = {
  test: "vitest",
  mutation: "@stryker-mutator/core",
};

const RUNNER_ENTRY = /\bnode\s+\.\/node_modules\/(?<pkg>(?:@[^/\s]+\/)?[^/\s]+)\/(?<file>\S+)/;

const binManifest = z.object({
  bin: z.union([z.string(), z.record(z.string(), z.string())]),
});

const binsOf = (packageDirectory: string): readonly string[] => {
  const { bin } = binManifest.parse(JSON.parse(read(path.join(packageDirectory, "package.json"))));
  return (typeof bin === "string" ? [bin] : Object.values(bin)).map((file) =>
    path.posix.normalize(file),
  );
};

type Script = { readonly directory: string; readonly name: string; readonly script: string };

type RunnerEntry = Script & { readonly pkg: string; readonly file: string };

const everyScript = (): readonly Script[] =>
  [".", ...workspacePackages()].flatMap((directory) =>
    Object.entries(scriptsOf(directory)).map(([name, script]) => ({ directory, name, script })),
  );

const runnerEntries = (): readonly RunnerEntry[] =>
  everyScript().flatMap((started) => {
    const groups = RUNNER_ENTRY.exec(started.script)?.groups;
    const pkg = groups?.["pkg"];
    const file = groups?.["file"];
    return pkg === undefined || file === undefined
      ? []
      : [{ ...started, pkg, file: path.posix.normalize(file) }];
  });

describe("the runners start through node", () => {
  it("starts no runner through its bin shim", () => {
    const shimmed = everyScript()
      .filter(({ script }) => script.split(/\s+/).some((word) => SHIMMED_RUNNERS.includes(word)))
      .map(({ directory, name, script }) => `${directory} ${name}: ${script}`);

    expect(
      shimmed,
      "a script starts vitest or Stryker through pnpm's `.bin` shim, a `#!` file: on macOS every process under it waits on the policy check. Start it as `node ./node_modules/<package>/<its bin file>`.",
    ).toEqual([]);
  });

  it("starts each runner at the file its package names", () => {
    const moved = runnerEntries().flatMap(({ directory, name, pkg, file }) => {
      const bins = binsOf(path.join(directory, "node_modules", pkg));
      return bins.includes(file)
        ? []
        : [`${directory} ${name}: ${pkg}/${file} (bin: ${bins.join(", ")})`];
    });

    expect(
      moved,
      "a script starts a runner at a file its package no longer names as its bin: an upgrade moved it. Point the script at the package's `bin` entry.",
    ).toEqual([]);
  });

  it("starts exactly the test and mutation scripts at a runner", () => {
    const expected = workspacePackages().flatMap((directory) =>
      Object.entries(RUNNER_SCRIPTS).flatMap(([name, pkg]) =>
        scriptsOf(directory)[name] === undefined ? [] : [`${directory} ${name}: ${pkg}`],
      ),
    );
    const started = runnerEntries().map(
      ({ directory, name, pkg }) => `${directory} ${name}: ${pkg}`,
    );

    expect(expected).toContain("packages/core mutation: @stryker-mutator/core");
    expect(
      [...started].sort(),
      "a workspace's test or mutation script starts no runner entry, or another script does",
    ).toEqual([...expected].sort());
  });
});

const throwaway = mkdtempSync(path.join(tmpdir(), "check-runner-"));

afterAll(() => rmSync(throwaway, { recursive: true, force: true }));

describe("the check runner", () => {
  it("runs every step given, then names the ones that failed", () => {
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
