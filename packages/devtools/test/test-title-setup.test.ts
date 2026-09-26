import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

import { tag, wordsOf } from "./fixture-text.ts";

const SPECIFIER = "@better-answers/schema/testing/test-title-setup";

const SETUP = fileURLToPath(import.meta.resolve(SPECIFIER));

const namedSetupFiles = z.object({
  default: z.object({ test: z.object({ setupFiles: z.array(z.string()).default([]) }) }),
});

const REPOSITORY = path.resolve(import.meta.dirname, "../../..");

/** Read off the tree, so a new workspace that takes vitest is held to name the setup. */
const WORKSPACES = ["apps", "packages"]
  .flatMap((parent) =>
    readdirSync(path.join(REPOSITORY, parent)).map((name) => `${parent}/${name}`),
  )
  .filter((workspace) => {
    const manifest = path.join(REPOSITORY, workspace, "package.json");
    return existsSync(manifest) && readFileSync(manifest, "utf8").includes('"vitest"');
  });

/**
 * `globals`, so a tree outside the repository imports nothing it cannot resolve; `stdout`, or
 * the JSON reporter writes a file the tree takes with it.
 */
const CONFIG = `export default {
  test: {
    globals: true,
    include: ["*.test.ts"],
    setupFiles: [${JSON.stringify(SETUP)}],
    reporters: [["json", { stdout: true }]],
  },
};
`;

const report = z.object({
  testResults: z.array(
    z.object({
      assertionResults: z.array(
        z.object({ title: z.string(), status: z.string(), failureMessages: z.array(z.string()) }),
      ),
    }),
  ),
});

type Outcome = { readonly status: string; readonly message: string };

const outcomesIn = (output: string): ReadonlyMap<string, Outcome> =>
  new Map(
    report
      .parse(JSON.parse(output))
      .testResults.flatMap((file) => file.assertionResults)
      .map((result) => [
        result.title,
        { status: result.status, message: result.failureMessages.join("\n") },
      ]),
  );

const suite = (body: string): Tree => ({ "titles.test.ts": body });

const ELEVEN = wordsOf(11);

const vitest = runsOverThrowawayTree({
  executable: { package: "vitest", path: ["vitest.mjs"] },
  argv: ["run"],
  scaffold: { "vitest.config.mjs": CONFIG },
  foundSomething: [1],
  smoke: {
    tree: suite(`it(${JSON.stringify(ELEVEN)}, () => {});\n`),
    reports: (output) => outcomesIn(output).get(ELEVEN)?.status === "failed",
  },
});

const KINDS = ["each", "template", "loop"] as const;

/** `<kind> word1 … word<count - 1>`, its last word filled in only as the test runs. */
const renderedTitle = (kind: string, count: number): string => `${kind} ${wordsOf(count - 1)}`;

const renderedSuite = (count: number): string => {
  const written = wordsOf(count - 2);
  return [
    `const last = "word${String(count - 1)}";`,
    `it.each([[last]])("each ${written} %s", () => {});`,
    `it(\`template ${written} \${last}\`, () => {});`,
    `for (const word of [last]) it(\`loop ${written} \${word}\`, () => {});`,
    "",
  ].join("\n");
};

const statusesOf = (count: number): Readonly<Record<string, string | undefined>> => {
  const outcomes = outcomesIn(vitest(suite(renderedSuite(count))));
  return Object.fromEntries(
    KINDS.map((kind) => [kind, outcomes.get(renderedTitle(kind, count))?.status]),
  );
};

describe("the rendered test-title hold", () => {
  it("fails each 11-word rendered title under its own name", () => {
    expect(statusesOf(11)).toEqual({ each: "failed", template: "failed", loop: "failed" });
  });

  it("passes each 10-word rendered title", () => {
    expect(statusesOf(10)).toEqual({ each: "passed", template: "passed", loop: "passed" });
  });

  it("prints the rule and the title it refuses", () => {
    const outcomes = outcomesIn(vitest(suite(`it(${JSON.stringify(ELEVEN)}, () => {});\n`)));

    expect(outcomes.get(ELEVEN)?.message).toContain(`${tag("TEST", "5")}: "${ELEVEN}"`);
  });

  it("fails a short title holding the forbidden word", () => {
    const outcomes = outcomesIn(vitest(suite(`it("should refuse a name", () => {});\n`)));

    expect(outcomes.get("should refuse a name")?.status).toBe("failed");
  });

  it.each(WORKSPACES)("is named in the setup files of %s", async (workspace) => {
    const loaded: unknown = await import(
      pathToFileURL(path.join(REPOSITORY, workspace, "vitest.config.ts")).href
    );

    expect(namedSetupFiles.parse(loaded).default.test.setupFiles).toContain(SPECIFIER);
  });
});
