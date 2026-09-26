import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { byCodeUnit } from "@better-answers/schema/code-unit";

/**
 * What `execFileSync` throws once the tool ran; a spawn that never started carries a null
 * status and no streams, so nothing is required.
 */
const spawnFailure = z.object({
  status: z.number().nullish(),
  code: z.string().nullish(),
  stdout: z.string().nullish(),
  stderr: z.string().nullish(),
});

/** A test's own timeout cannot interrupt a synchronous run, so this is the one a hung tool meets. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** A live tree lasts one run, inside the time limit, so a tree this old outlived a killed run. */
const STALE_AFTER_MS = 60 * 60 * 1000;

export type Tree = Readonly<Record<string, string>>;

export type Tool = {
  /** The package that ships the binary, and the binary's path inside that package. */
  readonly executable: { readonly package: string; readonly path: readonly string[] };

  readonly argv: readonly string[];

  /** Written under every tree before the tree's own files, which win on a shared path. */
  readonly scaffold?: Tree;

  /** Laid over this process's environment, never in place of it. */
  readonly env?: Readonly<Record<string, string>>;

  /** The exits that mean the tool ran and reported something; any other non-zero exit throws. */
  readonly foundSomething: readonly number[];

  /** Under an hour, or the sweep could take a live tree for one a killed run left. */
  readonly timeoutMs?: number;

  /** A tree the tool must report on, run once when the runner is made. */
  readonly smoke: { readonly tree: Tree; readonly reports: (output: string) => boolean };
};

export type RunOverTree = (tree: Tree) => string;

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

/**
 * The binary's absolute path; throws when the package is not a dependency here or ships no such
 * file.
 */
export const executableOf = (executable: Tool["executable"]): string => {
  const from = createRequire(import.meta.url);
  const root = packageRoot(from, executable.package);
  if (root === undefined) {
    throw new Error(
      `\`${executable.package}\` is not in @better-answers/devtools's dependency tree, so its binary cannot be resolved. Declare it as a devDependency of packages/devtools.`,
    );
  }
  const binary = path.join(root, ...executable.path);
  if (!existsSync(binary)) {
    throw new Error(
      `${executable.package}: the package is installed but carries no executable at ${executable.path.join("/")} (looked at ${binary}).`,
    );
  }
  return binary;
};

