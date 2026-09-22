import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

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

export const runWorkerOnce = async (
  connectionUri: string,
  bundleRoot: string,
  workerId: string,
): Promise<void> => {
  const outcome = await run("uv", ["run", "--frozen", "better-answers-worker", "--once"], {
    cwd: workerDirectory,
    env: {
      ...process.env,
      DATABASE_URL: workerDsn(connectionUri),
      GIT_STORE_DIR: bundleRoot,
      WORKER_ID: workerId,

      LMDB_DIR: path.join(bundleRoot, "lmdb"),
      S3_ENDPOINT: "http://objectstore.invalid:3900",
      S3_ACCESS_KEY: "key-under-test",
      S3_SECRET_KEY: "secret-under-test",
      S3_BUCKET: "better-answers",
      S3_REGION: "garage",
    },
  }).catch((cause: unknown) => {
    const failure = execFailure.safeParse(cause);
    const { message = "", stderr = "", stdout = "" } = failure.success ? failure.data : {};
    throw new Error(`the worker did not run: ${message}\n${stderr}\n${stdout}`);
  });

  expect(outcome.stderr).not.toMatch(/Traceback/);
};
