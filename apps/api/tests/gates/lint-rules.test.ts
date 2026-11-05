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
      `\`${name}\` is in neither the rules block nor the \`correctness\` category of .oxlintrc.json, so this test has no severity to run it at.`,
    );
  return correctness;
};

const ruleLint = (name: string): ((tree: Tree) => PlannedLint) => {
  const setting = severityOf(name);
  const relaxed = config.overrides.filter((override) => override.rules?.[name] !== undefined);
  if (relaxed.length > 0)
    throw new Error(
      `\`${name}\` is changed by an override for ${relaxed.map((o) => o.files?.join(", ")).join("; ")}. This runner applies no overrides, so these cases would test a setting those files do not use.`,
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

  it("reports two tests with the same title in one block", () => {
    const output = copied.output();

    expect(output).toContain("test/copied.test.ts");
    expect(output).toContain("no-identical-title");
  });

  it("reports nothing when the two titles differ", () => {
    expect(distinct.output()).not.toContain("test/distinct.test.ts");
  });

  it("reports nothing when two files share a title", () => {
    const output = shared.output();

    expect(output).not.toContain("test/one.test.ts");
    expect(output).not.toContain("test/two.test.ts");
  });
});

const swallow = (body: string): string =>
  `export const rollbackQuietly = async (client: Client): Promise<void> => {\n  try {\n    await client.query("ROLLBACK");\n  } catch {${body}}\n};\n`;

describe("no-empty rejects empty blocks except a commented catch", () => {
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

  it("reports an empty catch, because `allowEmptyCatch` is off", () => {
    const output = silent.output();

    expect(output).toContain("src/silent.ts");
    expect(output).toContain("no-empty");
  });

  it("reports nothing for a catch that contains a comment", () => {
    expect(reasoned.output()).not.toContain("src/reasoned.ts");
  });

  it("reports an empty block that is not a catch", () => {
    const output = branch.output();

    expect(output).toContain("src/branch.ts");
    expect(output).toContain("no-empty");
  });
});

const renames = (body: string): string =>
  `type Member = { name: string };\n\nexport const rename = (member: Member, name: string): Member => {\n  ${body}\n};\n`;

describe("no-param-reassign rejects writes to a parameter", () => {
  const lintParameters = ruleLint("no-param-reassign");
  const written = lintParameters({
    "src/written.ts": renames("member.name = name;\n  return member;"),
  });
  const rebound = lintParameters({
    "src/rebound.ts": renames("member = { name };\n  return member;"),
  });
  const copied = lintParameters({ "src/copied.ts": renames("return { ...member, name };") });

  it("reports a write to a parameter's property", () => {
    const output = written.output();

    expect(output).toContain("src/written.ts");
    expect(output).toContain("no-param-reassign");
  });

  it("reports a parameter assigned a new value", () => {
    const output = rebound.output();

    expect(output).toContain("src/rebound.ts");
    expect(output).toContain("no-param-reassign");
  });

  it("reports nothing for a function that returns a changed copy", () => {
    expect(copied.output()).not.toContain("src/copied.ts");
  });
});

