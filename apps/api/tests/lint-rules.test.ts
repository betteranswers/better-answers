import path from "node:path";

import {
  oxlintOverrideFor,
  readOxlintConfig,
  repositoryRoot,
  type OxlintConfig,
} from "@better-answers/devtools/oxlint-config";
import { oxlintOver, type Tree } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

const probe = (specifier: string): string =>
  `import * as probe from "${specifier}";\nexport const keep = probe;\n`;

const config = readOxlintConfig();

const { output: lint } = oxlintOver(
  JSON.stringify({
    jsPlugins: config.jsPlugins.map((plugin) => ({
      ...plugin,
      specifier: path.join(repositoryRoot, plugin.specifier),
    })),
    rules: Object.fromEntries(
      Object.entries(config.rules).filter(([name]) => name.startsWith("better-answers/")),
    ),
    overrides: [oxlintOverrideFor("**/*.ts"), oxlintOverrideFor("apps/api/src/auth/**")],
  }),
  {
    tree: {
      "apps/api/src/mcp/probe.ts": probe("better-auth"),
      "apps/api/src/auth/probe.ts": probe("better-auth"),
    },
    flagged: ["apps/api/src/mcp/probe.ts"],
  },
);

const severityOf = (name: string): (typeof config.rules)[string] => {
  const named = config.rules[name];
  if (named !== undefined) return named;
  const correctness = config.categories["correctness"];
  if (correctness === undefined)
    throw new Error(
      `\`${name}\` is named in neither the rules block nor a \`correctness\` category of .oxlintrc.json, so there is no setting to run it under.`,
    );
  return correctness;
};

