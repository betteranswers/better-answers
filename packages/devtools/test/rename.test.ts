import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { parseRenameMap, renameOver } from "@better-answers/devtools/rename";
import type { RenameMap } from "@better-answers/devtools/rename";
import {
  executableOf,
  gitIn,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const scratch = mkdtempSync(path.join(tmpdir(), "rename-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const replayScript = path.resolve(import.meta.dirname, "../src/rename/replay.ts");

const tsc = executableOf({ package: "typescript", path: ["bin", "tsc"] });

const MODEL_CHOICE: RenameMap = {
  noun: "route",
  readerWord: "model choice",
  sweep: "U9. Model choice",
  collisions: [
    { with: "the `model` column naming the model actually called", codeWord: "model choice" },
  ],
  words: [
    { from: "llm route", to: "model choice" },
    { from: "llm routes", to: "model choices" },
    { from: "route", to: "model choice" },
    { from: "routes", to: "model choices" },
  ],
  symbols: { paths: ["**"] },
  text: { paths: ["**"] },
  senses: [],
};

const ACTION: RenameMap = {
  noun: "act",
  readerWord: "action",
  sweep: "U17. Action, last",
  collisions: [],
  words: [
    { from: "act", to: "action" },
    { from: "acts", to: "actions" },
  ],
  symbols: { paths: ["**"] },
  text: { paths: ["**"] },
  senses: [{ sense: "React and Testing Library act", matches: ["^act$"] }],
};

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2024",
    module: "nodenext",
    moduleResolution: "nodenext",
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    paths: { "@tree/schema": ["./packages/schema/src/index.ts"] },
  },
  include: ["packages"],
});

const SCHEMA = `export type LlmRoute = { readonly model: string };

export const llmRoute = (model: string): LlmRoute => ({ model });
`;

const PICK = `import { llmRoute } from "@tree/schema";
import type { LlmRoute } from "@tree/schema";

export const routes: readonly LlmRoute[] = [llmRoute("mistral-embed")];
`;

const TWO_PACKAGES: Tree = {
  "package.json": JSON.stringify({ type: "module" }),
  "tsconfig.json": TSCONFIG,
  "packages/schema/src/index.ts": SCHEMA,
  "packages/core/src/pick.ts": PICK,
};

const treeAt = (name: string, tree: Tree): string => {
  const root = path.join(scratch, name);
  for (const [file, source] of Object.entries(tree)) writeUnder(root, file, source);
  return root;
};

const read = (root: string, file: string): string => readFileSync(path.join(root, file), "utf8");

const compiles = (root: string): string => {
  const run = spawnSync(tsc, ["-p", "tsconfig.json"], { cwd: root, encoding: "utf8" });
  return `exit ${String(run.status)}\n${run.stdout}${run.stderr}`;
};

const mapOf = (map: RenameMap): RenameMap => parseRenameMap(JSON.stringify(map));

