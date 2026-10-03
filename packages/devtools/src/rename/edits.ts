import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { keptReason } from "./map.ts";

export const RENAMED = "rename";

export const OUTSIDE_ALLOWLIST = "outside the allowlist";

export type Occurrence = {
  readonly pass: "symbol" | "text";
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly found: string;
  readonly to: string;
  /** `rename`, or the sense or reason the occurrence stays as it is. */
  readonly verdict: string;
};

/** Offsets in UTF-16 code units, as a JavaScript string counts them. */
export type Edit = {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

/** What one pass found, and the edits that rename what it may. */
export type PassOutcome = {
  readonly occurrences: readonly Occurrence[];
  readonly edits: readonly Edit[];
};

/** A file under `root`, written with `/` whatever the platform. */
export const relativeTo = (root: string, file: string): string =>
  path.relative(root, file).split(path.sep).join("/");

/** Pruned from every walk: what a package manager installed, and hidden tool directories. */
export const isPrunedName = (segment: string): boolean =>
  segment === "node_modules" || segment.startsWith(".");

export const isSwept = (file: string): boolean =>
  !file.startsWith("../") && !file.split("/").some(isPrunedName);

const spliced = (source: string, edits: readonly Edit[]): string => {
  const ordered = [...edits].sort((left, right) => left.start - right.start);
  const parts: string[] = [];
  let at = 0;
  for (const edit of ordered) {
    if (edit.start < at) {
      throw new Error(`${edit.file}: two renames overlap at offset ${String(edit.start)}`);
    }
    parts.push(source.slice(at, edit.start), edit.text);
    at = edit.end;
  }
  parts.push(source.slice(at));
  return parts.join("");
};

/** Two symbols can reach one span, as a shorthand property does; the same text there is one edit. */
const distinctOf = (edits: readonly Edit[]): readonly Edit[] => [
  ...new Map(
    edits.map((edit) => [
      `${edit.file}:${String(edit.start)}:${String(edit.end)}:${edit.text}`,
      edit,
    ]),
  ).values(),
];

/** Writes every edit, refusing outright a file a sweep never edits, whatever pass asked. */
export const writeEdits = (root: string, edits: readonly Edit[]): void => {
  for (const [file, inFile] of Map.groupBy(distinctOf(edits), (edit) => edit.file)) {
    const reason = keptReason(file);
    if (reason !== undefined) throw new Error(`${file} is ${reason}, which a sweep never edits`);
    const absolute = path.join(root, file);
    writeFileSync(absolute, spliced(readFileSync(absolute, "utf8"), inFile));
  }
};
