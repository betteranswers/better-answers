import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

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

type Refused = { readonly refused: string };

type Parsed = { readonly mutation: Mutation } | Refused;

type Anchor = Pick<Mutation, "file" | "line" | "from" | "to">;

const anchorOf = (values: ReadonlyMap<string, string>): Anchor | undefined => {
  const file = values.get("file");
  const line = Number(values.get("line"));
  const from = values.get("from");
  const to = values.get("to");
  if (file === undefined || from === undefined || to === undefined || !Number.isInteger(line)) {
    return undefined;
  }
  return { file, line, from, to };
};

const timeoutOf = (value: string | undefined): number | undefined => {
  const timeoutMs = value === undefined ? DEFAULT_TIMEOUT_MS : Number(value);
  return Number.isInteger(timeoutMs) && timeoutMs >= 1 ? timeoutMs : undefined;
};

const parseArgv = (argv: readonly string[]): Parsed => {
  const values = flagValues(argv);
  if (values === undefined) return { refused: USAGE };
  const anchor = anchorOf(values);
  if (anchor === undefined) return { refused: USAGE };
  if (anchor.line < 1) return { refused: "--line counts from 1" };
  if (anchor.from.length === 0) return { refused: "--from must name the text to replace" };
  const timeoutMs = timeoutOf(values.get("timeout-ms"));
  if (timeoutMs === undefined) {
    return { refused: "--timeout-ms must be a whole number of milliseconds" };
  }
  return {
    mutation: {
      file: path.resolve(anchor.file),
      line: anchor.line,
      from: anchor.from,
      to: anchor.to,
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

/**
 * pnpm's shim, not vitest's entry: its NODE_PATH reaches the hoisted store, and a suite
 * that fails to collect reads as a kill.
 */
const vitestShimFor = (workspace: string): string | undefined => {
  const shim = path.join(workspace, "node_modules", ".bin", "vitest");
  return existsSync(shim) ? shim : undefined;
};

const applyTo = (original: string, mutation: Mutation): { readonly mutated: string } | Refused => {
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

const vitestReport = z.object({
  numTotalTests: z.number().optional(),
  numFailedTests: z.number().optional(),
  numTotalTestSuites: z.number().optional(),
  numFailedTestSuites: z.number().optional(),
  success: z.boolean().optional(),
});
type VitestReport = z.infer<typeof vitestReport>;

/** A reporter that changed shape reads as a suite that never ran. */
const readReport = (file: string): VitestReport | undefined => {
  if (!existsSync(file)) return undefined;
  const read = vitestReport.safeParse(JSON.parse(readFileSync(file, "utf8")));
  return read.success ? read.data : undefined;
};

const exitOf = (code: number | null, signal: NodeJS.Signals | null): string =>
  code === null ? `on ${String(signal)}` : String(code);

const filesFailedIn = (report: VitestReport): string =>
  `${String(report.numFailedTestSuites ?? "some")} of ${String(report.numTotalTestSuites ?? "the")} test files failed to run, and no test failed`;

const outcomeOf = (report: VitestReport | undefined, exit: string): SuiteOutcome => {
  if (
    report?.numTotalTests === undefined ||
    report.numTotalTests === 0 ||
    report.numFailedTests === undefined ||
    report.success === undefined
  ) {
    return { kind: "did not run", detail: `vitest exited ${exit} having run no test` };
  }
  if (!report.success && report.numFailedTests === 0) {
    return { kind: "did not run", detail: filesFailedIn(report) };
  }
  return {
    kind: "ran",
    total: report.numTotalTests,
    failed: report.numFailedTests,
    success: report.success,
  };
};

const killGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone, which is what the signal was for.
  }
};

const runSuite = (workspace: string, shim: string, mutation: Mutation): Promise<SuiteOutcome> =>
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
      // Its own process group, so a timeout or an interrupt reaches vitest's workers: one
      // stuck in a mutated loop answers no message from its parent.
      { cwd: workspace, stdio: ["ignore", 2, 2], detached: true },
    );

    const stopSuite = (): void => {
      const pid = child.pid;
      if (pid === undefined) return;
      killGroup(pid, "SIGTERM");
      setTimeout(() => killGroup(pid, "SIGKILL"), GRACE_MS).unref();
    };
    let timedOut = false;
    let interrupted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopSuite();
    }, mutation.timeoutMs);
    const onInterrupt = (): void => {
      interrupted = true;
      stopSuite();
    };
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);
    const settle = (): void => {
      clearTimeout(timer);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
    };
    child.on("error", (error) => {
      settle();
      rmSync(reportDirectory, { recursive: true, force: true });
      resolve({ kind: "did not run", detail: error.message });
    });
    child.on("exit", (code, signal) => {
      settle();
      const report = readReport(reportFile);
      rmSync(reportDirectory, { recursive: true, force: true });
      if (interrupted) {
        resolve({ kind: "interrupted" });
      } else if (timedOut) {
        resolve({ kind: "timed out" });
      } else {
        resolve(outcomeOf(report, exitOf(code, signal)));
      }
    });
  });

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const complain = (line: string): void => {
  process.stderr.write(`mutant-probe: ${line}\n`);
};

