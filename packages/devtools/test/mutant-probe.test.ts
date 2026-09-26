import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { gitIn, throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";

const script = path.join(repositoryRoot, "scripts/mutant-probe.mjs");

const scratch = mkdtempSync(path.join(tmpdir(), "mutant-probe-"));
afterAll(() => {
  // The interrupted case's child can still be spawning git as this runs, and rmSync retries
  // ENOTEMPTY only when given both maxRetries and retryDelay.
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const vitestRoot = path.dirname(createRequire(import.meta.url).resolve("vitest/package.json"));

const VITEST_SHIM = `#!/bin/sh\nexec node "${path.join(vitestRoot, "vitest.mjs")}" "$@"\n`;

const SOURCE = `export const answer = (n: number): number => n + 1;
export const label = "answer";
`;

const SUITE = `import { expect, it } from "vitest";

import { answer } from "../src/answer.ts";

it("adds one", () => {
  expect(answer(1)).toBe(2);
});
`;

const SLOW_SUITE = `import { expect, it } from "vitest";

import { answer } from "../src/answer.ts";

it("adds one, slowly", { timeout: 60_000 }, async () => {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  expect(answer(1)).toBe(2);
});
`;

const workspace = (name: string, suite = SUITE, extraSuite?: string): string => {
  const root = throwawayRepository(path.join(scratch, name));
  writeUnder(
    root,
    "package.json",
    JSON.stringify({
      name: "throwaway",
      private: true,
      type: "module",
      scripts: { test: "vitest run" },
    }),
  );
  writeUnder(root, ".gitignore", "node_modules/\n");
  writeUnder(root, "src/answer.ts", SOURCE);
  writeUnder(root, "test/answer.test.ts", suite);
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "tracked");
  mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
  symlinkSync(vitestRoot, path.join(root, "node_modules/vitest"));
  writeFileSync(path.join(root, "node_modules/.bin/vitest"), VITEST_SHIM, { mode: 0o755 });
  if (extraSuite !== undefined) writeUnder(root, "test/extra.test.ts", extraSuite);
  return root;
};

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

type Mutation = {
  readonly line: number;
  readonly from: string;
  readonly to: string;
  readonly timeoutMs?: number;
};

const argvFor = (root: string, mutation: Mutation): readonly string[] => [
  script,
  "--file",
  path.join(root, "src/answer.ts"),
  "--line",
  String(mutation.line),
  "--from",
  mutation.from,
  "--to",
  mutation.to,
  ...(mutation.timeoutMs === undefined ? [] : ["--timeout-ms", String(mutation.timeoutMs)]),
];

const probe = (root: string, mutation: Mutation): Run => {
  const result = spawnSync(process.execPath, [...argvFor(root, mutation)], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const verdictOf = (run: Run): string | undefined =>
  run.stdout.split("\n").find((line) => line.startsWith("verdict:"));

const source = (root: string): string => readFileSync(path.join(root, "src/answer.ts"), "utf8");

const exited = (run: Run, status: number): void => {
  if (run.status !== status) {
    throw new Error(
      `mutant-probe exited ${String(run.status)}, expected ${String(status)}:\n${run.stdout}\n${run.stderr}`,
    );
  }
};

describe("the mutant probe over a throwaway workspace", () => {
  it("says killed when the suite fails, and restores the file", () => {
    const root = workspace("killed");

    const run = probe(root, { line: 1, from: "n + 1", to: "n - 1" });

    exited(run, 0);
    expect(verdictOf(run)).toBe("verdict: killed");
    expect(source(root)).toBe(SOURCE);
  });

  it("says survived when the suite passes, and restores the file", () => {
    const root = workspace("survived");

    const run = probe(root, { line: 2, from: '"answer"', to: '""' });

    exited(run, 0);
    expect(verdictOf(run)).toBe("verdict: survived");
    expect(source(root)).toBe(SOURCE);
  });

  it("says timed out past the budget, and restores the file", () => {
    const root = workspace("timed-out");

    const run = probe(root, {
      line: 1,
      from: "n + 1",
      to: "(() => { for (;;) {} })()",
      timeoutMs: 4_000,
    });

    exited(run, 0);
    expect(verdictOf(run)).toBe("verdict: timed out");
    expect(source(root)).toBe(SOURCE);
  });

  it("says src is clean against HEAD after the run", () => {
    const root = workspace("clean");

    const run = probe(root, { line: 1, from: "n + 1", to: "n - 1" });

    exited(run, 0);
    expect(run.stdout).toContain("src: clean against HEAD");
  });

  it("restores the file on an interrupt, and exits as interrupted", async () => {
    const root = workspace("interrupted", SLOW_SUITE);
    const file = path.join(root, "src/answer.ts");
    const child: ChildProcess = spawn(
      process.execPath,
      [...argvFor(root, { line: 1, from: "n + 1", to: "n - 1" })],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exit = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => resolve(code));
    });

    const deadline = Date.now() + 30_000;
    while (!readFileSync(file, "utf8").includes("n - 1") || !stderr.includes("RUN")) {
      if (Date.now() > deadline) {
        throw new Error(`the mutation never reached the disk:\n${stdout}\n${stderr}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    child.kill("SIGINT");
    const status = await exit;

    expect(status).toBe(130);
    expect(source(root)).toBe(SOURCE);
    expect(stderr).toContain("interrupted");
    expect(stderr).toContain("restored");
  }, 90_000);

  it("restores the file and refuses a verdict on a crash", () => {
    const root = workspace(
      "crashed",
      'import { answer } from "../src/answer.ts";\nthis is not a test\n',
    );

    const run = probe(root, { line: 1, from: "n + 1", to: "n - 1" });

    expect(run.status).not.toBe(0);
    expect(verdictOf(run)).toBeUndefined();
    expect(run.stderr).toContain("did not run");
    expect(source(root)).toBe(SOURCE);
  });

  it("refuses a verdict when one test file failed to run", () => {
    const root = workspace("half-ran", SUITE, "this is not a test\n");

    const run = probe(root, { line: 2, from: '"answer"', to: '""' });

    expect(run.status).not.toBe(0);
    expect(verdictOf(run)).toBeUndefined();
    expect(run.stderr).toContain("1 of 2 test files failed to run");
    expect(source(root)).toBe(SOURCE);
  });

  it("refuses to start over a file with an unstaged change", () => {
    const root = workspace("dirty");
    const edited = `${SOURCE}export const extra = 1;\n`;
    writeFileSync(path.join(root, "src/answer.ts"), edited);

    const run = probe(root, { line: 1, from: "n + 1", to: "n - 1" });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("unstaged change");
    expect(verdictOf(run)).toBeUndefined();

    expect(source(root)).toBe(edited);
  });

  it("refuses a mutation whose text is not on its line", () => {
    const root = workspace("misanchored");

    const run = probe(root, { line: 2, from: "n + 1", to: "n - 1" });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("line 2");
    expect(verdictOf(run)).toBeUndefined();
    expect(source(root)).toBe(SOURCE);
  });
});