describe("renameOver", () => {
  it("renames a symbol used across two packages, and tsc passes", () => {
    const root = treeAt("two-packages", TWO_PACKAGES);

    renameOver(root, mapOf(MODEL_CHOICE), "apply");

    expect(read(root, "packages/schema/src/index.ts")).toBe(
      `export type ModelChoice = { readonly model: string };

export const modelChoice = (model: string): ModelChoice => ({ model });
`,
    );
    expect(read(root, "packages/core/src/pick.ts")).toBe(
      `import { modelChoice } from "@tree/schema";
import type { ModelChoice } from "@tree/schema";

export const modelChoices: readonly ModelChoice[] = [modelChoice("mistral-embed")];
`,
    );
    expect(compiles(root)).toBe("exit 0\n");
  });

  it("lists every occurrence on a dry run and writes nothing", () => {
    const root = treeAt("dry-run", TWO_PACKAGES);

    const report = renameOver(root, mapOf(MODEL_CHOICE), "dry-run");

    expect(read(root, "packages/core/src/pick.ts")).toBe(PICK);
    expect(
      report.occurrences
        .filter((one) => one.file === "packages/core/src/pick.ts")
        .map((one) => `${String(one.line)} ${one.found} → ${one.to}: ${one.verdict}`),
    ).toEqual([
      "1 llmRoute → modelChoice: rename",
      "2 LlmRoute → ModelChoice: rename",
      "4 routes → modelChoices: rename",
      "4 LlmRoute → ModelChoice: rename",
      "4 llmRoute → modelChoice: rename",
    ]);
  });

  it("leaves React's act alone under its permitted sense", () => {
    const root = treeAt("react-act", {
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": TSCONFIG,
      "node_modules/react/package.json": JSON.stringify({
        name: "react",
        type: "module",
        types: "index.d.ts",
      }),
      "node_modules/react/index.d.ts": "export declare function act(callback: () => void): void;\n",
      "packages/web/src/acts.ts": `import { act } from "react";

export type Act = { readonly name: string };

export const actLabel = (one: Act): string => one.name;

act(() => {
  actLabel({ name: "people.member.role_changed" });
});
`,
    });

    const report = renameOver(root, mapOf(ACTION), "apply");

    expect(read(root, "packages/web/src/acts.ts")).toBe(`import { act } from "react";

export type Action = { readonly name: string };

export const actionLabel = (one: Action): string => one.name;

act(() => {
  actionLabel({ name: "people.member.role_changed" });
});
`);
    expect(
      report.occurrences
        .filter((one) => one.verdict === "React and Testing Library act")
        .map((one) => `${String(one.line)} ${one.found}`),
    ).toEqual(["1 act", "7 act"]);
    expect(compiles(root)).toBe("exit 0\n");
  });

  it("renames strings only in files the allowlist names", () => {
    const table = `export const table = "llm_route";\n`;
    const root = treeAt("allowlist", { "named/table.ts": table, "unnamed/table.ts": table });

    const report = renameOver(
      root,
      mapOf({ ...MODEL_CHOICE, text: { paths: ["named/**"] } }),
      "apply",
    );

    expect(read(root, "named/table.ts")).toBe(`export const table = "model_choice";\n`);
    expect(read(root, "unnamed/table.ts")).toBe(table);
    expect(
      report.occurrences.map((one) => `${one.file} ${one.found}: ${one.verdict}`).sort(),
    ).toEqual([
      "named/table.ts llm_route: rename",
      "unnamed/table.ts llm_route: outside the allowlist",
    ]);
  });

  it("renames a Python identifier and a SQL string", () => {
    const root = treeAt("python", {
      "worker/db.py": `def seed_llm_route(cursor):
    cursor.execute("SELECT id FROM llm_route WHERE purpose = %s", ("embedding",))


def routes_of(cursor):
    cursor.execute("SELECT count(*) AS routes FROM llm_route")
    return seed_llm_route(cursor)
`,
    });

    renameOver(root, mapOf(MODEL_CHOICE), "apply");

    expect(read(root, "worker/db.py")).toBe(`def seed_model_choice(cursor):
    cursor.execute("SELECT id FROM model_choice WHERE purpose = %s", ("embedding",))


def model_choices_of(cursor):
    cursor.execute("SELECT count(*) AS model_choices FROM model_choice")
    return seed_model_choice(cursor)
`);
  });

  it("renames prose in a string as prose", () => {
    const root = treeAt("prose", {
      "web/words.ts": `export const empty = "No route is set. Routes are chosen per purpose.";\n`,
    });

    renameOver(root, mapOf(MODEL_CHOICE), "apply");

    expect(read(root, "web/words.ts")).toBe(
      `export const empty = "No model choice is set. Model choices are chosen per purpose.";\n`,
    );
  });

  it("renames strings after multi-byte characters", () => {
    const root = treeAt("multi-byte", {
      "web/words.ts": `export const sign = "Café — 🚀";\nexport const pair = ["🚀 an act", "no acts"];\n`,
    });

    renameOver(root, mapOf(ACTION), "apply");

    expect(read(root, "web/words.ts")).toBe(
      `export const sign = "Café — 🚀";\nexport const pair = ["🚀 an action", "no actions"];\n`,
    );
  });

  it("never touches the stored-names register, nor what reaches it", () => {
    const register = `export const routeChanged = "route-change";\n`;
    const jobs = `import { routeChanged } from "./audit/stored-names.ts";

export const reasons = [routeChanged, "route-change"];
`;
    const root = treeAt("register", {
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": TSCONFIG,
      "packages/core/src/audit/stored-names.ts": register,
      "packages/core/src/jobs.ts": jobs,
    });

    const report = renameOver(root, mapOf(MODEL_CHOICE), "apply");

    expect(read(root, "packages/core/src/audit/stored-names.ts")).toBe(register);
    expect(read(root, "packages/core/src/jobs.ts"))
      .toBe(`import { routeChanged } from "./audit/stored-names.ts";

export const reasons = [routeChanged, "model-choice-change"];
`);
    expect(
      report.occurrences
        .filter((one) => one.found === "routeChanged")
        .map((one) => `${one.file}: ${one.verdict}`),
    ).toEqual([
      "packages/core/src/audit/stored-names.ts: stored history",
      "packages/core/src/jobs.ts: stored history",
      "packages/core/src/jobs.ts: stored history",
    ]);
    expect(compiles(root)).toBe("exit 0\n");
  });

  it("keeps a stored act name in a string", () => {
    const root = treeAt("act-names", {
      "packages/core/src/acts.ts": `export const declared = ["platform.route.changed", "route-change"];\n`,
    });

    renameOver(root, mapOf(MODEL_CHOICE), "apply");

    expect(read(root, "packages/core/src/acts.ts")).toBe(
      `export const declared = ["platform.route.changed", "model-choice-change"];\n`,
    );
  });
});

