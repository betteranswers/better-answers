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
  glob: z.string().optional(),
  root: z.string().optional(),
  fail_text: z.string().optional(),
});
type Command = z.infer<typeof command>;
const hook = z
  .object({
    parallel: z.boolean().optional(),
    commands: z.record(z.string(), command).optional(),
  })
  .optional();
const lefthook = z.object({ "pre-commit": hook, "pre-push": hook });
type Lefthook = z.infer<typeof lefthook>;

const LOCAL_GATES = "docs/operations/local-gates.md";

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
  | { readonly kind: "guarded"; readonly binary: string };

const HOOK: Readonly<Record<string, { readonly glob: string | undefined; readonly proof: Proof }>> =
  {
    oxfmt: { glob: undefined, proof: { kind: "npm", package: "oxfmt" } },
    oxlint: { glob: "*.{ts,tsx}", proof: { kind: "npm", package: "oxlint" } },
    "ruff-format": { glob: "*.py", proof: { kind: "uv" } },
    "ruff-check": { glob: "*.py", proof: { kind: "uv" } },
    actionlint: {
      glob: ".github/workflows/*.{yml,yaml}",
      proof: { kind: "guarded", binary: "actionlint" },
    },

    "api-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc", via: "apps/api" },
    },
    "web-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc", via: "apps/web" },
    },
    "core-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc", via: "packages/core" },
    },
    "schema-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc", via: "packages/schema" },
    },
    "devtools-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc", via: "packages/devtools" },
    },
  };

const npmCommands = (): readonly (readonly [string, string, string, string | undefined])[] =>
  Object.entries(HOOK).flatMap(([name, { proof }]) =>
    proof.kind === "npm"
      ? [[name, proof.package, proof.binary ?? proof.package, proof.via] as const]
      : [],
  );

const uvCommands = (): readonly string[] =>
  Object.entries(HOOK).flatMap(([name, { proof }]) => (proof.kind === "uv" ? [name] : []));

