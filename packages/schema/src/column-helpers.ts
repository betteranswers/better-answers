import { timestamp } from "drizzle-orm/pg-core";

/**
 * The two column idioms every table file writes: a CHECK's quoted list, written from the
 * closed constant so the two cannot drift, and an instant in the one form the platform
 * stores one (`identity-tables.ts`). Shared here so two table files cannot disagree on
 * either; deliberately **not** re-exported from the package's entry point — they are how a
 * table is written, never what a boundary's caller needs.
 */

export const listed = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

export const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
