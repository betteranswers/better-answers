import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
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

/** Where the journeys' config has the reporter write its word, under Playwright's output folder. */
export const OUTCOME_FILE = "test-results/journeys-outcome";

type Ran = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly summary: string;
  /** Every file the run left under `test-results/`, by its path in the tree. */
  readonly left: ReadonlyMap<string, string>;
};

const leftUnder = (tree: string): ReadonlyMap<string, string> => {
  const results = path.join(tree, "test-results");
  if (!existsSync(results)) return new Map();
  const files = readdirSync(results, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
  return new Map(files.map((file) => [path.relative(tree, file), readFileSync(file, "utf8")]));
};

type Exited = Pick<Ran, "status" | "stdout" | "stderr">;

/** Asynchronous, so a stand-in server in the calling process can answer the run. */
const playwrightIn = (tree: string, env: Readonly<Record<string, string>>): Promise<Exited> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(web, "node_modules", "@playwright", "test", "cli.js"), "test"],
      { cwd: tree, env: { ...process.env, ...env } },
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => stdout.push(chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout: stdout.join(""), stderr: stderr.join("") });
    });
  });

/**
 * In a throwaway tree that is the run's workspace. A spec's import of Playwright resolves through
 * the link, to the instance running it.
 */
export const playwrightOver = async (
  files: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>> = {},
): Promise<Ran> => {
  const tree = realpathSync(mkdtempSync(path.join(tmpdir(), "playwright-tree-")));
  try {
    symlinkSync(path.join(web, "node_modules"), path.join(tree, "node_modules"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(tree, name), content);
    }
    const summary = path.join(tree, "summary.md");
    writeFileSync(summary, "");
    const exited = await playwrightIn(tree, {
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_WORKSPACE: tree,
      ...env,
    });
    return { ...exited, summary: readFileSync(summary, "utf8"), left: leftUnder(tree) };
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
};

type Journeys = {
  /** Left out, the tree holds no spec at all. */
  readonly spec?: string;
  /** More specs by file name, which Playwright runs one worker through in name order. */
  readonly specs?: Readonly<Record<string, string>>;
  readonly use?: Readonly<Record<string, string | number>>;
  readonly env?: Readonly<Record<string, string>>;
  /** The config's reporter list as written into it; the outcome reporter alone when left out. */
  readonly reporter?: string;
};

/** The outcome word the journeys' reporter wrote, if any, beside everything else the run left. */
export const journeysOver = async (journeys: Journeys) => {
  const reporter =
    journeys.reporter ??
    `[[${moduleAt("journeys/outcome-reporter.ts")}, { outcomeFile: ${JSON.stringify(OUTCOME_FILE)} }]]`;
  const run = await playwrightOver(
    {
      // The journeys are ES modules, and a spec loaded as CommonJS cannot import one.
      "package.json": '{ "type": "module" }\n',
      "playwright.config.ts": `export default { testDir: ".", workers: 1, use: ${JSON.stringify(journeys.use ?? {})}, reporter: ${reporter} };\n`,
      ...(journeys.spec === undefined ? {} : { "a.spec.ts": journeys.spec }),
      ...journeys.specs,
    },
    journeys.env,
  );
  return { ...run, outcome: run.left.get(OUTCOME_FILE) };
};
