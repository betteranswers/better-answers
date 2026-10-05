import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { rootScripts } from "@better-answers/devtools/root-commands";
import {
  gitIn,
  runsOverThrowawayTree,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";
import type { Tool } from "@better-answers/devtools/throwaway-tree";

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const command = z.object({
  run: z.string().optional(),
  root: z.string().optional(),
});
type Command = z.infer<typeof command>;
const hook = z.object({ commands: z.record(z.string(), command).optional() }).optional();
const lefthook = z.object({ "pre-commit": hook, "pre-push-gates": hook });
type Lefthook = z.infer<typeof lefthook>;

const config = (): Lefthook => lefthook.parse(parse(read("lefthook.yml")));

const declared = (name: keyof Lefthook) => {
  const found = config()[name];
  if (found === undefined) throw new Error(`lefthook.yml declares no \`${name}\` hook`);
  return found;
};

const commands = (): Record<string, Command> => declared("pre-commit").commands ?? {};

const runOf = (name: string): string => {
  const command = commands()[name];
  if (command?.run === undefined) throw new Error(`no \`${name}\` command in lefthook.yml`);
  return command.run;
};

const binaryManifest = z.object({
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
});

const declaredBinary = (packageName: string, binaryName: string = packageName): string => {
  const manifestPath = createRequire(import.meta.url).resolve(`${packageName}/package.json`);
  const { bin } = binaryManifest.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const relative = typeof bin === "string" ? bin : bin?.[binaryName];
  if (relative === undefined) {
    throw new Error(`${packageName} declares no \`${binaryName}\` binary`);
  }
  return path.join(path.dirname(manifestPath), relative);
};

const manifestScripts = (workspace: string): Readonly<Record<string, string>> =>
  z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(read(`${workspace}/package.json`))).scripts;

const SCRIPT_CALL = /(?:pnpm run|check\.mjs)\s+([\w:.\- ]+)/g;

/**
 * A delegating command names its binary in the script it runs, or in the steps that script
 * hands the `check` runner.
 */
const reachedFrom = (workspace: string, run: string): string => {
  const scripts = manifestScripts(workspace);
  const namedIn = (text: string): readonly string[] =>
    [...text.matchAll(SCRIPT_CALL)].flatMap(([, list]) => (list ?? "").trim().split(/\s+/));
  const bodies = (names: readonly string[]): readonly string[] =>
    names.flatMap((name) => (scripts[name] === undefined ? [] : [scripts[name]]));

  const first = bodies(namedIn(run));
  if (first.length === 0) throw new Error(`\`${run}\` reaches no script ${workspace} declares`);
  return [...first, ...bodies(first.flatMap(namedIn))].join("\n");
};

type Proof =
  | {
      readonly kind: "npm";
      readonly package: string;
      readonly binary?: string;
      readonly via?: string;
    }
  | { readonly kind: "uv" }
  | { readonly kind: "root-script"; readonly script: string };

const HOOK: Readonly<Record<string, Proof>> = {
  oxfmt: { kind: "npm", package: "oxfmt" },
  oxlint: { kind: "npm", package: "oxlint" },
  "ruff-format": { kind: "uv" },
  "ruff-check": { kind: "uv" },
  actionlint: { kind: "root-script", script: "lint:workflows:actionlint" },
  "api-typecheck": { kind: "npm", package: "typescript", binary: "tsc", via: "apps/api" },
  "web-typecheck": { kind: "npm", package: "typescript", binary: "tsc", via: "apps/web" },
  "core-typecheck": { kind: "npm", package: "typescript", binary: "tsc", via: "packages/core" },
  "schema-typecheck": { kind: "npm", package: "typescript", binary: "tsc", via: "packages/schema" },
  "devtools-typecheck": {
    kind: "npm",
    package: "typescript",
    binary: "tsc",
    via: "packages/devtools",
  },
};

const npmCommands = (): readonly (readonly [string, string, string, string | undefined])[] =>
  Object.entries(HOOK).flatMap(([name, proof]) =>
    proof.kind === "npm"
      ? [[name, proof.package, proof.binary ?? proof.package, proof.via] as const]
      : [],
  );

