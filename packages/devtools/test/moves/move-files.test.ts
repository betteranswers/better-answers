import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  gitIn,
  sweptFolder,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

import { untilTrue } from "./polling.ts";

const SCRIPT = path.join(repositoryRoot, "scripts/move-files.mjs");

const scratch = sweptFolder();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const THING = "packages/probe/src/thing.ts";
const GROUPED = "packages/probe/src/group/thing.ts";
const USER = "packages/probe/src/user.ts";

const BASE: Tree = {
  "packages/probe/package.json": `${JSON.stringify({ name: "probe", type: "module" }, null, 2)}\n`,
  "packages/probe/tsconfig.json": `{
  "compilerOptions": {
    // The alias a source file imports by.
    "paths": { "@/*": ["./src/*"] }
  }
}
`,
  [THING]: "export const thing = 1;\n",
  "packages/probe/src/sibling.ts": "export const sibling = 2;\n",
  [USER]: "export const user = 0;\n",
};

let counter = 0;

const repositoryOf = (tree: Tree): string => {
  counter += 1;
  const root = throwawayRepository(path.join(scratch, `repository-${String(counter)}`));
  for (const [file, text] of Object.entries({ ...BASE, ...tree })) writeUnder(root, file, text);
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "tracked");
  return root;
};

type Row = readonly [string, string];

const tableOf = (rows: readonly Row[]): string =>
  rows.map(([from, to]) => `${from}\t${to}`).join("\n");

const runWith = (root: string, table: string, ...flags: readonly string[]) => {
  counter += 1;
  const tablePath = path.join(scratch, `moves-${String(counter)}.tsv`);
  writeFileSync(tablePath, `${table}\n`);
  return spawnSync(process.execPath, [SCRIPT, tablePath, ...flags], {
    cwd: root,
    encoding: "utf8",
  });
};

const moved = (root: string, rows: readonly Row[], ...flags: readonly string[]) =>
  runWith(root, tableOf(rows), ...flags);

const read = (root: string, file: string): string => readFileSync(path.join(root, file), "utf8");

const status = (root: string): string => gitIn(root, "status", "--porcelain");

describe("the specifiers a move rewrites", () => {
  it.each([
    [
      "a static import",
      'import { thing } from "./thing.ts";',
      'import { thing } from "./group/thing.ts";',
    ],
    ["a re-export", 'export * from "./thing.ts";', 'export * from "./group/thing.ts";'],
    ["a side-effect import", 'import "./thing.ts";', 'import "./group/thing.ts";'],
    [
      "a dynamic import",
      'export const lazy = import("./thing.ts");',
      'export const lazy = import("./group/thing.ts");',
    ],
    [
      "a require call",
      'const old = require("./thing.ts");',
      'const old = require("./group/thing.ts");',
    ],
    [
      "a single-quoted import",
      "import { thing } from './thing.ts';",
      "import { thing } from './group/thing.ts';",
    ],
    [
      "a new URL",
      'export const at = new URL("./thing.ts", import.meta.url);',
      'export const at = new URL("./group/thing.ts", import.meta.url);',
    ],
    [
      "an import.meta.dirname join",
      'export const at = path.join(import.meta.dirname, "./thing.ts");',
      'export const at = path.join(import.meta.dirname, "./group/thing.ts");',
    ],
    [
      "a __dirname join",
      'export const at = path.join(__dirname, "./thing.ts");',
      'export const at = path.join(__dirname, "./group/thing.ts");',
    ],
    [
      "an aliased import, which stays aliased",
      'import { thing } from "@/thing.ts";',
      'import { thing } from "@/group/thing.ts";',
    ],
  ])("rewrites %s in an importer", (_what, before, after) => {
    const root = repositoryOf({ [USER]: `${before}\n` });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.stderr).toBe("");
    expect(read(root, USER)).toBe(`${after}\n`);
  });

  it("makes an alias import relative when its target leaves", () => {
    const root = repositoryOf({ [USER]: 'import { thing } from "@/thing.ts";\n' });

    moved(root, [[THING, "packages/probe/lib/thing.ts"]]);

    expect(read(root, USER)).toBe('import { thing } from "../lib/thing.ts";\n');
  });

  it("leaves an import of a file that stays", () => {
    const root = repositoryOf({ [USER]: 'import { sibling } from "./sibling.ts";\n' });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, USER)).toBe('import { sibling } from "./sibling.ts";\n');
  });

  it("leaves a bare package import and an unknown alias", () => {
    const source = 'import { z } from "zod";\nimport { x } from "~/elsewhere.ts";\n';
    const root = repositoryOf({ [USER]: source });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, USER)).toBe(source);
  });

  it("rewrites a moved file's import of a file that stays", () => {
    const root = repositoryOf({ [THING]: 'import { sibling } from "./sibling.ts";\n' });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, GROUPED)).toBe('import { sibling } from "../sibling.ts";\n');
  });

  it("keeps an alias import in a moved file", () => {
    const source = 'import { sibling } from "@/sibling.ts";\n';
    const root = repositoryOf({ [THING]: source });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, GROUPED)).toBe(source);
  });

  it("rewrites URL and dirname paths in a moved file", () => {
    const root = repositoryOf({
      "packages/probe/data/seed.json": "{}\n",
      [THING]:
        'export const data = new URL("../data/seed.json", import.meta.url);\nexport const up = path.resolve(import.meta.dirname, "../../..");\n',
    });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, GROUPED)).toBe(
      'export const data = new URL("../../data/seed.json", import.meta.url);\nexport const up = path.resolve(import.meta.dirname, "../../../..");\n',
    );
  });

  it("leaves an import between two files that move together", () => {
    const root = repositoryOf({ [USER]: 'import { thing } from "./thing.ts";\n' });

    moved(root, [
      [THING, GROUPED],
      [USER, "packages/probe/src/group/user.ts"],
    ]);

    expect(read(root, "packages/probe/src/group/user.ts")).toBe(
      'import { thing } from "./thing.ts";\n',
    );
  });

  it("rewrites an import of a file moved to another workspace", () => {
    const root = repositoryOf({ [USER]: 'import { thing } from "./thing.ts";\n' });

    moved(root, [[THING, "packages/other/src/thing.ts"]]);

    expect(read(root, USER)).toBe('import { thing } from "../../other/src/thing.ts";\n');
  });
});

