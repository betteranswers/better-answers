import { spawnSync } from "node:child_process";
import path from "node:path";

import { journalMetaFolder } from "../src/journal.ts";
import { restoreFinalNewline } from "./journal-newline.ts";

/**
 * `pnpm --filter @better-answers/schema run generate [--custom --name=…]` — drizzle-kit's own
 * `generate`, with whatever was asked of it handed straight through, and the journal's final
 * newline put back the moment it returns (`scripts/journal-newline.ts`).
 *
 * It is a script rather than a `drizzle-kit generate && node …` pair because pnpm appends a
 * run's extra arguments to the end of the command line, so the pair would hand `--custom` and
 * `--name=…` to the fixer and never to the tool. They are appended bare, with no `--` before
 * them — pnpm passes a `--` through as an argument of its own and drizzle-kit refuses it. The
 * binary is found on `PATH`, where pnpm puts `node_modules/.bin` for a manifest script, as the
 * root `check` runner finds `pnpm`.
 *
 * A failed run exits with the tool's own status and leaves the journal untouched: whatever it
 * wrote before it failed is the tool's to answer for, and a fixer that tidied the wreckage
 * would make a half-written journal harder to read, not easier.
 */

const packageRoot = path.resolve(import.meta.dirname, "..");

const { status, error } = spawnSync("drizzle-kit", ["generate", ...process.argv.slice(2)], {
  cwd: packageRoot,
  stdio: "inherit",
});

if (error !== undefined) throw error;
if (status !== 0) process.exit(status ?? 1);

restoreFinalNewline(journalMetaFolder);
