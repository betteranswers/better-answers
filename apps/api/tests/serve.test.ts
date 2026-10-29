import { execFile } from "node:child_process";

import { expect, it } from "vitest";

import { heldPort, released } from "./support/loopback-port.ts";
import { workspaceRoot } from "./support/roots/roots.ts";

/** Well under the harness's start-up, so only a server that binds before it starts can exit in time. */
const BEFORE_START_UP_MS = 3000;

type Exit = { readonly code: number | string | null | undefined; readonly output: string };

const servedOn = (port: number): Promise<Exit> =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      ["tests/serve.ts", String(port)],
      { cwd: workspaceRoot, timeout: BEFORE_START_UP_MS, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : error.code, output: stdout + stderr });
      },
    );
  });

it("exits at once when another listener holds its port", async () => {
  const held = await heldPort();
  try {
    const exit = await servedOn(held.port);

    expect(exit.output).toContain("EADDRINUSE");
    expect(exit.output).not.toContain("is listening");
    expect(exit.code).toBe(1);
  } finally {
    await released(held);
  }
});