const uvCommands = (): readonly string[] =>
  Object.entries(HOOK).flatMap(([name, proof]) => (proof.kind === "uv" ? [name] : []));

const rootScriptCommands = (): readonly (readonly [string, string])[] =>
  Object.entries(HOOK).flatMap(([name, proof]) =>
    proof.kind === "root-script" ? [[name, proof.script] as const] : [],
  );

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    module: "esnext",
    target: "es2022",
    moduleResolution: "bundler",
    skipLibCheck: true,
  },
  include: ["*.ts"],
});

const TYPE_ERROR_SOURCE = 'export const bad: number = "not a number";\n';
const CLEAN_SOURCE = "export const ok: number = 1;\n";

const typecheckTool: Tool = {
  executable: { package: "typescript", path: ["bin", "tsc"] },
  argv: ["--noEmit"],
  scaffold: { "tsconfig.json": TSCONFIG },
  foundSomething: [1],
  smoke: {
    tree: { "broken.ts": TYPE_ERROR_SOURCE },
    reports: (output) => output.includes("error TS"),
  },
};

describe("the hook's typecheck commands refuse a staged type error", () => {
  const typecheck = runsOverThrowawayTree(typecheckTool);

  it("refuses a type error, naming it in the report", () => {
    expect(typecheck({ "broken.ts": TYPE_ERROR_SOURCE })).toContain("error TS");
  });

  it("stays silent over a tree with no type error", () => {
    expect(typecheck({ "clean.ts": CLEAN_SOURCE })).toBe("");
  });
});

describe("the pre-commit hook", () => {
  it.each(npmCommands())(
    "runs `%s` from a binary this repository's own packages declare",
    (command, packageName, binaryName, via) => {
      const naming = via === undefined ? runOf(command) : reachedFrom(via, runOf(command));
      expect(naming).toContain(binaryName);
      expect(existsSync(declaredBinary(packageName, binaryName))).toBe(true);
    },
  );

  it.each(uvCommands())("runs `%s` through uv inside the worker", (command) => {
    expect(runOf(command)).toContain("uv run --frozen --only-group dev ruff");
    expect(commands()[command]?.root).toBe("apps/worker/");

    expect(() => execFileSync("uv", ["--version"], { stdio: "pipe" })).not.toThrow();
  });

  it.each(rootScriptCommands())("runs `%s` as the root script %s runs it", (command, script) => {
    expect(runOf(command)).toBe(`${rootScripts()[script] ?? ""} {staged_files}`);
  });
});

const CHECK_RUNNER = "scripts/check.mjs";
const PUSHED_SCRIPTS = ["check:gates", "check:docs"] as const;

const stepsOf = (script: string): readonly string[] => {
  const words = (rootScripts()[script] ?? "").split(/\s+/).filter((word) => word !== "");
  const at = words.indexOf(CHECK_RUNNER);
  if (at === -1) throw new Error(`\`${script}\` hands ${CHECK_RUNNER} no steps`);
  return words.slice(at + 1);
};

const pushedSteps = (): readonly string[] => [...new Set(PUSHED_SCRIPTS.flatMap(stepsOf))].sort();

const pushCommands = (): Record<string, Command> => declared("pre-push-gates").commands ?? {};

const runAlone = (step: string): string => `run it alone with pnpm run ${step}`;

describe("the pre-push gates", () => {
  it("runs each step `check:gates` and `check:docs` name, and nothing else", () => {
    expect(Object.keys(pushCommands()).sort()).toEqual(pushedSteps());
  });

  it("runs `format:check` once, though both scripts name it", () => {
    for (const script of PUSHED_SCRIPTS) expect(stepsOf(script)).toContain("format:check");
    const runs = Object.values(pushCommands()).map((one) => one.run ?? "");
    expect(runs.filter((run) => run.includes("pnpm run format:check"))).toHaveLength(1);
  });
});

