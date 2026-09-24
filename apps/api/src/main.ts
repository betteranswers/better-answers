import { serve } from "@hono/node-server";
import { createTransport } from "nodemailer";

import {
  readHeadCheck,
  readObjectStore,
  readSweeps,
  requireBootstrap,
  requireIdentityBootstrap,
  requireRunningImage,
} from "./config.ts";
import { openDoors } from "./doors.ts";
import { logger } from "./logger.ts";
import { RECONCILER_INTERVAL_MS, startReconciler } from "./reconciler.ts";
import { createServer } from "./server.ts";
import { startSweeps, SWEEP_FIRST_PASS_MS, SWEEP_INTERVAL_MS } from "./sweeps.ts";

const bootstrap = requireBootstrap("the api");
const identity = requireIdentityBootstrap("the api");
const image = requireRunningImage("the api");
const objectStore = readObjectStore();

const doors = openDoors({
  database: bootstrap.databaseUrl,
  gitStoreDir: bootstrap.gitStoreDir,
  objectStore: objectStore.ok ? objectStore.value : undefined,
});
if (doors.git?.ok === false) {
  logger.error(
    { reason: doors.git.error, git_store_dir: bootstrap.gitStoreDir },
    "the api cannot start: the head check's repositories' root was refused",
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
      imageDigest: image.digest,
    }).fetch,
    port: bootstrap.port,
  },
  (address) => {
    logger.info({ port: address.port }, "api listening");
  },
);

// A wrong setting leaves the head check running unwatched rather than stopping it; the scheduler
// check's silence tells the operator.
const headCheck = readHeadCheck();
if (!headCheck.ok) {
  logger.error({ reason: headCheck.error.message }, "the scheduler check will not be pinged");
}
const headCheckSettings = headCheck.ok ? headCheck.value : { pingUrl: undefined };
const reconciler = startReconciler({ doors, settings: headCheckSettings });
if (!reconciler.ok) {
  logger.warn(
    { reason: reconciler.error },
    "no repositories' root is configured (GIT_STORE_DIR): the head check is not running",
  );
} else {
  logger.info(
    {
      interval_ms: RECONCILER_INTERVAL_MS,
      check_configured: headCheckSettings.pingUrl !== undefined,
    },
    "head check running",
  );
}

// A wrong setting stops the sweeps and not the api; their check's silence tells the operator.
const sweepSettings = readSweeps();
if (!sweepSettings.ok) {
  logger.error({ reason: sweepSettings.error.message }, "the sweeps are not running");
} else {
  const { uploadSweep, pingUrl } = sweepSettings.value;
  const sweeps = startSweeps({ doors, settings: sweepSettings.value });
  if (!sweeps.ok) {
    logger.error({ reason: sweeps.error }, "the sweeps are not running");
  } else {
    logger.info(
      {
        interval_ms: SWEEP_INTERVAL_MS,
        first_pass_ms: SWEEP_FIRST_PASS_MS,
        upload_sweep: uploadSweep,
        check_configured: pingUrl !== undefined,
      },
      "sweeps running",
    );
  }
}
