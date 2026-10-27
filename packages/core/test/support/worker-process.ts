import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import pg from "pg";
import { expect } from "vitest";
import { z } from "zod";

import { CONTRACT_DIGEST, STAMP_THE_CONTRACT } from "@better-answers/schema";

const run = promisify(execFile);

/** What `execFile` hangs on its rejection: the spawn's streams and the error's own line. */
const execFailure = z.object({
  stderr: z.string().optional(),
  stdout: z.string().optional(),
  message: z.string().optional(),
});

const workerDirectory = path.resolve(import.meta.dirname, "../../../../apps/worker");

const workerDsn = (connectionUri: string): string => {
  const uri = new URL(connectionUri);

  uri.search = "options=-c%20role%3Dworker_rt";
  return uri.toString();
};

const stampTheContract = async (connectionUri: string): Promise<void> => {
  const client = new pg.Client({ connectionString: connectionUri });
  await client.connect();
  try {
    await client.query(STAMP_THE_CONTRACT, [CONTRACT_DIGEST]);
  } finally {
    await client.end();
  }
};

export type WorkerObjectStore = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

const AN_UNREACHABLE_STORE: WorkerObjectStore = {
  endpoint: "http://objectstore.invalid:3900",
  bucket: "better-answers",
  region: "garage",
  accessKeyId: "key-under-test",
  secretAccessKey: "secret-under-test",
};

export const lmdbRootUnder = (bundleRoot: string): string => path.join(bundleRoot, "lmdb");

export const runWorkerOnce = async (
  connectionUri: string,
  bundleRoot: string,
  workerId: string,
  objects: WorkerObjectStore = AN_UNREACHABLE_STORE,
): Promise<void> => {
  await stampTheContract(connectionUri);

  const outcome = await run("uv", ["run", "--frozen", "better-answers-worker", "--once"], {
    cwd: workerDirectory,
    env: {
      ...process.env,
      DATABASE_URL: workerDsn(connectionUri),
      GIT_STORE_DIR: bundleRoot,
      WORKER_ID: workerId,

      LMDB_DIR: lmdbRootUnder(bundleRoot),
      S3_ENDPOINT: objects.endpoint,
      S3_ACCESS_KEY: objects.accessKeyId,
      S3_SECRET_KEY: objects.secretAccessKey,
      S3_BUCKET: objects.bucket,
      S3_REGION: objects.region,
    },
  }).catch((cause: unknown) => {
    const failure = execFailure.safeParse(cause);
    const { message = "", stderr = "", stdout = "" } = failure.success ? failure.data : {};
    throw new Error(`the worker did not run: ${message}\n${stderr}\n${stdout}`);
  });

  expect(outcome.stderr).not.toMatch(/Traceback/);
  const errors = errorsLoggedIn(outcome.stdout);
  if (errors.length > 0) {
    throw new Error(`the worker logged an error: ${errors.join("; ")}\n${outcome.stdout}`);
  }
};

/** The engine logs a component's exception on stdout and carries on, so the pass exits 0. */
const errorLine = z.object({ level: z.literal("error"), event: z.string() });

const errorsLoggedIn = (stdout: string): readonly string[] =>
  stdout.split("\n").flatMap((line) => {
    if (!line.startsWith("{")) return [];
    const read = errorLine.safeParse(JSON.parse(line));
    return read.success ? [read.data.event] : [];
  });
