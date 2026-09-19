import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The byte drizzle-kit leaves off `_journal.json`. The tool rewrites the journal whenever a
 * `generate` run has a migration to add, and writes it without a final newline, so the file's
 * last line lands in the diff of every such run. Nothing else puts it back: `.oxfmtrc.json`
 * ignores `packages/schema/migrations/**`, and it has to — the formatter reflows a snapshot
 * heavily (`0038` loses about 5 kB of drizzle-kit's own layout), which would make every
 * generated file a diff against what the tool wrote. `scripts/generate-migrations.ts` calls
 * this the moment the tool returns, and the migration-ownership suite holds both the tracked
 * file and this function.
 *
 * Nothing here reads the journal as a document: the entries are the tool's to write, and the
 * suite holds them where they are parsed (`src/journal.ts`).
 */

/**
 * Put the final newline back on the journal in this `meta/` folder, leaving a journal that
 * already ends in one exactly as it was — appending to whatever is handed over would add a
 * blank line on every run, which is the diff this exists to stop.
 *
 * A folder with no `_journal.json` in it throws, naming the path: the tool writes that file
 * before this runs, so a missing one means a generate that reported success wrote nothing
 * where the journal should be, and swallowing it would leave the tree looking generated.
 */
export const restoreFinalNewline = (metaFolder: string): void => {
  const journal = path.join(metaFolder, "_journal.json");
  const written = readFileSync(journal, "utf8");
  if (written.endsWith("\n")) return;
  writeFileSync(journal, `${written}\n`);
};
