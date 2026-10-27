import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

    expect(ran.stdout).toBe("moved 1 files; rewrote 2 files\n");
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

  it("walks past an unresolved specifier in a file that stays", () => {
    const root = repositoryOf({ [USER]: 'import { gone } from "./missing.ts";\n' });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.stdout).not.toContain("resolve to nothing");
  });

  it("walks past an unresolved alias or bare package", () => {
    const root = repositoryOf({
      [THING]: 'import { gone } from "@/missing.ts";\nimport { z } from "zod";\n',
    });

    const ran = moved(root, [[THING, GROUPED]]);

    expect(ran.stdout).not.toContain("resolve to nothing");
  });

  it("lists a workspace-relative mention of an old path left behind", () => {
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

  it("reports no finding when nothing is left behind", () => {
    const root = repositoryOf({});

    expect(moved(root, [[THING, GROUPED]]).stdout).toBe("moved 1 files; rewrote 0 files\n");
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
  ])("refuses %s, touching nothing", (_what, rows, message) => {
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
