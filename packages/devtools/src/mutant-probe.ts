import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { flagValues } from "./flags.ts";

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

const DEFAULT_TIMEOUT_MS = 600_000;

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

const workspaceOf = (file: string): string | undefined => {
  let directory = path.dirname(file);
  while (!existsSync(path.join(directory, "package.json"))) {
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return directory;
};

type GitAnswer = { readonly status: number | null; readonly out: string };

const gitSync = (cwd: string, args: readonly string[]): GitAnswer => {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
};

const vitestShimFor = (workspace: string): string | undefined => {
  const shim = path.join(workspace, "node_modules", ".bin", "vitest");
  return existsSync(shim) ? shim : undefined;
};

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

  // SAFETY: every field read off the report is checked, so a reporter that changed shape
  // reads as a suite that never ran.
  return typeof parsed === "object" && parsed !== null ? (parsed as VitestReport) : undefined;
};

const killGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone, which is what the signal was for.
  }
};

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