const ruleRunner = (
  name: string,
  smoke: { readonly tree: Tree; readonly flagged: readonly string[] },
): ((tree: Tree) => string) => {
  const setting = severityOf(name);
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

// tsgolint types what it lints from this tsconfig; without one a type-aware rule is
// silent and every case asserting silence passes.
const typedTree = (files: Tree, include: readonly string[] = ["src"]): Tree => ({
  "tsconfig.json": JSON.stringify({
    compilerOptions: { target: "esnext", module: "esnext", strict: true, noEmit: true },
    include,
  }),
  ...files,
});

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

const refusesSession = (guard: string): string =>
  `type Session = { readonly id: string };\nconst readSession = (): Session | null => null;\n\nexport const sessionId = (): string => {\n  const session = readSession();\n  if (${guard}) return "";\n  return session.id;\n};\n`;

const UNNECESSARY_CONDITION = "typescript/no-unnecessary-condition";
const REGISTRY_ZONE = "apps/web/src/shared/ui/**";

const registryZone = (): OxlintConfig["overrides"][number] => {
  const override = oxlintOverrideFor(REGISTRY_ZONE);
  const setting = override.rules?.[UNNECESSARY_CONDITION];
  return {
    files: override.files,
    rules: setting === undefined ? {} : { [UNNECESSARY_CONDITION]: setting },
  };
};

describe("one guard per condition — a value the type refused is not refused again", () => {
  const twice = typedTree({
    "src/twice.ts": refusesSession("session === null || session === undefined"),
  });
  const lintGuards = oxlintOver(
    JSON.stringify({
      plugins: config.plugins,
      options: config.options,
      rules: { [UNNECESSARY_CONDITION]: severityOf(UNNECESSARY_CONDITION) },
      overrides: [registryZone()],
    }),
    { tree: twice, flagged: ["src/twice.ts"] },
  ).output;

  it("fires on a guard the type makes unreachable — the second half of a check on `T | null`", () => {
    const output = lintGuards(twice);

    expect(output).toContain("src/twice.ts");
    expect(output).toContain("no-unnecessary-condition");
  });

  it("stays silent on the one guard the type leaves reachable", () => {
    const output = lintGuards(typedTree({ "src/once.ts": refusesSession("session === null") }));

    expect(output).not.toContain("src/once.ts");
  });

  it("leaves registry source as its upstream wrote it (ADR 0033), and fires on the same source one directory over", () => {
    const output = lintGuards(
      typedTree(
        {
          "apps/web/src/shared/ui/twice.ts": refusesSession(
            "session === null || session === undefined",
          ),
          "apps/web/src/features/twice.ts": refusesSession(
            "session === null || session === undefined",
          ),
        },
        ["apps"],
      ),
    );

    expect(output).toContain("apps/web/src/features/twice.ts");
    expect(output).not.toContain("apps/web/src/shared/ui/twice.ts");
  });
});

const ADOPTED = [
  {
    rule: "typescript/await-thenable",
    refuses: "an await on a call that returns no promise",
    fires: `const count = (): number => 1;\n\nexport const total = async (): Promise<number> => await count();\n`,
    silent: `const count = async (): Promise<number> => 1;\n\nexport const total = async (): Promise<number> => await count();\n`,
  },
  {
    rule: "typescript/no-array-delete",
    refuses: "a delete on an array index, which leaves a hole rather than shortening the array",
    fires: `export const drop = (names: string[]): void => {\n  delete names[0];\n};\n`,
    silent: `export const drop = (names: string[]): void => {\n  names.splice(0, 1);\n};\n`,
  },
  {
    rule: "typescript/no-base-to-string",
    refuses: "a value stringified through the default toString, which writes [object Object]",
    fires: `type Entry = { readonly name: string };\n\nexport const label = (entry: Entry): string => String(entry);\n`,
    silent: `type Entry = { readonly name: string };\n\nexport const label = (entry: Entry): string => String(entry.name);\n`,
  },
  {
    rule: "typescript/no-duplicate-type-constituents",
    refuses: "a union that names the same type twice",
    fires: `export type Word = string | string;\n`,
    silent: `export type Word = string | number;\n`,
  },
  {
    rule: "typescript/no-for-in-array",
    refuses: "a for-in over an array, which walks index strings and inherited keys",
    fires: `export const width = (names: string[]): number => {\n  let total = 0;\n  for (const name in names) total += name.length;\n  return total;\n};\n`,
    silent: `export const width = (names: string[]): number => {\n  let total = 0;\n  for (const name of names) total += name.length;\n  return total;\n};\n`,
  },
  {
    rule: "typescript/no-implied-eval",
    refuses: "a timer handed a string, which the platform evaluates as code",
    fires: `export const later = (): void => {\n  setTimeout("revoke()", 0);\n};\n`,
    silent: `export const later = (revoke: () => void): void => {\n  setTimeout(revoke, 0);\n};\n`,
  },
  {
    rule: "typescript/no-meaningless-void-operator",
    refuses: "a void on a call that already returns nothing",
    fires: `const close = (): void => {};\n\nexport const act = (): void => void close();\n`,
    silent: `const close = async (): Promise<void> => {};\n\nexport const act = (): void => void close();\n`,
  },
  {
    rule: "typescript/no-misused-spread",
    refuses: "an array spread into an object, which yields a map of index to element",
    fires: `export const held = (names: readonly string[]): object => ({ ...names });\n`,
    silent: `export const held = (entry: { readonly name: string }): object => ({ ...entry });\n`,
  },
  {
    rule: "typescript/no-redundant-type-constituents",
    refuses: "a union constituent another constituent already covers",
    fires: `export type Word = string | "member";\n`,
    silent: `export type Word = "admin" | "member";\n`,
  },
  {
    rule: "typescript/no-unsafe-unary-minus",
    refuses: "a unary minus on something that is no number",
    fires: `export const negated = (word: string): number => -word;\n`,
    silent: `export const negated = (count: number): number => -count;\n`,
  },
  {
    rule: "typescript/restrict-template-expressions",
    refuses: "an object interpolated into a template, which writes [object Object]",
    fires: `type Entry = { readonly name: string };\n\nexport const label = (entry: Entry): string => \`entry \${entry}\`;\n`,
    silent: `type Entry = { readonly name: string };\n\nexport const label = (entry: Entry): string => \`entry \${entry.name}\`;\n`,
  },
  {
    rule: "typescript/unbound-method",
    refuses: "a method taken off its instance, which loses the this it was written against",
    fires: `class Door {\n  open(): void {}\n}\n\nexport const opener = new Door().open;\n`,
    silent: `class Door {\n  open(): void {}\n}\n\nconst door = new Door();\n\nexport const opener = (): void => {\n  door.open();\n};\n`,
  },
] as const;

const reportedName = (rule: string): string => rule.slice(rule.indexOf("/") + 1);

const lintUnderCategories = oxlintOver(
  JSON.stringify({
    plugins: config.plugins,
    options: config.options,
    categories: config.categories,
  }),
  { tree: typedTree({ "src/fires.ts": ADOPTED[0].fires }), flagged: ["src/fires.ts"] },
).output;

describe.each(ADOPTED)("$rule refuses $refuses", ({ rule, fires, silent }) => {
  const firing = typedTree({ "src/fires.ts": fires });
  const lintRule = ruleRunner(rule, { tree: firing, flagged: ["src/fires.ts"] });

  it("names the file holding the source it refuses", () => {
    const output = lintRule(firing);

    expect(output).toContain("src/fires.ts");
    expect(output).toContain(reportedName(rule));
  });

  it("stays silent on the source that does the same work the way it asks", () => {
    const output = lintRule(typedTree({ "src/asked.ts": silent }));

    expect(output).not.toContain("src/asked.ts");
  });

  it("is one the repository's own categories switch on, having no line of its own to do it", () => {
    expect(config.rules).not.toHaveProperty(rule);
    expect(lintUnderCategories(firing)).toContain(reportedName(rule));
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
      "packages/core/package.json": JSON.stringify({ name: "@better-answers/core" }),
      "packages/core/src/probe.ts": probe("@modelcontextprotocol/server"),
      "apps/api/src/mcp/probe.ts": probe("@modelcontextprotocol/server"),
    });

    expect(output).toContain("packages/core/src/probe.ts");
    expect(output).toContain("import-direction");
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
