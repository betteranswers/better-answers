import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { flagValues } from "./flags.ts";

/**
 * One hand-applied mutation, run against a suite, restored whatever happened.
 *
 * A mutation-triage session applies a mutant by hand to ask the suite a question — does
 * this line's opposite die? — and two sessions left the mutant behind with the suite green,
 * because their loops restored on the happy path and a crash mid-loop restores nothing. So
 * the loop is a script: apply, run, read the verdict, and restore in a `finally` that an
 * interrupt, a crashed suite and a thrown error all reach. Then the `src` diff-stat against
 * `HEAD`, so the operator reads the tree clean before staging anything, and a non-zero exit
 * when it is not.
 *
 * The mutation is pinned to the source text — a line number and the text that must be on
 * it — so a probe written against one revision refuses to run against another rather than
 * mutating whatever moved there. The suite is the workspace's own vitest — the one on the bin
 * path of the directory holding the file's nearest manifest — with an optional filter; a
 * verdict is only read when every test file ran, because a file that failed to collect asked
 * the mutant nothing, and a suite that collected nothing killed nothing.
 */

/** One verdict the probe can reach. What kept it from one is said on stderr, not here. */
type Verdict = "killed" | "survived" | "timed out";

type Mutation = {
  readonly file: string;
  readonly line: number;
  readonly from: string;
  readonly to: string;
  readonly suite: string | undefined;
  readonly timeoutMs: number;
};

const USAGE =
  "usage: mutant-probe --file <path> --line <n> --from <text> --to <text> [--suite <vitest filter>] [--timeout-ms <n>]";

/** How long the whole suite may take under the mutation before the verdict is `timed out`. */
const DEFAULT_TIMEOUT_MS = 600_000;

/** After a SIGTERM to the suite's process group, how long before the group is SIGKILLed. */
const GRACE_MS = 2_000;

type Parsed = { readonly mutation: Mutation } | { readonly refused: string };

const parseArgv = (argv: readonly string[]): Parsed => {
  const values = flagValues(argv);
  if (values === undefined) return { refused: USAGE };
  const file = values.get("file");
  const line = Number(values.get("line"));
  const from = values.get("from");
  const to = values.get("to");
  if (file === undefined || from === undefined || to === undefined || !Number.isInteger(line)) {
    return { refused: USAGE };
  }
  if (line < 1) return { refused: "--line counts from 1" };
  if (from.length === 0) return { refused: "--from must name the text to replace" };
  const timeoutValue = values.get("timeout-ms");
  const timeoutMs = timeoutValue === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return { refused: "--timeout-ms must be a whole number of milliseconds" };
  }
  return {
    mutation: {
      file: path.resolve(file),
      line,
      from,
      to,
      suite: values.get("suite"),
      timeoutMs,
    },
  };
};

