import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startMigratedPostgres } from "../test/harness.ts";
import { assertNoUndeclaredTables, introspect, renderWorkerSchemaView } from "./worker-view.ts";

/**
 * `pnpm --filter @better-answers/schema run generate:worker-view` — runs the journal
 * against a throwaway Postgres (the pinned image) and writes the worker's committed
 * schema view. CI never runs this; it regenerates in the drift test and fails on any
 * difference, so a schema PR that forgets this step cannot merge.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const journalPath = path.resolve(here, "../migrations/meta/_journal.json");
const viewPath = path.resolve(
  here,
  "../../../apps/worker/src/better_answers_worker/schema_view.py",
);

type Journal = { readonly entries: readonly { readonly tag: string }[] };
// SAFETY: the journal is drizzle-kit's own artefact in this repository; a malformed
// one fails on the very next line, which is the failure we want.
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
const migrationId = journal.entries.at(-1)?.tag;
if (migrationId === undefined) throw new Error("the journal is empty");

const db = await startMigratedPostgres();
try {
  const rows = await introspect(db.pool);
  assertNoUndeclaredTables(rows);
  writeFileSync(viewPath, renderWorkerSchemaView(rows, migrationId));
} finally {
  await db.stop();
}
