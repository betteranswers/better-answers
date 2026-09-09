import { existsSync, readFileSync } from "node:fs";

import { flagValues } from "./flags.ts";

/**
 * The mutation run's job summary: one leg's score, the mutants that survive here and did
 * not survive in the previous run's report, and the rows the runner never tested.
 *
 * A score's movement is unreadable at two thousand rows; what a reader needs is which
 * mutants newly survived since the last run, named as `file:line — mutator — replacement`,
 * or a plain sentence that there are none. The previous run's report is the incremental
 * result file the workflow restores before Stryker overwrites it, so a first run — or a
 * run after the cache evicted the entry — has no baseline, and says so rather than listing
 * every survivor as news.
 *
 * A mutant is matched across the two reports by its text, not its line number: the file it
 * sits in, the mutator, the replacement and the source span the mutant replaces. A file
 * that gained lines above a mutant keeps the mutant where it was. Two identical spans in one
 * file mutated the same way — two `""` mutants on two `"user"` literals — are told apart by
 * order, which is the one limitation, and the summary text says so.
 *
 * A `Survived` row with `testsCompleted: 0` is not a survivor: the runner ran no test
 * against it, which the coding rules' mutation-schedule rule calls a runner
 * fault to fix where the runner failed (T-107). Those rows are named under their own
 * heading, and a baseline row of that shape is not a survivor either, so a mutant that ran
 * for the first time and survived is news — marked as one the baseline held no verdict on,
 * apart from the drift the summary exists to name: a mutant a test caught last run and none
 * caught in this one.
 *
 * Nothing here gates: the text is appended to the job summary and the exit is zero whatever
 * the two reports hold. A report that cannot be read is said in the text, not thrown.
 */

/** Stryker's statuses for a mutant, as the mutation-testing report schema spells them. */
export type MutantStatus =
  | "Killed"
  | "Survived"
  | "NoCoverage"
  | "Timeout"
  | "Ignored"
  | "CompileError"
  | "RuntimeError"
  | "Pending";

/** A 1-based position in a file; the end column is exclusive. */
export type Position = { readonly line: number; readonly column: number };

/** The slice of one mutant this reading needs. */
export type ReportMutant = {
  readonly mutatorName: string;
  readonly replacement?: string;
  readonly status: MutantStatus;
  /** How many tests ran against the mutant; absent on a mutant no test covers. */
  readonly testsCompleted?: number;
  readonly location: { readonly start: Position; readonly end: Position };
};

/** The slice of Stryker's mutation-testing report this reading needs: each file's source and mutants. */
export type Report = {
  readonly files: Readonly<
    Record<string, { readonly source: string; readonly mutants: readonly ReportMutant[] }>
  >;
};

const USAGE = "usage: mutation-summary --leg <name> --report <path> [--baseline <path>]";

/** A replacement as one line, so a block or an arrow body does not break the list. */
const MAX_REPLACEMENT = 80;

/** A mutant with the file it sits in and the text it replaces. */
type Placed = {
  readonly file: string;
  readonly mutant: ReportMutant;
  readonly text: string;
};

/** The source the mutant replaces, read from the file's text at the mutant's span. */
const spanText = (source: string, location: ReportMutant["location"]): string => {
  const lines = source.split("\n");
  const { start, end } = location;
  if (start.line === end.line) {
    return (lines[start.line - 1] ?? "").slice(start.column - 1, end.column - 1);
  }
  const first = (lines[start.line - 1] ?? "").slice(start.column - 1);
  const middle = lines.slice(start.line, end.line - 1);
  const last = (lines[end.line - 1] ?? "").slice(0, end.column - 1);
  return [first, ...middle, last].join("\n");
};

/**
 * What one mutant is, across runs: where it is, what it does and what it replaces. Joined
 * on NUL — written as an escape, since a raw byte makes the file binary to git — because a
 * replacement or a span can hold any printable character, and a separator that could occur
 * inside a part would let two different mutants read as one.
 */
const identity = (placed: Placed): string =>
  [placed.file, placed.mutant.mutatorName, placed.mutant.replacement ?? "", placed.text].join(
    "\u0000",
  );

const placedIn = (report: Report): readonly Placed[] =>
  Object.entries(report.files).flatMap(([file, entry]) =>
    entry.mutants.map((mutant) => ({
      file,
      mutant,
      text: spanText(entry.source, mutant.location),
    })),
  );

/**
 * The report's mutants grouped by identity, each group in position order, so a duplicate
 * pairs with the same occurrence run after run. Stryker does not keep a file's mutant order
 * stable between runs — two `"auth.consent"` literals came out swapped in consecutive
 * reports, and a survivor paired with the other occurrence's kill read as a lost kill
 * (T-107's residue) — so the report's own order is never the pairing order.
 */
const byIdentity = (report: Report): ReadonlyMap<string, readonly Placed[]> => {
  const groups = new Map<string, Placed[]>();
  for (const placed of placedIn(report)) {
    const key = identity(placed);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [placed]);
    else group.push(placed);
  }
  for (const group of groups.values()) group.sort(byPlace);
  return groups;
};

/** A row the runner never tested: reported as survived, with no test run against it. */
const ranNoTest = (mutant: ReportMutant): boolean =>
  mutant.status === "Survived" && mutant.testsCompleted === 0;

/** A survivor a test was run against, or a mutant no test covers. */
const survives = (mutant: ReportMutant): boolean =>
  mutant.status === "NoCoverage" || (mutant.status === "Survived" && !ranNoTest(mutant));

const killed = (mutant: ReportMutant): boolean =>
  mutant.status === "Killed" || mutant.status === "Timeout";

/** A mutant the score counts: one a test could have caught. */
const scored = (mutant: ReportMutant): boolean =>
  killed(mutant) || mutant.status === "Survived" || mutant.status === "NoCoverage";

