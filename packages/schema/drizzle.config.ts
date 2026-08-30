import { defineConfig } from "drizzle-kit";

/**
 * Drizzle is the only migration owner, and it owns `public` alone (ADR 0007 and
 * its 27/08/2026 amendment): the app's own migrations own the DDL in `index` and
 * in the graph, and the worker never migrates anything.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "" },
});
