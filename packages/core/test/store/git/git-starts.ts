import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const shellQuoted = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const SHIM = (log: string, searched: string): string => `#!/bin/sh
printf '%s %s %s\\n' "$1" "$2" "$3" >> ${shellQuoted(log)}
PATH=${shellQuoted(searched)} exec git "$@"
`;

const subcommandOf = (line: string): string => {
  const words = line.split(" ");
  return (words[0] === "--git-dir" ? words[2] : words[0]) ?? "";
};

const withShimFirst = async (shim: string, searched: string, work: () => Promise<unknown>) => {
  process.env["PATH"] = `${shim}${path.delimiter}${searched}`;
  try {
    await work();
  } finally {
    process.env["PATH"] = searched;
  }
};

/**
 * Reads no input and, like git clearing its locks, takes a second to exit on SIGTERM. Writes its
 * pid once it waits.
 */
const HANGING = (subcommand: string, pidFile: string, searched: string): string => `#!/bin/sh
for word in "$@"; do
  if [ "$word" = ${shellQuoted(subcommand)} ]; then
    trap 'kill $!; sleep 1; exit 143' TERM
    sleep 30 &
    echo $$ > ${shellQuoted(`${pidFile}.part`)} && mv ${shellQuoted(`${pidFile}.part`)} ${shellQuoted(pidFile)}
    wait
    exit 1
  fi
done
PATH=${shellQuoted(searched)} exec git "$@"
`;

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

/** Waits until `file` exists or `running` settles, and says whether `file` exists. */
const appearsWhile = async (file: string, running: Promise<unknown>): Promise<boolean> => {
  const run = { settled: false };
  const settle = () => {
    run.settled = true;
  };
  running.then(settle, settle);
  while (!run.settled && !(await exists(file))) await new Promise((r) => setTimeout(r, 20));
  return exists(file);
};

/** Returns the hung git's pid. Sets PATH for the whole process, so nothing else may start git. */
export const whileGitHangsAt = async (
  subcommand: string,
  work: (budgetEnds: () => AbortSignal) => Promise<void>,
): Promise<number> => {
  const shim = await mkdtemp(path.join(tmpdir(), "better-answers-git-hangs-"));
  const searched = process.env["PATH"] ?? "";
  const pidFile = path.join(shim, "pid");
  const budget = new AbortController();
  try {
    await writeFile(path.join(shim, "git"), HANGING(subcommand, pidFile, searched));
    await chmod(path.join(shim, "git"), 0o755);
    process.env["PATH"] = `${shim}${path.delimiter}${searched}`;
    const working = work(() => budget.signal);
    const hung = await appearsWhile(pidFile, working);
    budget.abort();
    await working;
    if (!hung) throw new Error(`git ${subcommand} never hung`);
    return Number(await readFile(pidFile, "utf8"));
  } finally {
    budget.abort();
    process.env["PATH"] = searched;
    await rm(shim, { recursive: true, force: true });
  }
};

/** `rm` is atomic, so only the first git call with the subcommand pauses. */
const PAUSING = (
  pause: { readonly subcommand: string; readonly after: boolean },
  shim: string,
  searched: string,
): string => `#!/bin/sh
for word in "$@"; do
  if [ "$word" = ${shellQuoted(pause.subcommand)} ] && rm ${shellQuoted(path.join(shim, "armed"))} 2>/dev/null; then
    if [ ${pause.after ? 1 : 0} = 1 ]; then PATH=${shellQuoted(searched)} git "$@"; status=$?; fi
    touch ${shellQuoted(path.join(shim, "paused"))}
    while [ ! -f ${shellQuoted(path.join(shim, "go"))} ]; do sleep 0.02; done
    if [ ${pause.after ? 1 : 0} = 1 ]; then exit $status; fi
    break
  fi
done
PATH=${shellQuoted(searched)} exec git "$@"
`;

/** Sets PATH for the whole process, so nothing else may start git while it runs. */
export const whileGitPausesAt = async <T>(
  pause: { readonly subcommand: string; readonly after: boolean },
  started: () => Promise<T>,
  meanwhile: () => Promise<void>,
): Promise<T> => {
  const shim = await mkdtemp(path.join(tmpdir(), "better-answers-git-pauses-"));
  const searched = process.env["PATH"] ?? "";
  const go = path.join(shim, "go");
  try {
    await writeFile(path.join(shim, "git"), PAUSING(pause, shim, searched));
    await chmod(path.join(shim, "git"), 0o755);
    await writeFile(path.join(shim, "armed"), "");
    process.env["PATH"] = `${shim}${path.delimiter}${searched}`;
    const answer = started();
    if (!(await appearsWhile(path.join(shim, "paused"), answer))) {
      throw new Error(`git ${pause.subcommand} never started`);
    }
    await meanwhile();
    await writeFile(go, "");
    return await answer;
  } finally {
    await writeFile(go, "");
    process.env["PATH"] = searched;
    await rm(shim, { recursive: true, force: true });
  }
};

/** Sets PATH for the whole process, so `work` must be the only code that starts git. */
export const gitStarts = async (work: () => Promise<unknown>): Promise<readonly string[]> => {
  const shim = await mkdtemp(path.join(tmpdir(), "better-answers-git-starts-"));
  try {
    const log = path.join(shim, "starts");
    const searched = process.env["PATH"] ?? "";
    await writeFile(path.join(shim, "git"), SHIM(log, searched));
    await chmod(path.join(shim, "git"), 0o755);
    await writeFile(log, "");

    await withShimFirst(shim, searched, work);
    const started = await readFile(log, "utf8");
    return started
      .split("\n")
      .filter((line) => line !== "")
      .map(subcommandOf);
  } finally {
    await rm(shim, { recursive: true, force: true });
  }
};
