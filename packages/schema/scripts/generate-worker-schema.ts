import { writeFileSync } from "node:fs";
import path from "node:path";

import { rootsOf } from "@better-answers/schema/testing/roots";

import { lastMigration } from "../src/journal.ts";
import { startMigratedPostgres } from "../test/support/harness.ts";
import { assertNoUndeclaredTables, introspect, renderWorkerSchemaView } from "./worker-view.ts";

const { repositoryRoot } = rootsOf(import.meta.url);

const viewPath = path.join(repositoryRoot, "apps/worker/src/better_answers_worker/schema_view.py");

const migration = lastMigration();

const db = await startMigratedPostgres();
try {
  const rows = await introspect(db.pool);
  assertNoUndeclaredTables(rows);
  writeFileSync(viewPath, renderWorkerSchemaView(rows, migration));
} finally {
  await db.stop();
}
