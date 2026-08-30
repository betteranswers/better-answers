import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { attempt } from "@better-answers/contracts";
import { migrationsFolder } from "@better-answers/schema";

import { readBootstrap } from "./config.ts";
import { logger } from "./logger.ts";

/**
 * The `migrate` one-shot of the platform stack: it runs to completion before `app`
 * starts, and `app` before `worker` (ADR 0007's deploy order). Migrations are
 * forward-only — a rollback is the previous image digest (`[OPS1]`, ADR 0022).
 */
const bootstrap = readBootstrap();
if (!bootstrap.ok) {
  logger.error({ reason: bootstrap.error.message }, "migrations cannot run");
  process.exit(1);
}

const database = drizzle(bootstrap.value.databaseUrl);
const applied = await attempt(async () => {
  await migrate(database, { migrationsFolder });
  await database.$client.end();
});

if (!applied.ok) {
  logger.error({ reason: applied.error.message }, "migrations failed");
  process.exit(1);
}

logger.info("migrations applied");
