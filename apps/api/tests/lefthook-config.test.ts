import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import type { Tool } from "@better-answers/devtools/throwaway-tree";

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

const declaredBinary = (packageName: string, binaryName: string = packageName): string => {
  const manifestPath = createRequire(import.meta.url).resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = manifest.bin;
  const relative = typeof bin === "string" ? bin : bin?.[binaryName];
  if (relative === undefined) {
    throw new Error(`${packageName} declares no \`${binaryName}\` binary`);
  }
  return path.join(path.dirname(manifestPath), relative);
};

type Proof =
  | { readonly kind: "npm"; readonly package: string; readonly binary?: string }
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
      proof: { kind: "npm", package: "typescript", binary: "tsc" },
    },
    "web-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc" },
    },
    "core-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc" },
    },
    "schema-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc" },
    },
    "devtools-typecheck": {
      glob: "*.{ts,tsx}",
      proof: { kind: "npm", package: "typescript", binary: "tsc" },
    },
  };

const npmCommands = (): readonly (readonly [string, string, string])[] =>
  Object.entries(HOOK).flatMap(([name, { proof }]) =>
    proof.kind === "npm" ? [[name, proof.package, proof.binary ?? proof.package] as const] : [],
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

describe("the hook's typecheck commands refuse a staged type error (T-174)", () => {
  const typecheck = runsOverThrowawayTree(typecheckTool);

  it("refuses a type error, naming it in the report", () => {
    expect(typecheck({ "broken.ts": TYPE_ERROR_SOURCE })).toContain("error TS");
  });

  it("stays silent over a tree with no type error", () => {
    expect(typecheck({ "clean.ts": CLEAN_SOURCE })).toBe("");
  });
});

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

  it("lets oxfmt take the whole staged set, and pass when none of it is its to format", () => {
    expect(existsSync(path.join(repositoryRoot, ".oxfmtrc.json"))).toBe(true);
    expect(runOf("oxfmt")).toContain("--no-error-on-unmatched-pattern");
  });

  it.each(npmCommands())(
    "runs `%s` from a binary this repository's own packages declare",
    (command, packageName, binaryName) => {
      expect(runOf(command)).toContain(binaryName);
      expect(existsSync(declaredBinary(packageName, binaryName))).toBe(true);
    },
  );

  it.each(uvCommands())("runs `%s` through uv inside the worker", (command) => {
    expect(runOf(command)).toContain("uv run --frozen ruff");
    expect(commands()[command]?.root).toBe("apps/worker/");

    expect(() => execFileSync("uv", ["--version"], { stdio: "pipe" })).not.toThrow();
  });

  it.each(guardedCommands())(
    "skips `%s` with a warning where it is not installed, rather than failing",
    (command, binary) => {
      const run = runOf(command);
      expect(run).toContain(`command -v ${binary}`);
      expect(run).toContain("warning");
      expect(run).toContain("exit 0");
    },
  );

  it("runs no test suite, and bounds its typecheck to the measured worst case", () => {
    for (const [name, command] of Object.entries(commands())) {
      for (const forbidden of ["vitest", "pytest", "pnpm test", "run test"]) {
        expect({ name, forbidden, present: (command.run ?? "").includes(forbidden) }).toEqual({
          name,
          forbidden,
          present: false,
        });
      }
    }

    const header = read("lefthook.yml").split(/^[^#\s]/m)[0] ?? "";
    expect(header).toContain("worst case");
    expect(header).toMatch(/\d+(\.\d+)?s/);
  });

  it("documents both escape hatches and the typecheck's own workspace limit in its header", () => {
    const header = read("lefthook.yml").split(/^[^#\s]/m)[0] ?? "";
    expect(header).toContain("LEFTHOOK=0");
    expect(header).toContain("LEFTHOOK_EXCLUDE");

    expect(header).toContain("root `check` owns the cross-workspace case");
  });

  it("is installed by a root `prepare` script, so a fresh clone needs no remembered step", () => {
    const manifest = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.scripts["prepare"]).toContain("lefthook install");

    expect(manifest.scripts["prepare"]).toContain("||");
    expect(manifest.devDependencies["lefthook"]).toBeDefined();
  });

  it("refuses lefthook's own postinstall in the allow-list, because `prepare` is the wiring", () => {
    const workspace = parse(read("pnpm-workspace.yaml")) as {
      allowBuilds?: Record<string, unknown>;
    };
    expect(workspace.allowBuilds?.["lefthook"]).toBe(false);
  });
});
