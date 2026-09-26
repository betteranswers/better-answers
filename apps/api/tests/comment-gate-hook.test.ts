import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { pythonGateRoots, rootScripts } from "@better-answers/devtools/root-commands";
import { throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

import { hookScript, runHook, scratchRoot, type HookRun } from "./worktree-hooks.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const script = hookScript("comment-gate-hook");

const scratch = scratchRoot("comment-gate-hook");

const ANTI_SLOP = "packages/devtools/lifts/anti-slop";

/** Borrowed, not rebuilt: a tree without the checkout's gate tooling answers silence. */
const treeWithTheGateTooling = (name: string): string => {
  const root = throwawayRepository(path.join(scratch, name));
  // Each part on its own, so the lift's directory stays real and this tree can write into it.
  mkdirSync(path.join(root, ANTI_SLOP), { recursive: true });
  for (const part of [
    ".oxlintrc.json",
    "node_modules",
    "packages/devtools/lint-rules",
    "packages/devtools/python",
    `${ANTI_SLOP}/index.ts`,
  ]) {
    symlinkSync(path.join(repositoryRoot, part), path.join(root, part));
  }
  return root;
};

const tree = treeWithTheGateTooling("tree");

const edit = (file: string, source: string): HookRun => {
  writeUnder(tree, file, source);
  return runHook(script, {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      cwd: tree,
      tool_input: { file_path: path.join(tree, file) },
    }),
    env: {},
  });
};

const FORTY_WORDS =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven twentyeight twentynine thirty thirtyone thirtytwo thirtythree thirtyfour thirtyfive thirtysix thirtyseven thirtyeight thirtynine forty";

const A_WHY_OF_TWENTY =
  "Deleting this line changes what the engine memoises, and every caller below then reads a value the store never wrote";

/** Spelled in two halves, so the tag scan does not read a fixture as a citation. */
const tag = (family: string, number: string): string => `[${family}${number}]`;

const hookText = readFileSync(script, "utf8");

const pathIn = (command: string, pattern: RegExp): string => {
  const found = pattern.exec(command)?.[0];
  if (found === undefined) {
    throw new Error(
      `\`${command}\` names no path this reading can find, so the check below is empty.`,
    );
  }
  return found;
};

const checkerPath = (): string =>
  pathIn(rootScripts()["comment-gate:python"] ?? "", /packages\/\S+\.py/);

const CONFIG = ".oxlintrc.json";

const rootConfig = z.object({ ignorePatterns: z.array(z.string()).optional() });

/** Read here rather than restated, so hook and config cannot drift apart. */
const ignorePatterns = (): readonly string[] => {
  const { ignorePatterns: patterns } = rootConfig.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, CONFIG), "utf8")),
  );
  if ((patterns ?? []).length === 0) {
    throw new Error(`${CONFIG} names no ignore pattern, so this reading proves nothing.`);
  }
  return patterns ?? [];
};

/**
 * A bare name is a directory at any depth, a double-star pattern a file anywhere, and any other
 * one place.
 */
const probeUnder = (pattern: string): string => {
  if (!pattern.includes("/")) return `packages/probe/${pattern}/probe.ts`;
  if (pattern.startsWith("**/")) return `packages/probe/${pattern.slice(3).replaceAll("*", "x")}`;
  return `${pattern.replace(/\*+$/, "")}probe.ts`;
};

const skippable = (): readonly (readonly [string, string])[] =>
  ignorePatterns().map((pattern) => [pattern, probeUnder(pattern)] as const);

/** A silence below means nothing until the gate is known to be loud in this tree. */
const smoke = edit("packages/smoke/probe.ts", `// ${FORTY_WORDS}\nexport const keep = 1;\n`);
if (smoke.status !== 2 || !smoke.stderr.includes("runs to 40 words")) {
  throw new Error(
    `the hook did not refuse a 40-word comment in this tree, so no silence below can be read as the gate staying quiet. It exited ${String(smoke.status)} saying:\n${smoke.stderr}`,
  );
}

