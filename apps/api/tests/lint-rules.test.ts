import path from "node:path";

import {
  oxlintOverrideFor,
  readOxlintConfig,
  repositoryRoot,
} from "@better-answers/devtools/oxlint-config";
import { oxlintOver, type Tree } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

/**
 * The repository's lint rules, run rather than remembered (`[CHECK1]`). Two families, two
 * runners.
 *
 * The rules T-004 adds, each an override or a plugin rule: ADR 0009's better-auth ban, ADR
 * 0030's MCP-type ban over `packages/core` (the existing core override, extended here to the
 * v2 package name), and the two `better-answers` plugin rules — every entry carries
 * `annotations`, no entry takes a workspace argument.
 *
 * The three rules T-069 adds, each a line in the base `rules` block: no two tests in one
 * describe block carry the same title, no block is empty, and no promise floats.
 *
 * Each is applied to a throwaway tree so the assertion is as much about where the rule stays
 * silent as where it fires.
 *
 * The tree and the oxlint run are the devtools runner's, which is what makes a silence here
 * mean something: a linter that could not run — a moved binary, a plugin that failed to
 * load, a config oxlint refused — reports nothing, and nothing satisfies every assertion
 * below.
 */

const probe = (specifier: string): string =>
  `import * as probe from "${specifier}";\nexport const keep = probe;\n`;

const config = readOxlintConfig();

/** Lint `files` (path → source) under the repo's real config, returning oxlint's output. */
const { output: lint } = oxlintOver(
  JSON.stringify({
    // The plugin is resolved from the repo, not copied.
    jsPlugins: config.jsPlugins.map((plugin) => ({
      ...plugin,
      specifier: path.join(repositoryRoot, plugin.specifier),
    })),
    rules: Object.fromEntries(
      Object.entries(config.rules).filter(([name]) => name.startsWith("better-answers/")),
    ),
    overrides: [
      oxlintOverrideFor("**/*.ts"),
      oxlintOverrideFor("apps/api/src/auth/**"),
      oxlintOverrideFor("packages/core/**"),
    ],
  }),
  {
    // The identity ban's own subject, under the glob it fires in and the one it does not.
    // Until oxlint answers this the way the config says it will, no silence below means
    // anything — and the plugin specifiers above are proved to load by the same case.
    tree: {
      "apps/api/src/mcp/probe.ts": probe("better-auth"),
      "apps/api/src/auth/probe.ts": probe("better-auth"),
    },
    flagged: ["apps/api/src/mcp/probe.ts"],
  },
);

/**
 * A runner over exactly one of the repository's base rules, its setting read out of
 * `.oxlintrc.json` rather than restated here — a restatement would pass while the real
 * config carried the rule as a warning, or not at all. The plugin list and the options
 * block travel with it, because a rule from a plugin oxlint was not told to load is a rule
 * that stays silent, and the type-aware rules need the options block to run at all.
 *
 * The overrides do not travel with it — the react plugin one names a specifier that cannot
 * resolve from a temporary directory — so the runner refuses instead to build over a rule any
 * override switches off, which is the only way an override could make these cases lie.
 */
const ruleRunner = (
  name: string,
  smoke: { readonly tree: Tree; readonly flagged: readonly string[] },
): ((tree: Tree) => string) => {
  const setting = config.rules[name];
  if (setting === undefined) throw new Error(`no \`${name}\` rule in .oxlintrc.json`);
  const relaxed = config.overrides.filter((override) => override.rules?.[name] !== undefined);
  if (relaxed.length > 0)
    throw new Error(
      `\`${name}\` is re-set by an override over ${relaxed.map((o) => o.files?.join(", ")).join("; ")}, which this runner does not carry — so these cases would prove the rule somewhere it no longer holds.`,
    );
  return oxlintOver(
    JSON.stringify({
      plugins: config.plugins,
      options: config.options,
      rules: { [name]: setting },
    }),
    smoke,
  ).output;
};

/** A vitest file whose one describe block holds `titles`, each test carrying an assertion. */
const suiteOf = (...titles: readonly string[]): string =>
  `describe("the workspace door", () => {\n${titles
    .map((title) => `  it("${title}", () => {\n    expect(door).toBeDefined();\n  });`)
    .join("\n")}\n});\n`;

