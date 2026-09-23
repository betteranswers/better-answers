import { spawnSync } from "node:child_process";

const steps = process.argv.slice(2);

if (steps.length === 0) {
  process.stderr.write("check: name at least one script to run\n");
  process.exit(2);
}

// Collected rather than thrown at the first, so one run names every step that failed.
const failed = [];

for (const step of steps) {
  process.stdout.write(`\n== ${step} ==\n`);
  const { status, error } = spawnSync("pnpm", ["run", step], { stdio: "inherit" });
  if (error !== undefined || status !== 0) failed.push(step);
}

if (failed.length > 0) {
  process.stderr.write(`\ncheck failed: ${failed.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write("\ncheck passed\n");
