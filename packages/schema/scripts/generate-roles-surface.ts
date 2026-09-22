import { writeFileSync } from "node:fs";

import { startMigratedPostgres } from "../test/harness.ts";
import {
  readRolesSurface,
  renderRolesSurface,
  rolesSurfacePath,
  withOneWorkspacePartition,
} from "./roles-surface.ts";

// CI never runs this; the drift test regenerates over a fresh database. A comparison of the
// file against itself is how that goes silently wrong.
const db = await startMigratedPostgres();
try {
  const client = await db.pool.connect();
  try {
    await withOneWorkspacePartition(client);
    writeFileSync(rolesSurfacePath, renderRolesSurface(await readRolesSurface(client)));
  } finally {
    client.release();
  }
} finally {
  await db.stop();
}
