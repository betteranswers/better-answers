import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const HOLDER = path.join(import.meta.dirname, "holds-a-container.ts");

const GONE = /No such (object|container)/i;

const POLL_MS = 250;

export type Holder = {
  readonly process: ChildProcess;
  readonly container: Promise<string>;
};

/**
 * A process of its own that starts one container through testcontainers and holds it until
 * killed, as a test run does.
 */
export const holdAContainer = (env: Readonly<Record<string, string>> = {}): Holder => {
  const child = spawn(process.execPath, [HOLDER], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const container = new Promise<string>((resolve, reject) => {
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
      const [line] = out.split("\n");
      if (out.includes("\n") && line !== undefined) resolve(line.trim());
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("exit", (code, signal) => {
      reject(new Error(`the holder ended (${String(code ?? signal)}) holding nothing:\n${err}`));
    });
  });
  return { process: child, container };
};

/** The container's state, or undefined once the daemon no longer has it; throws on any other failure. */
export const containerState = (container: string): string | undefined => {
  const inspected = spawnSync("docker", ["inspect", "--format", "{{.State.Status}}", container], {
    encoding: "utf8",
  });
  if (inspected.status === 0) return inspected.stdout.trim();
  if (GONE.test(inspected.stderr)) return undefined;
  throw new Error(`docker inspect ${container} failed:\n${inspected.stderr}`);
};

export const untilContainerGone = async (container: string, withinMs: number): Promise<boolean> => {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (containerState(container) === undefined) return true;
    await sleep(POLL_MS);
  }
  return containerState(container) === undefined;
};

/** Removes only the containers named, each of which the calling suite started itself. */
export const removeContainers = (containers: readonly string[]): void => {
  if (containers.length === 0) return;
  spawnSync("docker", ["rm", "--force", "--volumes", ...containers], { encoding: "utf8" });
};
