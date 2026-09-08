import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Not imported from index.ts — that would make the package entry point and this
// module a cycle the day index.ts re-exports the journal readers.
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * The one reader of drizzle-kit's journal (`migrations/meta/_journal.json`): the
 * worker-view generator, the drift test and the migration-ownership test all speak
 * through it, so the journal's shape is asserted once — with zod, not a cast.
 */

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number().int() })),
});

/**
 * One journal entry as everything here reads one: the tag, which names the file, and
 * `when`, which is the value drizzle's migrator writes into `created_at` on the stamp row.
 * The tag never reaches that table, so `when` is the only fact the two halves share — which
 * is why the worker's schema stamp, the thing it refuses to claim without, is checked
 * against it.
 */
export type JournalEntry = { readonly tag: string; readonly when: number };

export const journalEntries = (): readonly JournalEntry[] =>
  journalSchema.parse(
    JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")),
  ).entries;

export const journalMigrationFiles = (): readonly string[] =>
  journalEntries().map((entry) => path.join(migrationsFolder, `${entry.tag}.sql`));

/** The migration the database is stamped with once the whole journal has been applied. */
export const lastMigration = (): JournalEntry => {
  const last = journalEntries().at(-1);
  if (last === undefined) throw new Error("the journal is empty");
  return last;
};
