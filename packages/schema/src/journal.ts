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
  entries: z.array(z.object({ tag: z.string() })),
});

export const journalEntries = (): readonly { readonly tag: string }[] =>
  journalSchema.parse(
    JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")),
  ).entries;

export const journalMigrationFiles = (): readonly string[] =>
  journalEntries().map((entry) => path.join(migrationsFolder, `${entry.tag}.sql`));

export const lastMigrationTag = (): string => {
  const last = journalEntries().at(-1);
  if (last === undefined) throw new Error("the journal is empty");
  return last.tag;
};
