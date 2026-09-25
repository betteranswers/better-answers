import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
