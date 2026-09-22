import { serve } from "@hono/node-server";
import { createTransport } from "nodemailer";

import { readObjectStore, requireBootstrap, requireIdentityBootstrap } from "./config.ts";
import { openDoors } from "./doors.ts";
import { logger } from "./logger.ts";
import { RECONCILER_INTERVAL_MS, startReconciler } from "./reconciler.ts";
import { createServer } from "./server.ts";

const bootstrap = requireBootstrap("the app");
const identity = requireIdentityBootstrap("the app");
const objectStore = readObjectStore();

const doors = openDoors({
  database: bootstrap.databaseUrl,
  gitStoreDir: bootstrap.gitStoreDir,
  objectStore: objectStore.ok ? objectStore.value : undefined,
});
if (doors.git?.ok === false) {
  logger.error(
    { reason: doors.git.error, git_store_dir: bootstrap.gitStoreDir },
    "the app cannot start: the head check's repositories' root was refused",
  );
  process.exit(1);
}

type EmailMessage = { readonly to: string; readonly subject: string; readonly text: string };

const failWithoutTransport = async (message: EmailMessage): Promise<void> => {
  logger.error({ to_domain: message.to.split("@")[1] ?? null }, "no email transport is configured");
  throw new Error("no email transport is configured");
};

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
      doors,
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

const reconciler = startReconciler({ doors });
if (!reconciler.ok) {
  logger.warn(
    { reason: reconciler.error },
    "no repositories' root is configured (GIT_STORE_DIR): the head check is not running",
  );
} else {
  logger.info({ interval_ms: RECONCILER_INTERVAL_MS }, "head check running");
}
