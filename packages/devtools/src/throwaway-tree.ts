import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

export type Tree = Readonly<Record<string, string>>;

export type Tool = {
  readonly executable: { readonly package: string; readonly path: readonly string[] };

  readonly argv: readonly string[];

  readonly scaffold?: Tree;

  readonly env?: Readonly<Record<string, string>>;

  readonly foundSomething: readonly number[];

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

export const runsOverThrowawayTree = (tool: Tool): RunOverTree => {
  const binary = executableOf(tool.executable);

  const run: RunOverTree = (tree) => {
    const directory = mkdtempSync(path.join(tmpdir(), "throwaway-tree-"));
    writeTree(directory, tool.scaffold ?? {});
    writeTree(directory, tree);
    try {
      return execFileSync(binary, [...tool.argv], {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],

        // Not hermetic: a tool spawned without PATH, HOME and a temporary directory fails
        // for reasons unrelated to the rule under test.
        env: { ...process.env, ...tool.env },
      });
    } catch (cause) {
      // SAFETY: every field is read defensively below, because a spawn that never started
      // carries a null status and no stdout.
      const failure = cause as {
        status?: number | null;
        stdout?: string;
        stderr?: string;
      };
      const status = failure.status;
      if (status !== null && status !== undefined && tool.foundSomething.includes(status)) {
        return String(failure.stdout ?? "");
      }

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

const pathsIn = (output: string): readonly string[] =>
  [
    ...new Set(
      output
        .split("\n")
        .map((line) => /^(?<file>[^\s:]+):\d+:\d+:/.exec(line)?.groups?.["file"])
        .filter((file): file is string => file !== undefined),
    ),
  ].sort();

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

export type OxlintRunner = {
  readonly output: (tree: Tree) => string;
  readonly flagged: (tree: Tree) => readonly string[];
};

export const oxlintOver = (
  configJson: string,
  smoke: { readonly tree: Tree; readonly flagged: readonly string[] },
): OxlintRunner => {
  const expected = [...smoke.flagged].sort();
  const run = runsOverThrowawayTree({
    executable: { package: "oxlint", path: ["bin", "oxlint"] },
    // Pinned, never left to oxlint: under Actions it picks the annotation reporter, whose
    // lines `pathsIn` cannot read, and every rule then looks silent.
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

type KnipReportEntry = { readonly file?: string } & {
  readonly [Kind in (typeof KNIP_FINDING_KINDS)[number]]?: readonly { readonly name: string }[];
};

const sortKey = (finding: KnipFinding): string => `${finding.kind}:${finding.file}:${finding.name}`;

const findingsIn = (output: string): readonly KnipFinding[] => {
  const parsed: unknown = JSON.parse(output);

  // SAFETY: the runner's smoke case proves knip's reporter contract; a report this cannot
  // find is refused there, never read as a clean tree.
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
