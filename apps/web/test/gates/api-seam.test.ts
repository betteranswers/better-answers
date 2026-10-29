import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { workspaceRoot } from "@test/roots.ts";

const tsc = (() => {
  const manifest = createRequire(import.meta.url).resolve("typescript/package.json");
  const binary = path.join(path.dirname(manifest), "bin", "tsc");
  if (!existsSync(binary)) throw new Error(`tsc is not at ${binary}`);
  return binary;
})();

/**
 * The icon set declares a file per glyph, which puts this listing past Node's default
 * megabyte; truncation fails as a spawn error, not a finding.
 */
const LISTING_BUFFER_BYTES = 64 * 1024 * 1024;

const AUTH_FILES_THE_WEB_MAY_PULL = new Set(["verify.ts", "constants.ts"]);

describe("the AppRouter seam", () => {
  it("pulls nothing of the auth server into the web program", () => {
    const listing = execFileSync(process.execPath, [tsc, "--noEmit", "--listFiles"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: LISTING_BUFFER_BYTES,
    });
    const authFiles = listing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("/apps/api/src/auth/"))
      .map((line) => path.basename(line));

    expect(authFiles).toContain("verify.ts");

    const intruders = authFiles.filter((file) => !AUTH_FILES_THE_WEB_MAY_PULL.has(file));
    expect(intruders).toEqual([]);
  }, 60_000);
});
