import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { LANGUAGE_BY_EXTENSION, withoutComments } from "./config-comments.mjs";
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

const CONFIG_ROOTS = [
  ".claude/hooks",
  ".github/actions",
  ".github/workflows",
  "deploy",
  "packages/schema/migrations",
  "scripts",
];

const CONFIG_FILES = [
  "cubic.yaml",
  "jscpd.config.mjs",
  "knip.config.ts",
  "lefthook.yml",
  "pnpm-workspace.yaml",
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
const JAVASCRIPT = new Set([".js", ".cjs", ".mjs"]);

const AST_GREP = new Set(["javascript", "typescript", "tsx"]);

const DIRECTIVE = String.raw`(eslint|oxlint|biome)-(disable|enable)|@ts-|prettier-ignore|(v8|c8|istanbul) ignore`;

// Anchored arms only: a directive is one at a comment's start. The notice arm is not, a
// block carrying it on line two.
const KEPT = String.raw`^(#!|///|//\s*(${DIRECTIVE}|@vitest-environment)|/\*!|/\*\s*(${DIRECTIVE}|jscpd:ignore)|#\s*(type:|noqa(:|$)|pragma:|ruff:|mypy:|fmt:\s*(on|off)))|(?i:spdx-license-identifier|copyright|@license|@preserve|lifted from|third-party notice)`;

const parseArguments = (argv) => {
  let root = checkout;

  /** @type {string[]} */
  const only = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" || argument === "--only") {
      const value = argv[index + 1];
      if (value === undefined) fail(`strip-comments: ${argument} needs a directory`);
      if (argument === "--root") root = path.resolve(value);
      else only.push(value.replace(/\/+$/, ""));
      index += 1;
      continue;
    }
    fail(`strip-comments: unknown argument ${argument}`);
  }
  return { root, only };
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const codeLanguage = (extension) => {
  if (extension === ".tsx") return "tsx";
  if (TYPESCRIPT.has(extension)) return "typescript";
  if (extension === ".py") return "python";
  return undefined;
};

const configLanguage = (extension) => {
  if (JAVASCRIPT.has(extension)) return "javascript";
  return codeLanguage(extension) ?? LANGUAGE_BY_EXTENSION.get(extension);
};

const sourceFiles = (root, only) => {
  const found = new Map();
  const asked = (named) => only.length === 0 || only.includes(named);

  const take = (file, language) => {
    if (language !== undefined && !found.has(file)) found.set(file, { file, language });
  };

  const walk = (directory, languageOf) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, languageOf);
        continue;
      }
      if (entry.isFile()) take(full, languageOf(path.extname(entry.name)));
    }
  };

  for (const workspace of WORKSPACES) {
    const directory = path.join(root, workspace);
    if (asked(workspace) && fs.existsSync(directory)) walk(directory, codeLanguage);
  }
  for (const config of CONFIG_ROOTS) {
    const directory = path.join(root, config);
    if (asked(config) && fs.existsSync(directory)) walk(directory, configLanguage);
  }
  for (const config of CONFIG_FILES) {
    const file = path.join(root, config);
    if (asked(config) && fs.existsSync(file)) take(file, configLanguage(path.extname(file)));
  }

  return [...found.values()];
};

const NAMED = [...WORKSPACES, ...CONFIG_ROOTS, ...CONFIG_FILES];

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
    ["javascript", "typescript", "tsx"]
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

const stripConfig = (files) => {
  let moved = 0;
  for (const found of files) {
    const before = fs.readFileSync(found.file, "utf8");
    const after = withoutComments(found.language, before);
    if (after === before) continue;
    fs.writeFileSync(found.file, after);
    moved += 1;
  }
  return moved;
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

const { root, only } = parseArguments(process.argv.slice(2));
for (const named of only) {
  if (!NAMED.includes(named)) {
    fail(`strip-comments: ${named} is not a root this script knows. It knows ${NAMED.join(", ")}`);
  }
}

const files = sourceFiles(root, only);
const typescript = files.filter((found) => AST_GREP.has(found.language));
const python = files.filter((found) => found.language === "python");
const config = files.filter(
  (found) => !AST_GREP.has(found.language) && found.language !== "python",
);

const covered = only.length === 0 ? "every root" : only.join(", ");
if (files.length === 0) {
  fail(`strip-comments: no file the syntax table reads is under ${root} in ${covered}`);
}

process.stdout.write(
  `strip-comments: ${typescript.length} JavaScript or TypeScript, ${python.length} Python and ${config.length} config files in ${covered} under ${root}\n`,
);

stripTypeScript(root, typescript);
stripPython(python);
const moved = stripConfig(config);
collapseResidue(root, typescript, python);

process.stdout.write(`strip-comments: done — ${moved} of ${config.length} config files moved\n`);
