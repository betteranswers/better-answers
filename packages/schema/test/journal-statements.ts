import { readFileSync } from "node:fs";

import { journalMigrationFiles } from "../src/journal.ts";

const SEPARATOR = "--> statement-breakpoint";

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
