import { timestamp } from "drizzle-orm/pg-core";

export const listed = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

export const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
