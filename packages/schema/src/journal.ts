import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { byCodeUnit } from "./code-unit.ts";
import { migrationsFolder } from "./migrations-folder.ts";

export const journalMetaFolder = path.join(migrationsFolder, "meta");

const journalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string(), when: z.number().int() })),
});

export type JournalEntry = { readonly idx: number; readonly tag: string; readonly when: number };

export type JournalRefusal = { readonly earlier: JournalEntry; readonly later: JournalEntry };

type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

type JournalDocument = z.input<typeof journalSchema>;

/**
 * Refuses the first entry whose instant does not follow the one before it.
 * @throws when the document is not a journal.
 */
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

/** @throws when the journal does not parse, or an instant does not increase. */
export const journalEntries = (): readonly JournalEntry[] => entriesIn(journalMetaFolder);

/** Absolute paths, in the journal's order. */
export const journalMigrationFiles = (): readonly string[] =>
  journalEntries().map((entry) => path.join(migrationsFolder, `${entry.tag}.sql`));

const snapshotSchema = z.object({ id: z.string(), prevId: z.string() });

const NOTHING_BEFORE_THE_FIRST = "00000000-0000-0000-0000-000000000000";

const snapshotOf = (entry: JournalEntry): string =>
  `${String(entry.idx).padStart(4, "0")}_snapshot.json`;

export type SnapshotRefusal =
  | { readonly kind: "snapshot-missing"; readonly tag: string; readonly snapshot: string }
  | { readonly kind: "snapshot-orphaned"; readonly snapshot: string }
  | { readonly kind: "chain-broken"; readonly earlier: string; readonly later: string }
  | { readonly kind: "chain-unrooted"; readonly snapshot: string };

const unpairedIn = (
  folder: string,
  entries: readonly JournalEntry[],
): SnapshotRefusal | undefined => {
  const named = new Set(entries.map(snapshotOf));

  for (const entry of entries) {
    const snapshot = snapshotOf(entry);
    if (!existsSync(path.join(folder, snapshot))) {
      return { kind: "snapshot-missing", tag: entry.tag, snapshot };
    }
  }
  for (const snapshot of readdirSync(folder).toSorted(byCodeUnit)) {
    if (snapshot.endsWith("_snapshot.json") && !named.has(snapshot)) {
      return { kind: "snapshot-orphaned", snapshot };
    }
  }
  return undefined;
};

const chainIn = (
  folder: string,
  entries: readonly JournalEntry[],
): Result<readonly string[], SnapshotRefusal> => {
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
 * The snapshots in the journal's order, once each entry has one, each snapshot has an entry,
 * and each names the one before as its parent. Otherwise the first refusal, checked in that
 * order.
 * @throws when the journal or a snapshot does not parse, or an instant does not increase.
 */
export const journalSnapshotsIn = (folder: string): Result<readonly string[], SnapshotRefusal> => {
  const entries = entriesIn(folder);
  const unpaired = unpairedIn(folder, entries);
  return unpaired === undefined ? chainIn(folder, entries) : { ok: false, error: unpaired };
};

export const journalSnapshots = (): Result<readonly string[], SnapshotRefusal> =>
  journalSnapshotsIn(journalMetaFolder);

/** @throws when the journal is empty. */
export const lastMigration = (): JournalEntry => {
  const last = journalEntries().at(-1);
  if (last === undefined) throw new Error("the journal is empty");
  return last;
};
