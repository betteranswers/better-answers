import { RENAMED } from "./edits.ts";
import type { Occurrence } from "./edits.ts";
import type { RenameMode, RenameReport } from "./index.ts";
import type { RenameMap } from "./map.ts";

/** A bare identifier reads as itself; a string with spaces or a newline reads quoted. */
const shown = (text: string): string => (/^[\w$]+$/.test(text) ? text : JSON.stringify(text));

const lineOf = (one: Occurrence): string => {
  const place = `${one.pass} ${one.file}:${String(one.line)}:${String(one.column)}`;
  return one.verdict === RENAMED
    ? `  ${place} ${shown(one.found)} → ${shown(one.to)}`
    : `  ${place} ${shown(one.found)}`;
};

/** Renames first, then each sense or reason by how much it keeps. */
const byWeight = (
  left: readonly [string, readonly Occurrence[]],
  right: readonly [string, readonly Occurrence[]],
): number =>
  Number(right[0] === RENAMED) - Number(left[0] === RENAMED) || right[1].length - left[1].length;

/** Each occurrence under the sense or reason that decided it, with a count per heading first. */
export const formatReport = (map: RenameMap, report: RenameReport, mode: RenameMode): string => {
  const sections = [...Map.groupBy(report.occurrences, (one) => one.verdict)].sort(byWeight);
  return [
    `${map.noun} → ${map.readerWord} (${map.sweep}), ${mode}: ${String(report.occurrences.length)} occurrences`,
    ...sections.map(([verdict, occurrences]) => `  ${verdict}: ${String(occurrences.length)}`),
    ...sections.flatMap(([verdict, occurrences]) => ["", verdict, ...occurrences.map(lineOf)]),
    "",
  ].join("\n");
};
