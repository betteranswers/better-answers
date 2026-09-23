import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { attempt } from "@better-answers/core/kernel";
import {
  CONTRACT_DIGEST,
  MARK_THE_MATCH_LEAKPROOF,
  migrationsFolder,
  STAMP_THE_CONTRACT,
} from "@better-answers/schema";

import { requireBootstrap } from "./config.ts";
import { logger } from "./logger.ts";

const bootstrap = requireBootstrap("migrations");
const database = drizzle(bootstrap.databaseUrl);

const applied = await attempt(async () => {
  await migrate(database, { migrationsFolder });
  await database.$client.query(MARK_THE_MATCH_LEAKPROOF);
  // After the journal, because the stamp writes to a table a migration creates.
  await database.$client.query(STAMP_THE_CONTRACT, [CONTRACT_DIGEST]);
  await database.$client.end();
});

if (!applied.ok) {
  logger.error({ reason: applied.error.message }, "migrations failed");
  process.exit(1);
}

logger.info({ contractDigest: CONTRACT_DIGEST }, "migrations applied");
