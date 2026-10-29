import { spawnSync } from "node:child_process";

import { journalMetaFolder } from "../src/journal.ts";
import { migrationsFolder } from "../src/migrations-folder.ts";
import { workspaceRoot } from "../test/support/roots/roots.ts";
import { foldSeparators } from "./fold-separators.ts";
import { restoreFinalNewline } from "./journal-newline.ts";

const { status, error } = spawnSync(
  "drizzle-kit",
  // No `--` before the extras: pnpm passes one through as an argument of its own, and
  // drizzle-kit refuses it.
  ["generate", ...process.argv.slice(2)],
  { cwd: workspaceRoot, stdio: "inherit" },
);

if (error !== undefined) throw error;
if (status !== 0) process.exit(status ?? 1);

restoreFinalNewline(journalMetaFolder);

for (const name of foldSeparators(migrationsFolder)) {
  process.stdout.write(`generate: folded the statement separators in ${name}\n`);
}
