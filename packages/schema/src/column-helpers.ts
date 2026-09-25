import { timestamp } from "drizzle-orm/pg-core";

/**
 * The values as SQL string literals, comma-separated, for an `IN` list. Nothing is escaped, so
 * a value holding a quote breaks the statement.
 */
export const listed = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

export const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
