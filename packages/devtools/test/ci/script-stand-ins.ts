import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";

/** A script under `deploy/`, by its file name. */
export const deployScript = (name: string): string => path.join(repositoryRoot, "deploy", name);

/** A directory of the suite's own, removed once the file's tests have run. */
export const scratchDirectory = (prefix: string): string => {
  const made = mkdtempSync(path.join(tmpdir(), prefix));
  afterAll(() => {
    rmSync(made, { recursive: true, force: true });
  });
  return made;
};

/** The runner's PATH and nothing else, so a script sees no variable a test did not give it. */
export const PATH_ONLY = { PATH: process.env["PATH"] ?? "" };

export type Ran = { readonly code: number | null; readonly out: string; readonly err: string };

/** Runs a script under bash with exactly `env`, collecting both streams. */
export const ran = (
  script: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<Ran> =>
  new Promise((resolve, reject) => {
    const child = spawn("bash", [script, ...args], { env: { ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });

export type Heard = {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

export type Answer = {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
};

/** A stand-in for a service a script calls, answering each request as `answer` says. */
export const listening = async (
  answer: (heard: Heard) => Answer,
  work: (origin: string, heard: readonly Heard[]) => Promise<void>,
): Promise<void> => {
  const heard: Heard[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const one = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      };
      heard.push(one);
      const { status, body: sent, headers } = answer(one);
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(sent);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port to listen on");
    await work(`http://127.0.0.1:${String(address.port)}`, heard);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
