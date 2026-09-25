import { readFileSync } from "node:fs";

import type pg from "pg";

import { journalMigrationFiles } from "../src/journal.ts";

const SEPARATOR = "--> statement-breakpoint";

/**
 * The statements of the migration whose file name ends with `tag`, trimmed, blanks dropped.
 * @throws when no journal entry's file ends with `tag`.
 */
export const migrationStatements = (tag: string): readonly string[] => {
  const file = journalMigrationFiles().find((name) => name.endsWith(tag));
  if (file === undefined) throw new Error(`${tag} is not in the journal`);
  return readFileSync(file, "utf8")
    .split(SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
};

/**
 * The first statement of `tag`'s migration that contains `word`.
 * @throws when the journal has no `tag`, or no statement contains `word`.
 */
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
