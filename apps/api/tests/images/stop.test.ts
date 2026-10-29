import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterAll, afterEach, beforeAll, expect, it } from "vitest";

import { until } from "@better-answers/core/testing/postgres";

import {
  AGENT_HOSTNAME,
  APEX_HOSTNAME,
  APP_HOSTNAME,
  AUTH_SECRET,
  PUBLIC_URL,
} from "../support/harness/harness.ts";
import { freePort } from "../support/loopback-port.ts";
import { startTestDatabase, type TestDatabase } from "../support/postgres.ts";
import { workspaceRoot } from "../support/roots/roots.ts";

const DEFAULT_STOP_DEADLINE_MS = 10_000;

const SHORT_STOP_DEADLINE_MS = 500;

const HEADERS_READ_MS = 250;

type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

type Running = {
  readonly child: ChildProcess;
  readonly port: number;
  readonly exited: Promise<Exit>;
  readonly said: () => string;
};

let database: TestDatabase;
let gitStoreDir: string;
const started: ChildProcess[] = [];

beforeAll(async () => {
  database = await startTestDatabase();
  gitStoreDir = await mkdtemp(path.join(tmpdir(), "api-stop-"));
});

afterEach(() => {
  for (const child of started.splice(0)) child.kill("SIGKILL");
});

afterAll(async () => {
  await database.stop();
  await rm(gitStoreDir, { recursive: true, force: true });
});

const startApi = async (stopDeadlineMs?: number): Promise<Running> => {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/main.ts"], {
    cwd: workspaceRoot,
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      DATABASE_URL: database.connectionUri,
      PORT: String(port),
      PUBLIC_URL,
      AUTH_SECRET,
      AGENT_HOSTNAME,
      APEX_HOSTNAME,
      GIT_STORE_DIR: gitStoreDir,
      ...(stopDeadlineMs === undefined ? {} : { STOP_DEADLINE_MS: String(stopDeadlineMs) }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  started.push(child);
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<Exit>((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const said = (): string => output;
  const listening = (): boolean => output.includes('"api listening"');
  await until(async () => listening() || child.exitCode !== null || child.signalCode !== null);
  if (!listening()) throw new Error(`the api exited before it listened:\n${output}`);
  return { child, port, exited, said };
};

type Stopped = Exit & { readonly said: string; readonly afterMs: number };

const stopped = (api: Running, signal: NodeJS.Signals): Promise<Stopped> => {
  const from = Date.now();
  api.child.kill(signal);
  return api.exited.then((exit) => ({ ...exit, said: api.said(), afterMs: Date.now() - from }));
};

const exitedWith = (code: number, stop: Stopped): Stopped => ({
  code,
  signal: null,
  said: stop.said,
  afterMs: stop.afterMs,
});

const heldRequest = async (port: number): Promise<Socket> => {
  const socket = connect(port, "127.0.0.1");
  await new Promise((open) => socket.once("connect", open));
  socket.write(`GET /health HTTP/1.1\r\nHost: ${APP_HOSTNAME}\r\n`);
  await delay(HEADERS_READ_MS);
  return socket;
};

const received = (socket: Socket): Promise<string> =>
  new Promise((resolve) => {
    let reply = "";
    socket.on("data", (chunk: Buffer) => (reply += chunk.toString()));
    socket.once("close", () => resolve(reply));
  });

it.each(["SIGTERM", "SIGINT"] as const)("exits 0 at once on %s", async (signal) => {
  const api = await startApi();

  const stop = await stopped(api, signal);

  expect(stop).toEqual(exitedWith(0, stop));
  expect(stop.afterMs).toBeLessThan(DEFAULT_STOP_DEADLINE_MS / 2);
});

it("answers a request in flight at the stop", async () => {
  const api = await startApi();
  const socket = await heldRequest(api.port);
  const reply = received(socket);

  const stopping = stopped(api, "SIGTERM");
  await until(async () => api.said().includes('"the api is stopping"'));
  socket.write("\r\n");

  expect(await reply).toMatch(
    /^HTTP\/1\.1 200 [\s\S]*\r\nconnection: close\r\n[\s\S]*"status":"healthy"/i,
  );
  const stop = await stopping;
  expect(stop).toEqual(exitedWith(0, stop));
  expect(stop.afterMs).toBeLessThan(DEFAULT_STOP_DEADLINE_MS / 2);
});

it("exits 1 at the deadline, cutting a request still open", async () => {
  const api = await startApi(SHORT_STOP_DEADLINE_MS);
  const socket = await heldRequest(api.port);
  const reply = received(socket);

  const stop = await stopped(api, "SIGTERM");

  expect(stop).toEqual(exitedWith(1, stop));
  expect(stop.afterMs).toBeGreaterThanOrEqual(SHORT_STOP_DEADLINE_MS - 50);
  expect(stop.afterMs).toBeLessThan(SHORT_STOP_DEADLINE_MS + 5_000);
  expect(await reply).toBe("");
});
