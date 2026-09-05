import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { getTableConfig } from "drizzle-orm/pg-core";
import type pg from "pg";

import * as publicEntry from "../src/index.ts";

/**
 * The worker's view of the schema, generated and committed (ADR 0032): these
 * functions run the journal's result through `pg_catalog` and render the Python
 * module the worker imports, carrying the migration id (the worker's schema stamp). The drift
 * test regenerates and fails in both directions — a stale committed view, and any
 * table in the migrated database the declarations do not know (a hand-written
 * migration that added a table `src/` never declared).
 */

export type ColumnRow = {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly type: string;
  readonly notNull: boolean;
};

/** Every table the migrated database holds, partitions excluded. */
export const introspect = async (client: pg.Pool | pg.PoolClient): Promise<ColumnRow[]> => {
  const result = await client.query(
    String.raw`SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'index') AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped AND c.relname NOT LIKE 'chunk\_%'
      ORDER BY n.nspname, c.relname, a.attnum`,
  );
  return result.rows.map((row) => ({
    schema: String(row.schema),
    table: String(row.table),
    column: String(row.column),
    type: String(row.type),
    notNull: Boolean(row.not_null),
  }));
};

/** The tables `src/` declares — the set the migrated database must not exceed. */
export const declaredTableNames = (): Set<string> => {
  const names = new Set<string>();
  for (const value of Object.values(publicEntry)) {
    if (is(value, PgTable)) {
      const { schema } = getTableConfig(value);
      names.add(`${schema ?? "public"}.${getTableName(value)}`);
    }
  }
  return names;
};

/** Fails on the table the declarations do not know — drift's second direction. */
export const assertNoUndeclaredTables = (rows: readonly ColumnRow[]): void => {
  const declared = declaredTableNames();
  const undeclared = [...new Set(rows.map((row) => `${row.schema}.${row.table}`))].filter(
    (name) => !declared.has(name),
  );
  if (undeclared.length > 0) {
    throw new Error(
      `the migrated database holds tables src/ never declared: ${undeclared.join(", ")} — ` +
        "declare them (and their boundary schemas) or remove the hand-written DDL",
    );
  }
};

/** Renders the committed Python module — ruff-format-stable by construction. */
export const renderWorkerSchemaView = (rows: readonly ColumnRow[], migrationId: string): string => {
  const byTable = new Map<string, ColumnRow[]>();
  for (const row of rows) {
    const key = `${row.schema}.${row.table}`;
    byTable.set(key, [...(byTable.get(key) ?? []), row]);
  }

  const lines: string[] = [
    '"""The worker\'s view of the schema — generated, never edited (ADR 0032).',
    "",
    "Regenerate with `pnpm --filter @better-answers/schema run generate:worker-view`;",
    "the drift test fails CI when this file and the journal disagree in either",
    "direction. The worker never migrates; this module is its read-only",
    "knowledge of what the app's journal built, stamped with the migration id it was",
    'generated from."""',
    "",
    `MIGRATION_ID = "${migrationId}"`,
    "",
    "TABLES: dict[str, dict[str, str]] = {",
  ];
  for (const [name, columns] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`    "${name}": {`);
    for (const column of columns) {
      lines.push(
        `        "${column.column}": "${column.type}${column.notNull ? " NOT NULL" : ""}",`,
      );
    }
    lines.push("    },");
  }
  lines.push("}", "");
  return lines.join("\n");
};
