#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const BOTS = [
  { name: "cubic", check: "cubic · AI code reviewer", ai: true, reviewed: ["success"] },
  { name: "coderabbit", check: "CodeRabbit", ai: true, reviewed: ["success"] },
  {
    name: "codacy",
    check: "Codacy Static Code Analysis",
    ai: false,
    reviewed: ["success", "action_required"],
  },
];

const pr = process.argv[2];
if (!/^\d+$/u.test(pr)) {
  process.stderr.write("usage: pnpm run review-coverage <pr-number>\n");
  process.exit(2);
}

const gh = (...args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (cause) {
    process.stderr.write(
      `review-coverage: gh ${args[0]} failed: ${String(cause.stderr ?? cause)}\n`,
    );
    process.exit(2);
  }
};
const head = gh("pr", "view", pr, "--json", "headRefOid", "-q", ".headRefOid");
const runs = JSON.parse(
  gh("api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${head}/check-runs`),
).flatMap((page) => page.check_runs);

process.stdout.write(`head ${head}\n`);
let reviewers = 0;
let pending = false;
for (const bot of BOTS) {
  const mine = runs
    .filter((one) => one.name === bot.check)
    .toSorted((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
  const passed = mine.find((one) => bot.reviewed.includes(one.conclusion));
  const latest = passed ?? mine[0];
  if (latest === undefined) {
    process.stdout.write(`${bot.name}\tmissing (no check run on this head)\n`);
  } else if (passed === undefined && latest.status !== "completed") {
    pending = true;
    process.stdout.write(`${bot.name}\tpending (${latest.status})\n`);
  } else {
    if (passed !== undefined && bot.ai) reviewers += 1;
    const outcome = passed === undefined ? "not reviewed" : "reviewed";
    const title = latest.output?.title ?? "";
    process.stdout.write(`${bot.name}\t${outcome} (${latest.conclusion}: ${title})\n`);
  }
}
process.stdout.write(`ai reviewers on this head: ${String(reviewers)} of 2\n`);
if (pending) {
  process.stdout.write("a bot is still running, so this is not final\n");
  process.exit(3);
}
process.exit(reviewers > 0 ? 0 : 1);
