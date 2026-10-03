import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { writeEdits } from "./edits.ts";
import type { Occurrence } from "./edits.ts";
import type { RenameMap } from "./map.ts";
import { symbolPass } from "./symbols.ts";
import { textPass } from "./text.ts";
import { wordsOf } from "./words.ts";

export { parseRenameMap } from "./map.ts";
export type { RenameMap } from "./map.ts";

export type RenameMode = "dry-run" | "apply";

export type RenameReport = { readonly occurrences: readonly Occurrence[] };

const byPlace = (left: Occurrence, right: Occurrence): number =>
  byCodeUnit(left.file, right.file) || left.line - right.line || left.column - right.column;

/** Symbols go first, so the text pass reads the renamed files. A dry run reports and writes nothing. */
export const renameOver = (root: string, map: RenameMap, mode: RenameMode): RenameReport => {
  const tree = path.resolve(root);
  const words = wordsOf(map);
  const symbols = symbolPass(tree, map, words);
  if (mode === "apply") writeEdits(tree, symbols.edits);
  const text = textPass(tree, map, words);
  if (mode === "apply") writeEdits(tree, text.edits);
  return { occurrences: [...symbols.occurrences, ...text.occurrences].sort(byPlace) };
};