describe("no two tests in one describe block carry the same title", () => {
  const copied: Tree = {
    "test/copied.test.ts": suiteOf("refuses a stranger", "refuses a stranger"),
  };
  const lintTitles = ruleRunner("vitest/no-identical-title", {
    tree: copied,
    flagged: ["test/copied.test.ts"],
  });

  it("fires when a copied test keeps the title of the one it was copied from", () => {
    const output = lintTitles(copied);

    expect(output).toContain("test/copied.test.ts");
    expect(output).toContain("no-identical-title");
  });

  it("stays silent when the two titles differ, which is the whole ask of the rule", () => {
    const output = lintTitles({
      "test/distinct.test.ts": suiteOf("refuses a stranger", "admits a member"),
    });

    expect(output).not.toContain("test/distinct.test.ts");
  });

  it("stays silent when two files share a title — a title is unique inside its block, not the tree", () => {
    const output = lintTitles({
      "test/one.test.ts": suiteOf("refuses a stranger"),
      "test/two.test.ts": suiteOf("refuses a stranger"),
    });

    expect(output).not.toContain("test/one.test.ts");
    expect(output).not.toContain("test/two.test.ts");
  });
});

/** A module whose one function swallows a rollback failure, with `body` as its catch block. */
const swallow = (body: string): string =>
  `export const rollbackQuietly = async (client: Client): Promise<void> => {\n  try {\n    await client.query("ROLLBACK");\n  } catch {${body}}\n};\n`;

describe("no block is empty, and a swallowed error is a commented decision", () => {
  const silent: Tree = { "src/silent.ts": swallow("") };
  const lintBlocks = ruleRunner("no-empty", { tree: silent, flagged: ["src/silent.ts"] });

  it("fires on an empty catch — `allowEmptyCatch` is off, so a swallow says nothing by accident", () => {
    const output = lintBlocks(silent);

    expect(output).toContain("src/silent.ts");
    expect(output).toContain("no-empty");
  });

  it("stays silent on a catch holding a comment, which is how the Postgres door's own swallow passes", () => {
    const output = lintBlocks({
      "src/reasoned.ts": swallow(
        "\n    // The connection is already gone; releasing it below is all that is left.\n  ",
      ),
    });

    expect(output).not.toContain("src/reasoned.ts");
  });

  it("fires on an empty block that is no catch at all", () => {
    const output = lintBlocks({
      "src/branch.ts": `export const guard = (revoked: boolean): void => {\n  if (revoked) {\n  }\n};\n`,
    });

    expect(output).toContain("src/branch.ts");
    expect(output).toContain("no-empty");
  });
});

/**
 * A tree the type-aware linter can build a program from. `tsgolint` reads a `tsconfig.json`
 * to type the files it lints, so a type-aware rule over a tree without one has nothing to
 * say — which would read as the rule staying silent.
 */
const typedTree = (files: Tree): Tree => ({
  "tsconfig.json": JSON.stringify({
    compilerOptions: { target: "esnext", module: "esnext", strict: true, noEmit: true },
    include: ["src"],
  }),
  ...files,
});

/** A module calling `revoke`, which returns a promise, in the way `call` writes it. */
const callsRevoke = (call: string): string =>
  `const revoke = async (): Promise<void> => {};\n\nexport const act = async (): Promise<void> => {\n  ${call}\n};\n`;

describe("no promise floats — an unawaited call is awaited or `void`", () => {
  const forgotten = typedTree({ "src/forgotten.ts": callsRevoke("revoke();") });
  const lintPromises = ruleRunner("typescript/no-floating-promises", {
    tree: forgotten,
    flagged: ["src/forgotten.ts"],
  });

  it("fires on a call whose promise nobody takes", () => {
    const output = lintPromises(forgotten);

    expect(output).toContain("src/forgotten.ts");
    expect(output).toContain("no-floating-promises");
  });

  it("stays silent on a `void`-prefixed call — the sanctioned way to say fire and forget", () => {
    const output = lintPromises(typedTree({ "src/sanctioned.ts": callsRevoke("void revoke();") }));

    expect(output).not.toContain("src/sanctioned.ts");
  });

  it("stays silent on an awaited call", () => {
    const output = lintPromises(typedTree({ "src/awaited.ts": callsRevoke("await revoke();") }));

    expect(output).not.toContain("src/awaited.ts");
  });
});

describe("ADR 0009 — the identity provider stays behind its seam", () => {
  it("refuses a better-auth import outside the auth module, and allows it inside", () => {
    const output = lint({
      "apps/api/src/mcp/probe.ts": probe("better-auth"),
      "apps/api/src/auth/probe.ts": probe("better-auth"),
      "apps/api/lifts/better-auth-cimd-node/probe.ts": probe("@better-auth/core/utils/host"),
      "packages/core/src/probe.ts": probe("@better-auth/oauth-provider"),
    });

    expect(output).toContain("apps/api/src/mcp/probe.ts");
    expect(output).toContain("packages/core/src/probe.ts");
    expect(output).not.toContain("apps/api/src/auth/probe.ts");
    expect(output).not.toContain("apps/api/lifts/better-auth-cimd-node/probe.ts");
  });
});

