import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { expect } from "vitest";

/**
 * The **other tier as a real process**, for the two suites that need one: the rebuild
 * equivalence fence, which asserts that what the worker rebuilds equals what the app wrote,
 * and the budget test, which times the same rebuild against ADR 0032's two minutes. No
 * fixture stands between the tiers in either — that is the whole point of both — so the
 * worker is started the way the estate starts it and pointed at the suite's own stores.
 *
 * It became a helper the second time a suite wanted this footing, which is what the copy
 * gate asks for.
 */

const run = promisify(execFile);

const workerDirectory = path.resolve(import.meta.dirname, "../../../apps/worker");

/**
 * The worker's own DSN over a test's database: the superuser's connection with the worker's
 * role taken at session start. Both runtime roles are NOLOGIN (migration 0000), so this is
 * how a process takes one — the same trick `migratedPostgresOver` uses for `app_rt`, and
 * the reason it is a startup option is that a connection which cannot take the role is
 * refused by Postgres rather than handed out as the superuser.
 *
 * `WORKER_DATABASE_URL`'s production shape is a DSN that logs in as `worker_rt` directly
 * (`deploy/platform.compose.yaml`), so nothing here assumes the option is present: the
 * worker reads one string out of its environment and connects, whichever of the two it is.
 */
const workerDsn = (connectionUri: string): string => {
  const uri = new URL(connectionUri);
  // Written into `search` rather than through `searchParams`, which form-encodes a space
  // as `+` — and libpq reads `+` literally, so the option arrives as `+role` and the
  // connection is refused before the worker has done anything wrong.
  uri.search = "options=-c%20role%3Dworker_rt";
  return uri.toString();
};

/**
 * Run the worker once, over every workspace, and fail loudly if it is not runnable.
 *
 * `[CHECK2]`: a suite that can run nothing fails. If `uv` is missing this says so rather
 * than skipping — a cross-tier fence that quietly stops crossing is worse than no fence,
 * because the suite still reports green.
 *
 * The worker id is the caller's, so two suites' rows say which run claimed them.
 */
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
      // The whole bootstrap class, because the worker reads it whole before it claims
      // anything: the deploy unit hands the platform's own object store and the store
      // root to every worker process, so a harness that gave it less would be starting
      // a process no estate starts. Neither kind this call runs reaches either of them.
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
  // The loop logs JSON to stdout; a failed job is a line, never a non-zero exit, so a
  // caller reads a failure off the job's own outcome row rather than off the exit code.
  expect(outcome.stderr).not.toMatch(/Traceback/);
};
