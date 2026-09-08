import { serve } from "@hono/node-server";
import { createTransport } from "nodemailer";
import { Pool } from "pg";

import { systemClock } from "@better-answers/core/kernel";

import { requireBootstrap, requireIdentityBootstrap } from "./config.ts";
import { logger } from "./logger.ts";
import { RECONCILER_INTERVAL_MS, startReconciler } from "./reconciler.ts";
import { createServer } from "./server.ts";

const bootstrap = requireBootstrap("the app");
const identity = requireIdentityBootstrap("the app");
const database = new Pool({ connectionString: bootstrap.databaseUrl });
// The one Clock this process holds, constructed once at boot and handed on explicitly to
// every act that reads time (ADR 0040) — never read ambiently past this line.
const clock = systemClock();

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
      clock,
    }).fetch,
    port: bootstrap.port,
  },
  (address) => {
    logger.info({ port: address.port }, "app listening");
  },
);

// The reconciler's trigger (ADR 0012, amended 2026-09-06): only where there are bundles
// to open. Without a root the process still serves — nothing in it writes a bundle either
// — and the line says so rather than leaving a silent gap in the recovery path.
if (bootstrap.gitStoreDir === undefined) {
  logger.warn("no repositories' root is configured (GIT_STORE_DIR): the head check is not running");
} else {
  startReconciler({ database, gitStoreDir: bootstrap.gitStoreDir, clock });
  logger.info({ interval_ms: RECONCILER_INTERVAL_MS }, "head check running");
}