const LEFTHOOK = path.join(repositoryRoot, "node_modules", ".bin", "lefthook");
const PRE_PUSH_SCRIPT = "scripts/pre-push.sh";
const SKIPPED =
  "gates skipped: every ref pushed is a deletion or outside refs/heads/, so none carries commits";

const PNPM_STUB = [
  "#!/bin/sh",
  'if [ "$1 $2" = "exec lefthook" ]; then shift 2; exec "$LEFTHOOK_BIN" "$@"; fi',
  `printf '%s GIT_DIR=%s\\n' "$*" "$(printenv GIT_DIR || echo unset)" >> "$PNPM_STUB_LOG"`,
  'case ",$PNPM_STUB_FAILS," in *",$2,"*) echo "$2 found something" >&2; exit 1 ;; esac',
  "",
].join("\n");

const scratch = mkdtempSync(path.join(tmpdir(), "pre-push-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

type Pushing = {
  readonly root: string;
  readonly origin: string;
  readonly bin: string;
  readonly log: string;
};

const hookedRepository = (name: string): Pushing => {
  const root = throwawayRepository(path.join(scratch, name));
  const origin = path.join(scratch, `${name}-origin.git`);
  gitIn(scratch, "init", "--bare", "-q", "-b", "main", origin);
  gitIn(root, "remote", "add", "origin", origin);
  writeUnder(root, "lefthook.yml", read("lefthook.yml"));
  writeUnder(root, PRE_PUSH_SCRIPT, read(PRE_PUSH_SCRIPT));
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "the hooks' configuration");
  execFileSync(LEFTHOOK, ["install"], { cwd: root, stdio: "pipe" });
  const bin = path.join(scratch, `${name}-bin`);
  writeUnder(bin, "pnpm", PNPM_STUB);
  chmodSync(path.join(bin, "pnpm"), 0o755);
  return { root, origin, bin, log: path.join(scratch, `${name}.log`) };
};

const LEFTHOOK_SWITCHES = new Set(["LEFTHOOK", "LEFTHOOK_EXCLUDE"]);

const pushFrom = (
  pushing: Pushing,
  directory: string,
  refs: string | readonly string[],
  options: { readonly env?: Readonly<Record<string, string>>; readonly flags?: string[] } = {},
): { readonly status: number | null; readonly said: string } => {
  const inherited = Object.entries(process.env).filter(([name]) => !LEFTHOOK_SWITCHES.has(name));
  const pushed = [refs].flat();
  const ran = spawnSync(
    "git",
    ["-C", directory, "push", ...(options.flags ?? []), "origin", ...pushed],
    {
      encoding: "utf8",
      env: {
        ...Object.fromEntries(inherited),
        PATH: `${pushing.bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
        LEFTHOOK_BIN: LEFTHOOK,
        PNPM_STUB_LOG: pushing.log,
        ...options.env,
      },
    },
  );
  return { status: ran.status, said: `${ran.stdout}${ran.stderr}` };
};

const ranBy = (pushing: Pushing): readonly string[] =>
  existsSync(pushing.log)
    ? readFileSync(pushing.log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];

const originHas = (pushing: Pushing, branch: string): boolean =>
  spawnSync("git", [
    "-C",
    pushing.origin,
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]).status === 0;

const originRefs = (pushing: Pushing): readonly string[] =>
  gitIn(pushing.origin, "for-each-ref", "--format=%(refname)")
    .split("\n")
    .filter((line) => line !== "");

const pushedUnhooked = (pushing: Pushing, ref: string): void => {
  const pushed = pushFrom(pushing, pushing.root, ref, { flags: ["--no-verify"] });
  if (pushed.status !== 0) throw new Error(`pushing ${ref} unhooked failed:\n${pushed.said}`);
};

const seeded = (pushing: Pushing): void => {
  pushedUnhooked(pushing, "main");
  gitIn(pushing.root, "remote", "set-head", "origin", "main");
};

const committedChange = (directory: string): void => {
  writeUnder(directory, "README.md", "a change to push\n");
  gitIn(directory, "add", "-A");
  gitIn(directory, "commit", "-q", "--no-verify", "-m", "a change to push");
};

const tagged = (pushing: Pushing): void => {
  committedChange(pushing.root);
  gitIn(pushing.root, "tag", "probe");
};

const CUSTOM_REF = "refs/probe/one";

const customRefWritten = (pushing: Pushing): void => {
  writeUnder(pushing.root, "blob.md", "a blob, left untracked\n");
  const blob = gitIn(pushing.root, "hash-object", "-w", "blob.md").trim();
  gitIn(pushing.root, "update-ref", CUSTOM_REF, blob);
};

type CarriesNothing = {
  readonly push: string;
  readonly directory: string;
  readonly before: (pushing: Pushing) => void;
  readonly refspec: string;
  readonly left: readonly string[];
};

const CARRY_NOTHING: readonly CarriesNothing[] = [
  {
    push: "a tag",
    directory: "tag",
    before: tagged,
    refspec: "refs/tags/probe",
    left: ["refs/heads/main", "refs/tags/probe"],
  },
  {
    push: "a tag's deletion",
    directory: "tag-deletion",
    before: (pushing) => {
      tagged(pushing);
      pushedUnhooked(pushing, "refs/tags/probe");
    },
    refspec: ":refs/tags/probe",
    left: ["refs/heads/main"],
  },
  {
    push: "a custom ref",
    directory: "custom-ref",
    before: customRefWritten,
    refspec: CUSTOM_REF,
    left: ["refs/heads/main", CUSTOM_REF],
  },
  {
    push: "a branch's deletion",
    directory: "branch-deletion",
    before: (pushing) => {
      pushedUnhooked(pushing, "main:refs/heads/other");
    },
    refspec: ":refs/heads/other",
    left: ["refs/heads/main"],
  },
];

const linkedWorktree = (pushing: Pushing): string => {
  seeded(pushing);
  const tree = `${pushing.root}-linked`;
  gitIn(pushing.root, "worktree", "add", "-q", "-b", "feature", tree);
  committedChange(tree);
  return tree;
};

describe("the pre-push hook over a throwaway repository", () => {
  it("lets a push through once every gate passes, each once", () => {
    const pushing = hookedRepository("all-pass");

    const pushed = pushFrom(pushing, pushing.root, "main");

    expect(pushed).toMatchObject({ status: 0 });
    expect(originHas(pushing, "main")).toBe(true);
    expect([...ranBy(pushing)].sort()).toEqual(
      pushedSteps().map((step) => `run ${step} GIT_DIR=unset`),
    );
    expect(pushed.said).not.toContain(SKIPPED);
  });

  it("refuses a push, naming each failed gate's run-alone command", () => {
    const pushing = hookedRepository("two-fail");

    const pushed = pushFrom(pushing, pushing.root, "main", {
      env: { PNPM_STUB_FAILS: "knip,check:docs:api" },
    });

    expect(pushed.status).not.toBe(0);
    expect(originHas(pushing, "main")).toBe(false);
    expect(pushed.said).toContain(runAlone("knip"));
    expect(pushed.said).toContain(runAlone("check:docs:api"));
    expect(pushed.said).not.toContain(runAlone("lint"));
    expect(ranBy(pushing)).toHaveLength(pushedSteps().length);
  });

  it("runs on a new branch's first push", () => {
    const pushing = hookedRepository("land-shaped");
    seeded(pushing);
    gitIn(pushing.root, "switch", "-q", "-c", "landed");
    committedChange(pushing.root);

    const pushed = pushFrom(pushing, pushing.root, "landed", {
      env: { PNPM_STUB_FAILS: "knip" },
      flags: ["-u"],
    });

    expect(pushed.status).not.toBe(0);
    expect(originHas(pushing, "landed")).toBe(false);
    expect(pushed.said).toContain(runAlone("knip"));
  });

  it("runs on a push that only deletes a file", () => {
    const pushing = hookedRepository("deletion");
    committedChange(pushing.root);
    seeded(pushing);
    gitIn(pushing.root, "switch", "-q", "-c", "removal");
    gitIn(pushing.root, "rm", "-q", "README.md");
    gitIn(pushing.root, "commit", "-q", "--no-verify", "-m", "a file removed");

    const pushed = pushFrom(pushing, pushing.root, "removal", {
      env: { PNPM_STUB_FAILS: "lint" },
      flags: ["-u"],
    });

    expect(pushed.status).not.toBe(0);
    expect(originHas(pushing, "removal")).toBe(false);
    expect(pushed.said).toContain(runAlone("lint"));
  });

  it("runs when a tag rides with a branch's commits", () => {
    const pushing = hookedRepository("tag-and-branch");
    seeded(pushing);
    tagged(pushing);

    const pushed = pushFrom(pushing, pushing.root, ["refs/tags/probe", "main"], {
      env: { PNPM_STUB_FAILS: "lint" },
    });

    expect(pushed.status).not.toBe(0);
    expect(originRefs(pushing)).toEqual(["refs/heads/main"]);
    expect(pushed.said).toContain(runAlone("lint"));
  });

  it.each(CARRY_NOTHING)(
    "skips every gate on $push, saying why",
    ({ directory, before, refspec, left }) => {
      const pushing = hookedRepository(directory);
      seeded(pushing);
      before(pushing);

      const pushed = pushFrom(pushing, pushing.root, refspec, { env: { PNPM_STUB_FAILS: "lint" } });

      expect(pushed).toMatchObject({ status: 0 });
      expect(pushed.said).toContain(SKIPPED);
      expect(originRefs(pushing)).toEqual(left);
      expect(ranBy(pushing)).toEqual([]);
    },
  );

  it("runs from a linked worktree, through the common git directory", () => {
    const pushing = hookedRepository("worktree");
    const tree = linkedWorktree(pushing);

    const pushed = pushFrom(pushing, tree, "feature", { env: { PNPM_STUB_FAILS: "lint" } });

    expect(pushed.status).not.toBe(0);
    expect(originHas(pushing, "feature")).toBe(false);
    expect(pushed.said).toContain(runAlone("lint"));
  });

  it("keeps a worktree hook's `GIT_DIR` from every gate", () => {
    const pushing = hookedRepository("worktree-environment");
    const tree = linkedWorktree(pushing);

    const pushed = pushFrom(pushing, tree, "feature");

    expect(pushed).toMatchObject({ status: 0 });
    expect(ranBy(pushing).filter((line) => !line.endsWith(" GIT_DIR=unset"))).toEqual([]);
  });

  it("hands every gate `GIT_DIR` once `without-git-env` is emptied", () => {
    const pushing = hookedRepository("worktree-control");
    const tree = linkedWorktree(pushing);
    writeUnder(tree, "lefthook-local.yml", 'templates:\n  without-git-env: ""\n');

    const pushed = pushFrom(pushing, tree, "feature");

    expect(pushed).toMatchObject({ status: 0 });
    expect(ranBy(pushing).filter((line) => line.endsWith(" GIT_DIR=unset"))).toEqual([]);
    expect(ranBy(pushing)[0]).toContain(".git/worktrees/");
  });

  it.each([
    {
      bypass: "LEFTHOOK_EXCLUDE",
      directory: "exclude",
      options: { env: { PNPM_STUB_FAILS: "check:docs:api", LEFTHOOK_EXCLUDE: "check:docs:api" } },
      ran: pushedSteps().length - 1,
    },
    {
      bypass: "--no-verify",
      directory: "no-verify",
      options: { env: { PNPM_STUB_FAILS: "check:docs:api" }, flags: ["--no-verify"] },
      ran: 0,
    },
  ])("lets a failing gate's push through when $bypass skips it", ({ directory, options, ran }) => {
    const pushing = hookedRepository(directory);

    const pushed = pushFrom(pushing, pushing.root, "main", options);

    expect(pushed).toMatchObject({ status: 0 });
    expect(originHas(pushing, "main")).toBe(true);
    expect(ranBy(pushing)).toHaveLength(ran);
  });
});
