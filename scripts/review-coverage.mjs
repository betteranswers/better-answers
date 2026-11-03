#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const BOTS = [
  { name: "cubic", app: "cubic-dev-ai", reviewed: ["success"] },
  { name: "coderabbit", app: "coderabbitai", reviewed: ["success"] },
  { name: "codacy", app: "codacy-production", reviewed: ["success", "action_required"] },
];

const pr = process.argv[2];
if (!/^\d+$/u.test(pr)) {
  process.stderr.write("usage: pnpm run review-coverage <pr-number>\n");
  process.exit(2);
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const head = gh("pr", "view", pr, "--json", "headRefOid", "-q", ".headRefOid");
const runs = JSON.parse(
  gh("api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${head}/check-runs`),
).flatMap((page) => page.check_runs);

process.stdout.write(`head ${head}\n`);
let reviewers = 0;
for (const bot of BOTS) {
  const run = runs.find((one) => one.app?.slug === bot.app);
  if (!run) {
    process.stdout.write(`${bot.name}\tmissing (no check run on this head)\n`);
    continue;
  }
  if (run.status !== "completed") {
    process.stdout.write(`${bot.name}\tpending (${run.status})\n`);
    continue;
  }
  const ok = bot.reviewed.includes(run.conclusion);
  if (ok && bot.name !== "codacy") reviewers += 1;
  const title = run.output?.title ?? "";
  process.stdout.write(
    `${bot.name}\t${ok ? "reviewed" : "not reviewed"} (${run.conclusion}: ${title})\n`,
  );
}
process.stdout.write(`ai reviewers on this head: ${String(reviewers)} of 2\n`);
process.exit(reviewers > 0 ? 0 : 1);