/**
 * tsgolint needs a tsconfig to type the files. Without one, a type-aware rule reports nothing, and
 * every case that expects no report passes.
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

describe("no-floating-promises requires each promise to be awaited or voided", () => {
  const lintPromises = ruleLint("typescript/no-floating-promises");
  const forgotten = lintPromises(typedTree({ "src/forgotten.ts": callsRevoke("revoke();") }));
  const sanctioned = lintPromises(
    typedTree({ "src/sanctioned.ts": callsRevoke("void revoke();") }),
  );
  const awaited = lintPromises(typedTree({ "src/awaited.ts": callsRevoke("await revoke();") }));

  it("reports a call whose promise is neither awaited nor voided", () => {
    const output = forgotten.output();

    expect(output).toContain("src/forgotten.ts");
    expect(output).toContain("no-floating-promises");
  });

  it("reports nothing for a call prefixed with `void`", () => {
    expect(sanctioned.output()).not.toContain("src/sanctioned.ts");
  });

  it("reports nothing for an awaited call", () => {
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

describe("no-unnecessary-condition rejects a check the type already rules out", () => {
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

  it("reports an `=== undefined` check the type rules out", () => {
    const output = twice.output();

    expect(output).toContain("src/twice.ts");
    expect(output).toContain("no-unnecessary-condition");
  });

  it("reports nothing for a null check on a nullable value", () => {
    expect(once.output()).not.toContain("src/once.ts");
  });

  it("skips apps/web/src/shared/ui but reports the same code elsewhere", () => {
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

describe("every sort in source code passes a comparator", () => {
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

  it.each(bare)("reports `%s` with no comparator on a string array", (_call, found) => {
    const output = found.output();

    expect(output).toContain("src/bare.ts");
    expect(output).toContain("require-array-sort-compare");
  });

  it("reports nothing for a sort with a comparator", () => {
    expect(compared.output()).not.toContain("src/compared.ts");
  });

  it("reports nothing for a sort without a comparator in tests", () => {
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
    refuses: "a union member that another member already covers",
    fires: `export type Word = string | "member";\n`,
    silent: `export type Word = "admin" | "member";\n`,
  },
  {
    rule: "typescript/no-unsafe-unary-minus",
    refuses: "a unary minus on a value that is not a number",
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
    refuses: "a method detached from its instance, which loses its `this`",
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

  it("reports the file that breaks the rule", () => {
    const output = refused.output();

    expect(output, `the rule did not report ${refuses}`).toContain("src/fires.ts");
    expect(output).toContain(reportedName(rule));
  });

  it("reports nothing for the fixed version of the code", () => {
    expect(asked.output(), `the rule reported the fixed version of ${refuses}`).not.toContain(
      "src/asked.ts",
    );
  });

  it("runs through a category, not the rules block", () => {
    expect(config.rules).not.toHaveProperty(rule);
    expect(categorised.output()).toContain(reportedName(rule));
  });
});

describe("better-auth imports stay inside the auth module", () => {
  const seam = lint({
    "apps/api/src/mcp/probe.ts": probe("better-auth"),
    "apps/api/src/auth/probe.ts": probe("better-auth"),
    "apps/api/lifts/better-auth-cimd-node/probe.ts": probe("@better-auth/core/utils/host"),
    "packages/core/src/probe.ts": probe("@better-auth/oauth-provider"),
  });

  it("reports better-auth imports outside the auth module and its lift", () => {
    const output = seam.output();

    expect(output).toContain("apps/api/src/mcp/probe.ts");
    expect(output).toContain("packages/core/src/probe.ts");
    expect(output).not.toContain("apps/api/src/auth/probe.ts");
    expect(output).not.toContain("apps/api/lifts/better-auth-cimd-node/probe.ts");
  });
});

describe("packages/core cannot import the MCP library", () => {
  const crossing = lint({
    "packages/core/package.json": JSON.stringify({ name: "@better-answers/core" }),
    "packages/core/src/probe.ts": probe("@modelcontextprotocol/server"),
    "apps/api/src/mcp/probe.ts": probe("@modelcontextprotocol/server"),
  });

  it("reports the MCP server import in packages/core, not apps/api", () => {
    const output = crossing.output();

    expect(output).toContain("packages/core/src/probe.ts");
    expect(output).toContain("import-direction");
    expect(output).not.toContain("apps/api/src/mcp/probe.ts");
  });
});

describe("every MCP entry declares its annotations", () => {
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

  it("reports defineEntry and registerTool calls that lack annotations", () => {
    const output = annotated.output();

    expect(output).toContain("entries/without.ts");
    expect(output).toContain("registered-without.ts");
    expect(output).toContain("mcp-entry-annotations");
    expect(output).not.toContain("entries/with.ts");
    expect(output).not.toContain("registered-with.ts");
  });

  it("reports annotations that lack readOnlyHint", () => {
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
  )("reports an input named %s", (name, found) => {
    const output = found.output();

    expect(output).toContain("mcp-entry-no-workspace-argument");
    expect(output).toContain(name);
  });

  const allowed = lint({
    "apps/api/src/mcp/entries/probe.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ query: z.string(), limit: z.number() }) });\n`,
    "apps/api/src/mcp/entries/refined.ts": `defineEntry({ name: "open", annotations: { readOnlyHint: true }, input: z.object({ iri: z.string() }).refine(() => true) });\n`,
    "apps/api/src/mcp/raw.ts": `server.registerTool("find", { annotations: { readOnlyHint: true }, inputSchema: { query: z.string() } }, async () => ({}));\n`,
  });

  it("reports nothing for other input names, even inside a refine", () => {
    expect(allowed.output()).not.toContain("mcp-entry-no-workspace-argument");
  });

  const closed = lint({
    "apps/api/src/mcp/entries/opaque.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: sharedShape });\n`,
    "apps/api/src/mcp/entries/spread.ts": `defineEntry({ name: "find", annotations: { readOnlyHint: true }, input: z.object({ ...base, query: z.string() }) });\n`,
  });

  it("reports an input variable or a spread it cannot inspect", () => {
    const output = closed.output();

    expect(output).toContain("entries/opaque.ts");
    expect(output).toContain("entries/spread.ts");
    expect(output).toContain("mcp-entry-no-workspace-argument");
  });

  const variable = lint({
    "apps/api/src/mcp/mount.ts": `server.registerTool(entry.name, { annotations: entry.annotations, inputSchema: entry.input }, entry.run);\n`,
  });

  it("reports a registerTool whose inputSchema is a variable", () => {
    expect(variable.output()).toContain("mcp-entry-no-workspace-argument");
  });
});
