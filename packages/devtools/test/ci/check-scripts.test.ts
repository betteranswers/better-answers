import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot, workspacePackages } from "@better-answers/devtools/paths";
import { gatesNamed } from "@better-answers/devtools/root-commands";

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

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

const workspacesWith = (
  name: string,
): readonly { readonly directory: string; readonly script: string }[] =>
  workspacePackages().flatMap((directory) => {
    const script = scriptsOf(directory)[name];
    return script === undefined ? [] : [{ directory, script }];
  });

const rootCheck = (): string => {
  const check = scriptsOf(".")["check"];
  assert(check !== undefined, "the root package.json has no check script");
  return check;
};

const NO_CHECK: Readonly<Record<string, string>> = {
  "packages/design-system":
    "CSS tokens, a stylesheet and guideline cards as HTML — nothing executable to lint, type or test; the workspace exists so apps/web can import the stylesheet by name",
};

describe("the workspaces' scripts", () => {
  it("lists every workspace that pnpm installs", () => {
    const directories = workspacePackages();

    expect(directories.length).toBeGreaterThan(0);
    expect(directories).toContain("apps/api");
    expect(directories).toContain("apps/web");
    expect(directories).toContain("packages/core");
    expect(directories).toContain("packages/schema");
  });

  it("has no test script that passes with no tests", () => {
    const passing = workspacesWith("test")
      .filter(({ script }) => script.includes("--passWithNoTests"))
      .map(({ directory, script }) => `${directory}: ${script}`);

    expect(
      passing,
      "a workspace's test script passes when it finds no tests. Delete --passWithNoTests and write a test for the workspace's code.",
    ).toEqual([]);
  });

  it("gives every workspace a check script or a NO_CHECK reason", () => {
    const withoutCheck = workspacePackages()
      .filter((directory) => scriptsOf(directory)["check"] === undefined)
      .sort();
    const named = Object.keys(NO_CHECK).sort();

    expect(
      withoutCheck.filter((directory) => !named.includes(directory)),
      "a pnpm workspace has no check script and is not listed in NO_CHECK. Add a check script, or add the workspace to NO_CHECK with the reason it has nothing to check.",
    ).toEqual([]);
    expect(
      named.filter((directory) => !withoutCheck.includes(directory)),
      "a workspace listed in NO_CHECK now has a check script. Delete its NO_CHECK entry, because its reason is no longer true.",
    ).toEqual([]);
  });

  it("runs every workspace's check from one root script", () => {
    const recursive = Object.values(scriptsOf("."))
      .filter((script) => script.includes("-r "))
      .filter((script) => script.includes("run check"));

    expect(
      recursive.length,
      "the root package.json needs exactly one script that runs `run check` with `-r`",
    ).toBe(1);
    expect(recursive[0]).toContain("--if-present");
    expect(recursive[0]).toContain("--no-bail");
  });
});

const GATE_STEPS = ["lint:python", "lint:python-format", "typecheck", "test", "e2e"] as const;

const RUNNER = /^node\s+(?:\.\.\/)*scripts\/check\.mjs\s+(?<steps>.+)$/;

const stepsOf = (check: string): readonly string[] =>
  (RUNNER.exec(check)?.groups?.["steps"] ?? "").split(/\s+/).filter((step) => step.length > 0);

const chainsItsSteps = (check: string): boolean =>
  check.includes("&&") || stepsOf(check).length === 0;

