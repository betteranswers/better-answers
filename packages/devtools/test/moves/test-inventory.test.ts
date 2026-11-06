import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import {
  sweptFolder,
  throwawayRepository,
  writeUnder,
} from "@better-answers/devtools/throwaway-tree";

import { isAlive, untilTrue } from "./polling.ts";

const SCRIPT = path.join(repositoryRoot, "scripts/test-inventory.sh");

const VITEST = path.dirname(createRequire(import.meta.url).resolve("vitest/package.json"));

const scratch = sweptFolder();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const hangingVitest = (pidFile: string): string =>
  `import { writeFileSync } from "node:fs";\n\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`;

describe("the listing script", () => {
  it("stops every listing when it is stopped", async () => {
    const root = throwawayRepository(path.join(scratch, "repository"));
    const pidFile = path.join(scratch, "listing.pid");
    writeUnder(root, "packages/core/vitest.config.ts", "export default {};\n");
    writeUnder(root, "packages/core/node_modules/vitest/vitest.mjs", hangingVitest(pidFile));

    const script = spawn(SCRIPT, [path.join(scratch, "out")], { cwd: root, stdio: "ignore" });
    const stopped = new Promise((resolve) => script.once("exit", resolve));
    await untilTrue(() => existsSync(pidFile));
    const listing = Number(readFileSync(pidFile, "utf8"));
    script.kill("SIGTERM");
    await stopped;
    await untilTrue(() => !isAlive(listing));

    expect(isAlive(listing)).toBe(false);
  });

  it("stops every listing when its caller is killed outright", async () => {
    const root = throwawayRepository(path.join(scratch, "orphaned"));
    const pidFile = path.join(scratch, "orphaned.pid");
    writeUnder(root, "packages/core/vitest.config.ts", "export default {};\n");
    writeUnder(root, "packages/core/node_modules/vitest/vitest.mjs", hangingVitest(pidFile));

    const caller = spawn("sh", ["-c", `${SCRIPT} ${path.join(scratch, "orphaned-out")}; :`], {
      cwd: root,
      stdio: "ignore",
    });
    await untilTrue(() => existsSync(pidFile));
    const listing = Number(readFileSync(pidFile, "utf8"));
    caller.kill("SIGKILL");
    await untilTrue(() => !isAlive(listing));

    expect(isAlive(listing)).toBe(false);
  });

  it("keeps test modules' temp folders and docker calls inside", () => {
    const root = throwawayRepository(path.join(scratch, "hermetic"));
    const temp = path.join(scratch, "temp");
    const bin = path.join(scratch, "bin");
    const dockerCalls = path.join(scratch, "docker-calls");
    mkdirSync(temp);
    writeUnder(bin, "docker", `#!/bin/sh\necho "$@" >> ${dockerCalls}\n`);
    chmodSync(path.join(bin, "docker"), 0o755);
    writeUnder(root, "packages/core/vitest.config.ts", "export default {};\n");
    writeUnder(
      root,
      "packages/core/test/probe.test.ts",
      [
        'import { execFileSync } from "node:child_process";',
        'import { mkdtempSync } from "node:fs";',
        'import { tmpdir } from "node:os";',
        'import path from "node:path";',
        'import { it } from "vitest";',
        "",
        'mkdtempSync(path.join(tmpdir(), "made-at-import-"));',
        'const dockerAnswers = (() => { try { execFileSync("docker", ["info"]); return "up"; } catch { return "down"; } })();',
        "it(`docker is ${dockerAnswers}`, () => {});",
        "",
      ].join("\n"),
    );
    mkdirSync(path.join(root, "packages/core/node_modules"), { recursive: true });
    symlinkSync(VITEST, path.join(root, "packages/core/node_modules/vitest"));

    const listed = spawnSync(SCRIPT, [path.join(scratch, "hermetic-out")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: temp, PATH: `${bin}:${String(process.env["PATH"])}` },
    });

    expect(listed.status).toBe(0);
    expect(readFileSync(path.join(scratch, "hermetic-out/vitest-core.txt"), "utf8")).toBe(
      "probe.test.ts :: docker is down\n",
    );
    expect(readdirSync(temp)).toStrictEqual([]);
    expect(existsSync(dockerCalls)).toBe(false);
  });
});
