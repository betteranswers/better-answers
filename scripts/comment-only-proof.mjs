import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import esbuild from "esbuild";

import { workerPython } from "./worker-python.mjs";

const checkout = path.resolve(import.meta.dirname, "..");
const PYTHON = ".py";
const TYPESCRIPT = new Set([".ts", ".tsx", ".cts", ".mts"]);

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const parseArguments = (argv) => {
  const options = { base: "main", root: checkout, selfTest: false, files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") options.selfTest = true;
    else if (argument === "--base" || argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined) fail(`comment-only-proof: ${argument} needs a value`);
      if (argument === "--base") options.base = value;
      else options.root = path.resolve(value);
      index += 1;
    } else if (argument.startsWith("--")) fail(`comment-only-proof: unknown argument ${argument}`);
    else options.files.push(argument);
  }
  return options;
};

const digestOf = (text) => crypto.createHash("sha256").update(text).digest("hex");

const typeScriptDigest = (file, source) =>
  digestOf(
    esbuild.transformSync(source, {
      // `preserve` keeps JSX comments verbatim, which would read a deleted one as no change.
      loader: file.endsWith(".tsx") ? "tsx" : "ts",
      jsx: "transform",
      legalComments: "none",
      // The transform alone keeps a comment sitting on a property; only minified whitespace
      // drops every one. Identifiers and syntax stay, or a renamed local reads as unchanged.
      minifyWhitespace: true,
      minifyIdentifiers: false,
      minifySyntax: false,
      target: "esnext",
    }).code,
  );

const pythonDigests = (sources) => {
  if (Object.keys(sources).length === 0) return { digests: {}, errors: {} };
  const answer = spawnSync(
    "uv",
    [
      "run",
      "--no-project",
      "--python",
      workerPython(checkout),
      "python",
      path.join(checkout, "scripts", "comment_only_normalize.py"),
    ],
    { input: JSON.stringify({ sources }), encoding: "utf8" },
  );
  if (answer.error !== undefined) {
    fail(`comment-only-proof: the Python side could not be run: ${answer.error.message}`);
  }
  if (answer.status !== 0) fail(`comment-only-proof: the Python side exited ${answer.status}`);
  return JSON.parse(answer.stdout);
};

// Keyed by position rather than by path, so two pairs over one path cannot overwrite each
// other on the way across the language boundary.
const verdicts = (pairs) => {
  const pythonSources = {};
  for (const [index, pair] of pairs.entries()) {
    if (path.extname(pair.file) !== PYTHON) continue;
    pythonSources[`${index}:base`] = pair.base;
    pythonSources[`${index}:current`] = pair.current;
  }
  const python = pythonDigests(pythonSources);

  return pairs.map((pair, index) => {
    if (path.extname(pair.file) === PYTHON) {
      const base = python.digests[`${index}:base`];
      const current = python.digests[`${index}:current`];
      if (base === undefined || current === undefined) {
        const reason = python.errors[`${index}:base`] ?? python.errors[`${index}:current`];
        return { file: pair.file, same: false, note: `unparseable: ${reason}` };
      }
      return { file: pair.file, same: base === current };
    }
    try {
      return {
        file: pair.file,
        same: typeScriptDigest(pair.file, pair.base) === typeScriptDigest(pair.file, pair.current),
      };
    } catch (failure) {
      return { file: pair.file, same: false, note: `untransformable: ${String(failure)}` };
    }
  });
};

const git = (root, argv) => spawnSync("git", ["-C", root, ...argv], { encoding: "utf8" });

const changedPairs = (root, base, named) => {
  const listed =
    named.length > 0
      ? named
      : (() => {
          const answer = git(root, ["diff", "--name-only", base, "--"]);
          if (answer.status !== 0) fail(`comment-only-proof: ${answer.stderr.trim()}`);
          return answer.stdout.split("\n").filter((line) => line !== "");
        })();

  // An added or deleted file is a change the strip did not make, so it is reported, not
  // refused.
  const pairs = [];
  const unpaired = [];
  for (const file of listed) {
    const extension = path.extname(file);
    if (extension !== PYTHON && !TYPESCRIPT.has(extension)) continue;
    const before = git(root, ["show", `${base}:${file}`]);
    const onDisk = path.join(root, file);
    if (before.status !== 0) {
      unpaired.push({ file, same: false, note: `added since ${base}` });
      continue;
    }
    if (!fs.existsSync(onDisk)) {
      unpaired.push({ file, same: false, note: `deleted since ${base}` });
      continue;
    }
    pairs.push({ file, base: before.stdout, current: fs.readFileSync(onDisk, "utf8") });
  }
  return { pairs, unpaired };
};

const FIXTURE_TS = `#!/usr/bin/env node
// the source of truth is the header, not this file
const url = "https://example.test";

export const target = {
  // a comment sitting on a property, which the plain transform keeps
  where: url,
  read: () => {
    // a comment inside a body
    return url;
  },
};
`;

