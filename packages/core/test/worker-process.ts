import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { CONTRACT_DIGEST, STAMP_THE_CONTRACT } from "@better-answers/schema";
import pg from "pg";
import { expect } from "vitest";
import { z } from "zod";

const run = promisify(execFile);

// What `execFile` hangs on its rejection: the spawn's streams and the error's own line.
const execFailure = z.object({
  stderr: z.string().optional(),
  stdout: z.string().optional(),
  message: z.string().optional(),
});

const workerDirectory = path.resolve(import.meta.dirname, "../../../apps/worker");

const workerDsn = (connectionUri: string): string => {
  const uri = new URL(connectionUri);

  uri.search = "options=-c%20role%3Dworker_rt";
  return uri.toString();
};

// The deploy order in a fixture. As the owner, not through `workerDsn`: the worker is refused
// this write.
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

// A suite whose jobs read no original still has to give the worker a bucket to open.
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
};