const CASE_BLOCK = /case "\$RELATIVE" in\n([\s\S]*?)\n\s*esac/;

/** The roots a `case` arm names, with the trailing glob off, so `scripts/*` reads as `scripts`. */
const rootsIn = (hook: string): readonly string[] => {
  const block = CASE_BLOCK.exec(hook)?.[1];
  if (block === undefined) throw new Error("the hook holds no `$RELATIVE` case block to read");
  return block
    .split("\n")
    .flatMap((line) => (line.split(")")[0] ?? "").split("|"))
    .map((pattern) => pattern.trim().replace(/\/\*$/, ""))
    .filter((pattern) => pattern !== "" && pattern !== "*");
};

const missingFrom = (named: readonly string[], read: readonly string[]): readonly string[] =>
  named.filter((root) => !read.includes(root)).sort();

describe("the write-time hook and the Python gate share roots", () => {
  it("finds every hook root in the Python gate's command", () => {
    expect(missingFrom(rootsIn(hookText), pythonGateRoots())).toEqual([]);
  });

  it("reads every Python gate root, so rules bind before CI", () => {
    expect(missingFrom(pythonGateRoots(), rootsIn(hookText))).toEqual([]);
  });

  it("reports a gap on either side, read off fixture text", () => {
    const fixture = '  case "$RELATIVE" in\n  nowhere/* | apps/*) ;;\n  *) exit 0 ;;\n  esac';

    expect(missingFrom(rootsIn(fixture), pythonGateRoots())).toEqual(["nowhere"]);
    expect(missingFrom(pythonGateRoots(), rootsIn(fixture))).toContain("packages");
  });
});

describe("the write-time hook hands back the broken comment rule", () => {
  it("refuses a 40-word TypeScript comment, naming count and rule", () => {
    const run = edit("packages/probe/long.ts", `// ${FORTY_WORDS}\nexport const keep = 1;\n`);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("runs to 40 words");
    expect(run.stderr).toContain(tag("COMMENT", "1"));
  });

  it("refuses a 40-word Python comment, naming count and rule", () => {
    const run = edit("packages/probe/long.py", `# ${FORTY_WORDS}\nKEEP = 1\n`);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("runs to 40 words");
    expect(run.stderr).toContain(tag("COMMENT", "1"));
  });

  it.each([["a root script", "scripts/long.mjs", `// ${FORTY_WORDS}\nexport const keep = 1;\n`]])(
    "refuses %s's 40-word comment, naming count and rule",
    (_what, file, source) => {
      const run = edit(file, source);

      expect(run.status).toBe(2);
      expect(run.stderr).toContain("runs to 40 words");
      expect(run.stderr).toContain(tag("COMMENT", "1"));
    },
  );

  it("reads a relative path against the session's directory", () => {
    const file = "packages/probe/relative.ts";
    writeUnder(tree, file, `// ${FORTY_WORDS}\nexport const keep = 1;\n`);

    const run = runHook(script, {
      input: JSON.stringify({ tool_name: "Write", cwd: tree, tool_input: { file_path: file } }),
      env: {},
    });

    expect(run.status).toBe(2);
  });

  it("refuses a comment citing a ticket, the gate's other condition", () => {
    const citing =
      "// Kept because the claim protocol changed under T-243.\nexport const keep = 1;\n";

    expect(edit("packages/probe/cites.ts", citing).status).toBe(2);
  });
});

