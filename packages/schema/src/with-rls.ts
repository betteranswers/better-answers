import { type BuildExtraConfigColumns, sql } from "drizzle-orm";
import {
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  pgPolicy,
  pgTable,
} from "drizzle-orm/pg-core";

export const withRLS = <TName extends string, TColumns extends Record<string, PgColumnBuilderBase>>(
  name: TName,
  columns: TColumns,
  tenantColumn: keyof TColumns & string,
  extraConfig?: (
    table: BuildExtraConfigColumns<TName, TColumns, "pg">,
  ) => PgTableExtraConfigValue[],
) =>
  pgTable(name, columns, (table) => [
    ...(extraConfig?.(table) ?? []),
    pgPolicy(`${name}_workspace_isolation`, {
      as: "permissive",
      for: "all",
      // Wrapped in a select so a bulk statement pays the seam function once, not once per row.
      using: sql`${table[tenantColumn]} = (select current_workspace_id())`,
      withCheck: sql`${table[tenantColumn]} = (select current_workspace_id())`,
    }),
  ]).enableRLS();
