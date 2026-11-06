import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  sweptFolder,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";

const SCRIPT = path.join(repositoryRoot, "scripts/test-inventory.sh");

const scratch = sweptFolder();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const POLL_MS = 50;

const WAIT_MS = 10_000;

const untilTrue = async (done: () => boolean): Promise<void> => {
  for (let waited = 0; !done() && waited < WAIT_MS; waited += POLL_MS) await sleep(POLL_MS);
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("the listing script", () => {
  it("stops every listing when it is stopped", async () => {
    const root = throwawayRepository(path.join(scratch, "repository"));
    const pidFile = path.join(scratch, "listing.pid");
    writeUnder(root, "packages/core/vitest.config.ts", "export default {};\n");
    writeUnder(
      root,
      "packages/core/node_modules/vitest/vitest.mjs",
      `import { writeFileSync } from "node:fs";\n\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    );

    const script = spawn(SCRIPT, [path.join(scratch, "out")], { cwd: root, stdio: "ignore" });
    const stopped = new Promise((resolve) => script.once("exit", resolve));
    await untilTrue(() => existsSync(pidFile));
    const listing = Number(readFileSync(pidFile, "utf8"));
    script.kill("SIGTERM");
    await stopped;
    await untilTrue(() => !isAlive(listing));

    expect(isAlive(listing)).toBe(false);
  });
});