describe("the write-time hook passes a comment that earns its place", () => {
  it.each([
    [
      "a why inside the ceiling",
      "probe/why.ts",
      `/** ${A_WHY_OF_TWENTY} */\nexport const keep = 1;\n`,
    ],
    [
      "a linter directive",
      "probe/directive.ts",
      "// oxlint-disable-next-line no-console -- the runner prints\nconsole.log(1);\n",
    ],
    ["a why inside the ceiling", "probe/why.py", `# ${A_WHY_OF_TWENTY}\nKEEP = 1\n`],
    ["a type-checker escape", "probe/directive.py", "# type: ignore[attr-defined]\nKEEP = 1\n"],
  ])("lets %s through", (_what, file, source) => {
    const run = edit(`packages/${file}`, source);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
  });

  it.each([
    ["YAML", "packages/probe/long.yml", `# ${FORTY_WORDS}\nkeep: 1\n`],
    ["shell", "packages/probe/long.sh", `# ${FORTY_WORDS}\nKEEP=1\n`],
    ["TOML", "packages/probe/long.toml", `# ${FORTY_WORDS}\nkeep = 1\n`],
    ["SQL", "packages/probe/long.sql", `-- ${FORTY_WORDS}\nSELECT 1;\n`],
    ["workflow", ".github/workflows/long.yml", `# ${FORTY_WORDS}\nname: probe\n`],
  ])("lets a 40-word %s comment through, being no Python", (_what, file, source) => {
    const run = edit(file, source);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
  });
});

describe("the write-time hook speaks only for what root `check` gates", () => {
  it.each([
    ["a Python file outside the Python gate's roots", "tools/loose.py"],
    ["a file the gate has no reader for", "packages/probe/notes.md"],
  ])("walks past %s", (_what, file) => {
    expect(edit(file, `// ${FORTY_WORDS}\nexport const keep = 1;\n`).status).toBe(0);
  });

  it("refuses TypeScript outside the Python roots, which lint walks too", () => {
    const run = edit("tools/loose.ts", `// ${FORTY_WORDS}\nexport const keep = 1;\n`);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("runs to 40 words");
  });

  it("walks past a path no checkout owns", () => {
    const loose = path.join(scratch, "unowned.ts");
    writeUnder(scratch, "unowned.ts", `// ${FORTY_WORDS}\nexport const keep = 1;\n`);

    const run = runHook(script, {
      input: JSON.stringify({ tool_input: { file_path: loose }, cwd: scratch }),
      env: {},
    });

    expect(run.status).toBe(0);
  });

  it("says nothing about an input carrying no path", () => {
    expect(runHook(script, { input: "{}", env: {} }).status).toBe(0);
  });

  it.each(skippable())("walks past %s, which the root run never reads", (_pattern, probe) => {
    expect(edit(probe, `// ${FORTY_WORDS}\nexport const keep = 1;\n`).status).toBe(0);
  });
});

describe("the write-time hook runs the root config's comment rules", () => {
  it.each([
    ["a TODO", "packages/probe/todo.ts", "// TODO: file the ticket\n", "no-warning-comments"],
    ["`@ts-ignore`", "packages/probe/ignore.ts", "// @ts-ignore\n", "ban-ts-comment"],
    [
      "`@ts-ignore`, naming its replacement",
      "packages/probe/prefer.ts",
      "// @ts-ignore\n",
      "prefer-ts-expect-error",
    ],
    [
      "a disable naming no rule",
      "packages/probe/blanket.ts",
      "/* eslint-disable */\n",
      "no-abusive-eslint-disable",
    ],
    [
      "a 40-word comment",
      "packages/probe/long-named.ts",
      `// ${FORTY_WORDS}\n`,
      "comment-only-the-why",
    ],
    [
      "a line comment on a declaration",
      "packages/probe/doc-block.ts",
      "// Kept short.\n",
      "declaration-doc-block",
    ],
    [
      "a disable with no reason",
      "packages/probe/bare.ts",
      "// oxlint-disable-next-line no-console\nconsole.log(1);\n",
      "gives no reason",
    ],
    [
      "a disable that suppresses nothing",
      "packages/probe/unused.ts",
      "// oxlint-disable-next-line no-console -- the runner prints\n",
      "Unused oxlint-disable directive",
    ],
    [
      "a string citing a ticket",
      "packages/probe/usage.ts",
      'export const usage = "Ask the owner about T-243 first.";\n',
      "string-cites-nothing",
    ],
  ])("refuses %s, as root lint does", (_what, file, source, named) => {
    const run = edit(file, `${source}export const keep = 1;\n`);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain(named);
  });
});

