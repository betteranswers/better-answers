import { spawnSync } from "node:child_process";
import path from "node:path";

import { migrationsFolder } from "../src/index.ts";
import { journalMetaFolder } from "../src/journal.ts";
import { foldSeparators } from "./fold-separators.ts";
import { restoreFinalNewline } from "./journal-newline.ts";

const packageRoot = path.resolve(import.meta.dirname, "..");

// No `--` before the extras: pnpm passes one through as an argument of its own, and
// drizzle-kit refuses it.
const { status, error } = spawnSync("drizzle-kit", ["generate", ...process.argv.slice(2)], {
  cwd: packageRoot,
  stdio: "inherit",
});

if (error !== undefined) throw error;
if (status !== 0) process.exit(status ?? 1);

restoreFinalNewline(journalMetaFolder);

for (const name of foldSeparators(migrationsFolder)) {
  process.stdout.write(`generate: folded the statement separators in ${name}\n`);
}
