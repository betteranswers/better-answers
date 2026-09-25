import { fileURLToPath } from "node:url";

/**
 * fileURLToPath, never URL.pathname: a percent-encoded space would hand the migrator a
 * directory that does not exist, and it would fail at deploy rather than here.
 */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
