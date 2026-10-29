import { beforeAll, describe, expect, it } from "vitest";

import {
  loadableAnywhere,
  oxlintOverrideFor,
  readOxlintConfig,
  type OxlintConfig,
} from "@better-answers/devtools/oxlint-config";
import {
  oxlintBatchOver,
  type PlannedLint,
  type Tree,
} from "@better-answers/devtools/throwaway-tree";

const probe = (specifier: string): string =>
  `import * as probe from "${specifier}";\nexport const keep = probe;\n`;

const config = readOxlintConfig();

const batch = oxlintBatchOver(JSON.stringify({ options: config.options }));

const linted = (tree: Tree, ruleConfig: string): PlannedLint => batch.plan(tree, ruleConfig);

beforeAll(batch.run);

const BETTER_ANSWERS_CONFIG = JSON.stringify({
  jsPlugins: config.jsPlugins.map(loadableAnywhere),
  rules: Object.fromEntries(
    Object.entries(config.rules).filter(([name]) => name.startsWith("better-answers/")),
  ),
  overrides: [oxlintOverrideFor("**/*.ts"), oxlintOverrideFor("apps/api/src/auth/**")],
});

const lint = (tree: Tree): PlannedLint => linted(tree, BETTER_ANSWERS_CONFIG);

batch.control(
  {
    "apps/api/src/mcp/probe.ts": probe("better-auth"),
    "apps/api/src/auth/probe.ts": probe("better-auth"),
  },
  BETTER_ANSWERS_CONFIG,
  ["apps/api/src/mcp/probe.ts"],
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

const ruleLint = (name: string): ((tree: Tree) => PlannedLint) => {
  const setting = severityOf(name);
  const relaxed = config.overrides.filter((override) => override.rules?.[name] !== undefined);
  if (relaxed.length > 0)
    throw new Error(
      `\`${name}\` is re-set by an override over ${relaxed.map((o) => o.files?.join(", ")).join("; ")}, which this runner does not carry — so these cases would prove the rule somewhere it no longer holds.`,
    );
  const ruleConfig = JSON.stringify({ plugins: config.plugins, rules: { [name]: setting } });
  return (tree) => linted(tree, ruleConfig);
};

const suiteOf = (...titles: readonly string[]): string =>
  `describe("the workspace door", () => {\n${titles
    .map((title) => `  it("${title}", () => {\n    expect(door).toBeDefined();\n  });`)
    .join("\n")}\n});\n`;

describe("no two tests in one block share a title", () => {
  const lintTitles = ruleLint("vitest/no-identical-title");
  const copied = lintTitles({
    "test/copied.test.ts": suiteOf("refuses a stranger", "refuses a stranger"),
  });
  const distinct = lintTitles({
    "test/distinct.test.ts": suiteOf("refuses a stranger", "admits a member"),
  });
  const shared = lintTitles({
    "test/one.test.ts": suiteOf("refuses a stranger"),
    "test/two.test.ts": suiteOf("refuses a stranger"),
  });

  it("fires when a copied test keeps its original's title", () => {
    const output = copied.output();

    expect(output).toContain("test/copied.test.ts");
    expect(output).toContain("no-identical-title");
  });

  it("stays silent when the two titles differ", () => {
    expect(distinct.output()).not.toContain("test/distinct.test.ts");
  });

  it("stays silent when two files share a title", () => {
    const output = shared.output();

    expect(output).not.toContain("test/one.test.ts");
    expect(output).not.toContain("test/two.test.ts");
  });
});

const swallow = (body: string): string =>
  `export const rollbackQuietly = async (client: Client): Promise<void> => {\n  try {\n    await client.query("ROLLBACK");\n  } catch {${body}}\n};\n`;

describe("no empty block; a swallowed error carries its comment", () => {
  const lintBlocks = ruleLint("no-empty");
  const silent = lintBlocks({ "src/silent.ts": swallow("") });
  const reasoned = lintBlocks({
    "src/reasoned.ts": swallow(
      "\n    // The connection is already gone; releasing it below is all that is left.\n  ",
    ),
  });
  const branch = lintBlocks({
    "src/branch.ts": `export const guard = (revoked: boolean): void => {\n  if (revoked) {\n  }\n};\n`,
  });

  it("fires on an empty catch, with `allowEmptyCatch` off", () => {
    const output = silent.output();

    expect(output).toContain("src/silent.ts");
    expect(output).toContain("no-empty");
  });

  it("stays silent on a catch holding a comment", () => {
    expect(reasoned.output()).not.toContain("src/reasoned.ts");
  });

  it("fires on an empty block that is no catch", () => {
    const output = branch.output();

    expect(output).toContain("src/branch.ts");
    expect(output).toContain("no-empty");
  });
});

const renames = (body: string): string =>
  `type Member = { name: string };\n\nexport const rename = (member: Member, name: string): Member => {\n  ${body}\n};\n`;

describe("no parameter mutated: a function returns a new value", () => {
  const lintParameters = ruleLint("no-param-reassign");
  const written = lintParameters({
    "src/written.ts": renames("member.name = name;\n  return member;"),
  });
  const rebound = lintParameters({
    "src/rebound.ts": renames("member = { name };\n  return member;"),
  });
  const copied = lintParameters({ "src/copied.ts": renames("return { ...member, name };") });

  it("fires on a write to a parameter's property", () => {
    const output = written.output();

    expect(output).toContain("src/written.ts");
    expect(output).toContain("no-param-reassign");
  });

  it("fires on a parameter assigned a new value", () => {
    const output = rebound.output();

    expect(output).toContain("src/rebound.ts");
    expect(output).toContain("no-param-reassign");
  });

  it("stays silent on a copy that carries the change", () => {
    expect(copied.output()).not.toContain("src/copied.ts");
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
  `const revoke = async (): Promise<void> => {};\n\nexport const action = async (): Promise<void> => {\n  ${call}\n};\n`;

describe("no promise floats: a call is awaited or `void`", () => {
  const lintPromises = ruleLint("typescript/no-floating-promises");
  const forgotten = lintPromises(typedTree({ "src/forgotten.ts": callsRevoke("revoke();") }));
  const sanctioned = lintPromises(
    typedTree({ "src/sanctioned.ts": callsRevoke("void revoke();") }),
  );
  const awaited = lintPromises(typedTree({ "src/awaited.ts": callsRevoke("await revoke();") }));

  it("fires on a call whose promise nobody takes", () => {
    const output = forgotten.output();

    expect(output).toContain("src/forgotten.ts");
    expect(output).toContain("no-floating-promises");
  });

  it("stays silent on a `void`-prefixed call, the sanctioned fire-and-forget", () => {
    expect(sanctioned.output()).not.toContain("src/sanctioned.ts");
  });

  it("stays silent on an awaited call", () => {
    expect(awaited.output()).not.toContain("src/awaited.ts");
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
  const guardsConfig = JSON.stringify({
    plugins: config.plugins,
    rules: { [UNNECESSARY_CONDITION]: severityOf(UNNECESSARY_CONDITION) },
    overrides: [registryZone()],
  });
  const lintGuards = (tree: Tree): PlannedLint => linted(tree, guardsConfig);
  const twice = lintGuards(
    typedTree({ "src/twice.ts": refusesSession("session === null || session === undefined") }),
  );
  const once = lintGuards(typedTree({ "src/once.ts": refusesSession("session === null") }));
  const registry = lintGuards(
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

  it("fires on a guard the type makes unreachable", () => {
    const output = twice.output();

    expect(output).toContain("src/twice.ts");
    expect(output).toContain("no-unnecessary-condition");
  });

  it("stays silent on the one guard the type leaves reachable", () => {
    expect(once.output()).not.toContain("src/once.ts");
  });

  it("leaves registry source alone but fires on a copy outside", () => {
    const output = registry.output();

    expect(output).toContain("apps/web/src/features/twice.ts");
    expect(output).not.toContain("apps/web/src/shared/ui/twice.ts");
  });
});

const SORT_COMPARE = "typescript/require-array-sort-compare";

const sortCompareOverrides = config.overrides.flatMap((override) => {
  const setting = override.rules?.[SORT_COMPARE];
  return setting === undefined
    ? []
    : [{ files: override.files ?? [], rules: { [SORT_COMPARE]: setting } }];
});

const sortingModule = (call: string): string =>
  `export const ordered = (names: readonly string[]): readonly string[] => [...names].${call};\n`;

describe("every sort in source names its comparator", () => {
  const sortsConfig = JSON.stringify({
    plugins: config.plugins,
    rules: { [SORT_COMPARE]: severityOf(SORT_COMPARE) },
    overrides: sortCompareOverrides,
  });
  const lintSorts = (tree: Tree): PlannedLint => linted(tree, sortsConfig);
  const bare = ["sort()", "toSorted()"].map(
    (call) => [call, lintSorts(typedTree({ "src/bare.ts": sortingModule(call) }))] as const,
  );
  const compared = lintSorts(
    typedTree({
      "src/compared.ts": sortingModule("toSorted((one, other) => one.localeCompare(other))"),
    }),
  );
  const inTest = lintSorts(
    typedTree(
      { "src/bare.test.ts": sortingModule("sort()"), "test/bare.ts": sortingModule("sort()") },
      ["src", "test"],
    ),
  );

  it.each(bare)("fires on a string array's bare `%s`", (_call, found) => {
    const output = found.output();

    expect(output).toContain("src/bare.ts");
    expect(output).toContain("require-array-sort-compare");
  });

  it("stays silent on a sort given a comparator", () => {
    expect(compared.output()).not.toContain("src/compared.ts");
  });

  it("stays silent on a bare sort in a test", () => {
    const output = inTest.output();

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
    fires: `const close = (): void => {};\n\nexport const action = (): void => void close();\n`,
    silent: `const close = async (): Promise<void> => {};\n\nexport const action = (): void => void close();\n`,
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

const CATEGORIES_CONFIG = JSON.stringify({
  plugins: config.plugins,
  categories: config.categories,
});

const lintUnderCategories = (tree: Tree): PlannedLint => linted(tree, CATEGORIES_CONFIG);

batch.control(typedTree({ "src/fires.ts": ADOPTED[0].fires }), CATEGORIES_CONFIG, ["src/fires.ts"]);

describe.each(ADOPTED)("$rule", ({ rule, refuses, fires, silent }) => {
  const firing = typedTree({ "src/fires.ts": fires });
  const lintRule = ruleLint(rule);
  const refused = lintRule(firing);
  const asked = lintRule(typedTree({ "src/asked.ts": silent }));
  const categorised = lintUnderCategories(firing);

  it("names the file holding the source it refuses", () => {
    const output = refused.output();

    expect(output, `refuses ${refuses}`).toContain("src/fires.ts");
    expect(output).toContain(reportedName(rule));
  });

  it("stays silent on the same work done as it asks", () => {
    expect(asked.output(), `refuses only ${refuses}`).not.toContain("src/asked.ts");
  });

  it("runs under the categories, never named in the rules block", () => {
    expect(config.rules).not.toHaveProperty(rule);
    expect(categorised.output()).toContain(reportedName(rule));
  });
});

describe("the identity provider stays behind its seam", () => {
  const seam = lint({
    "apps/api/src/mcp/probe.ts": probe("better-auth"),
    "apps/api/src/auth/probe.ts": probe("better-auth"),
    "apps/api/lifts/better-auth-cimd-node/probe.ts": probe("@better-auth/core/utils/host"),
    "packages/core/src/probe.ts": probe("@better-auth/oauth-provider"),
  });

  it("refuses better-auth outside the auth module and allows it inside", () => {
    const output = seam.output();

    expect(output).toContain("apps/api/src/mcp/probe.ts");
    expect(output).toContain("packages/core/src/probe.ts");
    expect(output).not.toContain("apps/api/src/auth/probe.ts");
    expect(output).not.toContain("apps/api/lifts/better-auth-cimd-node/probe.ts");
  });
});

describe("no MCP library type crosses into packages/core", () => {
  const crossing = lint({
    "packages/core/package.json": JSON.stringify({ name: "@better-answers/core" }),
    "packages/core/src/probe.ts": probe("@modelcontextprotocol/server"),
    "apps/api/src/mcp/probe.ts": probe("@modelcontextprotocol/server"),
  });

  it("refuses @modelcontextprotocol/server inside packages/core and allows it in apps/api", () => {
    const output = crossing.output();

    expect(output).toContain("packages/core/src/probe.ts");
    expect(output).toContain("import-direction");
    expect(output).not.toContain("apps/api/src/mcp/probe.ts");
  });
});

describe("every MCP entry carries its annotations", () => {
  const annotated = lint({
    "apps/api/src/mcp/entries/without.ts": `defineEntry({ name: "find", input: z.object({ query: z.string() }) });\n`,
    "apps/api/src/mcp/entries/with.ts": `defineEntry({ name: "find", input: z.object({ query: z.string() }), annotations: { readOnlyHint: true } });\n`,
    "apps/api/src/mcp/registered-without.ts": `server.registerTool("find", { inputSchema: z.object({}) }, async () => ({}));\n`,
    "apps/api/src/mcp/registered-with.ts": `server.registerTool("find", { inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => ({}));\n`,
  });
  const hinted = lint({
    "apps/api/src/mcp/entries/no-hint.ts": `defineEntry({ name: "find", input: z.object({}), annotations: { idempotentHint: true } });\n`,
    "apps/api/src/mcp/entries/hinted.ts": `defineEntry({ name: "find", input: z.object({}), annotations: { readOnlyHint: false } });\n`,
  });

  it("refuses defineEntry and registerTool without annotations, and allows both with", () => {
    const output = annotated.output();

    expect(output).toContain("entries/without.ts");
    expect(output).toContain("registered-without.ts");
    expect(output).toContain("mcp-entry-annotations");
    expect(output).not.toContain("entries/with.ts");
    expect(output).not.toContain("registered-with.ts");
  });

  it("refuses annotations with no readOnlyHint, the host's read-write split", () => {
    const output = hinted.output();

    expect(output).toContain("entries/no-hint.ts");
    expect(output).toContain("mcp-entry-annotations");
    expect(output).not.toContain("entries/hinted.ts");
  });
});

describe("no MCP entry takes a workspace argument", () => {
  it.each(
    ["workspace", "workspaceId", "bundle", "tenant_id"].map(
      (name) =>
        [
          name,
          lint({
            "apps/api/src/mcp/entries/probe.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ ${name}: z.string() }) });\n`,
          }),
        ] as const,
    ),
  )("refuses an input named %s", (name, found) => {
    const output = found.output();

    expect(output).toContain("mcp-entry-no-workspace-argument");
    expect(output).toContain(name);
  });

  const allowed = lint({
    "apps/api/src/mcp/entries/probe.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ query: z.string(), limit: z.number() }) });\n`,
    "apps/api/src/mcp/entries/refined.ts": `defineEntry({ name: "open", annotations: { readOnlyHint: true }, input: z.object({ iri: z.string() }).refine(() => true) });\n`,
    "apps/api/src/mcp/raw.ts": `server.registerTool("find", { annotations: { readOnlyHint: true }, inputSchema: { query: z.string() } }, async () => ({}));\n`,
  });

  it("allows other inputs in either form, and unwraps a refine", () => {
    expect(allowed.output()).not.toContain("mcp-entry-no-workspace-argument");
  });

  const closed = lint({
    "apps/api/src/mcp/entries/opaque.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: sharedShape });\n`,
    "apps/api/src/mcp/entries/spread.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ ...base, query: z.string() }) });\n`,
  });

  it("fails closed on an opaque input and a spread key", () => {
    const output = closed.output();

    expect(output).toContain("entries/opaque.ts");
    expect(output).toContain("entries/spread.ts");
    expect(output).toContain("mcp-entry-no-workspace-argument");
  });

  const variable = lint({
    "apps/api/src/mcp/mount.ts": `server.registerTool(entry.name, { annotations: entry.annotations, inputSchema: entry.input }, entry.run);\n`,
  });

  it("fails closed on a registerTool whose inputSchema is a variable", () => {
    expect(variable.output()).toContain("mcp-entry-no-workspace-argument");
  });
});