describe("parseRenameMap", () => {
  it.each([
    "packages/schema/migrations/**",
    "packages/schema/migrations/0060_model_choice.sql",
    "docs/archive/**",
    "docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md",
    "packages/core/src/audit/stored-names.ts",
  ])("refuses a map naming the kept path %s", (kept) => {
    expect(() => mapOf({ ...MODEL_CHOICE, text: { paths: ["apps/**", kept] } })).toThrow(kept);
  });

  it("refuses a collision whose code word no rename writes", () => {
    expect(() =>
      mapOf({ ...MODEL_CHOICE, collisions: [{ with: "the `model` column", codeWord: "model" }] }),
    ).toThrow(/code word "model"/);
  });
});

describe("the replay command", () => {
  const map = path.join(scratch, "model-choice.json");

  const replay = (root: string): string => {
    const run = spawnSync(
      process.execPath,
      [replayScript, "--map", map, "--root", root, "--mode", "apply"],
      { encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`replay exited ${String(run.status)}\n${run.stderr}`);
    return run.stdout;
  };

  it("renames an identifier a branch added before the sweep", () => {
    const root = throwawayRepository(path.join(scratch, "replay"));
    for (const [file, source] of Object.entries(TWO_PACKAGES)) writeUnder(root, file, source);
    writeUnder(scratch, "model-choice.json", JSON.stringify(MODEL_CHOICE));
    gitIn(root, "add", "-A");
    gitIn(root, "commit", "-q", "-m", "base");
    gitIn(root, "branch", "older");

    replay(root);
    gitIn(root, "commit", "-q", "-am", "sweep");
    gitIn(root, "checkout", "-q", "older");
    writeUnder(
      root,
      "packages/core/src/count.ts",
      `import { llmRoute } from "@tree/schema";

export const llmRouteCount = [llmRoute("mistral-embed")].length;
`,
    );
    gitIn(root, "add", "-A");
    gitIn(root, "commit", "-q", "-m", "older work");
    gitIn(root, "merge", "-q", "--no-edit", "main");

    expect(replay(root)).toContain("llmRouteCount → modelChoiceCount");
    expect(read(root, "packages/core/src/count.ts"))
      .toBe(`import { modelChoice } from "@tree/schema";

export const modelChoiceCount = [modelChoice("mistral-embed")].length;
`);
    expect(compiles(root)).toBe("exit 0\n");
  });
});
