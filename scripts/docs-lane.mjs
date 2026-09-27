import { readFileSync } from "node:fs";

const isMarkdown = (changed) => changed.endsWith(".md");

/** Unsure means `full`: wrong that way costs minutes; the other way ships a tree no gate read. */
const laneOf = (paths) => (paths.length > 0 && paths.every(isMarkdown) ? "docs" : "full");

/** Source the Dockerfiles copy is left out, because build.yml probes every image it pushes. */
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
  "apps/api/tests/backup-image.test.ts",
  "apps/api/tests/image-probe.ts",
  "apps/api/tests/image.test.ts",
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

/** Unsure means `yes`: a probe run needlessly costs minutes; one skipped ships an image unread. */
const imagesOf = (paths) => (paths.length === 0 || paths.some(isAnImageInput) ? "yes" : "no");

/** One separator, never both: a NUL stream split on newlines too reads one path as two. */
const changedPaths = (raw) =>
  raw.split(raw.includes("\0") ? "\0" : "\n").filter((changed) => changed.length > 0);

const changed = changedPaths(readFileSync(0, "utf8"));

process.stdout.write(`lane=${laneOf(changed)}\nimages=${imagesOf(changed)}\n`);
