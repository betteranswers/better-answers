import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { gitIn, throwawayRepository, writeUnder } from "@better-answers/devtools/throwaway-tree";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The mutant probe, run rather than read (T-098, `[CHECK1]`).
 *
 * Two triage sessions left a hand-applied mutation in `src` with the suite green: the loops
 * restored on the happy path, and a crash mid-loop leaves the mutation behind for good. So the
 * probe's promise is about the file after it exits — restored on every path, the interrupt and
 * the crash included — and only running it can hold that. Each case below is a throwaway git
 * repository holding one source file, one suite and a link to the installed vitest, with the
 * probe spawned over it as an operator would spawn it.
 *
 * The tree is not the runner's flat record of file contents run by a package's binary: this
 * tool is a repository script, and what it is proved over is a git repository with a commit, a
 * symlink and a process to interrupt. It is built from the devtools' throwaway repository
 * instead, and the runner's two fences are kept by hand — an exit the case did not expect is
 * read with what the probe wrote, and the first case, a mutation the suite must kill, is the
 * smoke case that proves the suite runs at all before any `survived` may be read as a verdict.
 *
 * Expected values are written down (`[TEST9]`): the source the probe must restore is a
 * literal here, never read back from the file the probe touched.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const script = path.join(repositoryRoot, "scripts/mutant-probe.mjs");

const scratch = mkdtempSync(path.join(tmpdir(), "mutant-probe-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The installed vitest, linked into each throwaway tree so its suite resolves the import. */
const vitestRoot = path.dirname(createRequire(import.meta.url).resolve("vitest/package.json"));

/** What pnpm would have put on the tree's bin path: a shim that starts that vitest. */
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

/** A suite that spends long enough in its one test for an interrupt to land mid-run. */
const SLOW_SUITE = `import { expect, it } from "vitest";

import { answer } from "../src/answer.ts";

it("adds one, slowly", { timeout: 60_000 }, async () => {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  expect(answer(1)).toBe(2);
});
`;

/**
 * A workspace shaped like the ones the probe runs over: a manifest with a `test` script, a
 * source file under `src`, a suite under `test`, everything committed — and the installed
 * vitest linked in, ignored, with a shim on the bin path, so the suite's `import "vitest"`
 * resolves from the tree and the probe finds vitest where pnpm would have put it. A second
 * suite file, when a case needs one, is untracked: it is the case's, not the tree's.
 */
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

/** The one line the probe writes to stdout for the verdict. */
const verdictOf = (run: Run): string | undefined =>
  run.stdout.split("\n").find((line) => line.startsWith("verdict:"));

const source = (root: string): string => readFileSync(path.join(root, "src/answer.ts"), "utf8");

/** The probe exited as the case expected — and when it did not, what it wrote is the message. */
const exited = (run: Run, status: number): void => {
  if (run.status !== status) {
    throw new Error(
      `mutant-probe exited ${String(run.status)}, expected ${String(status)}:\n${run.stdout}\n${run.stderr}`,
    );
  }
};

describe("the mutant probe over a throwaway workspace (T-098)", () => {
  it("says killed when the suite fails under the mutation, and restores the file", () => {
    const root = workspace("killed");

    const run = probe(root, { line: 1, from: "n + 1", to: "n - 1" });

    exited(run, 0);
    expect(verdictOf(run)).toBe("verdict: killed");
    expect(source(root)).toBe(SOURCE);
  });

  it("says survived when the suite stays green under the mutation, and restores the file", () => {
    const root = workspace("survived");

    const run = probe(root, { line: 2, from: '"answer"', to: '""' });

    exited(run, 0);
    expect(verdictOf(run)).toBe("verdict: survived");
    expect(source(root)).toBe(SOURCE);
  });

  it("says timed out when the suite outlives the budget, and restores the file", () => {
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

  it("prints the src diff-stat against HEAD after the run, and says when there is none", () => {
    const root = workspace("clean");

    const run = probe(root, { line: 1, from: "n + 1", to: "n - 1" });

    exited(run, 0);
    expect(run.stdout).toContain("src: clean against HEAD");
  });

  it("restores the file when it is interrupted mid-run, and exits as interrupted", async () => {
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

    // Wait until the mutation is on disk and vitest has announced itself, give the slow test
    // time to be the thing running, then interrupt.
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

  it("restores the file when the suite crashes rather than runs, and refuses a verdict", () => {
    // A suite vitest cannot collect: no test ran, so nothing was killed or survived.
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

  it("refuses a verdict when one test file failed to run, even though every test that ran passed", () => {
    // The suite that mutated audit's tenancy ternary in the T-098 controls: a file that failed
    // to collect for a reason of its own, and a red run with no red test. Under the mutation
    // `label` is blank, which no test checks — so this is not a kill, and it is not a survival
    // either, because the file that did not run might have asked.
    const root = workspace("half-ran", SUITE, "this is not a test\n");

    const run = probe(root, { line: 2, from: '"answer"', to: '""' });

    expect(run.status).not.toBe(0);
    expect(verdictOf(run)).toBeUndefined();
    expect(run.stderr).toContain("1 of 2 test files failed to run");
    expect(source(root)).toBe(SOURCE);
  });

  it("refuses to start over a file that already has an unstaged change", () => {
    const root = workspace("dirty");
    const edited = `${SOURCE}export const extra = 1;\n`;
    writeFileSync(path.join(root, "src/answer.ts"), edited);

    const run = probe(root, { line: 1, from: "n + 1", to: "n - 1" });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("unstaged change");
    expect(verdictOf(run)).toBeUndefined();
    // Someone's edit, untouched: the probe never restores over it.
    expect(source(root)).toBe(edited);
  });

  it("refuses a mutation whose text is not on the line it names, so a probe pins to the source", () => {
    const root = workspace("misanchored");

    const run = probe(root, { line: 2, from: "n + 1", to: "n - 1" });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("line 2");
    expect(verdictOf(run)).toBeUndefined();
    expect(source(root)).toBe(SOURCE);
  });
});
