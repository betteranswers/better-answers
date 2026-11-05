#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import {
  couldNot,
  cubicEnvironment,
  EXIT,
  report,
  reviewFrom,
} from "../packages/devtools/src/review/cubic-review.ts";

const REVIEW_TIMEOUT_MS = 25 * 60 * 1000;
const GIT_TIMEOUT_MS = 2 * 60 * 1000;
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

const finish = (head, review) => {
  process.stdout.write(report(head, review));
  process.exit(EXIT[review.kind]);
};

const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || String(result.error)).trim()}`);
  }
  return result.stdout.trim();
};

let head = "unknown";
try {
  git("fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main");
  head = git("rev-parse", "HEAD");
} catch (cause) {
  finish(head, couldNot(cause.message));
}

const ran = spawnSync(
  "cubic",
  ["review", "--base", "origin/main...HEAD", "--output-format", "json"],
  {
    encoding: "utf8",
    env: cubicEnvironment(process.env),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: REVIEW_TIMEOUT_MS,
    maxBuffer: OUTPUT_LIMIT_BYTES,
  },
);

const output = ran.error === undefined ? ran : { stdout: "", stderr: "" };

finish(
  head,
  reviewFrom({
    stdout: output.stdout,
    stderr: output.stderr,
    status: ran.status,
    spawnError: ran.error?.code,
  }),
);
