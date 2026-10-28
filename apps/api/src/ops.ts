import { writeFile } from "node:fs/promises";
import { text } from "node:stream/consumers";

import { err, ok } from "@better-answers/core/kernel";
import { openModelKeySetting } from "@better-answers/core/llm";

import {
  readEnvelopeKey,
  readIdentityBootstrap,
  readObjectStore,
  requireBootstrap,
} from "./config.ts";
import { closeDoors, openDoors } from "./doors.ts";
import { emailSender, pacedTransport } from "./email/smtp.ts";
import { logger } from "./logger.ts";
import { fetchHonouringHost } from "./ops/http-fetch.ts";
import { runOps } from "./ops/index.ts";
import { readTreeUnder } from "./ops/read-tree.ts";
import { senderAt } from "./product-name.ts";

const bootstrap = requireBootstrap("pnpm ops");
const identity = readIdentityBootstrap();
const objectStore = readObjectStore();
const envelopeKey = readEnvelopeKey();

const mail =
  identity.ok && identity.value.smtpUrl !== undefined
    ? {
        send: emailSender(
          pacedTransport(identity.value.smtpUrl),
          senderAt(identity.value.hostnames.apex),
          logger,
        ),
        publicUrl: identity.value.publicUrl,
      }
    : undefined;

const doors = openDoors({
  database: bootstrap.databaseUrl,
  gitStoreDir: bootstrap.gitStoreDir,
  objectStore: objectStore.ok ? objectStore.value : undefined,
});

const stdin = (): Promise<string> => text(process.stdin);

let exitCode: number;
try {
  exitCode = await runOps(process.argv.slice(2), doors, {
    fetch: fetchHonouringHost,
    stdin,
    say: (line) => {
      process.stdout.write(`${line}\n`);
    },
    logger,
    appHostname: identity.ok ? identity.value.hostnames.app : undefined,

    writeReport: async (path, body) => {
      await writeFile(path, body, "utf8");
    },

    readTree: readTreeUnder,
    mail,
    modelKeySetting: envelopeKey.ok
      ? ok(openModelKeySetting(envelopeKey.value))
      : err(envelopeKey.error.message),
  });
} finally {
  await closeDoors(doors);
}

process.exit(exitCode);
