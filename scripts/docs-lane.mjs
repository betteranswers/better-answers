import { readFileSync } from "node:fs";

const isMarkdown = (changed) => changed.endsWith(".md");

/** Named, not matched: a lookalike directory would map to the root and pass, running nothing. */
const WORKSPACE_ROOTS = [
  "apps/api/",
  "apps/web/",
  "apps/worker/",
  "packages/core/",
  "packages/design-system/",
  "packages/devtools/",
  "packages/schema/",
];

const ownedByAWorkspace = (changed) => WORKSPACE_ROOTS.some((root) => changed.startsWith(root));

const THE_WORKER_READS = ["apps/worker/", "contracts/"];

/** Unsure means `full`: wrong that way costs minutes; the other way ships a tree no gate read. */
const laneOf = (paths) => {
  if (paths.length === 0) return "full";
  if (paths.every(isMarkdown)) return "docs";

  return paths.every((changed) => !isMarkdown(changed) && ownedByAWorkspace(changed))
    ? "affected"
    : "full";
};

/** The worker is no pnpm workspace, so `--filter` never names it; this tells its leg instead. */
const workerOf = (paths) =>
  paths.length === 0 ||
  paths.some((changed) => THE_WORKER_READS.some((root) => changed.startsWith(root)))
    ? "yes"
    : "no";

/** One separator, never both: a NUL stream split on newlines too reads one path as two. */
const changedPaths = (raw) =>
  raw.split(raw.includes("\0") ? "\0" : "\n").filter((changed) => changed.length > 0);

const changed = changedPaths(readFileSync(0, "utf8"));

process.stdout.write(`lane=${laneOf(changed)}\nworker=${workerOf(changed)}\n`);
