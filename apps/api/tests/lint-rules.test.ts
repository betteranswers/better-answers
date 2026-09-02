import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The lint rules T-004 adds, run rather than remembered: `[DESIGN5]`'s better-auth ban
 * (an override in `.oxlintrc.json`), ADR 0030's MCP-type ban over `packages/core` (the
 * existing core override, extended here to the v2 package name), and the two
 * `better-answers` plugin rules — every entry carries `annotations`, no entry takes a
 * workspace argument. Each is applied to a throwaway tree so the assertion is as much
 * about where the rule stays silent as where it fires.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const oxlint = path.join(repoRoot, "node_modules", ".bin", "oxlint");

/** JSONC: the repo's config carries the comments explaining each rule. */
const readConfig = (): {
  overrides: { files?: string[]; rules?: Record<string, unknown> }[];
  rules: Record<string, unknown>;
  jsPlugins: { name: string; specifier: string }[];
} =>
  JSON.parse(
    readFileSync(path.join(repoRoot, ".oxlintrc.json"), "utf8").replaceAll(/^\s*\/\/.*$/gm, ""),
  ) as ReturnType<typeof readConfig>;

const overrideFor = (glob: string) => {
  const found = readConfig().overrides.find((override) => override.files?.includes(glob));
  if (found === undefined) throw new Error(`no override for ${glob} in .oxlintrc.json`);
  return found;
};

type Fixture = Readonly<Record<string, string>>;

/** Lint `files` (path → source) under the repo's real config, returning oxlint's output. */
const lint = (files: Fixture): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "t004-lint-"));
  const config = readConfig();
  writeFileSync(
    path.join(dir, ".oxlintrc.json"),
    JSON.stringify({
      // The plugin is resolved from the repo, not copied.
      jsPlugins: config.jsPlugins.map((plugin) => ({
        ...plugin,
        specifier: path.join(repoRoot, plugin.specifier),
      })),
      rules: Object.fromEntries(
        Object.entries(config.rules).filter(([name]) => name.startsWith("better-answers/")),
      ),
      overrides: [
        overrideFor("**/*.ts"),
        overrideFor("apps/api/src/auth/**"),
        overrideFor("packages/core/**"),
      ],
    }),
  );
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), source);
  }
  try {
    return execFileSync(oxlint, ["--config", ".oxlintrc.json", "."], {
      cwd: dir,
      encoding: "utf8",
    });
  } catch (error) {
    // oxlint exits non-zero when it finds a diagnostic, which is the case under test.
    return String((error as { stdout?: string }).stdout ?? "");
  }
};

const probe = (specifier: string): string =>
  `import * as probe from "${specifier}";\nexport const keep = probe;\n`;

describe("[DESIGN5] — the identity provider stays behind its seam", () => {
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
