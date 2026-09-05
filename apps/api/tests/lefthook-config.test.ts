import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * The pre-commit hook read as a value (T-070). The hook itself is never run here: its
 * commands are proved by the tools' own suites, and what a quiet edit can break is the
 * wiring — a command whose binary is not in this repository, a guard that stopped guarding,
 * a typecheck that crept in and turned a seconds-long hook into a minutes-long one.
 *
 * The failure this shape has to avoid is the same one the lint-rule tests avoid: a hook that
 * cannot run its tools still exits zero on a clean staged set, so "the hook passed" would be
 * indistinguishable from "the hook did nothing". Every binary is therefore resolved through
 * the module graph or PATH rather than assumed, as `apps/web/test/lint-rules.test.ts` does —
 * pnpm puts a binary where the package that declares it can reach it, not necessarily at the
 * root, and a wrong path there fails silently.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

type Command = { readonly run?: string; readonly glob?: string; readonly root?: string };
type Lefthook = {
  readonly "pre-commit"?: {
    readonly parallel?: boolean;
    readonly commands?: Record<string, Command>;
  };
};

const config = (): Lefthook => parse(read("lefthook.yml")) as Lefthook;

const preCommit = () => {
  const hook = config()["pre-commit"];
  if (hook === undefined) throw new Error("lefthook.yml declares no `pre-commit` hook");
  return hook;
};

const commands = (): Record<string, Command> => preCommit().commands ?? {};

const runOf = (name: string): string => {
  const command = commands()[name];
  if (command?.run === undefined) throw new Error(`no \`${name}\` command in lefthook.yml`);
  return command.run;
};

/**
 * A package's own declared binary, resolved through the module graph. Assembling the path
 * from a guessed `node_modules/.bin` entry would pass on a machine where pnpm happened to
 * hoist it and fail on one where it did not.
 */
const declaredBinary = (packageName: string): string => {
  const manifestPath = createRequire(import.meta.url).resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = manifest.bin;
  const relative = typeof bin === "string" ? bin : bin?.[packageName];
  if (relative === undefined) {
    throw new Error(`${packageName} declares no \`${packageName}\` binary`);
  }
  return path.join(path.dirname(manifestPath), relative);
};

/** A binary on PATH, for the tools npm does not own. */
const onPath = (binary: string): string | undefined =>
  (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .map((directory) => path.join(directory, binary))
    .find((candidate) => existsSync(candidate));

/**
 * Every command the hook runs, with how its binary is proved. A command added to the hook and
 * not named here fails the first test below, so a new command cannot arrive unasserted —
 * `[TEST7]`'s both-ways shape, in the small.
 */
const EXPECTED_COMMANDS = [
  "refuse-main",
  "oxfmt",
  "oxlint",
  "ruff-format",
  "ruff-check",
  "actionlint",
] as const;

/** Commands whose tool is an npm package this repository declares. */
const NPM_TOOLS: Readonly<Record<string, string>> = { oxfmt: "oxfmt", oxlint: "oxlint" };

/** Commands whose tool is reached through `uv`, the worker's runner. */
const UV_TOOLS = ["ruff-format", "ruff-check"] as const;

describe("the pre-commit hook (T-070)", () => {
  it("runs exactly the commands this test knows about", () => {
    expect(Object.keys(commands()).sort()).toEqual([...EXPECTED_COMMANDS].sort());
  });

  it("runs its commands in parallel, so the slowest one sets the wait", () => {
    expect(preCommit().parallel).toBe(true);
  });

  it("refuses a commit on main, the one-branch-per-task rule held by the hook", () => {
    const run = runOf("refuse-main");
    expect(run).toContain("git symbolic-ref --short HEAD");
    expect(run).toContain("main");
    expect(run).toContain("exit 1");
  });

  it.each(Object.entries(NPM_TOOLS))(
    "runs `%s` from a binary this repository's own packages declare",
    (command, packageName) => {
      expect(runOf(command)).toContain(packageName);
      expect(existsSync(declaredBinary(packageName))).toBe(true);
    },
  );

  it.each(UV_TOOLS)("runs `%s` through uv inside the worker", (command) => {
    expect(runOf(command)).toContain("uv run --frozen ruff");
    expect(commands()[command]?.root).toBe("apps/worker/");
    expect(onPath("uv")).toBeDefined();
  });

  it("skips actionlint with a warning when it is not installed, rather than failing", () => {
    const run = runOf("actionlint");
    expect(run).toContain("command -v actionlint");
    expect(run).toContain("warning");
    expect(run).toContain("exit 0");
  });

  it("runs no tests and no typecheck, so it stays a seconds-long hook", () => {
    for (const [name, command] of Object.entries(commands())) {
      for (const forbidden of ["vitest", "tsc", "pytest", "typecheck", "pnpm test", "run test"]) {
        expect({ name, forbidden, present: (command.run ?? "").includes(forbidden) }).toEqual({
          name,
          forbidden,
          present: false,
        });
      }
    }
  });

  it("documents both escape hatches in its own header, so a skip is never a deleted hook", () => {
    const header = read("lefthook.yml").split(/^[^#\s]/m)[0] ?? "";
    expect(header).toContain("LEFTHOOK=0");
    expect(header).toContain("LEFTHOOK_EXCLUDE");
  });

  it("is installed by a root `prepare` script, so a fresh clone needs no remembered step", () => {
    const manifest = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.scripts["prepare"]).toContain("lefthook install");
    // `--prod` and non-git installs reach `prepare` too, and neither can hold a hook. The
    // fresh-clone step in check.yml is what keeps the fallback from hiding a real failure.
    expect(manifest.scripts["prepare"]).toContain("||");
    expect(manifest.devDependencies["lefthook"]).toBeDefined();
  });

  /**
   * pnpm 11's build allow-list governs a dependency's own lifecycle scripts. lefthook's
   * postinstall is refused there and `prepare` installs the hook in the open instead.
   *
   * The entry is `false` rather than absent because pnpm 11 treats an undecided build script
   * as a hard error — `ERR_PNPM_IGNORED_BUILDS`, exit 1 — and rewrites the workspace file
   * with a placeholder, so no entry at all would fail every fresh install including CI's.
   * Read empirically on 05/09/2026 against pnpm 11.24.0.
   */
  it("refuses lefthook's own postinstall in the allow-list, because `prepare` is the wiring", () => {
    const workspace = parse(read("pnpm-workspace.yaml")) as {
      allowBuilds?: Record<string, unknown>;
    };
    expect(workspace.allowBuilds?.["lefthook"]).toBe(false);
  });
});
