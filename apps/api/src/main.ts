import { setTimeout as delay } from "node:timers/promises";

import { serve } from "@hono/node-server";

import {
  readEnvelopeKey,
  readHeadCheck,
  readObjectStore,
  readSweeps,
  requireBootstrap,
  requireIdentityBootstrap,
  requireRunningImage,
  requireStop,
} from "./config.ts";
import { closeDoors, openDoors } from "./doors.ts";
import type { EmailSender } from "./email/email.ts";
import { emailSender, pacedTransport } from "./email/smtp.ts";
import { logger } from "./logger.ts";
import { senderAt } from "./product-name.ts";
import { createServer } from "./server.ts";
import { RECONCILER_INTERVAL_MS, startReconciler } from "./timers/reconciler.ts";
import { startSweeps, SWEEP_FIRST_PASS_MS, SWEEP_INTERVAL_MS } from "./timers/sweeps.ts";

const bootstrap = requireBootstrap("the api");
const identity = requireIdentityBootstrap("the api");
const image = requireRunningImage("the api");
const stopSettings = requireStop("the api");
const objectStore = readObjectStore();
const envelopeKey = readEnvelopeKey();
if (!envelopeKey.ok) {
  logger.warn({ reason: envelopeKey.error.message }, "no model will be called");
}

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

let stopping: Promise<never> | undefined;
const running: { stop(): Promise<void> }[] = [];
const sending = new Set<Promise<void>>();

const sendBySmtp = emailSender(
  identity.smtpUrl === undefined ? undefined : pacedTransport(identity.smtpUrl),
  senderAt(identity.hostnames.apex),
  logger,
);
const sendEmail: EmailSender = (message) => {
  const sent = sendBySmtp(message);
  const settled = (): void => void sending.delete(sent);
  sending.add(sent);
  void sent.then(settled, settled);
  return sent;
};

const app = createServer({
  doors,
  publicUrl: identity.publicUrl,
  hostnames: identity.hostnames,
  authSecret: identity.authSecret,
  sendEmail,
  webRoot: bootstrap.webRoot,
  imageDigest: image.digest,
  envelopeKey: envelopeKey.ok ? envelopeKey.value : undefined,
});

const server = serve(
  {
    fetch: async (request, bindings) => {
      const response = await app.fetch(request, bindings);
      if (stopping === undefined) return response;
      const closing = new Response(response.body, response);
      closing.headers.set("connection", "close");
      return closing;
    },
    port: bootstrap.port,
  },
  (address) => {
    logger.info({ port: address.port }, "api listening");
  },
);

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
  running.push(reconciler.value);
  logger.info(
    {
      interval_ms: RECONCILER_INTERVAL_MS,
      check_configured: headCheckSettings.pingUrl !== undefined,
    },
    "head check running",
  );
}

const sweepSettings = readSweeps();
if (!sweepSettings.ok) {
  logger.error({ reason: sweepSettings.error.message }, "the sweeps are not running");
} else {
  const { uploadSweep, pingUrl } = sweepSettings.value;
  const sweeps = startSweeps({ doors, settings: sweepSettings.value });
  if (!sweeps.ok) {
    logger.error({ reason: sweeps.error }, "the sweeps are not running");
  } else {
    running.push(sweeps.value);
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

const drain = async (): Promise<void> => {
  await Promise.all([
    new Promise((closed) => server.close(closed)),
    ...running.map((job) => job.stop()),
  ]);
  await Promise.allSettled(sending);
  await closeDoors(doors);
};

const stop = async (signal: NodeJS.Signals): Promise<never> => {
  logger.info({ signal }, "the api is stopping");
  const drained = await Promise.race([
    drain().then(() => true),
    delay(stopSettings.deadlineMs).then(() => false),
  ]);
  if (drained) {
    logger.info("the api has stopped");
  } else {
    logger.warn(
      { deadline_ms: stopSettings.deadlineMs },
      "the stop reached its deadline, so what was still open is cut",
    );
  }
  // A non-zero exit leaves a cut stop in `docker inspect`, not only in the log.
  process.exit(drained ? 0 : 1);
};

const stopOn = (signal: NodeJS.Signals): void => {
  stopping ??= stop(signal);
};
process.once("SIGTERM", stopOn);
process.once("SIGINT", stopOn);