const oneLine = (replacement: string): string => {
  const flat = replacement.replaceAll(/\s*\n\s*/g, " ");
  return flat.length > MAX_REPLACEMENT ? `${flat.slice(0, MAX_REPLACEMENT - 1)}…` : flat;
};

const row = (placed: Placed, note = ""): string =>
  `- \`${placed.file}:${String(placed.mutant.location.start.line)}\` — ${placed.mutant.mutatorName} — \`${oneLine(placed.mutant.replacement ?? "")}\`${note}`;

const byPlace = (left: Placed, right: Placed): number =>
  left.file.localeCompare(right.file) ||
  left.mutant.location.start.line - right.mutant.location.start.line ||
  left.mutant.location.start.column - right.mutant.location.start.column;

const scoreLine = (leg: string, report: Report): string => {
  const mutants = placedIn(report).map((placed) => placed.mutant);
  const total = mutants.filter(scored).length;
  if (total === 0) return `### ${leg} mutation score: no mutants`;
  const kills = mutants.filter(killed).length;
  const score = Math.round((kills * 1000) / total) / 10;
  return `### ${leg} mutation score: ${String(score)}% (${String(kills)}/${String(total)} mutants killed)`;
};

/**
 * A survivor here, with what the baseline said of the same mutant: killed — the drift the
 * summary exists to name — or absent, or present with no verdict (ignored, an error, or a
 * row that ran no test), which is news too but not a test that stopped catching it.
 */
type NewSurvivor = {
  readonly placed: Placed;
  readonly before: "killed" | "absent" | "no verdict";
};

const before = (match: Placed | undefined): NewSurvivor["before"] | "survived" => {
  if (match === undefined) return "absent";
  if (survives(match.mutant)) return "survived";
  return killed(match.mutant) ? "killed" : "no verdict";
};

const newSurvivors = (report: Report, baseline: Report): readonly NewSurvivor[] => {
  const held = byIdentity(baseline);
  const found: NewSurvivor[] = [];
  for (const [key, group] of byIdentity(report)) {
    const previous = held.get(key) ?? [];
    group.forEach((placed, index) => {
      if (!survives(placed.mutant)) return;
      const was = before(previous[index]);
      if (was !== "survived") found.push({ placed, before: was });
    });
  }
  return found.sort((left, right) => byPlace(left.placed, right.placed));
};

const NO_BASELINE =
  "no baseline — nothing was restored to compare against, so this run's report is the next run's baseline";

/** What follows a row whose baseline held no kill: the reader should know it is not drift. */
const NOTE = {
  killed: "",
  absent: " (not in the baseline)",
  "no verdict": " (no verdict in the baseline)",
} as const satisfies Record<NewSurvivor["before"], string>;

const MATCHING =
  "Survived or uncovered here, and not so in the previous run's report. Matched by the mutated text, not by line number; two identical spans in one file mutated the same way are matched by their order in the file.";

const newSurvivorLines = (
  leg: string,
  report: Report,
  baseline: Report | undefined,
): readonly string[] => {
  if (baseline === undefined) return [`### ${leg} new survivors: ${NO_BASELINE}`];
  const found = newSurvivors(report, baseline);
  if (found.length === 0) return [`### ${leg} new survivors: none`];
  return [
    `### ${leg} new survivors: ${String(found.length)}`,
    MATCHING,
    ...found.map(({ placed, before: was }) => row(placed, NOTE[was])),
  ];
};

const ranNoTestLines = (leg: string, report: Report): readonly string[] => {
  const rows = placedIn(report)
    .filter((placed) => ranNoTest(placed.mutant))
    .sort(byPlace);
  if (rows.length === 0) return [`### ${leg} mutants that ran no test: none`];
  return [
    `### ${leg} mutants that ran no test: ${String(rows.length)} — the runner resolved no test file for them, which is a runner fault to fix (the vitest-runner patch under \`patches/\`, T-107), never a survivor to triage`,
    ...rows.map((placed) => row(placed)),
  ];
};

/**
 * The leg's summary as markdown: the score, the new survivors against `baseline`, and the
 * rows that ran no test. Without a report there is nothing to say but that; without a
 * baseline the survivors section says so.
 */
export const mutationSummary = (
  leg: string,
  report: Report | undefined,
  baseline: Report | undefined,
): string => {
  if (report === undefined) return `### ${leg} mutation score: no report\n`;
  return `${[scoreLine(leg, report), ...newSurvivorLines(leg, report, baseline), ...ranNoTestLines(leg, report)].join("\n")}\n`;
};

/**
 * A report read from disk, or nothing: an absent file and a file that is not a report —
 * the partial write an interrupted run can leave — both read as no report, because the
 * summary is appended to a job that must not go red over what it could not read.
 */
const readReport = (file: string): Report | undefined => {
  if (!existsSync(file)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("files" in parsed)) return undefined;
    // SAFETY: the shape asserted is Stryker's mutation-testing report, whose `files` map
    // this reading walks; the suite runs the reading over a report of that shape, and a
    // file without a `files` key is refused above rather than read as a report.
    return parsed as Report;
  } catch {
    return undefined;
  }
};

/** The summary for a command line: `--leg <name> --report <path> [--baseline <path>]`. */
export const mutationSummaryFromArgv = (argv: readonly string[]): string => {
  const values = flagValues(argv);
  const leg = values?.get("leg");
  const reportFile = values?.get("report");
  if (values === undefined || leg === undefined || reportFile === undefined) {
    throw new Error(USAGE);
  }
  const baselineFile = values.get("baseline");
  return mutationSummary(
    leg,
    readReport(reportFile),
    baselineFile === undefined ? undefined : readReport(baselineFile),
  );
};
