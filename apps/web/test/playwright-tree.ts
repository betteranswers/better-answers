import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));

/** A module of this workspace, as a spec in the tree imports it. */
export const moduleAt = (file: string): string => JSON.stringify(path.join(web, file));

type Ran = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly summary: string;
  /** Each file the run was asked for that it left behind. */
  readonly left: ReadonlyMap<string, string>;
};

/**
 * In a throwaway tree that is the run's workspace. A spec's import of Playwright resolves through
 * the link, to the instance running it.
 */
export const playwrightOver = (
  files: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>> = {},
  asked: readonly string[] = [],
): Ran => {
  const tree = realpathSync(mkdtempSync(path.join(tmpdir(), "playwright-tree-")));
  try {
    symlinkSync(path.join(web, "node_modules"), path.join(tree, "node_modules"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(tree, name), content);
    }
    const summary = path.join(tree, "summary.md");
    writeFileSync(summary, "");

    const run = spawnSync(
      process.execPath,
      [path.join(web, "node_modules", "@playwright", "test", "cli.js"), "test"],
      {
        cwd: tree,
        encoding: "utf8",
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: tree, ...env },
      },
    );
    if (run.error !== undefined) throw run.error;
    const left = asked
      .filter((file) => existsSync(path.join(tree, file)))
      .map((file): [string, string] => [file, readFileSync(path.join(tree, file), "utf8")]);
    return {
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      summary: readFileSync(summary, "utf8"),
      left: new Map(left),
    };
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
};

/** The outcome word the journeys' reporter wrote, if any, and the run's summary. */
export const journeysOver = (spec: string, use: Readonly<Record<string, string>> = {}) => {
  const reporter = `[${moduleAt("journeys/outcome-reporter.ts")}, { outcomeFile: "outcome" }]`;
  const run = playwrightOver(
    {
      // The journeys are ES modules, and a spec loaded as CommonJS cannot import one.
      "package.json": '{ "type": "module" }\n',
      "playwright.config.ts": `export default { testDir: ".", workers: 1, use: ${JSON.stringify(use)}, reporter: [${reporter}] };\n`,
      "a.spec.ts": spec,
    },
    {},
    ["outcome"],
  );
  return { outcome: run.left.get("outcome"), summary: run.summary };
};
