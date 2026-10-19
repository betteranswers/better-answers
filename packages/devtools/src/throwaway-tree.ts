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

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const STALE_AFTER_MS = 60 * 60 * 1000;

export type Tree = Readonly<Record<string, string>>;

export type Tool = {
  readonly executable: { readonly package: string; readonly path: readonly string[] };

  readonly argv: readonly string[];

  readonly scaffold?: Tree;

  readonly env?: Readonly<Record<string, string>>;

  readonly foundSomething: readonly number[];

  readonly timeoutMs?: number;

  readonly smoke: { readonly tree: Tree; readonly reports: (output: string) => boolean };
};

export type RunOverTree = (tree: Tree) => string;

type Resolver = ReturnType<typeof createRequire>;

const directoryResolved = (from: Resolver, specifier: string): string | undefined => {
  try {
    return path.dirname(from.resolve(specifier));
  } catch {
    return undefined;
  }
};

const packageRoot = (from: Resolver, name: string): string | undefined => {
  const manifestExported = directoryResolved(from, `${name}/package.json`);
  if (manifestExported !== undefined) return manifestExported;
  let directory = directoryResolved(from, name);
  if (directory === undefined) return undefined;
  while (!existsSync(path.join(directory, "package.json"))) {
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return directory;
};

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

export const gitIn = (directory: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
};

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

export const sweptFolder = (): string => mkdtempSync(path.join(sweptTreesFolder(), "tree-"));

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
    const directory = sweptFolder();
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
  const suffix = process.platform === "win32" ? ".exe" : "";
  try {
    // From the package that depends on the build, since no NODE_PATH reaches the hoisted store.
    const from = createRequire(
      createRequire(import.meta.url).resolve("oxlint-tsgolint/package.json"),
    );
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
  readonly flagged: (tree: Tree) => readonly string[];
};

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