const FIXTURE_TSX = `// a header nobody reads
export const Screen = () => (
  <main>
    {/* the wrapper goes with the comment */}
    <span>{"answer"}</span>
  </main>
);
`;

const FIXTURE_PY = `#!/usr/bin/env python3
"""The module docstring."""


def waited() -> None:
    """Only a docstring."""


def answered(value: int) -> int:
    # the caller already checked the bound
    return value
`;

const withoutLine = (source, fragment) =>
  source
    .split("\n")
    .filter((line) => !line.includes(fragment))
    .join("\n");

const selfTest = () => {
  const cases = [
    {
      name: "TypeScript, untouched",
      file: "a.ts",
      base: FIXTURE_TS,
      current: FIXTURE_TS,
      same: true,
    },
    {
      name: "TypeScript, comments removed",
      file: "a.ts",
      base: FIXTURE_TS,
      current: withoutLine(
        withoutLine(withoutLine(FIXTURE_TS, "source of truth"), "sitting on a property"),
        "inside a body",
      ),
      same: true,
    },
    {
      name: "TSX, a JSX comment removed",
      file: "a.tsx",
      base: FIXTURE_TSX,
      current: withoutLine(withoutLine(FIXTURE_TSX, "nobody reads"), "wrapper goes with"),
      same: true,
    },
    {
      name: "TypeScript, one token edited",
      file: "a.ts",
      base: FIXTURE_TS,
      current: FIXTURE_TS.replaceAll("url", "urlX"),
      same: false,
    },
    {
      name: "TypeScript, hashbang lost",
      file: "a.ts",
      base: FIXTURE_TS,
      current: withoutLine(FIXTURE_TS, "#!"),
      same: false,
    },
    { name: "Python, untouched", file: "b.py", base: FIXTURE_PY, current: FIXTURE_PY, same: true },
    {
      name: "Python, docstring became `pass`",
      file: "b.py",
      base: FIXTURE_PY,
      current: withoutLine(FIXTURE_PY, "Only a docstring")
        .replace("def waited() -> None:", "def waited() -> None:\n    pass")
        .replace('"""The module docstring."""\n', ""),
      same: true,
    },
    {
      name: "Python, docstring became `...`",
      file: "b.py",
      base: FIXTURE_PY,
      current: withoutLine(FIXTURE_PY, "Only a docstring")
        .replace("def waited() -> None:", "def waited() -> None:\n    ...")
        .replace('"""The module docstring."""\n', ""),
      same: true,
    },
    {
      name: "Python, comment removed",
      file: "b.py",
      base: FIXTURE_PY,
      current: withoutLine(FIXTURE_PY, "already checked"),
      same: true,
    },
    {
      name: "Python, one token edited",
      file: "b.py",
      base: FIXTURE_PY,
      current: FIXTURE_PY.replace("return value", "return value + 1"),
      same: false,
    },
    {
      name: "Python, hashbang lost",
      file: "b.py",
      base: FIXTURE_PY,
      current: withoutLine(FIXTURE_PY, "#!"),
      same: false,
    },
  ];

  const answers = verdicts(cases.map(({ file, base, current }) => ({ file, base, current })));
  let wrong = 0;
  for (const [index, expected] of cases.entries()) {
    const answered = answers[index].same;
    const held = answered === expected.same;
    if (!held) wrong += 1;
    process.stdout.write(
      `${held ? "held " : "BROKE"}  ${expected.name} — expected ${expected.same ? "identical" : "different"}, answered ${answered ? "identical" : "different"}\n`,
    );
  }
  if (wrong > 0) {
    process.stderr.write(`\ncomment-only-proof: ${wrong} of ${cases.length} cases broke\n`);
    process.exit(1);
  }
  process.stdout.write(`\ncomment-only-proof: all ${cases.length} cases held\n`);
};

const proveTree = (options) => {
  const { pairs, unpaired } = changedPairs(options.root, options.base, options.files);
  if (pairs.length + unpaired.length === 0) {
    process.stdout.write(
      `comment-only-proof: no TypeScript or Python changed against ${options.base}\n`,
    );
    return;
  }
  const answers = [...verdicts(pairs), ...unpaired];
  const different = answers.filter((answer) => !answer.same);
  for (const answer of different) {
    process.stderr.write(`code changed: ${answer.file}${answer.note ? ` (${answer.note})` : ""}\n`);
  }
  process.stdout.write(
    `comment-only-proof: ${answers.length - different.length} of ${answers.length} changed files are comment-only against ${options.base}\n`,
  );
  if (different.length > 0) process.exit(1);
};

const options = parseArguments(process.argv.slice(2));
if (options.selfTest) selfTest();
else proveTree(options);
