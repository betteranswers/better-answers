import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  CONTRACT_DIGEST_PATTERN,
  CONTRACT_STAMP_MODULE,
  contractDigest,
  CONTRACTS_ROOT,
  renderContractStamp,
} from "../src/contract-digest.ts";
import { CONTRACT_DIGEST } from "../src/contract-stamp.ts";

describe("the api tier's contract digest", () => {
  it("is byte-identical to a regeneration, so hand edits fail", () => {
    expect(readFileSync(CONTRACT_STAMP_MODULE, "utf8")).toBe(
      renderContractStamp(contractDigest(CONTRACTS_ROOT)),
    );
  });

  it("names the command that regenerates it", () => {
    expect(readFileSync(CONTRACT_STAMP_MODULE, "utf8")).toContain(
      "pnpm --filter @better-answers/schema run generate:contract-stamp",
    );
  });

  it("is the whole hash the stamp column is narrowed to", () => {
    expect(CONTRACT_DIGEST).toMatch(/^[0-9a-f]{64}$/);
    expect(CONTRACT_DIGEST_PATTERN.test(CONTRACT_DIGEST)).toBe(true);
  });
});

const trees = mkdtempSync(path.join(tmpdir(), "contract-digest-"));

afterAll(() => rmSync(trees, { recursive: true, force: true }));

const digestOf = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(path.join(trees, "tree-"));
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }
  return contractDigest(root);
};

describe("what the contract digest reads", () => {
  it("leaves a prose fix to the top-level README out", () => {
    const before = digestOf({ "README.md": "teh cases", "concept-file/cases.json": "[]" });
    expect(digestOf({ "README.md": "the cases", "concept-file/cases.json": "[]" })).toBe(before);
    expect(digestOf({ "README.md": "teh cases", "concept-file/cases.json": "[1]" })).not.toBe(
      before,
    );
  });

  it.each(["1b\n2", "1b\n\n2"])("never lets content %j pose as a second file", (forged) => {
    expect(digestOf({ a: forged })).not.toBe(digestOf({ a: "1", b: "2" }));
  });

  it("digests a CRLF file apart from its LF twin", () => {
    expect(digestOf({ "a.json": "{\r\n}\r\n" })).not.toBe(digestOf({ "a.json": "{\n}\n" }));
  });
});
