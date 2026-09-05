import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { boundarySchemas, ULID_PATTERN } from "@better-answers/schema";

import { ulid } from "../src/kernel/index.ts";

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

const SPOKEN_CONTRACT_VERSION = 1;
const SPOKEN_AGREEMENTS = {
  "concept-inbox": "sql-function",
  "cost-ledger": "generated",
  "id-shape": "fixtured",
  "credential-envelope": "fixtured",
  "llm-routing": "sql-function",
  queue: "sql-function",
  "visibility-columns": "fixtured",
} as const;
/** Files the manifest does not have to list. */
const NOT_FIXTURES = new Set(["manifest.json", "README.md"]);

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

  it("names exactly the agreements this tier speaks, each in the form this tier expects", () => {
    const manifest = readManifest();

    expect(Object.keys(manifest.agreements).toSorted()).toEqual(
      Object.keys(SPOKEN_AGREEMENTS).toSorted(),
    );
    for (const [id, form] of Object.entries(SPOKEN_AGREEMENTS)) {
      expect(manifest.agreements[id]?.form).toBe(form);
    }
  });

  it("lists a fixture if and only if it exists, under an agreement it names", () => {
    const manifest = readManifest();

    for (const fixture of manifest.fixtures) {
      expect(Object.keys(SPOKEN_AGREEMENTS)).toContain(fixture.agreement);
      expect(existsSync(path.join(contractsDir, fixture.path))).toBe(true);
    }

    // The other direction: a file on disk the manifest does not list fails too.
    const onDisk = readdirSync(contractsDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(contractsDir, path.join(entry.parentPath, entry.name)))
      .filter((relative) => !NOT_FIXTURES.has(relative));
    expect(onDisk.toSorted()).toEqual(manifest.fixtures.map((fixture) => fixture.path).toSorted());
  });
});

/**
 * id-shape: the one shape an id has, whichever tier minted it (ADR 0035). The fixture is
 * the contract — the pattern, the ids that must parse and the ids that must not — and
 * this half holds it against the tier's own minter and its own boundary, never against a
 * copy of the pattern written out here, which would agree with itself.
 */
type IdShape = {
  readonly pattern: string;
  readonly must_parse: readonly string[];
  readonly must_not_parse: readonly { readonly id: string; readonly why: string }[];
};

const readIdShape = (): IdShape =>
  JSON.parse(readFileSync(path.join(contractsDir, "id-shape", "cases.json"), "utf8")) as IdShape;

describe("id-shape, the agreement about what an id looks like", () => {
  it("pins the very pattern this tier narrows an identity id to at its boundary", () => {
    expect(readIdShape().pattern).toBe(ULID_PATTERN);
  });

  it("parses at this tier's boundary every id the other tier may mint, and refuses every id it may not", () => {
    const fixture = readIdShape();
    const atTheBoundary = boundarySchemas.workspace.select.shape.id;

    // The id and the reason travel with the assertion, so a failure names the sample
    // rather than reporting that true was not false.
    for (const id of fixture.must_parse) {
      expect({ id, parses: atTheBoundary.safeParse(id).success }).toEqual({ id, parses: true });
    }
    for (const { id, why } of fixture.must_not_parse) {
      expect({ why, parses: atTheBoundary.safeParse(id).success }).toEqual({ why, parses: false });
    }
  });

  it("mints ids the fixture's pattern accepts, so an id minted here parses over there", () => {
    const pattern = new RegExp(readIdShape().pattern);

    for (let minted = 0; minted < 100; minted += 1) expect(pattern.test(ulid())).toBe(true);
  });
});
