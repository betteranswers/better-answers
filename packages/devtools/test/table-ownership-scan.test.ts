import { describe, expect, it } from "vitest";

import {
  SCAN_EXECUTABLE,
  tablesReadIn,
  WHERE_THE_MAP_LIVES,
} from "@better-answers/devtools/table-ownership-scan";
import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

type Entry = { readonly table: string; readonly by: string; readonly access: string };

const mapOf = (entries: readonly Entry[], outsideCore: readonly string[] = []): string =>
  [
    `export const OWNERS_OUTSIDE_CORE = ${JSON.stringify(outsideCore)};`,
    "export const TABLE_OWNERS = {",
    '  "public.member": "members",',
    '  "public.job": "runs",',
    '  "public.user": "apps/api/src/auth",',
    "};",
    `export const CROSS_OWNER_TABLE_ACCESS = ${JSON.stringify(entries)};`,
    "",
  ].join("\n");

const WORKSPACES = "packages/core/src/workspaces/index.ts";

const READS_MEMBER: Entry = { table: "public.member", by: "workspaces", access: "read" };

const statement = (sql: string): string => `export const STATEMENT = \`\n  ${sql}\`;\n`;

const CLEAN: Tree = {
  [WHERE_THE_MAP_LIVES]: mapOf([READS_MEMBER]),
  [WORKSPACES]: statement("SELECT role FROM member m WHERE m.user_id = $1"),
  "packages/core/src/members/index.ts": statement("SELECT 1 FROM member"),
  "packages/core/src/runs/index.ts": statement("SELECT id FROM job"),
  "apps/api/src/index.ts": "export const one = 1;\n",
};

const withWorkspaces = (sql: string): Tree => ({ ...CLEAN, [WORKSPACES]: statement(sql) });

const scan = runsOverThrowawayTree({
  executable: SCAN_EXECUTABLE,
  argv: ["packages/core/src", "apps"],
  foundSomething: [1],
  smoke: {
    tree: withWorkspaces("SELECT 1 FROM member JOIN job ON true"),
    reports: (output) => output.includes(`${WORKSPACES}:2:`),
  },
});

const findings = (tree: Tree): readonly string[] =>
  scan(tree)
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("every table"));

const tablesIn = (source: string): readonly string[] =>
  tablesReadIn("one.ts", source).map(({ table }) => table);

describe("the tables a source names", () => {
  it.each([
    ["an unquoted name, on the search path", "SELECT 1 FROM Member", "public.member"],
    ["a quoted name, kept as written", 'SELECT 1 FROM "user" u', "public.user"],
    ["a quoted schema", 'SELECT 1 FROM "index".passage c', "index.passage"],
    ["a joined table", "SELECT 1 FROM member m JOIN job j ON true", "public.job"],
    ["a lower-case statement", "select 1 from member", "public.member"],
  ])("reads %s", (_what, sql, table) => {
    expect(tablesIn(statement(sql))).toContain(table);
  });

  it("reads a plain string as well as a template", () => {
    expect(tablesIn('const q = "SELECT 1 FROM job";\n')).toEqual(["public.job"]);
  });

  it("reads a quoted name a plain string escapes", () => {
    expect(tablesIn('const q = "SELECT 1 FROM \\"index\\".passage";\n')).toEqual(["index.passage"]);
  });

  it("reads each piece of a template around its interpolations", () => {
    const source =
      "const q = `SELECT 1 FROM job WHERE ${where} AND EXISTS (SELECT 1 FROM member)`;\n";
    expect(tablesIn(source)).toEqual(["public.job", "public.member"]);
  });

  it("counts the line from the file, not from the string", () => {
    const [found] = tablesReadIn("one.ts", `// one\n\nconst q = \`\n  SELECT 1\n  FROM job\`;\n`);
    expect(found?.line).toBe(5);
  });

  it("leaves out a CTE, but never the qualified table", () => {
    const sql =
      "WITH job AS (SELECT 1), live(id) AS (SELECT 2) SELECT 1 FROM job, live JOIN public.job ON true";
    expect(tablesIn(statement(sql))).toEqual(["public.job"]);
  });

  it.each([
    ["a recursive CTE", "WITH RECURSIVE job(id) AS (SELECT 1) SELECT 1 FROM job"],
    ["a materialized CTE", "WITH job AS MATERIALIZED (SELECT 1) SELECT 1 FROM job"],
    [
      "a CTE kept from being materialized",
      "WITH job AS NOT MATERIALIZED (SELECT 1) SELECT 1 FROM job",
    ],
  ])("leaves out %s", (_what, sql) => {
    expect(tablesIn(statement(sql))).toEqual([]);
  });

  it("marks a delete as no read of its table", () => {
    expect(tablesReadIn("one.ts", statement("DELETE FROM job WHERE id = $1"))).toEqual([
      expect.objectContaining({ table: "public.job", reads: false }),
    ]);
  });

  it.each([
    ["a comment", "// SELECT 1 FROM job\nexport const one = 1;\n"],
    ["an import", 'import { job } from "job";\n'],
  ])("walks past %s", (_what, source) => {
    expect(tablesIn(source)).toEqual([]);
  });

  it("refuses a file that does not parse", () => {
    expect(() => tablesReadIn("one.ts", "const = ;")).toThrow(/does not parse/);
  });
});

