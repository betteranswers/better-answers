import { serve } from "@hono/node-server";
import { Pool } from "pg";

import { requireBootstrap, requireIdentityBootstrap } from "./config.ts";
import { logger } from "./logger.ts";
import { createServer } from "./server.ts";

const bootstrap = requireBootstrap("the app");
const identity = requireIdentityBootstrap("the app");
const database = new Pool({ connectionString: bootstrap.databaseUrl });

/**
 * No email transport is wired yet: SMTP is a credential row under the envelope and
 * lands with the deploy task (T-005). Until then a code request fails loudly here
 * rather than writing a code anywhere a log could hold it (`[LOG1]`).
 */
const sendEmail = async (message: { readonly to: string }): Promise<void> => {
  logger.error({ to_domain: message.to.split("@")[1] ?? null }, "no email transport is configured");
  throw new Error("no email transport is configured");
};

serve(
  {
    fetch: createServer({
      database,
      publicUrl: identity.publicUrl,
      hostnames: identity.hostnames,
      authSecret: identity.authSecret,
      sendEmail,
    }).fetch,
    port: bootstrap.port,
  },
  (address) => {
    logger.info({ port: address.port }, "app listening");
  },
);
