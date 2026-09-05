import { serve } from "@hono/node-server";
import { createTransport } from "nodemailer";
import { Pool } from "pg";

import { requireBootstrap, requireIdentityBootstrap } from "./config.ts";
import { logger } from "./logger.ts";
import { createServer } from "./server.ts";

const bootstrap = requireBootstrap("the app");
const identity = requireIdentityBootstrap("the app");
const database = new Pool({ connectionString: bootstrap.databaseUrl });

type EmailMessage = { readonly to: string; readonly subject: string; readonly text: string };

/**
 * Without `SMTP_URL` — the dev loop, the test harness — a code request fails loudly
 * here rather than writing a code anywhere a log could hold it.
 */
const failWithoutTransport = async (message: EmailMessage): Promise<void> => {
  logger.error({ to_domain: message.to.split("@")[1] ?? null }, "no email transport is configured");
  throw new Error("no email transport is configured");
};

/**
 * The from address is derived from the apex rather than declared, the way `app.` is
 * derived from `PUBLIC_URL` (T-039): the apex is the domain the mail provider verified,
 * and a second declaration could only disagree with it.
 */
const sendOverSmtp = (smtpUrl: string): ((message: EmailMessage) => Promise<void>) => {
  const transport = createTransport(smtpUrl);
  const from = `Better Answers <no-reply@${identity.hostnames.apex}>`;
  return async (message) => {
    await transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    logger.info({ to_domain: message.to.split("@")[1] ?? null }, "sign-in email sent");
  };
};

const sendEmail =
  identity.smtpUrl === undefined ? failWithoutTransport : sendOverSmtp(identity.smtpUrl);

serve(
  {
    fetch: createServer({
      database,
      publicUrl: identity.publicUrl,
      hostnames: identity.hostnames,
      authSecret: identity.authSecret,
      sendEmail,
      webRoot: bootstrap.webRoot,
    }).fetch,
    port: bootstrap.port,
  },
  (address) => {
    logger.info({ port: address.port }, "app listening");
  },
);
