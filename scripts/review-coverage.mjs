#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import {
  assess,
  parseCheckRuns,
  parsePullRequest,
} from "../packages/devtools/src/review/review-coverage.ts";

const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

const pr = process.argv[2];
if (!/^\d+$/u.test(pr)) {
  process.stderr.write("usage: pnpm run review-coverage <pr-number>\n");
  process.exit(2);
}

const gh = (...args) => {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: OUTPUT_LIMIT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (cause) {
    process.stderr.write(
      `review-coverage: gh ${args[0]} failed: ${String(cause.stderr ?? cause)}\n`,
    );
    process.exit(2);
  }
};

let assessment;
try {
  const pullRequest = parsePullRequest(
    gh("pr", "view", pr, "--json", "headRefOid,labels,comments,reviews"),
  );
  const runs = parseCheckRuns(
    gh(
      "api",
      "--paginate",
      "--slurp",
      `repos/{owner}/{repo}/commits/${pullRequest.headRefOid}/check-runs`,
    ),
  );
  assessment = assess(pr, pullRequest, runs);
} catch (cause) {
  process.stderr.write(`review-coverage: could not read pull request ${pr}: ${String(cause)}\n`);
  process.exit(2);
}

process.stdout.write(assessment.report);
process.exit(assessment.exitCode);