const guardedCommands = (): readonly (readonly [string, string])[] =>
  Object.entries(HOOK).flatMap(([name, { proof }]) =>
    proof.kind === "guarded" ? [[name, proof.binary] as const] : [],
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
  it("runs exactly the commands this test knows how to prove", () => {
    expect(Object.keys(commands()).sort()).toEqual(Object.keys(HOOK).sort());
  });

  it("runs in parallel, so the slowest command sets the wait", () => {
    expect(declared("pre-commit").parallel).toBe(true);
  });

  it.each(Object.keys(HOOK))("runs `%s` over the files it says it does", (command) => {
    expect(commands()[command]?.glob).toBe(HOOK[command]?.glob);
  });

  it("gives oxfmt every staged file, even with nothing to format", () => {
    expect(existsSync(path.join(repositoryRoot, ".oxfmtrc.json"))).toBe(true);
    expect(runOf("oxfmt")).toContain("--no-error-on-unmatched-pattern");
  });

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

  it.each(guardedCommands())(
    "skips `%s` with a warning where it is not installed",
    (command, binary) => {
      const run = runOf(command);
      expect(run).toContain(`command -v ${binary}`);
      expect(run).toContain("warning");
      expect(run).toContain("exit 0");
    },
  );

  it("runs no test suite, and documents its measured worst case", () => {
    for (const [name, command] of Object.entries(commands())) {
      for (const forbidden of ["vitest", "pytest", "pnpm test", "run test"]) {
        expect({ name, forbidden, present: (command.run ?? "").includes(forbidden) }).toEqual({
          name,
          forbidden,
          present: false,
        });
      }
    }

    const operations = read(LOCAL_GATES);
    expect(operations).toContain("worst case");
    expect(operations).toMatch(/\d+(\.\d+)?s/);
  });

  it("documents both escape hatches and the typecheck's workspace limit", () => {
    const operations = read(LOCAL_GATES);
    expect(operations).toContain("LEFTHOOK=0");
    expect(operations).toContain("LEFTHOOK_EXCLUDE");

    expect(operations).toContain("root `check` owns the cross-workspace case");
  });

  it("points the hook file's reader at the local-gates document", () => {
    expect(read("lefthook.yml")).toContain(LOCAL_GATES);
  });

  it("is installed by the root `prepare` script on every clone", () => {
    const rootManifest = z.object({
      scripts: z.record(z.string(), z.string()),
      devDependencies: z.record(z.string(), z.string()),
    });
    const manifest = rootManifest.parse(JSON.parse(read("package.json")));
    expect(manifest.scripts["prepare"]).toContain("lefthook install");

    expect(manifest.scripts["prepare"]).toContain("||");
    expect(manifest.devDependencies["lefthook"]).toBeDefined();
  });

  it("refuses lefthook's postinstall in the allow-list, since `prepare` wires it", () => {
    const workspaceManifest = z.object({
      allowBuilds: z.record(z.string(), z.boolean()).optional(),
    });
    const workspace = workspaceManifest.parse(parse(read("pnpm-workspace.yaml")));
    expect(workspace.allowBuilds?.["lefthook"]).toBe(false);
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

const pushCommands = (): Record<string, Command> => declared("pre-push").commands ?? {};

const runAlone = (step: string): string => `run it alone with pnpm run ${step}`;

describe("the pre-push hook", () => {
  it("runs each step `check:gates` and `check:docs` name, and nothing else", () => {
    expect(Object.keys(pushCommands()).sort()).toEqual(pushedSteps());
  });

  it("runs `format:check` once, though both scripts name it", () => {
    for (const script of PUSHED_SCRIPTS) expect(stepsOf(script)).toContain("format:check");
    const runs = Object.values(pushCommands()).map((one) => one.run ?? "");
    expect(runs.filter((run) => run.includes("pnpm run format:check"))).toHaveLength(1);
  });

  it("runs in parallel, so the slowest gate sets the wait", () => {
    expect(declared("pre-push").parallel).toBe(true);
  });

  it.each(pushedSteps())("runs `%s` and, failing, says how to run it alone", (step) => {
    expect(pushCommands()[step]?.run).toContain(`pnpm run ${step}`);
    expect(pushCommands()[step]?.fail_text).toBe(runAlone(step));
  });

  it("documents skipping one gate, or the whole hook, per push", () => {
    const operations = read(LOCAL_GATES);
    expect(operations).toContain("git push --no-verify");
    expect(operations).toContain("LEFTHOOK_EXCLUDE=knip git push");
  });
});

const LEFTHOOK = path.join(repositoryRoot, "node_modules", ".bin", "lefthook");

const PNPM_STUB = [
  "#!/bin/sh",
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
  ref: string,
  options: { readonly env?: Readonly<Record<string, string>>; readonly flags?: string[] } = {},
): { readonly status: number | null; readonly said: string } => {
  const inherited = Object.entries(process.env).filter(([name]) => !LEFTHOOK_SWITCHES.has(name));
  const ran = spawnSync("git", ["-C", directory, "push", ...(options.flags ?? []), "origin", ref], {
    encoding: "utf8",
    env: {
      ...Object.fromEntries(inherited),
      PATH: `${pushing.bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
      LEFTHOOK_BIN: LEFTHOOK,
      PNPM_STUB_LOG: pushing.log,
      ...options.env,
    },
  });
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

const seeded = (pushing: Pushing): void => {
  const pushed = pushFrom(pushing, pushing.root, "main", { flags: ["--no-verify"] });
  if (pushed.status !== 0) throw new Error(`seeding origin's main failed:\n${pushed.said}`);
  gitIn(pushing.root, "remote", "set-head", "origin", "main");
};

const committedChange = (directory: string): void => {
  writeUnder(directory, "README.md", "a change to push\n");
  gitIn(directory, "add", "-A");
  gitIn(directory, "commit", "-q", "--no-verify", "-m", "a change to push");
};

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

  it("runs on a new branch's first push, like `pnpm land`'s", () => {
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
      route: "LEFTHOOK_EXCLUDE",
      directory: "exclude",
      options: { env: { PNPM_STUB_FAILS: "check:docs:api", LEFTHOOK_EXCLUDE: "check:docs:api" } },
      ran: pushedSteps().length - 1,
    },
    {
      route: "--no-verify",
      directory: "no-verify",
      options: { env: { PNPM_STUB_FAILS: "check:docs:api" }, flags: ["--no-verify"] },
      ran: 0,
    },
  ])("lets a failing gate's push through when $route skips it", ({ directory, options, ran }) => {
    const pushing = hookedRepository(directory);

    const pushed = pushFrom(pushing, pushing.root, "main", options);

    expect(pushed).toMatchObject({ status: 0 });
    expect(originHas(pushing, "main")).toBe(true);
    expect(ranBy(pushing)).toHaveLength(ran);
  });
});
