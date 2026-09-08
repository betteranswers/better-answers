import { execFileSync } from "node:child_process";
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

/**
 * How a command's tool is proved to exist:
 *
 * - `npm` — a package this repository declares, resolved through the module graph;
 * - `uv` — reached through the worker's runner, which the shell must be able to find;
 * - `guarded` — not ours to install, so what is proved is the skip, not the binary.
 */
type Proof =
  | { readonly kind: "npm"; readonly package: string }
  | { readonly kind: "uv" }
  | { readonly kind: "guarded"; readonly binary: string };

/**
 * Every command the hook runs, its glob and how its tool is proved — one fact in one place.
 * The keys are checked against the file both ways, so a sixth command cannot arrive
 * without a line here, and a line here cannot outlive the command it describes
 * (`[TEST7]`, in the small). `glob: undefined` is a claim like any other: oxfmt takes the
 * whole staged set on purpose.
 */
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
  };

/**
 * The map, read one proof kind at a time. Each case gets its own test rather than a branch
 * inside one, because an `expect` reached through a condition is an `expect` that can be
 * skipped without anyone noticing — which is the rule `vitest/no-conditional-expect` holds
 * and exactly the silence this suite exists to avoid.
 */
const npmCommands = (): readonly (readonly [string, string])[] =>
  Object.entries(HOOK).flatMap(([name, { proof }]) =>
    proof.kind === "npm" ? [[name, proof.package] as const] : [],
  );

const uvCommands = (): readonly string[] =>
  Object.entries(HOOK).flatMap(([name, { proof }]) => (proof.kind === "uv" ? [name] : []));

const guardedCommands = (): readonly (readonly [string, string])[] =>
  Object.entries(HOOK).flatMap(([name, { proof }]) =>
    proof.kind === "guarded" ? [[name, proof.binary] as const] : [],
  );

describe("the pre-commit hook (T-070)", () => {
  it("runs exactly the commands this test knows how to prove", () => {
    expect(Object.keys(commands()).sort()).toEqual(Object.keys(HOOK).sort());
  });

  it("runs its commands in parallel, so the slowest one sets the wait", () => {
    expect(preCommit().parallel).toBe(true);
  });

  it.each(Object.keys(HOOK))("runs `%s` over the files it says it does", (command) => {
    expect(commands()[command]?.glob).toBe(HOOK[command]?.glob);
  });

  /**
   * oxfmt's absent glob is the one worth a word: `.oxfmtrc.json` is where this repository
   * decides which files the formatter touches, and a glob here would be a second answer to
   * that question — the reason sits in `lefthook.yml`, beside the command.
   *
   * The flag is what makes that safe, and is asserted because losing it is silent until the
   * day someone commits only markdown: oxfmt exits 2 when every file it was handed was
   * excluded by an ignore rule, and the whole commit is refused for having nothing to format.
   */
  it("lets oxfmt take the whole staged set, and pass when none of it is its to format", () => {
    expect(existsSync(path.join(repositoryRoot, ".oxfmtrc.json"))).toBe(true);
    expect(runOf("oxfmt")).toContain("--no-error-on-unmatched-pattern");
  });

  it.each(npmCommands())(
    "runs `%s` from a binary this repository's own packages declare",
    (command, packageName) => {
      expect(runOf(command)).toContain(packageName);
      expect(existsSync(declaredBinary(packageName))).toBe(true);
    },
  );

  it.each(uvCommands())("runs `%s` through uv inside the worker", (command) => {
    expect(runOf(command)).toContain("uv run --frozen ruff");
    expect(commands()[command]?.root).toBe("apps/worker/");
    // The shell's own lookup, so the test fails exactly where the hook would.
    expect(() => execFileSync("uv", ["--version"], { stdio: "pipe" })).not.toThrow();
  });

  /**
   * Not ours to install, so what is proved is the skip: a warning and a pass, never a failed
   * commit on a machine that never had the tool.
   */
  it.each(guardedCommands())(
    "skips `%s` with a warning where it is not installed, rather than failing",
    (command, binary) => {
      const run = runOf(command);
      expect(run).toContain(`command -v ${binary}`);
      expect(run).toContain("warning");
      expect(run).toContain("exit 0");
    },
  );

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

  /** Why the entry is `false` rather than absent is written in `pnpm-workspace.yaml`. */
  it("refuses lefthook's own postinstall in the allow-list, because `prepare` is the wiring", () => {
    const workspace = parse(read("pnpm-workspace.yaml")) as {
      allowBuilds?: Record<string, unknown>;
    };
    expect(workspace.allowBuilds?.["lefthook"]).toBe(false);
  });
});