describe("the path mentions a move rewrites", () => {
  it.each([
    ["markdown", "docs/guide.md"],
    ["YAML", ".github/workflows/check.yml"],
    ["a shell script", "scripts/run.sh"],
    ["Python", "apps/probe/job.py"],
    ["a Dockerfile", "deploy/Dockerfile"],
    ["TypeScript", "packages/probe/test/path.test.ts"],
    ["a plan in docs/plans", "docs/plans/009-next.md"],
  ])("rewrites a repo-relative path in %s", (_what, file) => {
    const root = repositoryOf({ [file]: `see ${THING} and "${THING}".\n` });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, file)).toBe(`see ${GROUPED} and "${GROUPED}".\n`);
  });

  it.each([
    ["a longer file name", `${THING}x`],
    ["a source map", `${THING}.map`],
    ["a longer path ending in it", `other/${THING}`],
    ["a sibling in the folder", "packages/probe/src/thing.test.ts"],
  ])("leaves %s", (_what, mention) => {
    const root = repositoryOf({ "docs/guide.md": `see ${mention}\n` });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, "docs/guide.md")).toBe(`see ${mention}\n`);
  });

  it("rewrites a path that ends a sentence", () => {
    const root = repositoryOf({ "docs/guide.md": `Edit ${THING}.\n` });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, "docs/guide.md")).toBe(`Edit ${GROUPED}.\n`);
  });

  it.each([
    "contracts/note.md",
    "docs/archive/old.md",
    "docs/plans/008-folder-restructure/api.md",
    ".cubic/wiki/page.md",
    "pnpm-lock.yaml",
  ])("leaves %s as it is", (file) => {
    const text = `${THING} is named here\n`;
    const root = repositoryOf({ [file]: text });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, file)).toBe(text);
  });

  it("leaves a file type it does not read", () => {
    const root = repositoryOf({ "docs/image.svg": `<text>${THING}</text>\n` });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, "docs/image.svg")).toBe(`<text>${THING}</text>\n`);
  });
});

