import { execFileSync } from "node:child_process";

import { executableOf, runsOverThrowawayTree } from "./throwaway-tree.ts";

import type { Tree } from "./throwaway-tree.ts";

export const CEILING = { source: 0.1, test: 0.05 } as const;

export type Arm = keyof typeof CEILING;

const MEASURED_LANGUAGES = new Set(["TypeScript", "Python"]);

const NEVER_WALKED = [
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "lifts",
  "node_modules",
  "playwright-report",
  "test-results",
];

const TEST_DIRECTORIES = new Set(["e2e", "test", "tests"]);

const TEST_FILE = /(^test_|[._](test|spec)\.)/;

export const CLOC_EXECUTABLE = { package: "cloc", path: ["lib", "cloc"] } as const;

export const clocArgv = (paths: readonly string[]): readonly string[] => [
  "--json",
  "--by-file",
  "--quiet",

  // Without it cloc counts a file with a twin elsewhere once, and an arm loses its lines.
  "--skip-uniqueness",

  // The per-file guard drops the file it fires on and writes prose after the JSON, so the
  // count is short and the parse fails.
  "--timeout",
  "0",
  `--exclude-dir=${NEVER_WALKED.join(",")}`,
  ...paths,
];

export type Counted = {
  readonly file: string;
  readonly language: string;
  readonly code: number;
  readonly comment: number;
};

type ClocEntry = {
  readonly language?: unknown;
  readonly code?: unknown;
  readonly comment?: unknown;
};

export const countedIn = (output: string): readonly Counted[] => {
  const parsed: unknown = JSON.parse(output);

  // SAFETY: cloc's by-file JSON contract, which the runner's smoke case proves still holds.
  const report = parsed as Readonly<Record<string, ClocEntry>>;
  return Object.entries(report)
    .filter(([file]) => file !== "header" && file !== "SUM")
    .map(([file, entry]) => ({
      file,
      language: typeof entry.language === "string" ? entry.language : "",
      code: typeof entry.code === "number" ? entry.code : 0,
      comment: typeof entry.comment === "number" ? entry.comment : 0,
    }))
    .filter((counted) => MEASURED_LANGUAGES.has(counted.language))
    .sort((left, right) => left.file.localeCompare(right.file));
};

export const armOf = (file: string): Arm => {
  const segments = file.replace(/^\.\//, "").split("/");
  const name = segments.at(-1) ?? "";
  const inATestDirectory = segments.some((segment) => TEST_DIRECTORIES.has(segment));
  return inATestDirectory || TEST_FILE.test(name) ? "test" : "source";
};

export type Measured = {
  readonly workspace: string;
  readonly arm: Arm;
  readonly code: number;
  readonly comment: number;
  readonly ratio: number;
};

const workspaceOf = (file: string, workspaces: readonly string[]): string | undefined => {
  const relative = file.replace(/^\.\//, "");
  return [...workspaces]
    .sort((left, right) => right.length - left.length)
    .find((workspace) => relative === workspace || relative.startsWith(`${workspace}/`));
};

type Total = { code: number; comment: number };

export const measure = (
  counted: readonly Counted[],
  workspaces: readonly string[],
): readonly Measured[] => {
  const totals = new Map<string, Map<Arm, Total>>();
  for (const row of counted) {
    const workspace = workspaceOf(row.file, workspaces);
    if (workspace === undefined) continue;
    const arms = totals.get(workspace) ?? new Map<Arm, Total>();
    const arm = armOf(row.file);
    const running = arms.get(arm) ?? { code: 0, comment: 0 };
    arms.set(arm, { code: running.code + row.code, comment: running.comment + row.comment });
    totals.set(workspace, arms);
  }
  return [...totals.entries()]
    .flatMap(([workspace, arms]) =>
      [...arms.entries()].map(([arm, total]) => ({
        workspace,
        arm,
        code: total.code,
        comment: total.comment,
        ratio: total.code === 0 ? 0 : total.comment / total.code,
      })),
    )
    .sort((left, right) =>
      `${left.workspace}${left.arm}`.localeCompare(`${right.workspace}${right.arm}`),
    );
};

export const overTheCeiling = (measured: readonly Measured[]): readonly Measured[] =>
  measured.filter((one) => one.code > 0 && one.ratio > CEILING[one.arm]);

export const reportOf = (one: Measured): string =>
  `${one.workspace} ${one.arm}: ${one.ratio.toFixed(2)} comment lines per code line, over the ${CEILING[one.arm].toFixed(2)} ceiling ([COMMENT1]).`;

export const countOver = (cwd: string, paths: readonly string[]): readonly Counted[] =>
  countedIn(
    execFileSync(executableOf(CLOC_EXECUTABLE), [...clocArgv(paths)], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

export const WRAPPER_EXECUTABLE = {
  package: "@better-answers/devtools",
  path: ["..", "..", "scripts", "comment-density.mjs"],
} as const;

export const clocOver = (
  paths: readonly string[],
  smoke: { readonly tree: Tree; readonly counted: number },
): ((tree: Tree) => readonly Counted[]) => {
  const run = runsOverThrowawayTree({
    executable: CLOC_EXECUTABLE,
    argv: clocArgv(paths),
    foundSomething: [],
    smoke: { tree: smoke.tree, reports: (output) => countedIn(output).length === smoke.counted },
  });
  return (tree) => countedIn(run(tree));
};
