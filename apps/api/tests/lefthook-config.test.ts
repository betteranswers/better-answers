import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import type { Tool } from "@better-answers/devtools/throwaway-tree";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const command = z.object({
  run: z.string().optional(),
  glob: z.string().optional(),
  root: z.string().optional(),
});
type Command = z.infer<typeof command>;
const lefthook = z.object({
  "pre-commit": z
    .object({
      parallel: z.boolean().optional(),
      commands: z.record(z.string(), command).optional(),
    })
    .optional(),
});
type Lefthook = z.infer<typeof lefthook>;

const LOCAL_GATES = "docs/operations/local-gates.md";

const config = (): Lefthook => lefthook.parse(parse(read("lefthook.yml")));

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
    expect(preCommit().parallel).toBe(true);
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
