#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import {
  couldNot,
  cubicEnvironment,
  drift,
  EXIT,
  redact,
  refusal,
  report,
  reviewFrom,
} from "../packages/devtools/src/review/cubic-review.ts";

const REVIEW_TIMEOUT_MS = 25 * 60 * 1000;
const GIT_TIMEOUT_MS = 2 * 60 * 1000;
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

const base = process.argv[2] ?? "origin/main";
if (process.argv.length > 3 || !/^origin\/[\w./-]+$/u.test(base)) {
  process.stderr.write("usage: pnpm run cubic-review [origin/<base-branch>]\n");
  process.exit(2);
}

const env = process.env;

const finish = (head, label, review) => {
  process.stdout.write(hide(report(head, label, review)));
  process.exit(EXIT[review.kind]);
};

const hide = (text) => redact(text ?? "", env.CUBIC_API_KEY);

const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || String(result.error)).trim()}`);
  }
  return result.stdout.trim();
};

const readTree = () => ({
  head: git("rev-parse", "HEAD"),
  dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
});

const diffRef = `${base}...HEAD`;

let before;
let label = diffRef;
try {
  git(
    "fetch",
    "--quiet",
    "origin",
    `+refs/heads/${base.slice("origin/".length)}:refs/remotes/${base}`,
  );
  label = `${diffRef}, merge base ${git("merge-base", base, "HEAD")}`;
  before = readTree();
} catch (cause) {
  finish(undefined, label, couldNot("not-ready", String(cause.message)));
}

const refused = refusal(before);
if (refused !== undefined) finish(before.head, label, couldNot("not-ready", refused));

const ran = spawnSync("cubic", ["review", "--base", diffRef, "--output-format", "json"], {
  encoding: "utf8",
  env: cubicEnvironment(env),
  stdio: ["ignore", "pipe", "pipe"],
  timeout: REVIEW_TIMEOUT_MS,
  maxBuffer: OUTPUT_LIMIT_BYTES,
});

let moved;
try {
  moved = drift(before, readTree());
} catch (cause) {
  moved = String(cause.message);
}
finish(
  before.head,
  label,
  moved === undefined
    ? reviewFrom({
        stdout: hide(ran.stdout),
        stderr: hide(ran.stderr),
        status: ran.status,
        spawnError: ran.error?.code,
      })
    : couldNot("not-ready", moved),
);
