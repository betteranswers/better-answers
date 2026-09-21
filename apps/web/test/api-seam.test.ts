import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "..");

const tsc = (() => {
  const manifest = createRequire(import.meta.url).resolve("typescript/package.json");
  const binary = path.join(path.dirname(manifest), "bin", "tsc");
  if (!existsSync(binary)) throw new Error(`tsc is not at ${binary}`);
  return binary;
})();

describe("the AppRouter seam", () => {
  it("pulls nothing of the auth server into the web program", () => {
    const listing = execFileSync(process.execPath, [tsc, "--noEmit", "--listFiles"], {
      cwd: webRoot,
      encoding: "utf8",
    });
    const authFiles = listing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("/apps/api/src/auth/"))
      .map((line) => path.basename(line));

    // The positive control: with this line gone, an empty list would read as a narrowed seam
    // rather than a filter that has rotted.
    expect(authFiles).toContain("verify.ts");

    const intruders = authFiles.filter((file) => file !== "verify.ts" && file !== "constants.ts");
    expect(intruders).toEqual([]);
  }, 60_000);
});
