import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

/**
 * The globs under `packages:` in `pnpm-workspace.yaml`. Only the two shapes the file uses
 * are understood — a literal directory and a `<dir>/*` — and an unknown shape fails loudly
 * below rather than silently matching nothing, which is the failure this file exists for.
 */
const workspaceGlobs = (): readonly string[] => {
  const body = read("pnpm-workspace.yaml").split(/^packages:\s*$/m)[1] ?? "";
  const globs: string[] = [];
  for (const line of body.split("\n")) {
    const entry = /^\s{2}-\s+(?<glob>\S+)\s*$/.exec(line);
    if (entry === null) {
      if (line.trim().length > 0 && globs.length > 0) break;
      continue;
    }
    globs.push(entry.groups?.["glob"] ?? "");
  }
  return globs;
};

/** Every pnpm workspace directory, relative to the repository root, sorted. */
const workspaceDirectories = (): readonly string[] =>
  workspaceGlobs()
    .flatMap((glob) => {
      if (!glob.includes("*")) return [glob];
      expect(glob.endsWith("/*"), `unsupported workspace glob ${glob}`).toBe(true);
      const parent = glob.slice(0, -2);
      return readdirSync(path.join(repositoryRoot, parent))
        .map((entry) => `${parent}/${entry}`)
        .filter((directory) =>
          statSync(path.join(repositoryRoot, directory), { throwIfNoEntry: false })?.isDirectory(),
        );
    })
    .filter((directory) =>
      statSync(path.join(repositoryRoot, directory, "package.json"), {
        throwIfNoEntry: false,
      })?.isFile(),
    )
    .sort();

type Manifest = { readonly scripts?: Readonly<Record<string, string>> };

const manifestOf = (directory: string): Manifest => {
  const parsed: unknown = JSON.parse(read(path.join(directory, "package.json")));
  expect(typeof parsed, `${directory}/package.json is not an object`).toBe("object");
  return parsed as Manifest;
};

const scriptsOf = (directory: string): Readonly<Record<string, string>> =>
  manifestOf(directory).scripts ?? {};

describe("the workspaces' scripts (T-068)", () => {
  it("reads a workspace for every glob the pnpm workspace file declares", () => {
    // The assertions below go quiet if this list is empty, so it is asserted first: a
    // renamed directory or a glob shape this file cannot parse fails here, loudly.
    const directories = workspaceDirectories();

    expect(workspaceGlobs().length).toBeGreaterThan(0);
    expect(directories).toContain("apps/api");
    expect(directories).toContain("apps/web");
    expect(directories).toContain("packages/core");
    expect(directories).toContain("packages/schema");
  });

  it("has no test script that passes when it finds no tests", () => {
    // `--passWithNoTests` turns a rotted glob into a green run: the suite reports success
    // for having run nothing at all. A workspace with no tests yet writes one instead.
    const passing = workspaceDirectories().flatMap((directory) => {
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
});
