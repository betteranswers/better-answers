import { execFileSync, spawnSync } from "node:child_process";

import { heldPort, released } from "../support/loopback-port.ts";

export type Run = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** Compose narrates to stderr on success, so it is read only when the run failed. */
export const outcomeOf = (run: Run): string =>
  run.status === 0 ? "ran" : `exited ${String(run.status)}: ${run.stderr}`;

export const runScript = (
  script: string,
  argv: readonly string[],
  env: Readonly<Record<string, string>>,
): Run => {
  const result = spawnSync("bash", [script, ...argv], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const listedBy = (argv: readonly string[]): readonly string[] =>
  execFileSync("docker", argv, { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "");

export const containersOf = (projectName: string): readonly string[] =>
  listedBy(["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${projectName}`]);

export const volumesOf = (projectName: string): readonly string[] =>
  listedBy(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${projectName}`]);

export const inspected = (container: string, format: string): string =>
  execFileSync("docker", ["inspect", "--format", format, container], { encoding: "utf8" }).trim();

export const imagesOf = (projectName: string): readonly string[] =>
  containersOf(projectName).map((container) => inspected(container, "{{.Config.Image}}"));

export const upOnATakenPort = async (
  up: (port: number, projectName: string) => Run,
  projectName: string,
): Promise<{ status: number | null; containers: readonly string[]; namesThePort: boolean }> => {
  const held = await heldPort();
  try {
    const run = up(held.port, projectName);
    return {
      status: run.status,
      containers: containersOf(projectName),
      namesThePort: run.stderr.includes(`127.0.0.1:${String(held.port)} is taken`),
    };
  } finally {
    await released(held);
  }
};
