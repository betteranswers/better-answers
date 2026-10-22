import { sql } from "drizzle-orm";
import { check, integer, text, timestamp } from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN } from "./actor-id.ts";

export const listed = (values: readonly string[]): string =>
  values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");

export const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const versionColumns = () => ({
  version: integer("version").notNull(),
  actor: text("actor").notNull(),
  at: stamp("at").notNull().defaultNow(),
  note: text("note"),
});

export const versionChecks = (tableName: string) => [
  check(`${tableName}_version_check`, sql.raw("version >= 1")),
  check(`${tableName}_actor_check`, sql.raw(`actor ~ '^${ACTOR_ID_PATTERN}$'`)),
];
