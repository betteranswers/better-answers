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

describe("no two tests in one block share a title", () => {
  const copied: Tree = {
    "test/copied.test.ts": suiteOf("refuses a stranger", "refuses a stranger"),
  };
  const lintTitles = ruleRunner("vitest/no-identical-title", {
    tree: copied,
    flagged: ["test/copied.test.ts"],
  });

  it("fires when a copied test keeps its original's title", () => {
    const output = lintTitles(copied);

    expect(output).toContain("test/copied.test.ts");
    expect(output).toContain("no-identical-title");
  });

  it("stays silent when the two titles differ", () => {
    const output = lintTitles({
      "test/distinct.test.ts": suiteOf("refuses a stranger", "admits a member"),
    });

    expect(output).not.toContain("test/distinct.test.ts");
  });

  it("stays silent when two files share a title", () => {
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

describe("no empty block; a swallowed error carries its comment", () => {
  const silent: Tree = { "src/silent.ts": swallow("") };
  const lintBlocks = ruleRunner("no-empty", { tree: silent, flagged: ["src/silent.ts"] });

  it("fires on an empty catch, with `allowEmptyCatch` off", () => {
    const output = lintBlocks(silent);

    expect(output).toContain("src/silent.ts");
    expect(output).toContain("no-empty");
  });

  it("stays silent on a catch holding a comment", () => {
    const output = lintBlocks({
      "src/reasoned.ts": swallow(
        "\n    // The connection is already gone; releasing it below is all that is left.\n  ",
      ),
    });

    expect(output).not.toContain("src/reasoned.ts");
  });

  it("fires on an empty block that is no catch", () => {
    const output = lintBlocks({
      "src/branch.ts": `export const guard = (revoked: boolean): void => {\n  if (revoked) {\n  }\n};\n`,
    });

    expect(output).toContain("src/branch.ts");
    expect(output).toContain("no-empty");
  });
});

const renames = (body: string): string =>
  `type Member = { name: string };\n\nexport const rename = (member: Member, name: string): Member => {\n  ${body}\n};\n`;

describe("no parameter mutated: a function returns a new value", () => {
  const written: Tree = { "src/written.ts": renames("member.name = name;\n  return member;") };
  const lintParameters = ruleRunner("no-param-reassign", {
    tree: written,
    flagged: ["src/written.ts"],
  });

  it("fires on a write to a parameter's property", () => {
    const output = lintParameters(written);

    expect(output).toContain("src/written.ts");
    expect(output).toContain("no-param-reassign");
  });

  it("fires on a parameter assigned a new value", () => {
    const output = lintParameters({
      "src/rebound.ts": renames("member = { name };\n  return member;"),
    });

    expect(output).toContain("src/rebound.ts");
    expect(output).toContain("no-param-reassign");
  });

  it("stays silent on a copy that carries the change", () => {
    const output = lintParameters({ "src/copied.ts": renames("return { ...member, name };") });

    expect(output).not.toContain("src/copied.ts");
  });
});

/**
 * tsgolint types what it lints from this tsconfig; without one a type-aware rule is silent and
 * every case asserting silence passes.
 */
const typedTree = (files: Tree, include: readonly string[] = ["src"]): Tree => ({
  "tsconfig.json": JSON.stringify({
    compilerOptions: { target: "esnext", module: "esnext", strict: true, noEmit: true },
    include,
  }),
  ...files,
});

const callsRevoke = (call: string): string =>
  `const revoke = async (): Promise<void> => {};\n\nexport const act = async (): Promise<void> => {\n  ${call}\n};\n`;

describe("no promise floats: a call is awaited or `void`", () => {
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

  it("stays silent on a `void`-prefixed call, the sanctioned fire-and-forget", () => {
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

describe("one guard per condition, never re-refusing what the type refused", () => {
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

  it("fires on a guard the type makes unreachable", () => {
    const output = lintGuards(twice);

    expect(output).toContain("src/twice.ts");
    expect(output).toContain("no-unnecessary-condition");
  });

  it("stays silent on the one guard the type leaves reachable", () => {
    const output = lintGuards(typedTree({ "src/once.ts": refusesSession("session === null") }));

    expect(output).not.toContain("src/once.ts");
  });

  it("leaves registry source alone but fires on a copy outside", () => {
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

const SORT_COMPARE = "typescript/require-array-sort-compare";

/** Every override that re-sets the rule, so an exemption widened in the config widens here. */
const sortCompareOverrides = config.overrides.flatMap((override) => {
  const setting = override.rules?.[SORT_COMPARE];
  return setting === undefined
    ? []
    : [{ files: override.files ?? [], rules: { [SORT_COMPARE]: setting } }];
});

const sortingModule = (call: string): string =>
  `export const ordered = (names: readonly string[]): readonly string[] => [...names].${call};\n`;

describe("every sort in source names its comparator", () => {
  const bare = typedTree({ "src/bare.ts": sortingModule("sort()") });
  const lintSorts = oxlintOver(
    JSON.stringify({
      plugins: config.plugins,
      options: config.options,
      rules: { [SORT_COMPARE]: severityOf(SORT_COMPARE) },
      overrides: sortCompareOverrides,
    }),
    { tree: bare, flagged: ["src/bare.ts"] },
  ).output;

  it.each(["sort()", "toSorted()"])("fires on a string array's bare `%s`", (call) => {
    const output = lintSorts(typedTree({ "src/bare.ts": sortingModule(call) }));

    expect(output).toContain("src/bare.ts");
    expect(output).toContain("require-array-sort-compare");
  });

  it("stays silent on a sort given a comparator", () => {
    const output = lintSorts(
      typedTree({
        "src/compared.ts": sortingModule("toSorted((one, other) => one.localeCompare(other))"),
      }),
    );

    expect(output).not.toContain("src/compared.ts");
  });

  it("stays silent on a bare sort in a test", () => {
    const output = lintSorts(
      typedTree(
        { "src/bare.test.ts": sortingModule("sort()"), "test/bare.ts": sortingModule("sort()") },
        ["src", "test"],
      ),
    );

    expect(output).not.toContain("bare.test.ts");
    expect(output).not.toContain("test/bare.ts");
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

describe.each(ADOPTED)("$rule", ({ rule, refuses, fires, silent }) => {
  const firing = typedTree({ "src/fires.ts": fires });
  const lintRule = ruleRunner(rule, { tree: firing, flagged: ["src/fires.ts"] });

  it("names the file holding the source it refuses", () => {
    const output = lintRule(firing);

    expect(output, `refuses ${refuses}`).toContain("src/fires.ts");
    expect(output).toContain(reportedName(rule));
  });

  it("stays silent on the same work done as it asks", () => {
    const output = lintRule(typedTree({ "src/asked.ts": silent }));

    expect(output, `refuses only ${refuses}`).not.toContain("src/asked.ts");
  });

  it("runs under the categories, never named in the rules block", () => {
    expect(config.rules).not.toHaveProperty(rule);
    expect(lintUnderCategories(firing)).toContain(reportedName(rule));
  });
});

describe("the identity provider stays behind its seam", () => {
  it("refuses better-auth outside the auth module and allows it inside", () => {
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

describe("no MCP library type crosses into packages/core", () => {
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
  it("refuses defineEntry and registerTool without annotations, and allows both with", () => {
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

  it("refuses annotations with no readOnlyHint, the host's read-write split", () => {
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

  it("allows other inputs in either form, and unwraps a refine", () => {
    const output = lint({
      "apps/api/src/mcp/entries/probe.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ query: z.string(), limit: z.number() }) });\n`,
      "apps/api/src/mcp/entries/refined.ts": `defineEntry({ name: "open", annotations: { readOnlyHint: true }, input: z.object({ iri: z.string() }).refine(() => true) });\n`,
      "apps/api/src/mcp/raw.ts": `server.registerTool("find", { annotations: { readOnlyHint: true }, inputSchema: { query: z.string() } }, async () => ({}));\n`,
    });

    expect(output).not.toContain("mcp-entry-no-workspace-argument");
  });

  it("fails closed on an opaque input and a spread key", () => {
    const output = lint({
      "apps/api/src/mcp/entries/opaque.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: sharedShape });\n`,
      "apps/api/src/mcp/entries/spread.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ ...base, query: z.string() }) });\n`,
    });

    expect(output).toContain("entries/opaque.ts");
    expect(output).toContain("entries/spread.ts");
    expect(output).toContain("mcp-entry-no-workspace-argument");
  });

  it("fails closed on a registerTool whose inputSchema is a variable", () => {
    const output = lint({
      "apps/api/src/mcp/mount.ts": `server.registerTool(entry.name, { annotations: entry.annotations, inputSchema: entry.input }, entry.run);\n`,
    });

    // The one mount over ENTRIES carries the disable that names its runtime fence.
    expect(output).toContain("mcp-entry-no-workspace-argument");
  });
});