describe("ADR 0030 — no MCP library type crosses into packages/core", () => {
  it("refuses @modelcontextprotocol/server inside packages/core and allows it in apps/api", () => {
    const output = lint({
      "packages/core/src/probe.ts": probe("@modelcontextprotocol/server"),
      "apps/api/src/mcp/probe.ts": probe("@modelcontextprotocol/server"),
    });

    expect(output).toContain("packages/core/src/probe.ts");
    expect(output).not.toContain("apps/api/src/mcp/probe.ts");
  });
});

describe("every MCP entry carries its annotations", () => {
  it("refuses a defineEntry without annotations and a registerTool without them, and allows both with", () => {
    const output = lint({
      "apps/api/src/mcp/entries/without.ts": `defineEntry({ name: "find", input: z.object({ query: z.string() }) });\n`,
      "apps/api/src/mcp/entries/with.ts": `defineEntry({ name: "find", input: z.object({ query: z.string() }), annotations: { readOnlyHint: true } });\n`,
      "apps/api/src/mcp/registered-without.ts": `server.registerTool("find", { inputSchema: z.object({}) }, async () => ({}));\n`,
      "apps/api/src/mcp/registered-with.ts": `server.registerTool("find", { inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => ({}));\n`,
    });

    expect(output).toContain("entries/without.ts");
    expect(output).toContain("registered-without.ts");
    expect(output).toContain("mcp-entry-annotations");
    expect(output).not.toContain("entries/with.ts");
    expect(output).not.toContain("registered-with.ts");
  });

  it("refuses annotations that carry no readOnlyHint — the host splits read from write on it", () => {
    const output = lint({
      "apps/api/src/mcp/entries/no-hint.ts": `defineEntry({ name: "find", input: z.object({}), annotations: { idempotentHint: true } });\n`,
      "apps/api/src/mcp/entries/hinted.ts": `defineEntry({ name: "find", input: z.object({}), annotations: { readOnlyHint: false } });\n`,
    });

    expect(output).toContain("entries/no-hint.ts");
    expect(output).toContain("mcp-entry-annotations");
    expect(output).not.toContain("entries/hinted.ts");
  });
});

describe("no MCP entry takes a workspace argument", () => {
  it.each(["workspace", "workspaceId", "bundle", "tenant_id"])(
    "refuses an input named %s",
    (name) => {
      const output = lint({
        "apps/api/src/mcp/entries/probe.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ ${name}: z.string() }) });\n`,
      });

      expect(output).toContain("mcp-entry-no-workspace-argument");
      expect(output).toContain(name);
    },
  );

  it("allows an input that names none of the three, in either declaration form, and unwraps a refine", () => {
    const output = lint({
      "apps/api/src/mcp/entries/probe.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ query: z.string(), limit: z.number() }) });\n`,
      "apps/api/src/mcp/entries/refined.ts": `defineEntry({ name: "open", annotations: { readOnlyHint: true }, input: z.object({ iri: z.string() }).refine(() => true) });\n`,
      "apps/api/src/mcp/raw.ts": `server.registerTool("find", { annotations: { readOnlyHint: true }, inputSchema: { query: z.string() } }, async () => ({}));\n`,
    });

    expect(output).not.toContain("mcp-entry-no-workspace-argument");
  });

  it("fails closed on a defineEntry whose input is an opaque variable, and on a spread key", () => {
    const output = lint({
      "apps/api/src/mcp/entries/opaque.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: sharedShape });\n`,
      "apps/api/src/mcp/entries/spread.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ ...base, query: z.string() }) });\n`,
    });

    expect(output).toContain("entries/opaque.ts");
    expect(output).toContain("entries/spread.ts");
    expect(output).toContain("mcp-entry-no-workspace-argument");
  });

  it("fails closed on a registerTool whose inputSchema is a variable — the one mount over ENTRIES carries the disable that names its runtime fence", () => {
    const output = lint({
      "apps/api/src/mcp/mount.ts": `server.registerTool(entry.name, { annotations: entry.annotations, inputSchema: entry.input }, entry.run);\n`,
    });

    expect(output).toContain("mcp-entry-no-workspace-argument");
  });
});
