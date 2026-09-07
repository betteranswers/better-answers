import { timestamp } from "drizzle-orm/pg-core";

/**
 * The two column idioms every table file writes: a CHECK's quoted list, written from the
 * closed constant so the two cannot drift, and an instant in the one form the platform
 * stores one (`identity-tables.ts`).
 *
 * They live here rather than beside one of their callers because the concept write path,
 * the graph and the inbox each declare a tableful of them, and a second copy is a second
 * place a CHECK's quoting or a column's timezone could quietly differ. Deliberately **not**
 * re-exported from the package's entry point — they are how a table is written, never what
 * a boundary's caller needs.
 */

/** A closed word set as a CHECK's list: quoted, comma-separated, in the order declared. */
export const listed = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

/**
 * Every instant the platform stores, in the one form it stores one: with a timezone, read
 * back as a `Date` (`identity-tables.ts` sets the precedent Better Auth's own rows follow).
 */
export const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