/** The directory holding the nearest `package.json` above `file`: the workspace whose suite runs. */
const workspaceOf = (file: string): string | undefined => {
  let directory = path.dirname(file);
  while (!existsSync(path.join(directory, "package.json"))) {
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return directory;
};

/** What one git command answered: its exit status, and both streams as one text. */
type GitAnswer = { readonly status: number | null; readonly out: string };

const gitSync = (cwd: string, args: readonly string[]): GitAnswer => {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
};

/**
 * The vitest the workspace's own `test` script runs: pnpm's shim on the workspace's bin path,
 * not vitest's entry module. The shim exports a `NODE_PATH` that reaches pnpm's hoisted
 * store, and a suite that resolves a platform binary through it — the type-aware linter the
 * import-direction suite runs — fails to collect when vitest is started any other way, which
 * would read as a kill the mutation never earned.
 */
const vitestShimFor = (workspace: string): string | undefined => {
  const shim = path.join(workspace, "node_modules", ".bin", "vitest");
  return existsSync(shim) ? shim : undefined;
};

/** The mutated file's text, or the reason the mutation does not fit the source. */
const applyTo = (
  original: string,
  mutation: Mutation,
): { readonly mutated: string } | { readonly refused: string } => {
  const lines = original.split("\n");
  const target = lines[mutation.line - 1];
  if (target === undefined) {
    return {
      refused: `${mutation.file} has ${String(lines.length)} lines; there is no line ${String(mutation.line)}`,
    };
  }
  const first = target.indexOf(mutation.from);
  if (first === -1) {
    return {
      refused: `line ${String(mutation.line)} of ${mutation.file} does not contain \`${mutation.from}\` — the source has moved; re-anchor the probe`,
    };
  }
  if (target.indexOf(mutation.from, first + 1) !== -1) {
    return {
      refused: `line ${String(mutation.line)} of ${mutation.file} contains \`${mutation.from}\` more than once; give --from enough of the line to be unique`,
    };
  }
  const mutatedLine = `${target.slice(0, first)}${mutation.to}${target.slice(first + mutation.from.length)}`;
  return {
    mutated: [
      ...lines.slice(0, mutation.line - 1),
      mutatedLine,
      ...lines.slice(mutation.line),
    ].join("\n"),
  };
};

type SuiteOutcome =
  | {
      readonly kind: "ran";
      readonly total: number;
      readonly failed: number;
      readonly success: boolean;
    }
  | { readonly kind: "timed out" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "did not run"; readonly detail: string };

/** What vitest's JSON reporter writes, read for the three numbers the verdict needs. */
type VitestReport = {
  readonly numTotalTests?: number;
  readonly numFailedTests?: number;
  readonly numTotalTestSuites?: number;
  readonly numFailedTestSuites?: number;
  readonly success?: boolean;
};

const readReport = (file: string): VitestReport | undefined => {
  if (!existsSync(file)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  // SAFETY: vitest's JSON reporter writes one object; the three fields read off it are
  // optional here and checked before use, so a reporter that changed shape reads as a suite
  // that did not run rather than as a verdict.
  return typeof parsed === "object" && parsed !== null ? (parsed as VitestReport) : undefined;
};

const killGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone, which is what the signal was for.
  }
};

/**
 * Run the workspace's vitest under the mutation and read how it ended. The suite's own
 * output goes to stderr, so stdout carries only the verdict and the diff-stat. The child is
 * its own process group, so a timeout or an interrupt reaches vitest's workers too — a worker
 * stuck in a mutated loop answers no message from its parent.
 */