describe("the package.json strings a move rewrites", () => {
  it("rewrites a path relative to its own package", () => {
    const manifest = {
      name: "probe",
      main: "src/thing.ts",
      exports: { "./thing": "./src/thing.ts" },
      scripts: { run: "node ./src/thing.ts --flag", also: "node src/thing.ts" },
      files: ["src/thing.ts", "src/sibling.ts"],
    };
    const root = repositoryOf({ "packages/probe/package.json": JSON.stringify(manifest) });

    moved(root, [[THING, GROUPED]]);

    expect(JSON.parse(read(root, "packages/probe/package.json"))).toEqual({
      name: "probe",
      main: "src/group/thing.ts",
      exports: { "./thing": "./src/group/thing.ts" },
      scripts: { run: "node ./src/group/thing.ts --flag", also: "node src/group/thing.ts" },
      files: ["src/group/thing.ts", "src/sibling.ts"],
    });
  });

  it("writes a rewritten manifest indented, with a final newline", () => {
    const root = repositoryOf({
      "packages/probe/package.json": JSON.stringify({ main: "src/thing.ts" }),
    });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, "packages/probe/package.json")).toBe(
      '{\n  "main": "src/group/thing.ts"\n}\n',
    );
  });

  it("rewrites a root manifest path relative to the root", () => {
    const root = repositoryOf({
      "package.json": JSON.stringify({ scripts: { tool: "node scripts/tool.mjs apps" } }),
      "scripts/tool.mjs": "export {};\n",
    });

    moved(root, [["scripts/tool.mjs", "scripts/tools/tool.mjs"]]);

    expect(JSON.parse(read(root, "package.json"))).toEqual({
      scripts: { tool: "node scripts/tools/tool.mjs apps" },
    });
  });

  it("leaves a key, and a path relative to another package", () => {
    const manifest = JSON.stringify({ "src/thing.ts": "./src/thing.ts" });
    const root = repositoryOf({ "packages/other/package.json": manifest });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, "packages/other/package.json")).toBe(manifest);
  });

  it("leaves a manifest holding no moved path as written", () => {
    const manifest = '{"name":"compact","main":"src/sibling.ts"}';
    const root = repositoryOf({ "packages/probe/package.json": manifest });

    moved(root, [[THING, GROUPED]]);

    expect(read(root, "packages/probe/package.json")).toBe(manifest);
  });
});

describe("the move itself", () => {
  it("records a staged rename and creates the new folder", () => {
    const root = repositoryOf({});

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.status).toBe(0);
    expect(status(root)).toBe(`R  ${THING} -> ${GROUPED}\n`);
    expect(read(root, GROUPED)).toBe("export const thing = 1;\n");
    expect(existsSync(path.join(root, THING))).toBe(false);
  });

  it("moves each row, skipping blank and comment rows", () => {
    const root = repositoryOf({});
    const table = `# one move\n${THING}\t${GROUPED}\n\n  \n${USER}\tpackages/probe/src/group/user.ts\n`;

    const ran = runWith(root, table.trimEnd());

    expect(ran.stdout).toContain("moved 2 files");
    expect(
      status(root)
        .split("\n")
        .filter((line) => line.startsWith("R")),
    ).toHaveLength(2);
  });

  it("reports the files it moved and the files it rewrote", () => {
    const root = repositoryOf({
      [USER]: 'import { thing } from "./thing.ts";\n',
      "docs/guide.md": `${THING}\n`,
    });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.stdout).toBe(
      "moved 1 files; rewrote 2 files\ntest inventory unchanged; titles listed: 0\n",
    );
  });

  it("puts the tree back when a move fails halfway", () => {
    const root = repositoryOf({ [USER]: 'import { thing } from "./thing.ts";\n' });

    const ran = moved(root, [
      [THING, "packages/probe/src/group/inner.ts"],
      [USER, "packages/probe/src/group/inner.ts/user.ts"],
    ]);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("move-files:");
    expect(status(root)).toBe("");
    expect(read(root, USER)).toBe('import { thing } from "./thing.ts";\n');
    expect(existsSync(path.join(root, "packages/probe/src/group"))).toBe(false);
  });

  it("changes nothing under --dry-run, and says what it would do", () => {
    const root = repositoryOf({ [USER]: 'import { thing } from "./thing.ts";\n' });

    const ran = moved(root, [[THING, GROUPED]], "--dry-run");

    expect(ran.stdout).toBe("would move 1 files; rewrote 1 files\n");
    expect(status(root)).toBe("");
    expect(read(root, USER)).toBe('import { thing } from "./thing.ts";\n');
    expect(existsSync(path.join(root, GROUPED))).toBe(false);
  });
});

