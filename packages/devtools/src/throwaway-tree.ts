import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Run a tool's command line over a tree that exists for the length of one call.
 *
 * A rule nobody has run is a convention, so a gate is proved by running its tool over a
 * throwaway tree and asserting both where it fires and where it stays silent. The silent
 * half is the dangerous one: a tool that could not run at all reports nothing, and a suite
 * that reads nothing as "the rule stayed quiet" passes while enforcing nothing.
 *
 * Two fences hold that shut, and both are needed. Only the exits a caller names as "I found
 * something" are tolerated; every other non-zero exit is re-thrown with what the tool wrote.
 * And because a tool may answer a configuration it refused with the very same exit it uses
 * for a diagnostic — oxlint does, on stdout — a smoke case runs when the runner is built:
 * one tree that must produce a report, and the reading of that report the caller is about to
 * rely on. A runner that exists has proved its tool works.
 */

/** A throwaway tree: what each path holds, written under one temporary directory. */
export type Tree = Readonly<Record<string, string>>;

/** What a caller must know to run one tool over a throwaway tree. */
export type Tool = {
  /**
   * The package that declares the executable, and the path to it inside that package.
   * Resolved through the module graph rather than assembled from the repository root,
   * because pnpm puts a binary where the package that declares it can reach it and not
   * necessarily anywhere a path would guess — and a wrong path does not fail loudly, it
   * makes every rule look silent.
   */
  readonly executable: { readonly package: string; readonly path: readonly string[] };
  /** The command line, run with the throwaway tree as the working directory. */
  readonly argv: readonly string[];
  /** Written into every tree before the tool runs: its configuration, a manifest, a lockfile. */
  readonly scaffold?: Tree;
  /** The exit codes that mean the tool ran and found something. Zero is always tolerated. */
  readonly foundSomething: readonly number[];
  /** One tree that must produce a report, and the reading of it the caller depends on. */
  readonly smoke: { readonly tree: Tree; readonly reports: (output: string) => boolean };
};

/** A built runner: a tree in, whatever the tool wrote to stdout out. */
export type RunOverTree = (tree: Tree) => string;

const resolveExecutable = (tool: Tool): string => {
  const from = createRequire(import.meta.url);
  let root: string;
  try {
    root = path.dirname(from.resolve(`${tool.executable.package}/package.json`));
  } catch {
    throw new Error(
      `\`${tool.executable.package}\` is not in @better-answers/devtools's dependency tree, so its binary cannot be resolved. Declare it as a devDependency of packages/devtools.`,
    );
  }
  const binary = path.join(root, ...tool.executable.path);
  if (!existsSync(binary)) {
    throw new Error(
      `${tool.executable.package}: the package is installed but carries no executable at ${tool.executable.path.join("/")} (looked at ${binary}).`,
    );
  }
  return binary;
};

const writeTree = (directory: string, tree: Tree): void => {
  for (const [file, source] of Object.entries(tree)) {
    const destination = path.join(directory, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  }
};

/**
 * Build a runner for `tool`, proving on the way that the tool runs and that its reporter is
 * still shaped the way the caller reads it. Throws rather than returning a runner that
 * would answer every question with silence.
 */
export const runsOverThrowawayTree = (tool: Tool): RunOverTree => {
  const binary = resolveExecutable(tool);

  const run: RunOverTree = (tree) => {
    const directory = mkdtempSync(path.join(tmpdir(), "throwaway-tree-"));
    writeTree(directory, tool.scaffold ?? {});
    writeTree(directory, tree);
    try {
      return execFileSync(binary, [...tool.argv], {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      // SAFETY: `execFileSync` rejects with an Error carrying the child's exit status and
      // both captured streams; every field is read defensively below, because a spawn that
      // never started (ENOENT) carries a null status and no stdout.
      const failure = cause as {
        status?: number | null;
        stdout?: string;
        stderr?: string;
      };
      const status = failure.status;
      if (status !== null && status !== undefined && tool.foundSomething.includes(status)) {
        return String(failure.stdout ?? "");
      }
      // Both streams: a tool that refuses its configuration does not reliably say so on
      // stderr, and the whole point of this branch is that the reader learns why.
      throw new Error(
        `${tool.executable.package} (${binary}) did not run: exit ${String(status)}\n${String(failure.stdout ?? "")}\n${String(failure.stderr ?? cause)}`,
      );
    }
  };

  const smoked = run(tool.smoke.tree);
  if (!tool.smoke.reports(smoked)) {
    throw new Error(
      `${tool.executable.package} (${binary}) failed its smoke case: it ran over a tree that must produce a report, and what it wrote is not something the caller's reading can find. Until this passes, a silence from this tool means nothing.\nRaw output was:\n${smoked}`,
    );
  }

  return run;
};

/**
 * The paths a report names, read off the `path:line:column:` column of each line. Asserted
 * on rather than on the raw report, because a rule's help text names the file it points the
 * reader at — `Rename the file to 'route-table.ts'` — and a substring search over the whole
 * report would read that as a second diagnostic.
 */
const pathsIn = (output: string): readonly string[] =>
  [
    ...new Set(
      output
        .split("\n")
        .map((line) => /^(?<file>[^\s:]+):\d+:\d+:/.exec(line)?.groups?.["file"])
        .filter((file): file is string => file !== undefined),
    ),
  ].sort();

/** oxlint over a throwaway tree: the whole report, or just the paths it named. */
export type OxlintRunner = {
  readonly output: (tree: Tree) => string;
  readonly flagged: (tree: Tree) => readonly string[];
};

/**
 * oxlint over `configJson`, written into each tree as its `.oxlintrc.json`.
 *
 * The reporter format is pinned rather than left to oxlint: it picks GitHub's annotation
 * reporter when it detects Actions, which buries the path inside a `::error file=…::` line
 * where the reader below cannot see it — every rule then reads as silent, which is what CI
 * found while a suite passed locally. `unix` is the one format that is a stable
 * `path:line:column: message` line and never a drawn box.
 *
 * The smoke case is the caller's because the config is: a tree that must be flagged, and
 * exactly the paths that must come back for it.
 */
export const oxlintOver = (
  configJson: string,
  smoke: { readonly tree: Tree; readonly flagged: readonly string[] },
): OxlintRunner => {
  const expected = [...smoke.flagged].sort();
  const run = runsOverThrowawayTree({
    executable: { package: "oxlint", path: ["bin", "oxlint"] },
    argv: ["--config", ".oxlintrc.json", "--format=unix", "."],
    scaffold: { ".oxlintrc.json": configJson },
    foundSomething: [1],
    smoke: {
      tree: smoke.tree,
      reports: (output) => {
        const flagged = pathsIn(output);
        return (
          flagged.length === expected.length &&
          flagged.every((file, index) => file === expected[index])
        );
      },
    },
  });

  return { output: run, flagged: (tree) => pathsIn(run(tree)) };
};
