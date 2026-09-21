import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { workerPython } from "./worker-python.mjs";

const require = createRequire(import.meta.url);
const checkout = path.resolve(import.meta.dirname, "..");

const LIBCST = "libcst==1.9.0";

const WORKSPACES = [
  "apps/api",
  "apps/web",
  "apps/worker",
  "packages/core",
  "packages/devtools",
  "packages/schema",
];

// A lift is edited upstream, so its comments are not this repository's to delete.
const SKIPPED = new Set([
  "node_modules",
  "lifts",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  "__pycache__",
]);

const TYPESCRIPT = new Set([".ts", ".cts", ".mts"]);

const DIRECTIVE = String.raw`(eslint|oxlint|biome)-(disable|enable)|@ts-|prettier-ignore|(v8|c8|istanbul) ignore`;

// Anchored arms only: a directive is one at a comment's start. The notice arm is not, a
// block carrying it on line two.
const KEPT = String.raw`^(#!|///|//\s*(${DIRECTIVE}|@vitest-environment)|/\*!|/\*\s*(${DIRECTIVE}|jscpd:ignore)|#\s*(type:|noqa(:|$)|pragma:|ruff:|mypy:|fmt:\s*(on|off)))|(?i:spdx-license-identifier|copyright|@license|@preserve|lifted from|third-party notice)`;

const parseArguments = (argv) => {
  let root = checkout;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      const value = argv[index + 1];
      if (value === undefined) fail("strip-comments: --root needs a directory");
      root = path.resolve(value);
      index += 1;
      continue;
    }
    fail(`strip-comments: unknown argument ${argv[index]}`);
  }
  return root;
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const sourceFiles = (root) => {
  const found = [];

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name);
      if (extension === ".tsx") found.push({ file: full, language: "tsx" });
      else if (TYPESCRIPT.has(extension)) found.push({ file: full, language: "typescript" });
      else if (extension === ".py") found.push({ file: full, language: "python" });
    }
  };

  for (const workspace of WORKSPACES) {
    const directory = path.join(root, workspace);
    if (fs.existsSync(directory)) walk(directory);
  }

  return found;
};

const binaryOf = (specifier, name) =>
  path.join(path.dirname(require.resolve(`${specifier}/package.json`)), name);

const run = (label, command, argv, options) => {
  const { status, error } = spawnSync(command, argv, { stdio: "inherit", ...options });
  if (error !== undefined) fail(`strip-comments: ${label} could not be run: ${error.message}`);
  if (status !== 0) fail(`strip-comments: ${label} exited ${status}`);
};

// A handler body with a comment in it is also a `{…}` container; matching on the text alone
// is what keeps it.
const JSX_COMMENT_ONLY = String.raw`^\{\s*((/\*([^*]|\*[^/])*\*/|//[^\n]*)\s*)+\}$`;

const writeRules = (directory) => {
  const jsx = path.join(directory, "jsx-comment.yml");
  const plain = path.join(directory, "comment.yml");
  fs.writeFileSync(
    jsx,
    `id: jsx-comment\nlanguage: tsx\nrule:\n  kind: jsx_expression\n  regex: ${JSON.stringify(JSX_COMMENT_ONLY)}\nfix: ""\n`,
  );
  fs.writeFileSync(
    plain,
    ["typescript", "tsx"]
      .map(
        (language) =>
          `id: comment-${language}\nlanguage: ${language}\nrule:\n  kind: comment\n  not:\n    regex: ${JSON.stringify(KEPT)}\nfix: ""\n`,
      )
      .join("---\n"),
  );
  return { jsx, plain };
};

const stripTypeScript = (root, files) => {
  if (files.length === 0) return;
  const rules = fs.mkdtempSync(path.join(os.tmpdir(), "strip-comments-"));
  const { jsx, plain } = writeRules(rules);
  const astGrep = binaryOf("@ast-grep/cli", "ast-grep");
  const paths = files.map((found) => found.file);

  // The wrapper goes with the comment, so this runs first or the plain rule leaves an empty
  // container.
  const jsxFiles = files.filter((found) => found.language === "tsx").map((found) => found.file);
  if (jsxFiles.length > 0) {
    run("ast-grep (jsx)", astGrep, ["scan", "--rule", jsx, "--update-all", ...jsxFiles], {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  run("ast-grep", astGrep, ["scan", "--rule", plain, "--update-all", ...paths], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  fs.rmSync(rules, { recursive: true, force: true });
};

const stripPython = (files) => {
  if (files.length === 0) return;
  run("libcst", "uv", [
    "run",
    "--no-project",
    "--python",
    workerPython(checkout),
    "--with",
    LIBCST,
    "python",
    path.join(checkout, "scripts", "strip_python_comments.py"),
    "--keep",
    KEPT,
    ...files.map((found) => found.file),
  ]);
};

// Neither tool collapses the blank line and trailing space it leaves, and the restore pass
// reads the diff.
const collapseResidue = (root, typescript, python) => {
  if (typescript.length > 0) {
    run(
      "oxfmt",
      binaryOf("oxfmt", "bin/oxfmt"),
      typescript.map((found) => found.file),
      {
        cwd: root,
      },
    );
  }
  if (python.length > 0) {
    run("ruff format", "uv", ["run", "--frozen", "ruff", "format", ...python.map((f) => f.file)], {
      cwd: path.join(checkout, "apps", "worker"),
    });
  }
};

const root = parseArguments(process.argv.slice(2));
const files = sourceFiles(root);
const typescript = files.filter((found) => found.language !== "python");
const python = files.filter((found) => found.language === "python");

if (files.length === 0) fail(`strip-comments: no TypeScript or Python found under ${root}`);

process.stdout.write(
  `strip-comments: ${typescript.length} TypeScript and ${python.length} Python files under ${root}\n`,
);

stripTypeScript(root, typescript);
stripPython(python);
collapseResidue(root, typescript, python);

process.stdout.write("strip-comments: done\n");
