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
  /**
   * Added to the environment the tool runs in. A throwaway tree has no `node_modules`, so a
   * tool that reaches for a sibling binary by walking up from its working directory finds
   * nothing there; this is where the caller hands it the path instead.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** The exit codes that mean the tool ran and found something. Zero is always tolerated. */
  readonly foundSomething: readonly number[];
  /** One tree that must produce a report, and the reading of it the caller depends on. */
  readonly smoke: { readonly tree: Tree; readonly reports: (output: string) => boolean };
};

/** A built runner: a tree in, whatever the tool wrote to stdout out. */
export type RunOverTree = (tree: Tree) => string;

/**
 * Where an installed package's directory is, asked two ways.
 *
 * The manifest is the direct question, and it is the one that fails: a package whose
 * `exports` map does not publish `./package.json` cannot be resolved by that subpath at all
 * — knip's does not. So the fallback resolves the package's own entry, which every
 * `exports` map publishes, and walks up to the nearest directory holding a manifest, which
 * for an installed package is its root.
 */
const packageRoot = (from: ReturnType<typeof createRequire>, name: string): string | undefined => {
  try {
    return path.dirname(from.resolve(`${name}/package.json`));
  } catch {
    // The `exports` map withheld the manifest; the entry below is the other way in.
  }
  let directory: string;
  try {
    directory = path.dirname(from.resolve(name));
  } catch {
    return undefined;
  }
  while (!existsSync(path.join(directory, "package.json"))) {
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return directory;
};

const resolveExecutable = (tool: Tool): string => {
  const from = createRequire(import.meta.url);
  const root = packageRoot(from, tool.executable.package);
  if (root === undefined) {
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
        // The parent's environment, not this repository's configuration: a tool spawned with
        // an empty environment loses PATH, HOME and the platform's temporary directory and
        // fails for reasons that have nothing to do with the rule under test.
        env: { ...process.env, ...tool.env },
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

/**
 * Where the type-aware linter's binary is, for the child oxlint spawns.
 *
 * oxlint runs its type-aware rules by handing the file set to `tsgolint`, which it looks for
 * by walking up from its working directory — and a throwaway tree lives in the system's
 * temporary directory, where there is no `node_modules` to find. Without this, every
 * type-aware rule reads as silent, which is the one thing this runner exists to make
 * impossible. `OXLINT_TSGOLINT_PATH` is oxlint's own override for the lookup; the platform
 * binary is resolved the way `oxlint-tsgolint`'s own launcher resolves it, so a machine with
 * a different architecture gets its own and never the wrong one.
 */
const tsgolintPath = (): string => {
  const from = createRequire(import.meta.url);
  const suffix = process.platform === "win32" ? ".exe" : "";
  try {
    return from.resolve(`@oxlint-tsgolint/${process.platform}-${process.arch}/tsgolint${suffix}`);
  } catch {
    throw new Error(
      `oxlint's type-aware linter has no binary for ${process.platform}-${process.arch}, so a type-aware rule over a throwaway tree would read as silent — the one thing this runner exists to make impossible. Either \`oxlint-tsgolint\` is not a devDependency of packages/devtools, or it ships no build for this platform.`,
    );
  }
};

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
    env: { OXLINT_TSGOLINT_PATH: tsgolintPath() },
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

/**
 * The kinds of finding this repository's gate reads off knip's report. knip names more —
 * duplicate exports, enum members, catalog entries — and every one of them fails the gate;
 * these are the kinds a test asserts on, so the list is what a caller can name rather than
 * what knip can find.
 */
const KNIP_FINDING_KINDS = [
  "files",
  "exports",
  "types",
  "dependencies",
  "devDependencies",
  "unlisted",
  "binaries",
] as const;

/** One thing knip named: what kind of finding it is, the file it sits in, and its name. */
export type KnipFinding = {
  readonly kind: (typeof KNIP_FINDING_KINDS)[number];
  readonly file: string;
  readonly name: string;
};

/**
 * knip over a throwaway tree: the findings, and nothing wider. The raw report is not on the
 * interface, because knip's JSON is one object per file with an array per kind of finding —
 * a caller reading it would rewrite `findingsIn` badly, and the smoke case proves that
 * reading and no other.
 */
export type KnipRunner = {
  readonly findings: (tree: Tree) => readonly KnipFinding[];
};

/**
 * knip's `--reporter json` report: one entry per file, each carrying an array per kind of
 * finding. Written out here rather than inferred, because this is the shape the smoke case
 * exists to prove — a reporter that changed shape would otherwise read as a clean tree.
 */
type KnipReportEntry = { readonly file?: string } & {
  readonly [Kind in (typeof KNIP_FINDING_KINDS)[number]]?: readonly { readonly name: string }[];
};

const sortKey = (finding: KnipFinding): string => `${finding.kind}:${finding.file}:${finding.name}`;

const findingsIn = (output: string): readonly KnipFinding[] => {
  const parsed: unknown = JSON.parse(output);
  // SAFETY: the shape asserted is knip's JSON reporter contract, and the runner's smoke
  // case is what proves that contract still holds — a report this reading cannot find is
  // refused there, before any caller is allowed to read a silence as a clean tree.
  const report = parsed as { readonly issues?: readonly KnipReportEntry[] };
  return (report.issues ?? [])
    .flatMap((entry) =>
      KNIP_FINDING_KINDS.flatMap((kind) =>
        (entry[kind] ?? []).map((issue) => ({
          kind,
          file: entry.file ?? "",
          name: issue.name,
        })),
      ),
    )
    .sort((left, right) => sortKey(left).localeCompare(sortKey(right)));
};

/**
 * knip over `scaffold` — a manifest and a knip configuration written into every tree, which
 * a tree may replace when the manifest is the thing under test.
 *
 * The JSON reporter is pinned rather than left to knip: the default reporter draws a table
 * whose columns wrap on a narrow terminal, so a reader looking for a name would find it or
 * not depending on the width of the process that ran the tool. JSON is the one shape that
 * is the same everywhere, and `findingsIn` above is the reading the smoke case proves.
 *
 * The smoke case is the caller's because the configuration is: a tree that must produce
 * findings, and exactly the findings that must come back for it.
 */
export const knipOver = (
  scaffold: Tree,
  smoke: { readonly tree: Tree; readonly findings: readonly KnipFinding[] },
): KnipRunner => {
  const expected = [...smoke.findings].map(sortKey).sort();
  const run = runsOverThrowawayTree({
    executable: { package: "knip", path: ["bin", "knip.js"] },
    argv: ["--reporter", "json"],
    scaffold,
    foundSomething: [1],
    smoke: {
      tree: smoke.tree,
      reports: (output) => {
        const found = findingsIn(output).map(sortKey);
        return (
          found.length === expected.length && found.every((key, index) => key === expected[index])
        );
      },
    },
  });

  return { findings: (tree) => findingsIn(run(tree)) };
};
