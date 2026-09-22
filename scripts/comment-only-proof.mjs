import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import esbuild from "esbuild";

import { LANGUAGE_BY_EXTENSION, normalized } from "./config-comments.mjs";
import { workerPython } from "./worker-python.mjs";

const checkout = path.resolve(import.meta.dirname, "..");
const PYTHON = ".py";
const JAVASCRIPT = new Set([".js", ".mjs", ".cjs"]);
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

const loaderFor = (file) => {
  if (file.endsWith(".tsx")) return "tsx";
  return JAVASCRIPT.has(path.extname(file)) ? "js" : "ts";
};

const typeScriptDigest = (file, source) =>
  digestOf(
    esbuild.transformSync(source, {
      // `preserve` keeps JSX comments verbatim, which would read a deleted one as no change.
      loader: loaderFor(file),
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

const PYYAML = "pyyaml==6.0.3";
const NOTHING_ASKED = { digests: {}, errors: {}, data: {}, unread: {} };

// One crossing for both readings: the Python tier's own normalisation, and the YAML and TOML
// parse that answers for the syntax table.
const pythonAnswers = (sources, data) => {
  if (Object.keys(sources).length + Object.keys(data).length === 0) return NOTHING_ASKED;
  const answer = spawnSync(
    "uv",
    [
      "run",
      "--no-project",
      "--python",
      workerPython(checkout),
      "--with",
      PYYAML,
      "python",
      path.join(checkout, "scripts", "comment_only_normalize.py"),
    ],
    { input: JSON.stringify({ sources, data }), encoding: "utf8" },
  );
  if (answer.error !== undefined) {
    fail(`comment-only-proof: the Python side could not be run: ${answer.error.message}`);
  }
  if (answer.status !== 0) fail(`comment-only-proof: the Python side exited ${answer.status}`);
  return JSON.parse(answer.stdout);
};

const PARSED = new Set(["yaml", "toml"]);

// Keyed by position rather than by path, so two pairs over one path cannot overwrite each
// other on the way across the language boundary.
const verdicts = (pairs) => {
  const pythonSources = {};
  const parsedSources = {};
  for (const [index, pair] of pairs.entries()) {
    const extension = path.extname(pair.file);
    if (extension === PYTHON) {
      pythonSources[`${index}:base`] = pair.base;
      pythonSources[`${index}:current`] = pair.current;
      continue;
    }
    const language = LANGUAGE_BY_EXTENSION.get(extension);
    if (language === undefined || !PARSED.has(language)) continue;
    parsedSources[`${index}:base`] = { language, source: pair.base };
    parsedSources[`${index}:current`] = { language, source: pair.current };
  }
  const python = pythonAnswers(pythonSources, parsedSources);

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
    const language = LANGUAGE_BY_EXTENSION.get(path.extname(pair.file));
    if (language !== undefined) {
      const table =
        digestOf(normalized(language, pair.base)) === digestOf(normalized(language, pair.current));
      if (!PARSED.has(language)) return { file: pair.file, same: table };

      // Two readers, and both must say so: the parse is blind to a lost directive, the table
      // to its own misreads.
      const base = python.data[`${index}:base`];
      const current = python.data[`${index}:current`];
      if (base === undefined || current === undefined) {
        const reason = python.unread[`${index}:base`] ?? python.unread[`${index}:current`];
        return { file: pair.file, same: false, note: `unparseable: ${reason}` };
      }
      return { file: pair.file, same: table && base === current };
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

const proven = (extension) =>
  extension === PYTHON ||
  TYPESCRIPT.has(extension) ||
  JAVASCRIPT.has(extension) ||
  LANGUAGE_BY_EXTENSION.has(extension);

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
    if (!proven(extension)) continue;
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

const FIXTURE_MJS = `#!/usr/bin/env node
// the header nobody reads
const root = "/srv";

// the caller already resolved the root
export const under = (name) => \`\${root}/\${name}\`;
`;

const FIXTURE_WORKFLOW = `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: check
on: [push]

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      # the checkout has to come first
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: gates
        run: |
          # the block scalar's own lines are the step's script, not this file's comments
          pnpm check:gates
      - name: the detector's weights, keyed on the pins that name them
        # the apostrophe above opens no scalar, so this line is still a comment
        run: pnpm fetch:weights
`;

const FIXTURE_COMPOSE = `services:
  api:
    image: ghcr.io/better-answers/api:latest # v1.4.0
    # the api waits on Postgres
    depends_on:
      - postgres
    environment:
      BANNER: "a # inside a quoted scalar is the value"
      NOTE: "this scalar runs over
        two lines, and a # down here is the value too"
`;

const FIXTURE_SHELL = `#!/usr/bin/env bash
set -euo pipefail

# the swap waits for the health check
# shellcheck disable=SC2016
printf '%s\\n' "$PATH"

cat <<'EOF'
# a heredoc line is data
EOF

count=\${#PATH}
echo "count \${count}"  # the length, not a comment marker
`;

const FIXTURE_TOML = `# the worker's own lint settings
[tool.ruff]
line-length = 100
target-version = "py313"

[tool.ruff.lint]
# noqa
select = ["E", "F"]
ignore = ["E501"]  # the formatter owns the line length
banner = "a # inside a string is the value"
`;

const FIXTURE_SQL = `-- Custom migration (hand-written SQL; ADR 0032).
-- the substrate's first table, and the counter in front of /oauth2/*
CREATE TABLE workspace (
  id uuid PRIMARY KEY,
  slug text NOT NULL -- the slug is the operator's handle
);
--> statement-breakpoint
CREATE FUNCTION tenant() RETURNS uuid AS $$
BEGIN
  -- inside the body this line is the function's own source
  RETURN current_setting('app.workspace')::uuid;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
INSERT INTO note (body) VALUES ('a -- inside a literal is the value');
`;

// The corners a hand-written lexer gets wrong. In each the `#` or `--` is code, and reading it
// as a comment blesses a broken file.
const FIXTURE_YAML_CORNERS = `anchored: &tag "a # one"
tagged: !!str "b # two"
flow: [x, "c # three"]
plain: echo hi, 'there
folded: |2-
    echo "it's"
    echo "d # four"
after: 1
`;

const FIXTURE_SHELL_CORNERS = `#!/usr/bin/env bash
inner="$(printf 'e # five')"
ansi=$'it\\'s # six'
cat <<\\EOF
# seven is data
EOF
echo "done"
`;

const FIXTURE_TOML_CORNERS = `fenced = """a \\""" # eight"""
after = 1
`;

const FIXTURE_YAML_NESTING = `branches: [
  main, "release # nine"
]
nested:
  - - "a # ten"
? "a # eleven"
: value
json: {"k":"a # sixteen"}
plain:
  - run: echo key:'x
  - run: |
      echo "it's"
      echo "b # twelve"
`;

const FIXTURE_TOML_RUN = `fenced = """a""""
after = "b # thirteen"
`;

// Prose that reads like a directive is still prose, and a bare number is a step, not a pin.
const FIXTURE_PROSE = `# actionlint is a Homebrew binary, so the runner installs it
# step 3
# retry 2
lefthook: 2.1.12 # v2.1.12
uses: actions/checkout@v7 # v7.0.1
`;

const FIXTURE_SHELL_NESTING = `#!/usr/bin/env bash
x=$(
  true # it's
)
y=$(cat <<EOF
it's
EOF
)
echo 'a ) b # fourteen'
echo \${v:-a # fifteen}
sub="$( (cd /) ; echo "p # seventeen")"
echo "a$'b" 'c' "d # eighteen"
picked="$(case $1 in a) echo "q # nineteen" ;; esac)"
case "$1" in
a)
  found="$(cd / && ls "$HOME")"
  # this comment stands inside a case branch and must go
  ;;
esac
`;

// `case` and `esac` are keywords only where a command may start. Read anywhere else they leave
// the nesting wrong and the `#` after it swallowed.
const FIXTURE_SHELL_WORDS = `x="$(cat case.txt)"; echo "p # twenty"
y="$(echo the case is here)"; echo "q # twentyone"
z="$(true && echo case)" ; echo "r # twentytwo"
case $1 in
  a) w="$(echo esac)" ;;
esac
echo "s # twentythree"
v="$(case $1 in a) echo esac ;; b) echo "t # twentyfour" ;; esac)"
`;

const FIXTURE_SQL_CORNERS = `SELECT a/* nine */FROM t;
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
    {
      name: "JavaScript, untouched",
      file: "c.mjs",
      base: FIXTURE_MJS,
      current: FIXTURE_MJS,
      same: true,
    },
    {
      name: "JavaScript, comments removed",
      file: "c.mjs",
      base: FIXTURE_MJS,
      current: withoutLine(withoutLine(FIXTURE_MJS, "nobody reads"), "already resolved"),
      same: true,
    },
    {
      name: "JavaScript, one token edited",
      file: "c.mjs",
      base: FIXTURE_MJS,
      current: FIXTURE_MJS.replace('"/srv"', '"/var"'),
      same: false,
    },
    {
      name: "YAML, untouched",
      file: "check.yml",
      base: FIXTURE_WORKFLOW,
      current: FIXTURE_WORKFLOW,
      same: true,
    },
    {
      name: "YAML, comments removed",
      file: "check.yml",
      base: FIXTURE_WORKFLOW,
      current: withoutLine(FIXTURE_WORKFLOW, "has to come first"),
      same: true,
    },
    {
      name: "YAML, a comment below an apostrophe in a plain scalar removed",
      file: "check.yml",
      base: FIXTURE_WORKFLOW,
      current: withoutLine(FIXTURE_WORKFLOW, "opens no scalar"),
      same: true,
    },
    {
      name: "YAML, one token edited in a step",
      file: "check.yml",
      base: FIXTURE_WORKFLOW,
      current: FIXTURE_WORKFLOW.replace("pnpm check:gates", "pnpm check:docs"),
      same: false,
    },
    {
      name: "YAML, the pin tag lost",
      file: "check.yml",
      base: FIXTURE_WORKFLOW,
      current: FIXTURE_WORKFLOW.replace(" # v7.0.1", ""),
      same: false,
    },
    {
      name: "YAML, the language-server line lost",
      file: "check.yml",
      base: FIXTURE_WORKFLOW,
      current: withoutLine(FIXTURE_WORKFLOW, "yaml-language-server"),
      same: false,
    },
    {
      name: "YAML, a line inside a block scalar removed",
      file: "check.yml",
      base: FIXTURE_WORKFLOW,
      current: withoutLine(FIXTURE_WORKFLOW, "block scalar's own lines"),
      same: false,
    },
    {
      name: "Compose, comments removed",
      file: "compose.yaml",
      base: FIXTURE_COMPOSE,
      current: withoutLine(FIXTURE_COMPOSE, "waits on Postgres"),
      same: true,
    },
    {
      name: "Compose, one token edited in a key",
      file: "compose.yaml",
      base: FIXTURE_COMPOSE,
      current: FIXTURE_COMPOSE.replace("- postgres", "- postgres-read"),
      same: false,
    },
    {
      name: "Compose, a `#` inside a quoted scalar truncated",
      file: "compose.yaml",
      base: FIXTURE_COMPOSE,
      current: FIXTURE_COMPOSE.replace('"a # inside a quoted scalar is the value"', '"a # inside"'),
      same: false,
    },
    {
      name: "Compose, a `#` on a scalar's second line truncated",
      file: "compose.yaml",
      base: FIXTURE_COMPOSE,
      current: FIXTURE_COMPOSE.replace("and a # down here is the value too", "and a # down here"),
      same: false,
    },
    {
      name: "Shell, untouched",
      file: "swap.sh",
      base: FIXTURE_SHELL,
      current: FIXTURE_SHELL,
      same: true,
    },
    {
      name: "Shell, comments removed",
      file: "swap.sh",
      base: FIXTURE_SHELL,
      current: withoutLine(FIXTURE_SHELL, "waits for the health check").replace(
        "  # the length, not a comment marker",
        "",
      ),
      same: true,
    },
    {
      name: "Shell, one token edited in a command",
      file: "swap.sh",
      base: FIXTURE_SHELL,
      current: FIXTURE_SHELL.replace("set -euo pipefail", "set -eo pipefail"),
      same: false,
    },
    {
      name: "Shell, the shellcheck directive lost",
      file: "swap.sh",
      base: FIXTURE_SHELL,
      current: withoutLine(FIXTURE_SHELL, "shellcheck disable"),
      same: false,
    },
    {
      name: "Shell, a heredoc line removed",
      file: "swap.sh",
      base: FIXTURE_SHELL,
      current: withoutLine(FIXTURE_SHELL, "a heredoc line is data"),
      same: false,
    },
    {
      name: "Shell, hashbang lost",
      file: "swap.sh",
      base: FIXTURE_SHELL,
      current: withoutLine(FIXTURE_SHELL, "#!"),
      same: false,
    },
    {
      name: "TOML, untouched",
      file: "ruff.toml",
      base: FIXTURE_TOML,
      current: FIXTURE_TOML,
      same: true,
    },
    {
      name: "TOML, comments removed",
      file: "ruff.toml",
      base: FIXTURE_TOML,
      current: withoutLine(FIXTURE_TOML, "own lint settings").replace(
        "  # the formatter owns the line length",
        "",
      ),
      same: true,
    },
    {
      name: "TOML, one token edited",
      file: "ruff.toml",
      base: FIXTURE_TOML,
      current: FIXTURE_TOML.replace("line-length = 100", "line-length = 110"),
      same: false,
    },
    {
      name: "TOML, a `#` inside a string truncated",
      file: "ruff.toml",
      base: FIXTURE_TOML,
      current: FIXTURE_TOML.replace('"a # inside a string is the value"', '"a # inside"'),
      same: false,
    },
    {
      name: "SQL, untouched",
      file: "0000_substrate.sql",
      base: FIXTURE_SQL,
      current: FIXTURE_SQL,
      same: true,
    },
    {
      name: "SQL, comments removed",
      file: "0000_substrate.sql",
      base: FIXTURE_SQL,
      current: withoutLine(FIXTURE_SQL, "the substrate's first table").replace(
        " -- the slug is the operator's handle",
        "",
      ),
      same: true,
    },
    {
      name: "SQL, one token edited in a statement",
      file: "0000_substrate.sql",
      base: FIXTURE_SQL,
      current: FIXTURE_SQL.replace("id uuid PRIMARY KEY", "id text PRIMARY KEY"),
      same: false,
    },
    {
      name: "SQL, the statement breakpoint lost",
      file: "0000_substrate.sql",
      base: FIXTURE_SQL,
      current: FIXTURE_SQL.replace("--> statement-breakpoint\nCREATE FUNCTION", "CREATE FUNCTION"),
      same: false,
    },
    {
      name: "SQL, the custom-migration marker lost",
      file: "0000_substrate.sql",
      base: FIXTURE_SQL,
      current: withoutLine(FIXTURE_SQL, "Custom migration (hand-written"),
      same: false,
    },
    {
      name: "SQL, a comment inside a dollar-quoted body removed",
      file: "0000_substrate.sql",
      base: FIXTURE_SQL,
      current: withoutLine(FIXTURE_SQL, "the function's own source"),
      same: false,
    },
    {
      name: "SQL, a `--` inside a string literal truncated",
      file: "0000_substrate.sql",
      base: FIXTURE_SQL,
      current: FIXTURE_SQL.replace("'a -- inside a literal is the value'", "'a -- inside'"),
      same: false,
    },
    {
      name: "YAML, a `#` after an anchor truncated",
      file: "corners.yml",
      base: FIXTURE_YAML_CORNERS,
      current: FIXTURE_YAML_CORNERS.replace('"a # one"', '"a #"'),
      same: false,
    },
    {
      name: "YAML, a `#` after a tag truncated",
      file: "corners.yml",
      base: FIXTURE_YAML_CORNERS,
      current: FIXTURE_YAML_CORNERS.replace('"b # two"', '"b #"'),
      same: false,
    },
    {
      name: "YAML, a `#` inside a flow sequence truncated",
      file: "corners.yml",
      base: FIXTURE_YAML_CORNERS,
      current: FIXTURE_YAML_CORNERS.replace('"c # three"', '"c #"'),
      same: false,
    },
    {
      name: "YAML, a `#` in an indented block scalar truncated",
      file: "corners.yml",
      base: FIXTURE_YAML_CORNERS,
      current: FIXTURE_YAML_CORNERS.replace('"d # four"', '"d #"'),
      same: false,
    },
    {
      name: "Shell, a `#` inside a command substitution truncated",
      file: "corners.sh",
      base: FIXTURE_SHELL_CORNERS,
      current: FIXTURE_SHELL_CORNERS.replace("'e # five'", "'e #'"),
      same: false,
    },
    {
      name: "Shell, a `#` inside a `$'…'` string truncated",
      file: "corners.sh",
      base: FIXTURE_SHELL_CORNERS,
      current: FIXTURE_SHELL_CORNERS.replace("# six", "#"),
      same: false,
    },
    {
      name: "Shell, a line inside an escaped heredoc removed",
      file: "corners.sh",
      base: FIXTURE_SHELL_CORNERS,
      current: withoutLine(FIXTURE_SHELL_CORNERS, "seven is data"),
      same: false,
    },
    {
      name: "TOML, a `#` inside an escaped fence truncated",
      file: "corners.toml",
      base: FIXTURE_TOML_CORNERS,
      current: FIXTURE_TOML_CORNERS.replace("# eight", "#"),
      same: false,
    },
    {
      name: "YAML, the corner fixture untouched",
      file: "corners.yml",
      base: FIXTURE_YAML_CORNERS,
      current: FIXTURE_YAML_CORNERS,
      same: true,
    },
    {
      name: "Shell, the corner fixture untouched",
      file: "corners.sh",
      base: FIXTURE_SHELL_CORNERS,
      current: FIXTURE_SHELL_CORNERS,
      same: true,
    },
    {
      name: "TOML, the corner fixture untouched",
      file: "corners.toml",
      base: FIXTURE_TOML_CORNERS,
      current: FIXTURE_TOML_CORNERS,
      same: true,
    },
    {
      name: "YAML, the nesting fixture untouched",
      file: "nesting.yml",
      base: FIXTURE_YAML_NESTING,
      current: FIXTURE_YAML_NESTING,
      same: true,
    },
    {
      name: "YAML, a `#` in a flow sequence over two lines truncated",
      file: "nesting.yml",
      base: FIXTURE_YAML_NESTING,
      current: FIXTURE_YAML_NESTING.replace('"release # nine"', '"release #"'),
      same: false,
    },
    {
      name: "YAML, a `#` in a nested sequence truncated",
      file: "nesting.yml",
      base: FIXTURE_YAML_NESTING,
      current: FIXTURE_YAML_NESTING.replace('"a # ten"', '"a #"'),
      same: false,
    },
    {
      name: "YAML, a `#` in a complex key truncated",
      file: "nesting.yml",
      base: FIXTURE_YAML_NESTING,
      current: FIXTURE_YAML_NESTING.replace('"a # eleven"', '"a #"'),
      same: false,
    },
    {
      name: "YAML, a `#` below a colon with no space truncated",
      file: "nesting.yml",
      base: FIXTURE_YAML_NESTING,
      current: FIXTURE_YAML_NESTING.replace('"b # twelve"', '"b #"'),
      same: false,
    },
    {
      name: "YAML, a `#` in a JSON-spelled flow mapping truncated",
      file: "nesting.yml",
      base: FIXTURE_YAML_NESTING,
      current: FIXTURE_YAML_NESTING.replace('"a # sixteen"', '"a #"'),
      same: false,
    },
    {
      name: "YAML, tool-shaped prose and bare numbers are removed",
      file: "prose.yml",
      base: FIXTURE_PROSE,
      current: `lefthook: 2.1.12 # v2.1.12\nuses: actions/checkout@v7 # v7.0.1\n`,
      same: true,
    },
    {
      name: "YAML, a key's own pin tag lost",
      file: "prose.yml",
      base: FIXTURE_PROSE,
      current: FIXTURE_PROSE.replace(" # v2.1.12", ""),
      same: false,
    },
    {
      name: "TOML, the quote-run fixture untouched",
      file: "run.toml",
      base: FIXTURE_TOML_RUN,
      current: FIXTURE_TOML_RUN,
      same: true,
    },
    {
      name: "TOML, a `#` after a closing quote run truncated",
      file: "run.toml",
      base: FIXTURE_TOML_RUN,
      current: FIXTURE_TOML_RUN.replace('"b # thirteen"', '"b #"'),
      same: false,
    },
    {
      name: "Shell, the nesting fixture untouched",
      file: "nesting.sh",
      base: FIXTURE_SHELL_NESTING,
      current: FIXTURE_SHELL_NESTING,
      same: true,
    },
    {
      name: "Shell, a `#` after a substitution carrying an apostrophe truncated",
      file: "nesting.sh",
      base: FIXTURE_SHELL_NESTING,
      current: FIXTURE_SHELL_NESTING.replace("'a ) b # fourteen'", "'a ) b #'"),
      same: false,
    },
    {
      name: "Shell, a `#` inside a parameter expansion truncated",
      file: "nesting.sh",
      base: FIXTURE_SHELL_NESTING,
      current: FIXTURE_SHELL_NESTING.replace("# fifteen", "#"),
      same: false,
    },
    {
      name: "Shell, a `#` after a subshell inside a substitution truncated",
      file: "nesting.sh",
      base: FIXTURE_SHELL_NESTING,
      current: FIXTURE_SHELL_NESTING.replace('"p # seventeen"', '"p #"'),
      same: false,
    },
    {
      name: "Shell, a `#` after a literal `$'` inside a double quote truncated",
      file: "nesting.sh",
      base: FIXTURE_SHELL_NESTING,
      current: FIXTURE_SHELL_NESTING.replace('"d # eighteen"', '"d #"'),
      same: false,
    },
    {
      name: "Shell, a `#` after a case pattern's `)` truncated",
      file: "nesting.sh",
      base: FIXTURE_SHELL_NESTING,
      current: FIXTURE_SHELL_NESTING.replace('"q # nineteen"', '"q #"'),
      same: false,
    },
    {
      name: "Shell, the keyword fixture untouched",
      file: "words.sh",
      base: FIXTURE_SHELL_WORDS,
      current: FIXTURE_SHELL_WORDS,
      same: true,
    },
    {
      name: "Shell, a `#` after a substitution naming a case file truncated",
      file: "words.sh",
      base: FIXTURE_SHELL_WORDS,
      current: FIXTURE_SHELL_WORDS.replace('"p # twenty"', '"p #"'),
      same: false,
    },
    {
      name: "Shell, a `#` after `case` as an ordinary word truncated",
      file: "words.sh",
      base: FIXTURE_SHELL_WORDS,
      current: FIXTURE_SHELL_WORDS.replace('"q # twentyone"', '"q #"'),
      same: false,
    },
    {
      name: "Shell, a `#` after `case` as a final argument truncated",
      file: "words.sh",
      base: FIXTURE_SHELL_WORDS,
      current: FIXTURE_SHELL_WORDS.replace('"r # twentytwo"', '"r #"'),
      same: false,
    },
    {
      name: "Shell, a `#` after `esac` echoed inside a case branch truncated",
      file: "words.sh",
      base: FIXTURE_SHELL_WORDS,
      current: FIXTURE_SHELL_WORDS.replace('"s # twentythree"', '"s #"'),
      same: false,
    },
    {
      name: "Shell, a `#` after `esac` echoed inside a substitution truncated",
      file: "words.sh",
      base: FIXTURE_SHELL_WORDS,
      current: FIXTURE_SHELL_WORDS.replace('"t # twentyfour"', '"t #"'),
      same: false,
    },
    {
      name: "Shell, a comment inside a case branch removed",
      file: "nesting.sh",
      base: FIXTURE_SHELL_NESTING,
      current: withoutLine(FIXTURE_SHELL_NESTING, "inside a case branch"),
      same: true,
    },
    {
      name: "Shell, a comment inside a substitution removed",
      file: "nesting.sh",
      base: FIXTURE_SHELL_NESTING,
      current: withoutLine(FIXTURE_SHELL_NESTING, "true # it's").replace(
        "x=$(\n)",
        "x=$(\n  true\n)",
      ),
      same: true,
    },
    {
      name: "SQL, a block comment between two words closes up",
      file: "corners.sql",
      base: FIXTURE_SQL_CORNERS,
      current: "SELECT a FROM t;\n",
      same: true,
    },
    {
      name: "SQL, a block comment's neighbours run together",
      file: "corners.sql",
      base: FIXTURE_SQL_CORNERS,
      current: "SELECT aFROM t;\n",
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
      `comment-only-proof: no file the syntax table reads changed against ${options.base}\n`,
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
