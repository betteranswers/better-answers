// Plan 009 Appendix E after-table rows, read from main's build runs. Usage: node after-table.mjs [<pr> ...]
import { execFileSync } from "node:child_process";

const PLAN_PRS = {
  931: "BA-289",
  932: "BA-268",
  933: "BA-285",
  934: "BA-287",
  935: "BA-270",
  936: "BA-295",
  937: "BA-290",
  938: "BA-296",
  939: "BA-269",
  940: "BA-293",
  941: "BA-271",
  942: "BA-288",
  944: "BA-273",
  945: "BA-276",
  946: "BA-291",
  947: "BA-275",
  948: "BA-272",
  949: "BA-274",
  950: "BA-277",
  951: "BA-286",
};
const WANTED_RUNS = 5;

const gh = (...args) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return JSON.parse(
        execFileSync("gh", args, {
          encoding: "utf8",
          maxBuffer: 1 << 26,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const builds = gh(
  "run",
  "list",
  "--workflow",
  "build.yml",
  "--branch",
  "main",
  "--event",
  "push",
  "--status",
  "completed",
  "--limit",
  "200",
  "--json",
  "databaseId,conclusion,createdAt,headSha",
)
  .filter((run) => run.conclusion === "success")
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const suiteJobsOf = new Map();
const suiteJobs = (run) => {
  if (!suiteJobsOf.has(run.databaseId)) {
    const { jobs } = gh("run", "view", String(run.databaseId), "--json", "jobs");
    const full = jobs.filter((job) => job.name.startsWith("check / full-"));
    const ran = full.length > 0 && full.every((job) => job.conclusion === "success");
    suiteJobsOf.set(
      run.databaseId,
      ran
        ? full.map((job) => ({
            name: job.name.replace("check / ", ""),
            seconds: (Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000,
          }))
        : null,
    );
  }
  return suiteJobsOf.get(run.databaseId);
};

const prs =
  process.argv.length > 2 ? process.argv.slice(2).map(Number) : Object.keys(PLAN_PRS).map(Number);
const rows = [];
for (const pr of prs) {
  const { mergedAt, mergeCommit } = gh("pr", "view", String(pr), "--json", "mergedAt,mergeCommit");
  const runs = [];
  for (const run of builds.filter((candidate) => candidate.createdAt >= mergedAt)) {
    if (runs.length === WANTED_RUNS) break;
    const jobs = suiteJobs(run);
    if (jobs) runs.push({ run, jobs });
  }
  const byJob = Map.groupBy(
    runs.flatMap(({ jobs }) => jobs),
    (job) => job.name,
  );
  const medians = [...byJob].map(([name, jobs]) => ({
    name,
    seconds: median(jobs.map((job) => job.seconds)),
  }));
  const slowest = medians.reduce((a, b) => (b.seconds > a.seconds ? b : a), {
    name: "-",
    seconds: 0,
  });
  const total = medians.reduce((sum, job) => sum + job.seconds, 0);
  const who = PLAN_PRS[pr] ?? `#${pr}`;
  const after = `${who} (#${pr}), \`${mergeCommit.oid.slice(0, 9)}\``;
  rows.push({
    mergedAt,
    text:
      runs.length === 0
        ? `| ${after} | 0 | none yet | none yet | - |`
        : `| ${after} | ${runs.length} | ${slowest.name}, ${Math.round(slowest.seconds)}s | ${Math.round(total).toLocaleString("en-GB")} | - |`,
  });
}
process.stdout.write(
  `${rows
    .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))
    .map((row) => row.text)
    .join("\n")}\n`,
);
