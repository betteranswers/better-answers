import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

// Text, never imported: one half is Python, and importing either asks one language to answer
// for the other.
const TIER_STAMPS = {
  "the api tier": "packages/schema/src/contract-stamp.ts",
  "the worker tier": "apps/worker/src/better_answers_worker/contract_stamp.py",
} as const;

const WHOLE_HASH = /CONTRACT_DIGEST = "([0-9a-f]{64})"/;

const digestIn = (relative: string): string => {
  const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
  const found = WHOLE_HASH.exec(source);
  if (found?.[1] === undefined) {
    throw new Error(
      `${relative} carries no 64-character lowercase hex digest — regenerate it, and never by hand`,
    );
  }
  return found[1];
};

describe("the contract's digest, across the two tiers", () => {
  it("is the same hash in both, which is the proof the two languages read one directory alike", () => {
    const read = Object.entries(TIER_STAMPS).map(([tier, relative]) => ({
      tier,
      digest: digestIn(relative),
    }));

    const [first] = read;
    expect(read).toEqual(read.map(({ tier }) => ({ tier, digest: first?.digest })));
  });
});
