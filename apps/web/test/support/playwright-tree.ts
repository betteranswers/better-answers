import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { workspaceRoot } from "./roots.ts";

export const moduleAt = (file: string): string => JSON.stringify(path.join(workspaceRoot, file));

type Ran = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly summary: string;
};

type Exited = Pick<Ran, "status" | "stdout" | "stderr">;

const playwrightIn = (tree: string, env: Readonly<Record<string, string>>): Promise<Exited> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(workspaceRoot, "node_modules", "@playwright", "test", "cli.js"), "test"],
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
    symlinkSync(path.join(workspaceRoot, "node_modules"), path.join(tree, "node_modules"));
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
    return { ...exited, summary: readFileSync(summary, "utf8") };
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
};
