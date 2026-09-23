import { readFileSync } from "node:fs";

const isMarkdown = (changed) => changed.endsWith(".md");

// Named rather than matched: a directory that only LOOKS like a workspace would map to the
// root and let the leg pass having run nothing.
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

// Unsure falls to `full`, the lane this repository already ran: wrong that way costs minutes,
// wrong the other way ships a tree no gate read.
const laneOf = (paths) => {
  if (paths.length === 0) return "full";
  if (paths.every(isMarkdown)) return "docs";

  return paths.every((changed) => !isMarkdown(changed) && ownedByAWorkspace(changed))
    ? "affected"
    : "full";
};

// `pnpm --filter` never names the worker, not being a pnpm workspace, so the leg that runs
// its gates is told by this instead.
const workerOf = (paths) =>
  paths.length === 0 ||
  paths.some((changed) => THE_WORKER_READS.some((root) => changed.startsWith(root)))
    ? "yes"
    : "no";

// One separator or the other, never both: splitting a NUL stream on newlines too would read
// the path `-z` exists to carry as two.
const changedPaths = (raw) =>
  raw.split(raw.includes("\0") ? "\0" : "\n").filter((changed) => changed.length > 0);

const changed = changedPaths(readFileSync(0, "utf8"));

process.stdout.write(`lane=${laneOf(changed)}\nworker=${workerOf(changed)}\n`);
