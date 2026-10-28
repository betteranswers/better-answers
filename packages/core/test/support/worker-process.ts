import { type ChildProcess, execFile, spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

import pg from "pg";
import { afterAll, expect } from "vitest";
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

const workerEnvironment = (
  connectionUri: string,
  bundleRoot: string,
  workerId: string,
  objects: WorkerObjectStore,
): NodeJS.ProcessEnv => ({
  ...process.env,
  DATABASE_URL: workerDsn(connectionUri),
  GIT_STORE_DIR: bundleRoot,
  WORKER_ID: workerId,

  HF_HUB_OFFLINE: "1",
  LMDB_DIR: lmdbRootUnder(bundleRoot),
  S3_ENDPOINT: objects.endpoint,
  S3_ACCESS_KEY: objects.accessKeyId,
  S3_SECRET_KEY: objects.secretAccessKey,
  S3_BUCKET: objects.bucket,
  S3_REGION: objects.region,
});

const THE_DETECTORS_WEIGHTS_CACHED = `
import sys
from better_answers_worker.redaction.weights import WEIGHTS, carried_repositories, fetch
try:
    carried_repositories()
except Exception:
    try:
        fetch()
        carried_repositories()
    except Exception as failure:
        sys.exit(f"{', '.join(WEIGHTS)}, or the encoder it names, is missing from the Hugging Face cache and did not download: {failure}")
`;

let detectorsWeights: Promise<void> | undefined;

const detectorsWeightsCached = (): Promise<void> =>
  (detectorsWeights ??= run(
    "uv",
    ["run", "--frozen", "python", "-c", THE_DETECTORS_WEIGHTS_CACHED],
    {
      cwd: workerDirectory,
      maxBuffer: Number.POSITIVE_INFINITY,
    },
  ).then(
    () => undefined,
    (cause: unknown) => {
      const failure = execFailure.safeParse(cause);
      const { stderr = "" } = failure.success ? failure.data : {};
      throw new Error(`the worker cannot detect offline: ${stderr}`);
    },
  ));

export const runWorkerOnce = async (
  connectionUri: string,
  bundleRoot: string,
  workerId: string,
  objects: WorkerObjectStore = AN_UNREACHABLE_STORE,
): Promise<void> => {
  await detectorsWeightsCached();
  await stampTheContract(connectionUri);

  const outcome = await run("uv", ["run", "--frozen", "better-answers-worker", "--once"], {
    cwd: workerDirectory,
    env: workerEnvironment(connectionUri, bundleRoot, workerId, objects),
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

const jsonOrNothing = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

const errorsLoggedIn = (stdout: string): readonly string[] =>
  stdout.split("\n").flatMap((line) => {
    if (!line.startsWith("{")) return [];
    const read = errorLine.safeParse(jsonOrNothing(line));
    return read.success ? [read.data.event] : [];
  });

const A_STAMP_THAT_MATCHES = "matches";

const saysTickDone = z.object({ event: z.literal("tick done") });

const tickDone = saysTickDone.extend({
  schema_stamp: z.string(),
  contract_stamp: z.string(),
});

type Answer = {
  readonly logged: string;
  readonly raised: string;
  readonly stamps: readonly string[];
};

type Waiting = {
  readonly answer: (answer: Answer) => void;
  readonly fail: (failure: Error) => void;
};

const STOP_GRACE_MS = 30_000;

const A_TICK_ALLOWANCE_MS = 120_000;

type TickingWorker = {
  readonly tick: () => Promise<void>;
};

type Where = {
  readonly connectionUri: string;
  readonly bundleRoot: string;
  readonly objects: WorkerObjectStore;
};

/** macOS answers EPERM, not ESRCH, while a killed group's last member is still exiting. */
const A_GONE_GROUPS_ANSWERS = ["ESRCH", "EPERM"] as const;

const aGroupAlreadyGone = z.object({ code: z.enum(A_GONE_GROUPS_ANSWERS) });

/** `uv run` keeps the worker as its child, so a kill must reach the process group. */
const killTheGroup = (child: ChildProcess): void => {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (cause) {
    if (!aGroupAlreadyGone.safeParse(cause).success) throw cause;
  }
};

const startTickingWorker = (workerId: string, where: Where) => {
  const child = spawn("uv", ["run", "--frozen", "better-answers-worker", "--ticks"], {
    cwd: workerDirectory,
    env: workerEnvironment(where.connectionUri, where.bundleRoot, workerId, where.objects),
    detached: true,
  });
  let stderr = "";
  let gone: Error | undefined;
  const heard: string[] = [];
  const waiting: Waiting[] = [];

  const end = (reason: string): void => {
    gone ??= new Error(`the worker ${workerId} ${reason}\n${stderr}`);
    killTheGroup(child);
    for (const { fail } of waiting.splice(0)) fail(gone);
  };

  const ended = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      // The last of its stderr is still in the pipe when the exit arrives.
      setImmediate(() => {
        try {
          end(`exited (code ${String(code)}, signal ${String(signal)})`);
        } finally {
          resolve();
        }
      });
    });
    child.once("error", (cause) => {
      try {
        end(`did not start: ${cause.message}`);
      } finally {
        resolve();
      }
    });
  });

  child.stdin.on("error", () => undefined);
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    heard.push(line);
    if (!line.startsWith("{")) return;
    const read = jsonOrNothing(line);
    if (read !== undefined && !saysTickDone.safeParse(read).success) return;
    const done = tickDone.safeParse(read);
    if (!done.success) {
      end(`broke the tick protocol with ${line}`);
      return;
    }

    const answer = {
      logged: heard.splice(0).join("\n"),
      raised: stderr,
      stamps: [done.data.schema_stamp, done.data.contract_stamp],
    };
    stderr = "";
    waiting.shift()?.answer(answer);
  });

  const answered = (): Promise<Answer> =>
    new Promise((answer, fail) => {
      if (gone !== undefined) {
        fail(gone);
        return;
      }
      const deadline = setTimeout(
        () => end(`timed out: a tick went unanswered for ${A_TICK_ALLOWANCE_MS / 1000}s`),
        A_TICK_ALLOWANCE_MS,
      );
      waiting.push({
        answer: (given) => {
          clearTimeout(deadline);
          answer(given);
        },
        fail: (failure) => {
          clearTimeout(deadline);
          fail(failure);
        },
      });
      child.stdin.write("tick\n");
    });

  return {
    tick: async (): Promise<void> => {
      await stampTheContract(where.connectionUri);
      const { logged, raised, stamps } = await answered();

      expect(raised).not.toMatch(/Traceback/);
      const errors = errorsLoggedIn(logged);
      if (errors.length > 0) {
        throw new Error(`the worker logged an error: ${errors.join("; ")}\n${logged}`);
      }
      if (stamps.some((stamp) => stamp !== A_STAMP_THAT_MATCHES)) {
        throw new Error(`the worker ${workerId} refused the tick, a deploy stamp differs`);
      }
    },
    stop: async (): Promise<void> => {
      child.stdin.end();
      const killer = setTimeout(() => killTheGroup(child), STOP_GRACE_MS);
      await ended;
      clearTimeout(killer);
    },
  };
};

export const workerForSuite = (workerId: string, where: () => Where): TickingWorker => {
  let started: ReturnType<typeof startTickingWorker> | undefined;

  afterAll(async () => {
    await started?.stop();
  });

  return {
    tick: async (): Promise<void> => {
      await detectorsWeightsCached();
      started ??= startTickingWorker(workerId, where());
      await started.tick();
    },
  };
};
