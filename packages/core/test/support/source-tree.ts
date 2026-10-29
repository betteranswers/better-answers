import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { workspaceRoot } from "./roots/roots.ts";

const CORE_SRC = path.resolve(workspaceRoot, "src");

export const coreSourceFiles = (): readonly string[] =>
  readdirSync(CORE_SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name));

export const asSliceRelative = (files: readonly string[]): readonly string[] =>
  files.map((file) => path.relative(CORE_SRC, file));

export const sourceTreeIsInstrumented = (): boolean =>
  coreSourceFiles().some((file) => /\bstry(?:NS|Cov|MutAct)_/.test(readFileSync(file, "utf8")));
