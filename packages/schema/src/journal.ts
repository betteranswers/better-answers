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

/**
 * The journal's entries as one document holds them — **refusing two migrations at one
 * instant**. The worker's stamp check compares `when` alone, so two entries sharing one would
 * make a database stopped after the earlier of them read as stamped with the later: the
 * worker would claim against a schema one migration short of the view it was generated from.
 * drizzle-kit mints `when` from its own clock and never repeats one in practice; this is what
 * turns "in practice" into a fact the generator and the drift test hold, and a hand-edited
 * journal cannot get past.
 */
type JournalDocument = z.input<typeof journalSchema>;

export const journalEntriesOf = (document: JournalDocument): readonly JournalEntry[] => {
  const { entries } = journalSchema.parse(document);
  for (const [position, entry] of entries.entries()) {
    const earlier = entries[position - 1];
    if (earlier !== undefined && entry.when <= earlier.when) {
      throw new Error(
        `the journal's instants must strictly increase, but ${entry.tag} (${entry.when}) does not follow ${earlier.tag} (${earlier.when}): the worker's stamp check could not tell the two apart`,
      );
    }
  }
  return entries;
};

export const journalEntries = (): readonly JournalEntry[] =>
  journalEntriesOf(
    JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")),
  );

export const journalMigrationFiles = (): readonly string[] =>
  journalEntries().map((entry) => path.join(migrationsFolder, `${entry.tag}.sql`));

/** The migration the database is stamped with once the whole journal has been applied. */
export const lastMigration = (): JournalEntry => {
  const last = journalEntries().at(-1);
  if (last === undefined) throw new Error("the journal is empty");
  return last;
};
