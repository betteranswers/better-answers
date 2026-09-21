import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { expect } from "vitest";

const run = promisify(execFile);

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
    const failure = cause as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `the worker did not run: ${failure.message ?? ""}\n${failure.stderr ?? ""}\n${failure.stdout ?? ""}`,
    );
  });

  expect(outcome.stderr).not.toMatch(/Traceback/);
};
