import { defineConfig } from "drizzle-kit";

/**
 * Drizzle is the only migration owner, and it owns `public` alone (ADR 0007 and its
 * 27/08/2026 amendment): the app's own migrations own the DDL in `index` and in the
 * graph, and the worker never migrates anything.
 *
 * There are no `dbCredentials` here because this config exists for `generate` alone —
 * it reads `src/schema.ts` and writes SQL. Migrations are *applied* by the app
 * (`apps/api/src/migrate.ts`), which reads the database URL through its typed config module
 * (§ TYPES); `drizzle-kit push` is never run against an estate, because migrations are
 * forward-only and a rollback is the previous image digest (`[OPS1]`).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  schemaFilter: ["public"],
});