describe("the write-time hook blames only a comment the gate names", () => {
  it("lets a half-written file through without blaming a comment", () => {
    const run = edit("packages/probe/broken.ts", "export const broken = (\n");

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("without naming a comment");
  });

  it("lets through a line only another rule refuses", () => {
    const run = edit("packages/probe/prints.ts", "console.log(1);\nexport const keep = 1;\n");

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("without naming a comment");
  });

  it("hands back only the comment's line beside another failing rule", () => {
    const run = edit(
      "packages/probe/both.ts",
      `// ${FORTY_WORDS}\nconsole.log(1);\nexport const keep = 1;\n`,
    );

    expect(run.status).toBe(2);
    expect(run.stderr).not.toContain("no-console");
  });
});

describe("the write-time hook refuses nothing when the gate cannot run", () => {
  const bare = throwawayRepository(path.join(scratch, "bare"));

  it.each([
    ["TypeScript", "packages/probe/long.ts", `// ${FORTY_WORDS}\nexport const keep = 1;\n`],
    ["Python", "packages/probe/long.py", `# ${FORTY_WORDS}\nKEEP = 1\n`],
  ])("lets a %s edit through and says why on stderr", (_language, file, source) => {
    writeUnder(bare, file, source);

    const run = runHook(script, {
      input: JSON.stringify({ cwd: bare, tool_input: { file_path: path.join(bare, file) } }),
      env: {},
    });

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("comment-gate-hook:");
  });
});

const branchSuffixes = (): readonly string[] => {
  const branch = [...hookText.matchAll(/^(?<case>\*\..*)\)$/gm)]
    .map((found) => found.groups?.["case"] ?? "")
    .find((one) => one.includes("*.py"));
  if (branch === undefined) {
    throw new Error(`${path.basename(script)} names no branch for the checker's file types.`);
  }
  return branch.split("|").map((one) => one.trim().replace(/^\*/, ""));
};

describe("the write-time hook runs the root check's own gate", () => {
  it("dispatches to the checker on Python files alone", () => {
    expect(branchSuffixes()).toEqual([".py"]);
  });

  it("names the checker `comment-gate:python` names", () => {
    const named = checkerPath();

    expect(hookText).toContain(named);
  });
});

const hookCommand = z.object({ command: z.string().optional(), timeout: z.number().optional() });
const hookMatcher = z.object({
  matcher: z.string().optional(),
  hooks: z.array(hookCommand).optional(),
});
const settings = z.object({ hooks: z.record(z.string(), z.array(hookMatcher)).optional() });

const SETTINGS = path.join(repositoryRoot, ".claude/settings.json");

const wiring = (): readonly { matcher: string | undefined; timeout: number | undefined }[] => {
  const { hooks } = settings.parse(JSON.parse(readFileSync(SETTINGS, "utf8")));
  return (hooks?.["PostToolUse"] ?? []).flatMap((entry) =>
    (entry.hooks ?? [])
      .filter((hook) => hook.command?.includes(path.basename(script)) === true)
      .map((hook) => ({ matcher: entry.matcher, timeout: hook.timeout })),
  );
};

describe("the write-time hook is wired beside the project's other hooks", () => {
  it("runs after an edit and after a write, once", () => {
    expect(wiring().map((entry) => entry.matcher)).toEqual(["Edit|Write"]);
  });

  it("carries a timeout, since an unbounded gate hangs the edit", () => {
    expect(wiring().map((entry) => entry.timeout)).toEqual([15]);
  });
});
