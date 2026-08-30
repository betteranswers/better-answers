import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The boundary contract the `anti-slop` lift must keep across a refresh
 * (`[LIFT1]`, `[LIFT2]`; `app/lifts/anti-slop/THIRD_PARTY_NOTICES.md`). If either
 * rule stops firing, the constitution has lost the teeth the lift exists to give it,
 * and if the digest moves, what is running is no longer what was audited.
 */
const oxlint = fileURLToPath(new URL("../../node_modules/.bin/oxlint", import.meta.url));
const oxlintConfig = fileURLToPath(new URL("../../.oxlintrc.json", import.meta.url));
const liftRoot = fileURLToPath(new URL("../lifts/anti-slop", import.meta.url));

function lint(filename: string, source: string): string {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-"));
  const file = join(directory, filename);
  writeFileSync(file, source, "utf8");

  const run = spawnSync(oxlint, ["--config", oxlintConfig, file], {
    encoding: "utf8",
  });

  return `${run.stdout}${run.stderr}`;
}

/**
 * `sha256` over `<relative path>\0<sha256 of the file>\n` for every snapshot file
 * but the notices, sorted by path. Stated here so a refresh can recompute it from
 * the description alone.
 */
function snapshotDigest(root: string): string {
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.endsWith("THIRD_PARTY_NOTICES.md"))
    .map((file) => relative(root, file).split(sep).join(posix.sep))
    .sort();

  const digest = createHash("sha256");
  for (const file of files) {
    const content = createHash("sha256")
      .update(readFileSync(join(root, file)))
      .digest("hex");
    digest.update(`${file}\0${content}\n`);
  }

  return digest.digest("hex");
}

describe("the anti-slop lift", () => {
  it("refuses module mocking in a test file, which is the only place it can happen", () => {
    const report = lint(
      "mocking.test.ts",
      ['import { vi } from "vitest";', 'vi.mock("../src/server.ts");', ""].join("\n"),
    );

    expect(report).toContain("anti-slop(no-module-mocking)");
  });

  it("refuses an assertion chained through unknown", () => {
    const report = lint(
      "assertions.ts",
      [
        "export function widen(input: number): string {",
        "  return input as unknown as string;",
        "}",
        "",
      ].join("\n"),
    );

    expect(report).toContain("anti-slop(no-chained-type-assertions)");
  });

  it("is byte-for-byte the snapshot that was audited", () => {
    const recorded = readFileSync(join(liftRoot, "THIRD_PARTY_NOTICES.md"), "utf8");

    expect(recorded).toContain(snapshotDigest(liftRoot));
  });
});
