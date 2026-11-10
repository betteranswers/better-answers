import { setTimeout as sleep } from "node:timers/promises";

const POLL_MS = 50;

const WAIT_MS = 10_000;

export const untilTrue = async (done: () => boolean): Promise<void> => {
  for (let waited = 0; !done() && waited < WAIT_MS; waited += POLL_MS) await sleep(POLL_MS);
};

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