describe("the findings a move reports", () => {
  it("lists an unresolved relative specifier in a moved file", () => {
    const root = repositoryOf({ [THING]: 'import { gone } from "./missing.ts";\n' });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.stdout).toContain("relative specifiers in moved files that resolve to nothing");
    expect(ran.stdout).toContain(`  ${THING}: ./missing.ts\n`);
  });

  it("ignores an unresolved specifier in a file that stays", () => {
    const root = repositoryOf({ [USER]: 'import { gone } from "./missing.ts";\n' });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.stdout).not.toContain("resolve to nothing");
  });

  it("ignores an unresolved alias or bare package", () => {
    const root = repositoryOf({
      [THING]: 'import { gone } from "@/missing.ts";\nimport { z } from "zod";\n',
    });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.stdout).not.toContain("resolve to nothing");
  });

  it("lists a workspace-relative mention of an old path", () => {
    const root = repositoryOf({
      "packages/probe/notes.md": "edit src/thing.ts first\n",
      "contracts/note.md": "src/thing.ts is named in a contract\n",
      "pnpm-lock.yaml": "  src/thing.ts: locked\n",
    });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.stdout).toContain("workspace-relative mentions of an old path");
    expect(ran.stdout).toContain("  packages/probe/notes.md:1:edit src/thing.ts first\n");
    expect(ran.stdout).not.toContain("contracts/note.md");
    expect(ran.stdout).not.toContain("pnpm-lock.yaml");
  });

  it("reports no finding when no old path remains", () => {
    const root = repositoryOf({});

    expect(moved(root, [[THING, GROUPED]]).stdout).toBe(
      "moved 1 files; rewrote 0 files\ntest inventory unchanged; titles listed: 0\n",
    );
  });
});

describe("the moves it refuses", () => {
  const IMPORTER = 'import { thing } from "./thing.ts";\n';

  it.each([
    [
      "a source that is not on disk",
      "packages/probe/src/absent.ts\tpackages/probe/src/moved.ts",
      "not on disk: packages/probe/src/absent.ts",
    ],
    [
      "a destination that already exists",
      `${THING}\tpackages/probe/src/sibling.ts`,
      "already exists: packages/probe/src/sibling.ts",
    ],
    [
      "a source named twice",
      `${THING}\t${GROUPED}\n${THING}\tpackages/probe/src/other/thing.ts`,
      `moved twice: ${THING}`,
    ],
    [
      "two sources moving to one path",
      `${THING}\t${GROUPED}\npackages/probe/src/sibling.ts\t${GROUPED}`,
      "two files move to one path",
    ],
    [
      "a source that is a directory",
      "packages/probe/src\tpackages/probe/lib",
      "not a tracked file: packages/probe/src",
    ],
    [
      "a source with a leading ./",
      `./${THING}\t${GROUPED}`,
      `not a normalised repo-relative path: ./${THING}`,
    ],
    [
      "a source with a trailing slash",
      "packages/probe/src/\tpackages/probe/lib",
      "not a normalised repo-relative path: packages/probe/src/",
    ],
    [
      "a source with a doubled slash",
      `packages/probe//src/thing.ts\t${GROUPED}`,
      "not a normalised repo-relative path: packages/probe//src/thing.ts",
    ],
    [
      "a destination with a leading ./",
      `${THING}\t./${GROUPED}`,
      `not a normalised repo-relative path: ./${GROUPED}`,
    ],
    [
      "a destination with a trailing slash",
      `${THING}\tpackages/probe/src/group/`,
      "not a normalised repo-relative path: packages/probe/src/group/",
    ],
    [
      "a destination that leaves the repository",
      `${THING}\t../outside/thing.ts`,
      "not a normalised repo-relative path: ../outside/thing.ts",
    ],
    [
      "a destination written from the filesystem root",
      `${THING}\t/tmp/thing.ts`,
      "not a normalised repo-relative path: /tmp/thing.ts",
    ],
    ["a row of one cell", THING, `bad row: ${THING}`],
    ["a row with an empty destination", `${THING}\t `, `bad row: ${THING}\t `],
  ])("refuses %s, changing nothing", (_what, rows, message) => {
    const root = repositoryOf({ [USER]: IMPORTER });

    const ran = runWith(root, rows);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toBe(`move-files: ${message}\n`);
    expect(status(root)).toBe("");
    expect(read(root, USER)).toBe(IMPORTER);
  });

  it("refuses a source that is on disk but not tracked", () => {
    const root = repositoryOf({});
    writeUnder(root, "packages/probe/src/loose.ts", "export const loose = 3;\n");

    const ran = moved(root, [["packages/probe/src/loose.ts", GROUPED]]);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toBe("move-files: not a tracked file: packages/probe/src/loose.ts\n");
    expect(existsSync(path.join(root, GROUPED))).toBe(false);
  });

  it("rewrites nothing when a later manifest is not JSON", () => {
    const guide = `see ${THING}\n`;
    const root = repositoryOf({
      "docs/guide.md": guide,
      "packages/other/package.json": "not json {\n",
    });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("move-files:");
    expect(read(root, "docs/guide.md")).toBe(guide);
    expect(existsSync(path.join(root, THING))).toBe(true);
    expect(status(root)).toBe("");
  });

  it("refuses a table that is not there", () => {
    const root = repositoryOf({});

    const ran = spawnSync(process.execPath, [SCRIPT, path.join(scratch, "absent.tsv")], {
      cwd: root,
      encoding: "utf8",
    });

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("move-files: ENOENT");
  });
});