describe("the scan over a throwaway tree, slice to map", () => {
  it("passes a tree whose every read is owned or declared", () => {
    expect(findings(CLEAN)).toEqual([]);
  });

  it("refuses an undeclared read, naming its line and the map", () => {
    expect(findings(withWorkspaces("SELECT 1 FROM member JOIN job ON true"))).toEqual([
      expect.stringMatching(
        new RegExp(
          `^${WORKSPACES}:2: workspaces names public\\.job, which runs owns, and ${WHERE_THE_MAP_LIVES}`,
        ),
      ),
    ]);
  });

  it("refuses an undeclared delete as it refuses a read", () => {
    expect(findings(withWorkspaces("SELECT 1 FROM member; DELETE FROM job"))).toEqual([
      expect.stringContaining("workspaces names public.job"),
    ]);
  });

  it("refuses a read under an entry declaring only a write", () => {
    const tree = {
      ...CLEAN,
      [WHERE_THE_MAP_LIVES]: mapOf([
        READS_MEMBER,
        { table: "public.job", by: "workspaces", access: "write" },
      ]),
      [WORKSPACES]: statement("SELECT 1 FROM member JOIN job ON true"),
    };
    expect(findings(tree)).toEqual([expect.stringContaining("declares no read by workspaces")]);
  });

  it("refuses a read another slice's entry declares", () => {
    const tree = {
      ...CLEAN,
      [WHERE_THE_MAP_LIVES]: mapOf([
        READS_MEMBER,
        { table: "public.job", by: "members", access: "read" },
      ]),
      "packages/core/src/members/index.ts": statement("SELECT 1 FROM member JOIN job ON true"),
      [WORKSPACES]: statement("SELECT 1 FROM member JOIN job ON true"),
    };
    expect(findings(tree)).toEqual([
      expect.stringContaining(`${WORKSPACES}:2: workspaces names public.job`),
    ]);
  });

  it("passes a CTE named like a table not owned", () => {
    const tree = withWorkspaces("WITH job AS (SELECT 1) SELECT 1 FROM job JOIN member ON true");
    expect(findings(tree)).toEqual([]);
  });

  it("refuses a statement under no slice", () => {
    const tree = { ...CLEAN, "packages/core/src/kernel/index.ts": statement("SELECT 1 FROM job") };
    expect(findings(tree)).toEqual([
      expect.stringContaining(
        "packages/core/src/kernel/index.ts:2: names public.job outside every slice",
      ),
    ]);
  });

  it("walks past a suite, which may read any table", () => {
    const tree = {
      ...CLEAN,
      "packages/core/src/workspaces/one.test.ts": statement("SELECT 1 FROM job"),
    };
    expect(findings(tree)).toEqual([]);
  });

  it("gives a file to the deepest owner holding it", () => {
    const tree = {
      ...CLEAN,
      [WHERE_THE_MAP_LIVES]: mapOf([READS_MEMBER], ["apps/api/src", "apps/api/src/auth"]),
      "apps/api/src/auth/one.ts": statement('SELECT 1 FROM "user"'),
      "apps/api/src/two.ts": statement('SELECT 1 FROM "user"'),
    };
    expect(findings(tree)).toEqual([
      expect.stringContaining("apps/api/src/two.ts:2: apps/api/src names public.user"),
    ]);
  });
});

describe("the scan over a throwaway tree, map to slice", () => {
  const declaring = (entry: Entry): Tree => ({
    ...CLEAN,
    [WHERE_THE_MAP_LIVES]: mapOf([READS_MEMBER, entry]),
  });

  it("refuses a declared read no statement in its slice makes", () => {
    expect(findings(declaring({ table: "public.job", by: "workspaces", access: "read" }))).toEqual([
      `${WHERE_THE_MAP_LIVES}: declares that workspaces reads public.job, and no statement under workspaces reads it; remove the entry, or correct its access to a write if the slice only writes it.`,
    ]);
  });

  it("refuses a declared read that only a delete makes", () => {
    const tree = {
      ...declaring({ table: "public.job", by: "workspaces", access: "read and write" }),
      [WORKSPACES]: statement("SELECT 1 FROM member; DELETE FROM job"),
    };
    expect(findings(tree)).toEqual([
      expect.stringContaining("declares that workspaces reads public.job"),
    ]);
  });

  it("passes a declared read its slice makes", () => {
    const tree = {
      ...declaring({ table: "public.job", by: "workspaces", access: "read and write" }),
      [WORKSPACES]: statement("SELECT 1 FROM member JOIN job ON true"),
    };
    expect(findings(tree)).toEqual([]);
  });

  it("passes a write-only entry, which a read scan cannot hold", () => {
    expect(findings(declaring({ table: "public.job", by: "workspaces", access: "write" }))).toEqual(
      [],
    );
  });
});

describe("a scan that proves nothing", () => {
  it("refuses a run that read no source file", () => {
    const tree = {
      [WHERE_THE_MAP_LIVES]: mapOf([]),
      "packages/core/src/workspaces/one.test.ts": "",
      "apps/api/src/one.test.ts": "",
    };
    expect(() => scan(tree)).toThrow(/no source file under/);
  });

  it("refuses a map that names no table", () => {
    const tree = {
      ...CLEAN,
      [WHERE_THE_MAP_LIVES]:
        "export const OWNERS_OUTSIDE_CORE = [];\nexport const TABLE_OWNERS = {};\nexport const CROSS_OWNER_TABLE_ACCESS = [];\n",
    };
    expect(() => scan(tree)).toThrow(/no table in the map/);
  });

  it("refuses a run with no map to read", () => {
    const { [WHERE_THE_MAP_LIVES]: _map, ...unmapped } = CLEAN;
    expect(() => scan(unmapped)).toThrow(/the scan did not finish/);
  });
});
