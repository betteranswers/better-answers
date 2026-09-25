import { execFileSync } from "node:child_process";

import { z } from "zod";

import { executableOf, runsOverThrowawayTree } from "./throwaway-tree.ts";

import type { Tree } from "./throwaway-tree.ts";

/** Comment lines per code line; an arm over its figure fails the gate. */
export const CEILING = { source: 0.1, test: 0.05 } as const;

export type Arm = keyof typeof CEILING;

const WORKSPACE_LANGUAGES = ["TypeScript", "Python"] as const;

const CONFIG_LANGUAGES = [
  "Bourne Again Shell",
  "Bourne Shell",
  "JavaScript",
  "SQL",
  "TOML",
  "YAML",
] as const;

const MEASURED_LANGUAGES = {
  workspace: new Set<string>(WORKSPACE_LANGUAGES),
  directory: new Set<string>([...WORKSPACE_LANGUAGES, ...CONFIG_LANGUAGES]),
} as const;

type Kind = keyof typeof MEASURED_LANGUAGES;

/**
 * A unit no directory gathers names the paths it holds; one that is a directory or a
 * workspace stands at its own.
 */
export type Unit = {
  readonly name: string;
  readonly kind: Kind;
  readonly holds?: readonly string[];
};

export const heldBy = (unit: Unit): readonly string[] => unit.holds ?? [unit.name];

const EVERY_MEASURED_LANGUAGE = new Set<string>(
  Object.values(MEASURED_LANGUAGES).flatMap((languages) => [...languages]),
);

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

const CLOC_EXECUTABLE = { package: "cloc", path: ["lib", "cloc"] } as const;

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

/**
 * cloc's by-file JSON, with a `header` and a `SUM` beside the files; the smoke case proves
 * the contract.
 */
const clocReport = z.record(
  z.string(),
  z.looseObject({
    language: z.string().optional(),
    code: z.number().optional(),
    comment: z.number().optional(),
  }),
);

const countedIn = (output: string): readonly Counted[] =>
  Object.entries(clocReport.parse(JSON.parse(output)))
    .filter(([file]) => file !== "header" && file !== "SUM")
    .map(([file, entry]) => ({
      file,
      language: entry.language ?? "",
      code: entry.code ?? 0,
      comment: entry.comment ?? 0,
    }))
    .filter((counted) => EVERY_MEASURED_LANGUAGE.has(counted.language))
    .sort((left, right) => left.file.localeCompare(right.file));

/** A file under an `e2e`, `test` or `tests` directory, or named as a test, is `test`. */
export const armOf = (file: string): Arm => {
  const segments = file.replace(/^\.\//, "").split("/");
  const name = segments.at(-1) ?? "";
  const inATestDirectory = segments.some((segment) => TEST_DIRECTORIES.has(segment));
  return inATestDirectory || TEST_FILE.test(name) ? "test" : "source";
};

export type Measured = {
  readonly unit: string;
  readonly arm: Arm;
  readonly code: number;
  readonly comment: number;
  readonly ratio: number;
};

const unitOf = (file: string, units: readonly Unit[]): Unit | undefined => {
  const relative = file.replace(/^\.\//, "");

  // Longest path first, so a directory named inside a workspace takes the files it holds.
  return units
    .flatMap((unit) => heldBy(unit).map((held) => ({ unit, held })))
    .sort((left, right) => right.held.length - left.held.length)
    .find(({ held }) => relative === held || relative.startsWith(`${held}/`))?.unit;
};

type Total = { code: number; comment: number };

/**
 * A file no unit holds, or in a language its unit does not measure, is dropped; a directory
 * unit has only a `source` arm.
 */
export const measure = (
  counted: readonly Counted[],
  units: readonly Unit[],
): readonly Measured[] => {
  const totals = new Map<string, Map<Arm, Total>>();
  for (const row of counted) {
    const unit = unitOf(row.file, units);
    if (unit === undefined) continue;
    if (!MEASURED_LANGUAGES[unit.kind].has(row.language)) continue;
    const arms = totals.get(unit.name) ?? new Map<Arm, Total>();

    /** A config root has no test arm to hold to the tighter ceiling, so one number is the truth. */
    const arm = unit.kind === "directory" ? "source" : armOf(row.file);
    const running = arms.get(arm) ?? { code: 0, comment: 0 };
    arms.set(arm, { code: running.code + row.code, comment: running.comment + row.comment });
    totals.set(unit.name, arms);
  }
  return [...totals.entries()]
    .flatMap(([unit, arms]) =>
      [...arms.entries()].map(([arm, total]) => ({
        unit,
        arm,
        code: total.code,
        comment: total.comment,
        ratio: total.code === 0 ? 0 : total.comment / total.code,
      })),
    )
    .sort((left, right) => `${left.unit}${left.arm}`.localeCompare(`${right.unit}${right.arm}`));
};

export const overTheCeiling = (measured: readonly Measured[]): readonly Measured[] =>
  measured.filter((one) => one.code > 0 && one.ratio > CEILING[one.arm]);

export const reportOf = (one: Measured): string =>
  `${one.unit} ${one.arm}: ${one.ratio.toFixed(2)} comment lines per code line, over the ${CEILING[one.arm].toFixed(2)} ceiling ([COMMENT1]).`;

/** Runs cloc over `paths` from `cwd`; throws when cloc fails or writes no JSON. */
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

/** The smoke tree must count exactly `smoke.counted` measured files. */
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
