import { serve } from "@hono/node-server";
import { Pool } from "pg";

import { requireBootstrap } from "./config.ts";
import { logger } from "./logger.ts";
import { createServer } from "./server.ts";

const bootstrap = requireBootstrap("the app");
const database = new Pool({ connectionString: bootstrap.databaseUrl });

serve({ fetch: createServer({ database }).fetch, port: bootstrap.port }, (address) => {
  logger.info({ port: address.port }, "app listening");
});
