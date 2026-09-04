import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What ADR 0006's one exception actually costs, measured rather than remembered: importing
 * `AppRouter` puts `apps/api` source files into this workspace's TypeScript program, and the
 * only acceptable ones under `apps/api/src/auth/` are the seam's own — `verify.ts`, whose
 * `SessionReader` is the one auth name `TrpcContext` carries, and `constants.ts`. The Better
 * Auth server configuration (`auth.ts`, `routes.ts`, `pages.ts`, the barrel that exports
 * `createAuth`) must never be here: its presence is what forced `exactOptionalPropertyTypes`
 * off in this workspace once (T-036), and this test is what keeps the flag on.
 *
 * The program's file list is read from the compiler (`--listFiles`), not grepped from
 * imports, so a re-export added three files away still fails here.
 */

const webRoot = path.resolve(import.meta.dirname, "..");

/**
 * Resolved through the module graph rather than assembled from a path, for the same reason
 * `lint-rules.test.ts` resolves oxlint that way: pnpm puts a binary where the declaring
 * package can reach it, and a wrong path here would not fail loudly.
 */
const tsc = (() => {
  const manifest = createRequire(import.meta.url).resolve("typescript/package.json");
  const binary = path.join(path.dirname(manifest), "bin", "tsc");
  if (!existsSync(binary)) throw new Error(`tsc is not at ${binary}`);
  return binary;
})();

describe("the AppRouter seam", () => {
  it("pulls nothing of the auth server into the web program", () => {
    // A failing typecheck would also throw here, which is right: a program that does not
    // compile has no file list worth asserting over.
    const listing = execFileSync(process.execPath, [tsc, "--noEmit", "--listFiles"], {
      cwd: webRoot,
      encoding: "utf8",
    });
    const authFiles = listing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("/apps/api/src/auth/"))
      .map((line) => path.basename(line));
    // `verify.ts` is the positive control: the session reader genuinely rides in behind
    // `AppRouter` today, so an empty list means this filter rotted, not that the seam
    // narrowed to nothing — without this line the fence could pass while guarding nothing.
    expect(authFiles).toContain("verify.ts");
    // The allowlist is T-042's: `constants.ts` is permitted though not currently pulled in.
    // Anything else — `createAuth`'s module above all — is the regression, named here.
    const intruders = authFiles.filter((file) => file !== "verify.ts" && file !== "constants.ts");
    expect(intruders).toEqual([]);
  });
});
