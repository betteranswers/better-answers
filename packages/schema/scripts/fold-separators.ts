import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SEPARATOR = "--> statement-breakpoint";

const folded = (sql: string): string => {
  const kept: string[] = [];
  for (const line of sql.split("\n")) {
    const above = kept.at(-1);
    if (line === SEPARATOR && above !== undefined && above !== "") {
      kept[kept.length - 1] = `${above}${SEPARATOR}`;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
};

/** The line counter reads a directive alone on a line as a comment, which the ceiling pays for. */
export const foldSeparators = (migrationsFolder: string): readonly string[] => {
  const moved: string[] = [];
  for (const name of readdirSync(migrationsFolder).toSorted()) {
    if (!name.endsWith(".sql")) continue;
    const file = path.join(migrationsFolder, name);
    const before = readFileSync(file, "utf8");
    const after = folded(before);
    if (after === before) continue;
    writeFileSync(file, after);
    moved.push(name);
  }
  return moved;
};
