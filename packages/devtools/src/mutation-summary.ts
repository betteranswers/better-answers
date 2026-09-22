import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { flagValues } from "./flags.ts";

const mutantStatus = z.enum([
  "Killed",
  "Survived",
  "NoCoverage",
  "Timeout",
  "Ignored",
  "CompileError",
  "RuntimeError",
  "Pending",
]);
export type MutantStatus = z.infer<typeof mutantStatus>;

const position = z.object({ line: z.number(), column: z.number() });
export type Position = z.infer<typeof position>;

const reportMutant = z.object({
  mutatorName: z.string(),
  replacement: z.string().optional(),
  status: mutantStatus,

  testsCompleted: z.number().optional(),
  location: z.object({ start: position, end: position }),
});
export type ReportMutant = z.infer<typeof reportMutant>;

// Stryker's mutation-testing report, read as far as the summary needs it.
const report = z.object({
  files: z
    .record(z.string(), z.object({ source: z.string(), mutants: z.array(reportMutant).readonly() }))
    .readonly(),
});
export type Report = z.infer<typeof report>;

const USAGE = "usage: mutation-summary --leg <name> --report <path> [--baseline <path>]";

const MAX_REPLACEMENT = 80;

type Placed = {
  readonly file: string;
  readonly mutant: ReportMutant;
  readonly text: string;
};

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

const identity = (placed: Placed): string =>
  [placed.file, placed.mutant.mutatorName, placed.mutant.replacement ?? "", placed.text].join(
    // Written as an escape: a raw NUL byte would make this file binary to git. No part of
    // an identity can contain one.
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

const byIdentity = (report: Report): ReadonlyMap<string, readonly Placed[]> => {
  const groups = new Map<string, Placed[]>();
  for (const placed of placedIn(report)) {
    const key = identity(placed);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [placed]);
    else group.push(placed);
  }
  // Position order, never the report's: Stryker's mutant order moves between runs, and a
  // survivor paired with the wrong occurrence reads as a lost kill.
  for (const group of groups.values()) group.sort(byPlace);
  return groups;
};

const ranNoTest = (mutant: ReportMutant): boolean =>
  mutant.status === "Survived" && mutant.testsCompleted === 0;

const survives = (mutant: ReportMutant): boolean =>
  mutant.status === "NoCoverage" || (mutant.status === "Survived" && !ranNoTest(mutant));

const killed = (mutant: ReportMutant): boolean =>
  mutant.status === "Killed" || mutant.status === "Timeout";

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
    `### ${leg} mutants that ran no test: ${String(rows.length)} — the runner resolved no test file for them, which is a runner fault to fix (the vitest-runner patch under \`patches/\`), never a survivor to triage`,
    ...rows.map((placed) => row(placed)),
  ];
};

export const mutationSummary = (
  leg: string,
  report: Report | undefined,
  baseline: Report | undefined,
): string => {
  if (report === undefined) return `### ${leg} mutation score: no report\n`;
  return `${[scoreLine(leg, report), ...newSurvivorLines(leg, report, baseline), ...ranNoTestLines(leg, report)].join("\n")}\n`;
};

// A file that is not a report, or not JSON, reads as no report.
const readReport = (file: string): Report | undefined => {
  if (!existsSync(file)) return undefined;
  try {
    const read = report.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
};

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
