import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SHIM = `#!/bin/sh
printf '%s %s %s\\n' "$1" "$2" "$3" >> "$GIT_STARTS_LOG"
PATH="$GIT_STARTS_PATH" exec git "$@"
`;

const subcommandOf = (line: string): string => {
  const words = line.split(" ");
  return (words[0] === "--git-dir" ? words[2] : words[0]) ?? "";
};

const withShimFirst = async (shim: string, log: string, work: () => Promise<unknown>) => {
  const searched = process.env["PATH"] ?? "";
  process.env["GIT_STARTS_LOG"] = log;
  process.env["GIT_STARTS_PATH"] = searched;
  process.env["PATH"] = `${shim}${path.delimiter}${searched}`;
  try {
    await work();
  } finally {
    process.env["PATH"] = searched;
    delete process.env["GIT_STARTS_LOG"];
    delete process.env["GIT_STARTS_PATH"];
  }
};

/** Reads no input and takes a second to exit on SIGTERM, as git does clearing its locks. */
const HANGING = `#!/bin/sh
for word in "$@"; do
  if [ "$word" = "$GIT_HANGS_AT" ]; then
    echo $$ > "$GIT_HUNG_PID"
    trap 'kill $!; sleep 1; exit 143' TERM
    sleep 30 &
    wait
    exit 1
  fi
done
PATH="$GIT_STARTS_PATH" exec git "$@"
`;

const HANGING_ENVIRONMENT = ["GIT_HANGS_AT", "GIT_HUNG_PID", "GIT_STARTS_PATH"] as const;

/**
 * Runs `work` while every git naming `subcommand` hangs, and answers the hung child's pid. PATH
 * is process-wide, as for gitStarts.
 */
export const whileGitHangsAt = async (
  subcommand: string,
  work: () => Promise<void>,
): Promise<number> => {
  const shim = await mkdtemp(path.join(tmpdir(), "better-answers-git-hangs-"));
  const searched = process.env["PATH"] ?? "";
  const pidFile = path.join(shim, "pid");
  try {
    await writeFile(path.join(shim, "git"), HANGING);
    await chmod(path.join(shim, "git"), 0o755);
    process.env["GIT_HANGS_AT"] = subcommand;
    process.env["GIT_HUNG_PID"] = pidFile;
    process.env["GIT_STARTS_PATH"] = searched;
    process.env["PATH"] = `${shim}${path.delimiter}${searched}`;
    await work();
    return Number((await readFile(pidFile, "utf8")).trim());
  } finally {
    process.env["PATH"] = searched;
    for (const name of HANGING_ENVIRONMENT) delete process.env[name];
    await rm(shim, { recursive: true, force: true });
  }
};

/** PATH is process-wide, so `work` must be the only thing starting `git` while it runs. */
export const gitStarts = async (work: () => Promise<unknown>): Promise<readonly string[]> => {
  const shim = await mkdtemp(path.join(tmpdir(), "better-answers-git-starts-"));
  try {
    const log = path.join(shim, "starts");
    await writeFile(path.join(shim, "git"), SHIM);
    await chmod(path.join(shim, "git"), 0o755);
    await writeFile(log, "");

    await withShimFirst(shim, log, work);
    const started = await readFile(log, "utf8");
    return started
      .split("\n")
      .filter((line) => line !== "")
      .map(subcommandOf);
  } finally {
    await rm(shim, { recursive: true, force: true });
  }
};
