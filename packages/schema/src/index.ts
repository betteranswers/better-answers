export * from "./schema.ts";

/**
 * Where the generated SQL lives. The schema is defined here and the migrations are
 * *applied by the app* (ADR 0007), so the app's entry point needs this path and
 * nothing else from this package.
 */
export const migrationsFolder = new URL("../migrations", import.meta.url).pathname;
