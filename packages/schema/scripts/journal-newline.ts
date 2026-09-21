import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const restoreFinalNewline = (metaFolder: string): void => {
  const journal = path.join(metaFolder, "_journal.json");
  const written = readFileSync(journal, "utf8");
  if (written.endsWith("\n")) return;
  writeFileSync(journal, `${written}\n`);
};