export const writeUnder = (root: string, relative: string, content: string): void => {
  const destination = path.join(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
};

const writeTree = (directory: string, tree: Tree): void => {
  for (const [file, source] of Object.entries(tree)) writeUnder(directory, file, source);
};

/** git's stdout; a non-zero exit throws, carrying both streams. */
export const gitIn = (directory: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
};

/** Makes `root`, which must not exist yet, a repository on `main` with a throwaway identity. */
export const throwawayRepository = (root: string): string => {
  mkdirSync(root);
  gitIn(root, "init", "-q", "-b", "main");
  gitIn(root, "config", "user.email", "test@example.invalid");
  gitIn(root, "config", "user.name", "throwaway repository");
  return root;
};

const failureOf = (cause: unknown): z.infer<typeof spawnFailure> => {
  const read = spawnFailure.safeParse(cause);
  return read.success ? read.data : {};
};

const timeoutMsFor = (tool: Tool): number => {
  const timeoutMs = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (timeoutMs >= STALE_AFTER_MS) {
    throw new Error(
      `${tool.executable.package}: a time limit of ${String(timeoutMs)} ms lets a live tree reach the age at which the sweep removes it; keep it under ${String(STALE_AFTER_MS)} ms.`,
    );
  }
  return timeoutMs;
};

const howItStopped = (failure: z.infer<typeof spawnFailure>, timeoutMs: number): string =>
  failure.code === "ETIMEDOUT"
    ? `did not finish: stopped after ${String(timeoutMs)} ms`
    : `did not run: exit ${String(failure.status)}`;

const reportOrThrow = (tool: Tool, binary: string, timeoutMs: number, cause: unknown): string => {
  const failure = failureOf(cause);
  const status = failure.status;
  if (status !== null && status !== undefined && tool.foundSomething.includes(status)) {
    return String(failure.stdout ?? "");
  }

  throw new Error(
    `${tool.executable.package} (${binary}) ${howItStopped(failure, timeoutMs)}\n${String(failure.stdout ?? "")}\n${String(failure.stderr ?? cause)}`,
  );
};

/** Keyed by folder, not a flag, because the temp directory is read afresh on every run. */
const sweptFolders = new Set<string>();

const sweepStaleTrees = (folder: string): void => {
  if (sweptFolders.has(folder)) return;
  sweptFolders.add(folder);
  const staleBeforeMs = Date.now() - STALE_AFTER_MS;
  for (const entry of readdirSync(folder)) {
    const tree = path.join(folder, entry);
    const modifiedMs = statSync(tree, { throwIfNoEntry: false })?.mtimeMs;
    if (modifiedMs !== undefined && modifiedMs < staleBeforeMs) {
      rmSync(tree, { recursive: true, force: true });
    }
  }
};

const sweptTreesFolder = (): string => {
  const folder = path.join(tmpdir(), "better-answers-throwaway-trees");
  mkdirSync(folder, { recursive: true });
  sweepStaleTrees(folder);
  return folder;
};

/**
 * Resolves the binary and runs the smoke case now, throwing if either fails or the time limit is
 * an hour or more.
 */
export const runsOverThrowawayTree = (tool: Tool): RunOverTree => {
  const binary = executableOf(tool.executable);
  const timeoutMs = timeoutMsFor(tool);

  const runIn = (directory: string): string => {
    try {
      return execFileSync(binary, [...tool.argv], {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,

        env: { ...process.env, ...tool.env },
      });
    } catch (cause) {
      return reportOrThrow(tool, binary, timeoutMs, cause);
    }
  };

  const run: RunOverTree = (tree) => {
    const directory = mkdtempSync(path.join(sweptTreesFolder(), "tree-"));
    try {
      writeTree(directory, tool.scaffold ?? {});
      writeTree(directory, tree);
      return runIn(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
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

const pathsIn = (output: string): readonly string[] =>
  [
    ...new Set(
      output
        .split("\n")
        .map((line) => /^(?<file>[^\s:]+):\d+:\d+:/.exec(line)?.groups?.["file"])
        .filter((file): file is string => file !== undefined),
    ),
  ].sort(byCodeUnit);

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

const sameInOrder = (found: readonly string[], expected: readonly string[]): boolean =>
  found.length === expected.length && found.every((one, index) => one === expected[index]);

export type OxlintRunner = {
  readonly output: (tree: Tree) => string;
  /** Each file the report names, once, sorted. */
  readonly flagged: (tree: Tree) => readonly string[];
};

/** The smoke tree must flag exactly the files `smoke.flagged` names, in any order. */
export const oxlintOver = (
  configJson: string,
  smoke: { readonly tree: Tree; readonly flagged: readonly string[] },
  flags: readonly string[] = [],
): OxlintRunner => {
  const expected = [...smoke.flagged].sort(byCodeUnit);
  const run = runsOverThrowawayTree({
    executable: { package: "oxlint", path: ["bin", "oxlint"] },
    // Pinned, never left to oxlint: under Actions it picks the annotation reporter, whose
    // lines `pathsIn` cannot read, and every rule then looks silent.
    argv: [...flags, "--config", ".oxlintrc.json", "--format=unix", "."],
    scaffold: { ".oxlintrc.json": configJson },
    env: { OXLINT_TSGOLINT_PATH: tsgolintPath() },
    foundSomething: [1],
    smoke: { tree: smoke.tree, reports: (output) => sameInOrder(pathsIn(output), expected) },
  });

  return { output: run, flagged: (tree) => pathsIn(run(tree)) };
};

const KNIP_FINDING_KINDS = [
  "files",
  "exports",
  "types",
  "dependencies",
  "devDependencies",
  "unlisted",
  "binaries",
] as const;

export type KnipFinding = {
  readonly kind: (typeof KNIP_FINDING_KINDS)[number];
  readonly file: string;
  readonly name: string;
};

export type KnipRunner = {
  readonly findings: (tree: Tree) => readonly KnipFinding[];
};

const namedIssues = z.array(z.object({ name: z.string() })).optional();

/**
 * knip's JSON reporter, its kinds spelled out against the tuple. The smoke case proves the
 * shape, so an unreadable report is refused there.
 */
const knipReport = z.object({
  issues: z
    .array(
      z.object({
        file: z.string().optional(),
        files: namedIssues,
        exports: namedIssues,
        types: namedIssues,
        dependencies: namedIssues,
        devDependencies: namedIssues,
        unlisted: namedIssues,
        binaries: namedIssues,
      } satisfies Record<(typeof KNIP_FINDING_KINDS)[number], typeof namedIssues> & {
        readonly file: z.ZodOptional<z.ZodString>;
      }),
    )
    .optional(),
});

const sortKey = (finding: KnipFinding): string => `${finding.kind}:${finding.file}:${finding.name}`;

/** The smoke case compares the expected and found findings in order, so both sort by this. */
const byFinding = (left: KnipFinding, right: KnipFinding): number =>
  sortKey(left).localeCompare(sortKey(right));

const findingsIn = (output: string): readonly KnipFinding[] =>
  (knipReport.parse(JSON.parse(output)).issues ?? [])
    .flatMap((entry) =>
      KNIP_FINDING_KINDS.flatMap((kind) =>
        (entry[kind] ?? []).map((issue) => ({
          kind,
          file: entry.file ?? "",
          name: issue.name,
        })),
      ),
    )
    .sort(byFinding);

/** Each tree is laid over `scaffold`; the smoke tree must report exactly `smoke.findings`. */
export const knipOver = (
  scaffold: Tree,
  smoke: { readonly tree: Tree; readonly findings: readonly KnipFinding[] },
): KnipRunner => {
  const expected = [...smoke.findings].sort(byFinding).map(sortKey);
  const run = runsOverThrowawayTree({
    executable: { package: "knip", path: ["bin", "knip.js"] },
    argv: ["--reporter", "json"],
    scaffold,
    foundSomething: [1],
    smoke: {
      tree: smoke.tree,
      reports: (output) => sameInOrder(findingsIn(output).map(sortKey), expected),
    },
  });

  return { findings: (tree) => findingsIn(run(tree)) };
};
