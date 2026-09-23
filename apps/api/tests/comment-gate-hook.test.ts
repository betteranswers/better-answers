import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

import { hookScript, runHook, scratchRoot, type HookRun } from "./worktree-hooks.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const script = hookScript("comment-gate-hook");

const scratch = scratchRoot("comment-gate-hook");

// Borrowed, not rebuilt: a tree without the checkout's gate tooling answers silence.
const treeWithTheGateTooling = (name: string): string => {
  const root = throwawayRepository(path.join(scratch, name));
  symlinkSync(path.join(repositoryRoot, "node_modules"), path.join(root, "node_modules"));
  mkdirSync(path.join(root, "packages/devtools"), { recursive: true });
  // Each part on its own, so `lifts` stays a real directory this tree can write into.
  for (const part of ["lint-rules", "python"]) {
    symlinkSync(
      path.join(repositoryRoot, "packages/devtools", part),
      path.join(root, "packages/devtools", part),
    );
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

// Spelled in two halves, so the tag scan does not read a fixture as a citation.
const tag = (family: string, number: string): string => `[${family}${number}]`;

const scriptsByName = z.record(z.string(), z.string());
type Scripts = Readonly<z.infer<typeof scriptsByName>>;
const rootManifest = z.object({ scripts: scriptsByName.optional() });

const rootScripts = (): Scripts => {
  const { scripts } = rootManifest.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")),
  );
  if (scripts === undefined) {
    throw new Error("the root package.json carries no scripts, so nothing here is being proved.");
  }
  return scripts;
};

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

const configPath = (): string =>
  pathIn(rootScripts()["comment-gate:ts"] ?? "", /packages\/\S+\.oxlintrc\.json/);

const checkerPath = (): string =>
  pathIn(rootScripts()["comment-gate:python"] ?? "", /packages\/\S+\.py/);

const gateConfig = z.object({ ignorePatterns: z.array(z.string()).optional() });

// The config is JSONC, so the comment lines go before the parse; reading its patterns here
// stops hook and config drifting apart.
const ignorePatterns = (): readonly string[] => {
  const source = readFileSync(path.join(repositoryRoot, configPath()), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  const { ignorePatterns: patterns } = gateConfig.parse(JSON.parse(source));
  if ((patterns ?? []).length === 0) {
    throw new Error(`${configPath()} names no ignore pattern, so this reading proves nothing.`);
  }
  return patterns ?? [];
};

// A bare name is a directory at any depth; a path pattern is one place. Both reach the
// gate only under its two roots.
const probeUnder = (pattern: string): string | undefined => {
  if (!pattern.includes("/")) return `packages/probe/${pattern}/probe.ts`;
  const prefix = pattern.replace(/\*+$/, "");
  return prefix.startsWith("apps/") || prefix.startsWith("packages/")
    ? `${prefix}probe.ts`
    : undefined;
};

const skippable = (): readonly (readonly [string, string])[] =>
  ignorePatterns().flatMap((pattern) => {
    const probe = probeUnder(pattern);
    return probe === undefined ? [] : [[pattern, probe] as const];
  });

// A silence below means nothing until the gate is known to be loud in this tree.
const smoke = edit("packages/smoke/probe.ts", `// ${FORTY_WORDS}\nexport const keep = 1;\n`);
if (smoke.status !== 2 || !smoke.stderr.includes("runs to 40 words")) {
  throw new Error(
    `the hook did not refuse a 40-word comment in this tree, so no silence below can be read as the gate staying quiet. It exited ${String(smoke.status)} saying:\n${smoke.stderr}`,
  );
}

describe("the write-time hook hands back the comment rule the edit broke", () => {
  it("refuses a 40-word TypeScript comment, naming the count and its rule", () => {
    const run = edit("packages/probe/long.ts", `// ${FORTY_WORDS}\nexport const keep = 1;\n`);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("runs to 40 words");
    expect(run.stderr).toContain(tag("COMMENT", "1"));
  });

  it("refuses a 40-word Python comment, naming the count and its rule", () => {
    const run = edit("packages/probe/long.py", `# ${FORTY_WORDS}\nKEEP = 1\n`);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("runs to 40 words");
    expect(run.stderr).toContain(tag("COMMENT", "1"));
  });

  it.each([
    ["a YAML file", "packages/probe/long.yml", `# ${FORTY_WORDS}\nkeep: 1\n`],
    ["a shell file", "packages/probe/long.sh", `# ${FORTY_WORDS}\nKEEP=1\n`],
    ["a TOML file", "packages/probe/long.toml", `# ${FORTY_WORDS}\nkeep = 1\n`],
    ["a SQL file", "packages/probe/long.sql", `-- ${FORTY_WORDS}\nSELECT 1;\n`],
    ["a root script", "scripts/long.mjs", `// ${FORTY_WORDS}\nexport const keep = 1;\n`],
    ["a hook script", ".claude/hooks/long.sh", `# ${FORTY_WORDS}\nKEEP=1\n`],
    ["a root configuration file", "lefthook.yml", `# ${FORTY_WORDS}\nkeep: 1\n`],
  ])("refuses a 40-word comment in %s, naming the count and its rule", (_what, file, source) => {
    const run = edit(file, source);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("runs to 40 words");
    expect(run.stderr).toContain(tag("COMMENT", "1"));
  });

  it("reads a relative path against the session's directory, as the docs write one", () => {
    const file = "packages/probe/relative.ts";
    writeUnder(tree, file, `// ${FORTY_WORDS}\nexport const keep = 1;\n`);

    const run = runHook(script, {
      input: JSON.stringify({ tool_name: "Write", cwd: tree, tool_input: { file_path: file } }),
      env: {},
    });

    expect(run.status).toBe(2);
  });

  it("refuses a comment citing a ticket, which is the gate's other condition", () => {
    const citing =
      "// Kept because the claim protocol changed under T-243.\nexport const keep = 1;\n";

    expect(edit("packages/probe/cites.ts", citing).status).toBe(2);
  });
});

describe("the write-time hook is silent where the comment earns its place", () => {
  it.each([
    ["a why inside the ceiling", "probe/why.ts", `// ${A_WHY_OF_TWENTY}\nexport const keep = 1;\n`],
    [
      "a linter directive",
      "probe/directive.ts",
      "// oxlint-disable no-console\nexport const x = 1;\n",
    ],
    ["a why inside the ceiling", "probe/why.py", `# ${A_WHY_OF_TWENTY}\nKEEP = 1\n`],
    ["a type-checker escape", "probe/directive.py", "# type: ignore[attr-defined]\nKEEP = 1\n"],
    ["a why inside the ceiling", "probe/why.yml", `# ${A_WHY_OF_TWENTY}\nkeep: 1\n`],
    [
      "an editor schema line",
      "probe/directive.yml",
      "# yaml-language-server: $schema=x\nkeep: 1\n",
    ],
    ["a why inside the ceiling", "probe/why.sh", `# ${A_WHY_OF_TWENTY}\nKEEP=1\n`],
    ["a shellcheck directive", "probe/directive.sh", "# shellcheck disable=SC2016\nKEEP=1\n"],
    ["a why inside the ceiling", "probe/why.toml", `# ${A_WHY_OF_TWENTY}\nkeep = 1\n`],
    ["a renovate directive", "probe/directive.toml", "# renovate: datasource=docker\nkeep = 1\n"],
    ["a why inside the ceiling", "probe/why.sql", `-- ${A_WHY_OF_TWENTY}\nSELECT 1;\n`],
    ["a migration separator", "probe/directive.sql", "SELECT 1;\n--> statement-breakpoint\n"],
  ])("lets %s through", (_what, file, source) => {
    const run = edit(`packages/${file}`, source);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
  });
});

describe("the write-time hook speaks only for what root `check` gates", () => {
  it.each([
    ["a file outside apps and packages", "tools/loose.ts"],
    ["a file the gate has no reader for", "packages/probe/notes.md"],
  ])("walks past %s", (_what, file) => {
    expect(edit(file, `// ${FORTY_WORDS}\nexport const keep = 1;\n`).status).toBe(0);
  });

  it("walks past a path no checkout owns rather than refusing the edit", () => {
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

  it("leaves no ignore pattern of the config's unaccounted for", () => {
    const unreached = ignorePatterns().filter((pattern) => probeUnder(pattern) === undefined);

    expect(unreached.filter((p) => p.startsWith("apps/") || p.startsWith("packages/"))).toEqual([]);
  });
});

describe("the write-time hook blames a comment only when the gate names one", () => {
  it("lets a half-written file through rather than calling a parse error a comment", () => {
    const run = edit("packages/probe/broken.ts", "export const broken = (\n");

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("without naming a comment");
  });
});

describe("the write-time hook refuses nothing when it cannot run the gate", () => {
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

// Two readings of one list, each read here rather than restated, so neither drifts.
const tableSuffixes = (): readonly string[] => {
  const source = readFileSync(path.join(repositoryRoot, checkerPath()), "utf8");
  const table = /SYNTAX[^{]*\{(?<body>[^}]*)\}/.exec(source)?.groups?.["body"];
  if (table === undefined) {
    throw new Error(`${checkerPath()} carries no syntax table this reading can find.`);
  }
  return [...table.matchAll(/"(?<suffix>\.\w+)"/g)].map((found) => found.groups?.["suffix"] ?? "");
};

const branchSuffixes = (): readonly string[] => {
  const branch = [...hookText.matchAll(/^(?<case>\*\..*)\)$/gm)]
    .map((found) => found.groups?.["case"] ?? "")
    .find((one) => one.includes("*.py"));
  if (branch === undefined) {
    throw new Error(`${path.basename(script)} names no branch for the checker's file types.`);
  }
  return branch.split("|").map((one) => one.trim().replace(/^\*/, ""));
};

describe("the write-time hook runs the same gate the root check runs", () => {
  it("names the config `comment-gate:ts` names", () => {
    expect(hookText).toContain(configPath());
  });

  it("dispatches to the checker on every file type its syntax table reads", () => {
    expect([...branchSuffixes()].sort()).toEqual([...tableSuffixes()].sort());
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

describe("the write-time hook is wired where the project's other hooks are", () => {
  it("runs after an edit and after a write, once", () => {
    expect(wiring().map((entry) => entry.matcher)).toEqual(["Edit|Write"]);
  });

  it("carries a timeout, because an unbounded gate would hang the edit", () => {
    expect(wiring().map((entry) => entry.timeout)).toEqual([15]);
  });
});