describe("the test inventory a move holds", () => {
  const CORE_SOURCE = "packages/core/src/thing.ts";
  const CORE_TEST = "packages/core/test/thing.test.ts";
  const TITLE = "reads packages/core/src/thing.ts";
  const VITEST = path.dirname(createRequire(import.meta.url).resolve("vitest/package.json"));

  const coreRepositoryOf = (extra: Tree = {}): string => {
    const root = repositoryOf({
      [CORE_SOURCE]: "export const thing = 1;\n",
      [CORE_TEST]: `import { it } from "vitest";\n\nit("${TITLE}", () => {});\n`,
      "packages/core/vitest.config.ts": "export default {};\n",
      ".gitignore": "node_modules/\n",
      ...extra,
    });
    const modules = path.join(root, "packages/core/node_modules");
    mkdirSync(modules, { recursive: true });
    symlinkSync(VITEST, path.join(modules, "vitest"));
    return root;
  };

  it("passes a move that keeps every test name and title", () => {
    const root = coreRepositoryOf();

    const ran = moved(root, [[CORE_TEST, "packages/core/test/group/thing.test.ts"]]);

    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(
      "moved 1 files; rewrote 0 files\ntest inventory unchanged; titles listed: 1\n",
    );
  });

  it("fails a move that rewrites a path in a title", () => {
    const root = coreRepositoryOf();

    const ran = moved(root, [[CORE_SOURCE, "packages/core/src/group/thing.ts"]]);

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("the move changed a test file's name or a test's title");
    expect(ran.stdout).toContain(`  vitest-core.txt: removed thing.test.ts :: ${TITLE}\n`);
    expect(ran.stdout).toContain(
      "  vitest-core.txt: added thing.test.ts :: reads packages/core/src/group/thing.ts\n",
    );
  });

  it("passes a move between two configs of one workspace", () => {
    const root = coreRepositoryOf({
      "packages/core/vitest.config.ts":
        'export default { test: { include: ["test/**/*.test.ts"] } };\n',
      "packages/core/vitest.images.config.ts":
        'import base from "./vitest.config.ts";\n\nexport default { ...base, test: { ...base.test, include: ["images/**/*.test.ts"] } };\n',
    });

    const ran = moved(root, [[CORE_TEST, "packages/core/images/thing.test.ts"]]);

    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("test inventory unchanged; titles listed: 1");
  });

  it("lists the tests without running a globalSetup", () => {
    const root = coreRepositoryOf({
      "packages/core/vitest.config.ts":
        'export default { test: { globalSetup: ["./setup.ts"] } };\n',
      "packages/core/setup.ts": 'throw new Error("a globalSetup ran");\n',
    });

    const ran = moved(root, [[CORE_TEST, "packages/core/test/group/thing.test.ts"]]);

    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("test inventory unchanged; titles listed: 1");
  });

  it("fails a move that renames a test file", () => {
    const root = coreRepositoryOf();

    const ran = moved(root, [[CORE_TEST, "packages/core/test/renamed.test.ts"]]);

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain(`  vitest-core.txt: removed thing.test.ts :: ${TITLE}\n`);
    expect(ran.stdout).toContain(`  vitest-core.txt: added renamed.test.ts :: ${TITLE}\n`);
  });

  it("fails a move that changes a run-time title", () => {
    const LABEL_FILE = "packages/core/src/label.ts";
    const root = coreRepositoryOf({
      [LABEL_FILE]: `export const LABEL = "${CORE_SOURCE}";\n`,
      [CORE_TEST]: [
        'import { it } from "vitest";',
        'import { LABEL } from "../src/label.ts";',
        `const FILE = "${CORE_SOURCE}";`,
        `it.skip("skipped ${CORE_SOURCE}", () => {});`,
        "it(`built from ${FILE}`, () => {});",
        `it.each([["${CORE_SOURCE}"]])("each of %s", () => {});`,
        "it(`imported ${LABEL}`, () => {});",
        "",
      ].join("\n"),
    });

    const ran = moved(root, [[CORE_SOURCE, "packages/core/src/group/thing.ts"]]);

    expect(ran.status).toBe(1);
    for (const lead of ["skipped", "built from", "each of", "imported"]) {
      expect(ran.stdout).toContain(`: removed thing.test.ts :: ${lead} ${CORE_SOURCE}\n`);
      expect(ran.stdout).toContain(
        `: added thing.test.ts :: ${lead} packages/core/src/group/thing.ts\n`,
      );
    }
  });

  it("puts the tree back when it refuses a move", () => {
    const root = coreRepositoryOf({ "docs/note.md": `${CORE_SOURCE}\n` });
    writeUnder(root, "docs/note.md", `${CORE_SOURCE}, edited by hand\n`);
    writeUnder(root, "packages/core/src/staged.ts", "export const staged = 1;\n");
    gitIn(root, "add", "packages/core/src/staged.ts");
    const treeOf = (): readonly string[] => [
      status(root),
      gitIn(root, "diff"),
      gitIn(root, "diff", "--cached"),
    ];
    const before = treeOf();

    const ran = moved(root, [
      [CORE_SOURCE, "packages/core/src/new-folder/deeper/thing.ts"],
      ["packages/core/src/staged.ts", "packages/core/src/new-folder/staged.ts"],
    ]);

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain(
      "did not move 2 files or rewrite 2 files; the tree is as it was before",
    );
    expect(treeOf()).toStrictEqual(before);
    expect(existsSync(path.join(root, "packages/core/src/new-folder"))).toBe(false);
  });

  it("passes a test's move to another workspace", () => {
    const root = coreRepositoryOf();
    const devtools = path.join(root, "packages/devtools");
    writeUnder(root, "packages/devtools/vitest.config.ts", "export default {};\n");
    mkdirSync(path.join(devtools, "node_modules"));
    symlinkSync(VITEST, path.join(devtools, "node_modules/vitest"));
    gitIn(root, "add", "packages/devtools/vitest.config.ts");

    const ran = moved(root, [[CORE_TEST, "packages/devtools/test/thing.test.ts"]]);

    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("test inventory unchanged; titles listed: 1");
    expect(status(root)).toContain(`R  ${CORE_TEST} -> packages/devtools/test/thing.test.ts\n`);
  });

  it("puts the tree back when the tests cannot be listed", () => {
    const root = coreRepositoryOf({
      "packages/core/vitest.config.ts": `import { readFileSync } from "node:fs";\n\nreadFileSync("src/thing.ts");\n\nexport default {};\n`,
    });
    const before = status(root);

    const ran = moved(root, [[CORE_SOURCE, "packages/core/src/group/thing.ts"]]);

    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("the tree is as it was before");
    expect(ran.stdout).toContain("the tests could not be listed after the move");
    expect(ran.stdout).toContain("ENOENT");
    expect(status(root)).toBe(before);
  });

  it("leaves the tree untouched when stopped while listing", async () => {
    const root = coreRepositoryOf({
      "packages/core/vitest.config.ts": [
        'import { writeFileSync } from "node:fs";',
        "",
        `writeFileSync(${JSON.stringify(path.join(scratch, "listing.started"))}, "");`,
        "await new Promise(() => setInterval(() => {}, 1000));",
        "export default {};",
        "",
      ].join("\n"),
    });
    const tablePath = path.join(scratch, "stopped.tsv");
    writeFileSync(tablePath, `${CORE_SOURCE}\tpackages/core/src/group/thing.ts\n`);

    const run = spawn(process.execPath, [SCRIPT, tablePath], { cwd: root });
    let stderr = "";
    run.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exited = new Promise<number | null>((resolve) => run.once("close", resolve));
    await untilTrue(() => existsSync(path.join(scratch, "listing.started")));
    run.kill("SIGTERM");

    expect({ code: await exited, stderr }).toStrictEqual({
      code: 143,
      stderr: "move-files: stopped by SIGTERM; the tree is as it was before\n",
    });
    expect(status(root)).toBe("");
    expect(read(root, CORE_SOURCE)).toBe("export const thing = 1;\n");
  });

  it("undoes a killed run's part-done move, then moves", () => {
    const root = coreRepositoryOf({
      "packages/core/src/one.ts": "export const one = 1;\n",
      "packages/core/src/other.ts": "export const other = 2;\n",
      "docs/note.md": "packages/core/src/one.ts\n",
    });
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const bin = path.join(scratch, `killing-git-${String(counter)}`);
    writeUnder(
      bin,
      "git",
      [
        "#!/bin/sh",
        `if [ "$1 $2 $3 $4" = "-C ${realpathSync(root)} mv packages/core/src/other.ts" ]; then kill -9 $PPID; exit 1; fi`,
        `exec ${realGit} "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(path.join(bin, "git"), 0o755);
    const table = tableOf([
      ["packages/core/src/one.ts", "packages/core/src/group/one.ts"],
      ["packages/core/src/other.ts", "packages/core/src/group/other.ts"],
    ]);
    const tablePath = path.join(scratch, `killed-${String(counter)}.tsv`);
    writeFileSync(tablePath, `${table}\n`);

    const killed = spawnSync(process.execPath, [SCRIPT, tablePath], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${String(process.env["PATH"])}` },
    });

    expect(killed.signal).toBe("SIGKILL");
    expect(status(root)).toContain(
      "R  packages/core/src/one.ts -> packages/core/src/group/one.ts\n",
    );
    expect(moved(root, [[THING, GROUPED]], "--dry-run").stderr).toContain(
      "a stopped run left a move part done",
    );

    const rerun = spawnSync(process.execPath, [SCRIPT, tablePath], { cwd: root, encoding: "utf8" });

    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain("undid the move a stopped run left part done\nmoved 2 files");
    expect(status(root).split("\n").sort()).toStrictEqual(
      [
        "",
        " M docs/note.md",
        "R  packages/core/src/one.ts -> packages/core/src/group/one.ts",
        "R  packages/core/src/other.ts -> packages/core/src/group/other.ts",
      ].sort(),
    );
  });

  it("moves nothing when the inventory cannot be taken", () => {
    const root = repositoryOf({
      [CORE_SOURCE]: "export const thing = 1;\n",
      "packages/core/vitest.config.ts": "export default {};\n",
    });

    const ran = moved(root, [[CORE_SOURCE, "packages/core/src/group/thing.ts"]]);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("test-inventory.sh failed before the move, so nothing moved");
    expect(status(root)).toBe("");
  });

  it("takes no inventory under --dry-run", () => {
    const root = repositoryOf({ [CORE_SOURCE]: "export const thing = 1;\n" });

    const ran = moved(root, [[CORE_SOURCE, "packages/core/src/group/thing.ts"]], "--dry-run");

    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe("would move 1 files; rewrote 0 files\n");
  });
});

describe("the command line", () => {
  it("prints its usage and exits 2 with no table", () => {
    const ran = spawnSync(process.execPath, [SCRIPT], { cwd: repositoryOf({}), encoding: "utf8" });

    expect(ran.status).toBe(2);
    expect(ran.stderr).toBe("usage: move-files <moves.tsv> [--dry-run]\n");
  });

  it("refuses a flag it does not know, and moves nothing", () => {
    const root = repositoryOf({});

    const ran = moved(root, [[THING, GROUPED]], "--dryrun");

    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain("usage: move-files");
    expect(status(root)).toBe("");
  });
});
