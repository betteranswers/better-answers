import { fileURLToPath } from "node:url";

export * from "./schema.ts";
export * from "./index-tables.ts";
export * from "./counter-tables.ts";
export * from "./postgres-image.ts";
export * from "./boundary-schemas.ts";
export * from "./roles.ts";

/**
 * Where the generated SQL lives. The schema is defined here and the migrations are
 * *applied by the app* (ADR 0007), so the app's entry point needs this path and
 * nothing else from this package.
 *
 * `fileURLToPath`, not `URL.pathname`: a URL percent-encodes, so a checkout or an image
 * layer whose path contains a space would hand the migrator a directory that does not
 * exist — and it would fail in the `migrate` one-shot at deploy, not here.
 */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
