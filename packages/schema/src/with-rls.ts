import { type BuildExtraConfigColumns, sql } from "drizzle-orm";
import {
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  pgPolicy,
  pgTable,
} from "drizzle-orm/pg-core";

/**
 * Every tenant table is created through this helper (`[DESIGN4]`, ADR 0032): RLS
 * enabled, one permissive policy for ALL commands whose predicate calls the one
 * migration-installed seam function. The call is written `(select
 * current_workspace_id())` — the InitPlan form — so a bulk statement pays the function
 * once, not once per row. `FORCE ROW LEVEL SECURITY` has no Drizzle API, so a table
 * created here also gets a hand-written `ALTER TABLE … FORCE ROW LEVEL SECURITY`
 * line in a custom migration — and the catalogue assertion in `test/rls.test.ts`
 * ("every tenant table") fails on any table whose FORCE line is missing, so the pair
 * is enforced, not remembered.
 *
 * A missing scope is an empty GUC is zero rows: the seam function returns NULL and no
 * row's tenant column equals NULL.
 */
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
      using: sql`${table[tenantColumn]} = (select current_workspace_id())`,
      withCheck: sql`${table[tenantColumn]} = (select current_workspace_id())`,
    }),
  ]).enableRLS();
