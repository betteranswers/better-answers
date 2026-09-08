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
 * Why a journal was refused: an entry whose instant does not follow the one before it. The
 * two entries are the refusal, so a caller can say which pair rather than that a check failed.
 */
export type JournalRefusal = { readonly earlier: JournalEntry; readonly later: JournalEntry };

/**
 * The kernel's `Result` shape, written here because this package sits below `packages/core`
 * and cannot import it (the import direction, ADR 0029); the shape is the rule's, not a second
 * convention.
 */
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * The journal's entries as one document holds them — **refusing two migrations at one
 * instant**. The worker's stamp check compares `when` alone, so two entries sharing one would
 * make a database stopped after the earlier of them read as stamped with the later: the
 * worker would claim against a schema one migration short of the view it was generated from.
 * drizzle-kit mints `when` from its own clock and never repeats one in practice; this is what
 * turns "in practice" into a fact the generator and the drift test hold, and a hand-edited
 * journal cannot get past. The shape is zod's to refuse (the boundary's parse throws, as it
 * does everywhere); the order is this function's, and it answers a `Result`.
 */
type JournalDocument = z.input<typeof journalSchema>;

export const journalEntriesOf = (
  document: JournalDocument,
): Result<readonly JournalEntry[], JournalRefusal> => {
  const { entries } = journalSchema.parse(document);
  for (const [position, later] of entries.entries()) {
    const earlier = entries[position - 1];
    if (earlier !== undefined && later.when <= earlier.when) {
      return { ok: false, error: { earlier, later } };
    }
  }
  return { ok: true, value: entries };
};

/**
 * The tracked journal's entries. A refusal here is a defect in a committed file, found by the
 * generator or the drift test before any view is rendered, so it is thrown in the refusal's
 * own words — the same class of stop as `lastMigration`'s empty journal — rather than handed
 * to a script that has nothing to do with it but exit.
 */
export const journalEntries = (): readonly JournalEntry[] => {
  const read = journalEntriesOf(
    JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")),
  );
  if (read.ok) return read.value;
  const { earlier, later } = read.error;
  throw new Error(
    `the journal's instants must strictly increase, but ${later.tag} (${later.when}) does not follow ${earlier.tag} (${earlier.when}): the worker's stamp check could not tell the two apart`,
  );
};

export const journalMigrationFiles = (): readonly string[] =>
  journalEntries().map((entry) => path.join(migrationsFolder, `${entry.tag}.sql`));

/** The migration the database is stamped with once the whole journal has been applied. */
export const lastMigration = (): JournalEntry => {
  const last = journalEntries().at(-1);
  if (last === undefined) throw new Error("the journal is empty");
  return last;
};
