import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type pg from "pg";
import { z } from "zod";

import { migrationsFolder } from "../../src/index.ts";
import { journalEntries, journalMetaFolder, journalMigrationFiles } from "../../src/journal.ts";

const SEPARATOR = "--> statement-breakpoint";

const JOURNAL_KEPT_WHOLE = z.looseObject({
  entries: z.array(z.looseObject({ tag: z.string() })),
});

export const migrationsFolderEndingAt = (tag: string): string => {
  const journal = JOURNAL_KEPT_WHOLE.parse(
    JSON.parse(readFileSync(path.join(journalMetaFolder, "_journal.json"), "utf8")),
  );
  const last = journal.entries.findIndex((entry) => entry.tag === tag);
  if (last === -1) throw new Error(`${tag} is not in the journal`);
  const entries = journal.entries.slice(0, last + 1);
  const folder = mkdtempSync(path.join(tmpdir(), "migrations-until-"));
  mkdirSync(path.join(folder, "meta"));
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries) {
    cpSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  return folder;
};

export const migrationsFolderBefore = (tag: string): string => {
  const entries = journalEntries();
  const previous = entries[entries.findIndex((entry) => entry.tag === tag) - 1];
  if (previous === undefined) throw new Error(`nothing in the journal comes before ${tag}`);
  return migrationsFolderEndingAt(previous.tag);
};

export const migrationStatements = (tag: string): readonly string[] => {
  const file = journalMigrationFiles().find((name) => name.endsWith(tag));
  if (file === undefined) throw new Error(`${tag} is not in the journal`);
  return readFileSync(file, "utf8")
    .split(SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
};

export const migrationStatementSaying = (tag: string, word: string): string => {
  const statement = migrationStatements(tag).find((part) => part.includes(word));
  if (statement === undefined) throw new Error(`no statement of ${tag} says ${word}`);
  return statement;
};

const THE_MIGRATION_OWNER = "the_migration_owner";

/**
 * Runs `work` as a new non-superuser owner of `objects`, as `migrate` connects, so the policies a
 * superuser escapes bind it. Only inside a transaction.
 */
export const asTheMigrationOwnerOf = async <T>(
  client: pg.PoolClient,
  objects: readonly string[],
  work: () => Promise<T>,
): Promise<T> => {
  await client.query(`CREATE ROLE ${THE_MIGRATION_OWNER} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  for (const object of [
    ...objects,
    "TABLE public.workspace",
    "FUNCTION public.current_workspace_id()",
  ]) {
    await client.query(`ALTER ${object} OWNER TO ${THE_MIGRATION_OWNER}`);
  }
  await client.query(`SET LOCAL ROLE ${THE_MIGRATION_OWNER}`);
  const done = await work();
  await client.query("RESET ROLE");
  return done;
};
