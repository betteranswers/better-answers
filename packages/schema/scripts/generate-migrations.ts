import { spawnSync } from "node:child_process";
import path from "node:path";

import { journalMetaFolder } from "../src/journal.ts";
import { restoreFinalNewline } from "./journal-newline.ts";

const packageRoot = path.resolve(import.meta.dirname, "..");

const { status, error } = spawnSync("drizzle-kit", ["generate", ...process.argv.slice(2)], {
  cwd: packageRoot,
  stdio: "inherit",
});

if (error !== undefined) throw error;
if (status !== 0) process.exit(status ?? 1);

restoreFinalNewline(journalMetaFolder);
