import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const source = path.resolve(import.meta.dirname, "../src");

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