const runSuite = (
  workspace: string,
  shim: string,
  mutation: Mutation,
  interrupted: { value: boolean },
): Promise<SuiteOutcome> =>
  new Promise((resolve) => {
    const reportDirectory = mkdtempSync(path.join(tmpdir(), "mutant-probe-"));
    const reportFile = path.join(reportDirectory, "report.json");
    const child = spawn(
      shim,
      [
        "run",
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${reportFile}`,
        ...(mutation.suite === undefined ? [] : [mutation.suite]),
      ],
      { cwd: workspace, stdio: ["ignore", 2, 2], detached: true },
    );
    /** Stop the suite: its whole group is asked, then told. */
    const stopSuite = (): void => {
      const pid = child.pid;
      if (pid === undefined) return;
      killGroup(pid, "SIGTERM");
      setTimeout(() => killGroup(pid, "SIGKILL"), GRACE_MS).unref();
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopSuite();
    }, mutation.timeoutMs);
    const onInterrupt = (): void => {
      interrupted.value = true;
      stopSuite();
    };
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);
    child.on("error", (error) => {
      clearTimeout(timer);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      rmSync(reportDirectory, { recursive: true, force: true });
      resolve({ kind: "did not run", detail: error.message });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      const report = readReport(reportFile);
      rmSync(reportDirectory, { recursive: true, force: true });
      if (interrupted.value) {
        resolve({ kind: "interrupted" });
      } else if (timedOut) {
        resolve({ kind: "timed out" });
      } else if (
        report?.numTotalTests === undefined ||
        report.numTotalTests === 0 ||
        report.numFailedTests === undefined ||
        report.success === undefined
      ) {
        resolve({
          kind: "did not run",
          detail: `vitest exited ${code === null ? `on ${String(signal)}` : String(code)} having run no test`,
        });
      } else if (!report.success && report.numFailedTests === 0) {
        // A red run with no red test: a file failed to collect, so its tests never asked
        // the mutant anything. Neither verdict is earned.
        resolve({
          kind: "did not run",
          detail: `${String(report.numFailedTestSuites ?? "some")} of ${String(report.numTotalTestSuites ?? "the")} test files failed to run, and no test failed`,
        });
      } else {
        resolve({
          kind: "ran",
          total: report.numTotalTests,
          failed: report.numFailedTests,
          success: report.success,
        });
      }
    });
  });

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const complain = (line: string): void => {
  process.stderr.write(`mutant-probe: ${line}\n`);
};

/**
 * The probe, start to finish: the exit code is the process's. Zero is a verdict over a
 * tree left clean; 1 is a verdict over a tree that is not, or a suite that did not run; 2 is
 * a refusal before anything was touched; 130 is an interrupt, restored.
 */
export const mutantProbe = async (argv: readonly string[]): Promise<number> => {
  const parsed = parseArgv(argv);
  if ("refused" in parsed) {
    complain(parsed.refused);
    return 2;
  }
  const { mutation } = parsed;

  const workspace = workspaceOf(mutation.file);
  if (workspace === undefined) {
    complain(`no package.json above ${mutation.file}, so there is no workspace whose suite to run`);
    return 2;
  }
  const shim = vitestShimFor(workspace);
  if (shim === undefined) {
    complain(`${workspace} has no vitest on its bin path, so its suite cannot be run`);
    return 2;
  }
  const relative = path.relative(workspace, mutation.file);

  // The refusal that keeps a probe from restoring over someone's edit: the file is tracked
  // and matches the index, or nothing here runs.
  if (gitSync(workspace, ["ls-files", "--error-unmatch", "--", relative]).status !== 0) {
    complain(
      `${mutation.file} is not tracked by git, so a restore could not be checked against HEAD`,
    );
    return 2;
  }
  if (gitSync(workspace, ["diff", "--quiet", "--", relative]).status !== 0) {
    complain(
      `${mutation.file} already has an unstaged change; a probe never restores over someone's edit`,
    );
    return 2;
  }

  const original = readFileSync(mutation.file, "utf8");
  const applied = applyTo(original, mutation);
  if ("refused" in applied) {
    complain(applied.refused);
    return 2;
  }

  const interrupted = { value: false };
  let outcome: SuiteOutcome = { kind: "did not run", detail: "the probe threw before the suite" };
  writeFileSync(mutation.file, applied.mutated);
  try {
    complain(
      `${relative}:${String(mutation.line)} \`${mutation.from}\` → \`${mutation.to}\`, running ${mutation.suite ?? "the whole suite"} in ${workspace}`,
    );
    outcome = await runSuite(workspace, shim, mutation, interrupted);
  } finally {
    writeFileSync(mutation.file, original);
    const restored = readFileSync(mutation.file, "utf8") === original;
    complain(
      restored
        ? `${relative} restored`
        : `${relative} could NOT be restored — it does not match what was read; restore it by hand`,
    );
  }

  let status: number;
  switch (outcome.kind) {
    case "interrupted":
      complain("interrupted before the suite finished; no verdict");
      status = 130;
      break;
    case "did not run":
      complain(`the suite did not run (${outcome.detail}); no verdict`);
      status = 1;
      break;
    case "timed out":
      say("verdict: timed out");
      status = 0;
      break;
    case "ran": {
      const verdict: Verdict = outcome.success ? "survived" : "killed";
      complain(
        `${String(outcome.failed)} of ${String(outcome.total)} tests failed under the mutation`,
      );
      say(`verdict: ${verdict}`);
      status = 0;
      break;
    }
  }

  // The tree the operator is about to stage from, read before they read it.
  const stat = gitSync(workspace, ["diff", "--stat", "HEAD", "--", "src"]);
  if (stat.status !== 0) {
    complain(`git diff --stat failed:\n${stat.out}`);
    return 1;
  }
  if (stat.out.trim().length === 0) {
    say("src: clean against HEAD");
    return status;
  }
  say(`src: NOT clean against HEAD\n${stat.out.trimEnd()}`);
  return status === 0 ? 1 : status;
};
