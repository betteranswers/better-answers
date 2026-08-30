import { serve } from "@hono/node-server";
import { Pool } from "pg";

import { readBootstrap } from "./config.ts";
import { logger } from "./logger.ts";
import { createServer } from "./server.ts";

const bootstrap = readBootstrap();
if (!bootstrap.ok) {
  logger.error({ reason: bootstrap.error.message }, "app cannot start");
  process.exit(1);
}

const database = new Pool({ connectionString: bootstrap.value.databaseUrl });

serve({ fetch: createServer({ database }).fetch, port: bootstrap.value.port }, (address) => {
  logger.info({ port: address.port }, "app listening");
});
