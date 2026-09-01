import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The TypeScript half of the tier-contract conformance suite (ADR 0031). The Python
 * half is `apps/worker/tests/test_tier_contract.py`, and the two assert the same
 * expectations against the same `contracts/` directory.
 *
 * The version and the agreement ids are hardcoded on each side on purpose, never read
 * from a shared constant: each suite states what its tier speaks, so a change to the
 * contract that either tier has not been taught fails that tier's suite. That failure
 * is the mechanism; deduplicating it away would delete the test.
 */

const SPOKEN_CONTRACT_VERSION = 0;
const SPOKEN_AGREEMENTS = [
  "concept-inbox",
  "cost-ledger",
  "credential-envelope",
  "llm-routing",
  "queue",
  "visibility-columns",
] as const;
const FORMS = ["sql-function", "fixtured", "generated"] as const;

const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");

type Manifest = {
  readonly contract_version: number;
  readonly agreements: Readonly<Record<string, { readonly form: string }>>;
  readonly fixtures: readonly { readonly agreement: string; readonly path: string }[];
};

const readManifest = (): Manifest =>
  JSON.parse(readFileSync(path.join(contractsDir, "manifest.json"), "utf8")) as Manifest;

describe("the tier contract", () => {
  it("speaks this tier's contract version", () => {
    expect(readManifest().contract_version).toBe(SPOKEN_CONTRACT_VERSION);
  });

  it("names exactly the agreements this tier speaks, each in a known form", () => {
    const manifest = readManifest();

    expect(Object.keys(manifest.agreements).toSorted()).toEqual([...SPOKEN_AGREEMENTS]);
    for (const agreement of Object.values(manifest.agreements)) {
      expect(FORMS).toContain(agreement.form);
    }
  });

  it("lists a fixture if and only if it exists, under an agreement it names", () => {
    const manifest = readManifest();

    for (const fixture of manifest.fixtures) {
      expect(SPOKEN_AGREEMENTS).toContain(fixture.agreement);
      expect(existsSync(path.join(contractsDir, fixture.path))).toBe(true);
    }
  });
});
