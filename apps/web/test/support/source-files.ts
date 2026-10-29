import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { workspaceRoot } from "./roots.ts";

const source = path.resolve(workspaceRoot, "src");

const filesUnder = (directory: string, named: RegExp): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const here = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(here, named);
    return named.test(entry.name) ? [path.relative(source, here)] : [];
  });

export const sourceFiles = (named: RegExp) =>
  filesUnder(source, named).map((file) => ({
    file,
    text: readFileSync(path.join(source, file), "utf8"),
  }));
