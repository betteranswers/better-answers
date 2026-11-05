import { readFileSync } from "node:fs";

const isMarkdown = (changed) => changed.endsWith(".md");

/** Defaults to `full`: a needless full lane costs minutes, but a wrong docs lane merges code that no gate checked. */
const laneOf = (paths) => (paths.length > 0 && paths.every(isMarkdown) ? "docs" : "full");

/** Omits source files that the Dockerfiles copy, because build.yml probes every image it pushes. */
const IMAGE_INPUTS = [
  ".dockerignore",
  ".node-version",
  ".github/workflows/build.yml",
  ".github/workflows/check.yml",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "patches/",
  "deploy/",
  "apps/api/Dockerfile",
  "apps/api/lifts/",
  "apps/api/tests/images/backup-image.test.ts",
  "apps/api/tests/images/image-probe.ts",
  "apps/api/tests/images/image.test.ts",
  "apps/worker/.dockerignore",
  "apps/worker/.python-version",
  "apps/worker/.tool-versions",
  "apps/worker/Dockerfile",
  "apps/worker/pyproject.toml",
  "apps/worker/uv.lock",
  "apps/worker/src/better_answers_worker/__init__.py",
  "apps/worker/src/better_answers_worker/redaction/",
  "apps/worker/tests/test_image.py",
];

const isAManifest = (changed) => changed === "package.json" || changed.endsWith("/package.json");

const isAnImageInput = (changed) =>
  isAManifest(changed) ||
  IMAGE_INPUTS.some((input) =>
    input.endsWith("/") ? changed.startsWith(input) : changed === input,
  );

/** Defaults to `yes`: a needless probe costs minutes, but a skipped probe ships an untested image. */
const imagesOf = (paths) => (paths.length === 0 || paths.some(isAnImageInput) ? "yes" : "no");

/** Splits on NUL or newline, never both: splitting a NUL stream on newlines too can turn one path into two. */
const changedPaths = (raw) =>
  raw.split(raw.includes("\0") ? "\0" : "\n").filter((changed) => changed.length > 0);

const changed = changedPaths(readFileSync(0, "utf8"));

process.stdout.write(`lane=${laneOf(changed)}\nimages=${imagesOf(changed)}\n`);