type Suite = { readonly workspace: string; readonly shim: string };

const suiteFor = (file: string): Suite | Refused => {
  const workspace = workspaceOf(file);
  if (workspace === undefined) {
    return {
      refused: `no package.json above ${file}, so there is no workspace whose suite to run`,
    };
  }
  const shim = vitestShimFor(workspace);
  if (shim === undefined) {
    return { refused: `${workspace} has no vitest on its bin path, so its suite cannot be run` };
  }
  return { workspace, shim };
};

const gitRefusal = (workspace: string, file: string, relative: string): Refused | undefined => {
  if (gitSync(workspace, ["ls-files", "--error-unmatch", "--", relative]).status !== 0) {
    return {
      refused: `${file} is not tracked by git, so a restore could not be checked against HEAD`,
    };
  }
  if (gitSync(workspace, ["diff", "--quiet", "--", relative]).status !== 0) {
    return {
      refused: `${file} already has an unstaged change; a probe never restores over someone's edit`,
    };
  }
  return undefined;
};

type Probe = Suite & {
  readonly mutation: Mutation;
  readonly relative: string;
  readonly original: string;
  readonly mutated: string;
};

const prepare = (argv: readonly string[]): Probe | Refused => {
  const parsed = parseArgv(argv);
  if ("refused" in parsed) return parsed;
  const { mutation } = parsed;
  const suite = suiteFor(mutation.file);
  if ("refused" in suite) return suite;
  const relative = path.relative(suite.workspace, mutation.file);
  const refused = gitRefusal(suite.workspace, mutation.file, relative);
  if (refused !== undefined) return refused;
  const original = readFileSync(mutation.file, "utf8");
  const applied = applyTo(original, mutation);
  if ("refused" in applied) return applied;
  return { ...suite, mutation, relative, original, mutated: applied.mutated };
};

const runMutated = async (probe: Probe): Promise<SuiteOutcome> => {
  const { mutation, relative, original } = probe;
  writeFileSync(mutation.file, probe.mutated);
  try {
    complain(
      `${relative}:${String(mutation.line)} \`${mutation.from}\` → \`${mutation.to}\`, running ${mutation.suite ?? "the whole suite"} in ${probe.workspace}`,
    );
    return await runSuite(probe.workspace, probe.shim, mutation);
  } finally {
    writeFileSync(mutation.file, original);
    const restored = readFileSync(mutation.file, "utf8") === original;
    complain(
      restored
        ? `${relative} restored`
        : `${relative} could NOT be restored — it does not match what was read; restore it by hand`,
    );
  }
};

const printVerdict = (outcome: SuiteOutcome): number => {
  switch (outcome.kind) {
    case "interrupted":
      complain("interrupted before the suite finished; no verdict");
      return 130;
    case "did not run":
      complain(`the suite did not run (${outcome.detail}); no verdict`);
      return 1;
    case "timed out":
      say("verdict: timed out");
      return 0;
    case "ran": {
      const verdict: Verdict = outcome.success ? "survived" : "killed";
      complain(
        `${String(outcome.failed)} of ${String(outcome.total)} tests failed under the mutation`,
      );
      say(`verdict: ${verdict}`);
      return 0;
    }
  }
};

const printSrcAgainstHead = (workspace: string, status: number): number => {
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

/**
 * Resolves to 2 refused, 130 interrupted, 0 a verdict over a clean `src`, else 1, and to 1
 * whenever `git diff` over `src` fails.
 */
export const mutantProbe = async (argv: readonly string[]): Promise<number> => {
  const probe = prepare(argv);
  if ("refused" in probe) {
    complain(probe.refused);
    return 2;
  }
  const outcome = await runMutated(probe);
  return printSrcAgainstHead(probe.workspace, printVerdict(outcome));
};
