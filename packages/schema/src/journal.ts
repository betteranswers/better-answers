import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Not imported from index.ts — that would make the package entry point and this
// module a cycle the day index.ts re-exports the journal readers.
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
/** Where drizzle-kit keeps the journal and one snapshot per entry. */
const metaFolder = path.join(migrationsFolder, "meta");

/**
 * The one reader of drizzle-kit's journal (`migrations/meta/_journal.json`): the
 * worker-view generator, the drift test and the migration-ownership test all speak
 * through it, so the journal's shape is asserted once — with zod, not a cast.
 */

const journalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string(), when: z.number().int() })),
});

/**
 * One journal entry as everything here reads one: the tag, which names the file, `when`,
 * which is the value drizzle's migrator writes into `created_at` on the stamp row, and `idx`,
 * which names the entry's snapshot under `meta/`. The tag never reaches that table, so `when`
 * is the only fact the two halves share — which is why the worker's schema stamp, the thing
 * it refuses to claim without, is checked against it.
 *
 * `idx` is read rather than re-derived from the tag's own numeric prefix. The two agree on
 * every entry the journal has ever held, but only one of them is what drizzle-kit writes and
 * what it names the snapshot by; deriving from the prefix would make the tag's spelling a
 * second convention that a rename could quietly break.
 */
export type JournalEntry = { readonly idx: number; readonly tag: string; readonly when: number };

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
 * The entries a `meta/` folder's journal holds. A refusal here is a defect in a committed
 * file, found by the generator or the drift test before any view is rendered, so it is thrown
 * in the refusal's own words — the same class of stop as `lastMigration`'s empty journal —
 * rather than handed to a script that has nothing to do with it but exit.
 */
const entriesIn = (folder: string): readonly JournalEntry[] => {
  const read = journalEntriesOf(
    JSON.parse(readFileSync(path.join(folder, "_journal.json"), "utf8")),
  );
  if (read.ok) return read.value;
  const { earlier, later } = read.error;
  throw new Error(
    `the journal's instants must strictly increase, but ${later.tag} (${later.when}) does not follow ${earlier.tag} (${earlier.when}): the worker's stamp check could not tell the two apart`,
  );
};

/** The tracked journal's entries. */
export const journalEntries = (): readonly JournalEntry[] => entriesIn(metaFolder);

export const journalMigrationFiles = (): readonly string[] =>
  journalEntries().map((entry) => path.join(migrationsFolder, `${entry.tag}.sql`));

/**
 * The snapshot drizzle-kit writes beside each migration: the schema as it stood once that
 * migration had run, and `prevId`, the `id` of the snapshot before it. Everything else in the
 * file is that schema, which nothing here reads, so zod strips it.
 */
const snapshotSchema = z.object({ id: z.string(), prevId: z.string() });

/**
 * What the first snapshot's `prevId` is, because there is no snapshot before it. drizzle-kit
 * writes the all-zero uuid rather than omitting the key, so the head of the chain is checked
 * by the same comparison as every link after it rather than by not being checked at all.
 */
const NOTHING_BEFORE_THE_FIRST = "00000000-0000-0000-0000-000000000000";

/** What a snapshot is called, from the entry that owns it. */
const snapshotOf = (entry: JournalEntry): string =>
  `${String(entry.idx).padStart(4, "0")}_snapshot.json`;

/**
 * Why a `meta/` folder was refused, in the four shapes the break takes. Each names the file
 * rather than reporting that a check failed, because the folder holds one file per migration
 * and "the chain is wrong" does not say which of them somebody has to open.
 */
export type SnapshotRefusal =
  /** A journal entry whose snapshot is not in the folder. */
  | { readonly kind: "snapshot-missing"; readonly tag: string; readonly snapshot: string }
  /** A snapshot in the folder no journal entry names. */
  | { readonly kind: "snapshot-orphaned"; readonly snapshot: string }
  /** A snapshot whose `prevId` is not the `id` of the snapshot before it. */
  | { readonly kind: "chain-broken"; readonly earlier: string; readonly later: string }
  /** The first snapshot, whose `prevId` is not the sentinel that stands for nothing before. */
  | { readonly kind: "chain-unrooted"; readonly snapshot: string };

/**
 * A `meta/` folder held against its own journal, answering the snapshots it walked in the
 * journal's order. Folder-taking for the same reason `journalEntriesOf` is document-taking:
 * a break is provoked over a copy, never by editing the tracked tree that every other suite
 * in the run is reading at the same time.
 */
export const journalSnapshotsIn = (folder: string): Result<readonly string[], SnapshotRefusal> => {
  const entries = entriesIn(folder);
  const named = new Set(entries.map(snapshotOf));

  // Membership first, both ways, before the chain is walked: a snapshot that is not there
  // breaks the link of the entry after it too, and a chain refusal would name that pair
  // rather than the file somebody has to put back.
  for (const entry of entries) {
    const snapshot = snapshotOf(entry);
    if (!existsSync(path.join(folder, snapshot))) {
      return { ok: false, error: { kind: "snapshot-missing", tag: entry.tag, snapshot } };
    }
  }
  for (const snapshot of readdirSync(folder).toSorted()) {
    if (snapshot.endsWith("_snapshot.json") && !named.has(snapshot)) {
      return { ok: false, error: { kind: "snapshot-orphaned", snapshot } };
    }
  }

  const walked: string[] = [];
  let before: { readonly snapshot: string; readonly id: string } | undefined;
  for (const entry of entries) {
    const snapshot = snapshotOf(entry);
    const { id, prevId } = snapshotSchema.parse(
      JSON.parse(readFileSync(path.join(folder, snapshot), "utf8")),
    );
    if (before === undefined) {
      if (prevId !== NOTHING_BEFORE_THE_FIRST) {
        return { ok: false, error: { kind: "chain-unrooted", snapshot } };
      }
    } else if (prevId !== before.id) {
      return {
        ok: false,
        error: { kind: "chain-broken", earlier: before.snapshot, later: snapshot },
      };
    }
    walked.push(snapshot);
    before = { snapshot, id };
  }
  return { ok: true, value: walked };
};

/**
 * The tracked `meta/` folder, held the same way. It answers the `Result` rather than throwing
 * on it as `journalEntries` does: nothing generates from this, so there is no script to stop —
 * its one reader is the suite that holds the folder, and a refusal it can assert on says which
 * file broke where a thrown sentence would have to be read out of a stack trace.
 */
export const journalSnapshots = (): Result<readonly string[], SnapshotRefusal> =>
  journalSnapshotsIn(metaFolder);

/** The migration the database is stamped with once the whole journal has been applied. */
export const lastMigration = (): JournalEntry => {
  const last = journalEntries().at(-1);
  if (last === undefined) throw new Error("the journal is empty");
  return last;
};