describe("each check script runs every step and reports each failure", () => {
  it("runs a workspace's gates through scripts/check.mjs, not chained", () => {
    const chained = workspacesWith("check")
      .filter(({ script }) => chainsItsSteps(script))
      .map(({ directory, script }) => `${directory}: ${script}`);

    expect(
      chained,
      "a workspace's check script chains its steps with && or names no steps. Call scripts/check.mjs with the step names instead. The runner runs every step and lists each step that failed.",
    ).toEqual([]);
  });

  it("lists exactly the workspace's gate scripts as its check steps", () => {
    const checked = workspacesWith("check");
    expect(checked.length, "no workspace has a check script").toBeGreaterThan(0);

    for (const { directory, script: check } of checked) {
      const scripts = scriptsOf(directory);

      expect(
        stepsOf(check),
        `${directory}'s check must list exactly its gate scripts, in the order of GATE_STEPS. It names a step that is not a gate, or it leaves a gate out. Do not add oxlint. It runs once from the root, and a workspace copy annotates every warning twice, on paths that CI cannot place on the diff.`,
      ).toEqual(GATE_STEPS.filter((step) => scripts[step] !== undefined));
    }
  });

  it("runs the root check through scripts/check.mjs too", () => {
    const scripts = scriptsOf(".");
    const steps = stepsOf(rootCheck());

    expect(
      steps.length,
      "the root check script does not call scripts/check.mjs with any steps",
    ).toBeGreaterThan(0);
    expect(steps.filter((step) => scripts[step] === undefined)).toEqual([]);

    expect(steps).toContain("check:workspaces");
    expect(steps).toContain("check:worker");
  });
});

describe("the root gates, which always check the whole tree", () => {
  it("run before the workspace tiers and recurse into no workspace", () => {
    const scripts = scriptsOf(".");
    const steps = gatesNamed(rootCheck());
    const tiers = steps.indexOf("check:workspaces");
    const gates = steps.slice(0, tiers);

    expect(gates.length, "the root check names no gate before check:workspaces").toBeGreaterThan(0);

    for (const gate of gates) {
      expect(
        scripts[gate],
        `${gate} comes before check:workspaces but recurses into the workspaces. Make it run once over the whole tree, or move it into each workspace's check.`,
      ).not.toMatch(/pnpm -r|--filter|uv run(?: --[\w-]+)* check\b/);
    }
    expect(steps.slice(tiers)).toEqual(["check:workspaces", "check:worker"]);
  });
});

const SHIMMED_RUNNERS: ReadonlySet<string> = new Set(["vitest", "stryker"]);

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
  it("starts no runner through its pnpm .bin shim", () => {
    const shimmed = everyScript()
      .filter(({ script }) => script.split(/\s+/).some((word) => SHIMMED_RUNNERS.has(word)))
      .map(({ directory, name, script }) => `${directory} ${name}: ${script}`);

    expect(
      shimmed,
      "a script starts vitest or Stryker through pnpm's `.bin` shim, which is a `#!` file. On macOS, every process under a `#!` file waits on the policy check. Start the runner as `node ./node_modules/<package>/<its bin file>`.",
    ).toEqual([]);
  });

  it("starts each runner at the bin file its package declares", () => {
    const moved = runnerEntries()
      .map((entry) => ({
        ...entry,
        bins: binsOf(path.join(entry.directory, "node_modules", entry.pkg)),
      }))
      .filter(({ bins, file }) => !bins.includes(file))
      .map(
        ({ directory, name, pkg, file, bins }) =>
          `${directory} ${name}: ${pkg}/${file} (bin: ${bins.join(", ")})`,
      );

    expect(
      moved,
      "a script starts a runner at a file that its package no longer declares as `bin`, because an upgrade moved the file. Point the script at the file in the package's `bin` entry.",
    ).toEqual([]);
  });

  it("starts runners only from the test and mutation scripts", () => {
    const expected = Object.entries(RUNNER_SCRIPTS).flatMap(([name, pkg]) =>
      workspacesWith(name).map(({ directory }) => `${directory} ${name}: ${pkg}`),
    );
    const started = runnerEntries().map(
      ({ directory, name, pkg }) => `${directory} ${name}: ${pkg}`,
    );

    expect(expected).toContain("packages/core mutation: @stryker-mutator/core");
    expect(
      [...started].sort(),
      "only test and mutation scripts may start a runner, as `node ./node_modules/...`. A test or mutation script starts no runner, or another script starts one.",
    ).toEqual([...expected].sort());
  });
});

const throwaway = mkdtempSync(path.join(tmpdir(), "check-runner-"));

afterAll(() => rmSync(throwaway, { recursive: true, force: true }));

describe("the check runner", () => {
  it("runs every step, then lists the steps that failed", () => {
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

  it("passes only when every step passes", () => {
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
