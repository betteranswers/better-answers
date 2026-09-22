import { fileURLToPath } from "node:url";

export * from "./schema.ts";
export * from "./graph-tables.ts";
export * from "./index-tables.ts";
export * from "./counter-tables.ts";
export * from "./rls-exemptions.ts";
export * from "./table-ownership.ts";
export * from "./definer-reach.ts";
export * from "./postgres-image.ts";
export * from "./boundary-schemas.ts";
export * from "./roles.ts";
export * from "./ulid.ts";
export * from "./bundle-manifest.ts";

// fileURLToPath, never URL.pathname: a percent-encoded space would hand the migrator a
// directory that does not exist, and it would fail at deploy rather than here.
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
