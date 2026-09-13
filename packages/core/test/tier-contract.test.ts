import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

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

const SPOKEN_CONTRACT_VERSION = 6;
const SPOKEN_AGREEMENTS = {
  "concept-file": "fixtured",
  "concept-inbox": "sql-function",
  "cost-ledger": "generated",
  "id-shape": "fixtured",
  "credential-envelope": "fixtured",
  "llm-routing": "sql-function",
  queue: "sql-function",
  redaction: "fixtured",
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

/**
 * Every fixture a directory holds, as the manifest writes a path: sorted, relative, and
 * neither the manifest nor the README.
 *
 * Dotfiles are not fixtures. macOS writes a `.DS_Store` into any directory a Finder
 * window has opened; `contracts/` is a directory a person browses. It is git-ignored, so
 * no manifest can list it, CI never has one, and the owner reviewing the failure cannot
 * see it either — the suite would fail on the one machine that has one and pass on every
 * other. The Python half applies the same rule to the same directory (ADR 0031), because
 * a filter in one half alone leaves the other tripping on the same file.
 */
const fixturesOnDisk = (directory: string): readonly string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .filter((relative) => !relative.split(path.sep).some((segment) => segment.startsWith(".")))
    .filter((relative) => !NOT_FIXTURES.has(relative))
    .toSorted();

/**
 * A stand-in for `contracts/`, outside the repository. The walk's rule is proved against
 * files this test writes rather than by dropping a `.DS_Store` into the tracked directory:
 * that would put the proof inside the tree it is proving, and the Python half walks the
 * same directory in another process at the same time.
 */
const throwaway = mkdtempSync(path.join(tmpdir(), "tier-contract-"));

afterAll(() => rmSync(throwaway, { recursive: true, force: true }));

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
    expect(fixturesOnDisk(contractsDir)).toEqual(
      manifest.fixtures.map((fixture) => fixture.path).toSorted(),
    );
  });

  it("counts a fixture and never a dotfile, so a stray .DS_Store is not an unlisted one", () => {
    mkdirSync(path.join(throwaway, "id-shape"));
    writeFileSync(path.join(throwaway, "id-shape", "cases.json"), "{}");
    writeFileSync(path.join(throwaway, "manifest.json"), "{}");
    writeFileSync(path.join(throwaway, "README.md"), "");
    // What macOS writes into any directory a Finder window has opened, at the root and
    // under a fixture's own. It is git-ignored, so no manifest can list it, CI never has
    // one and a reviewer cannot see it: without this, the suite fails on one laptop and
    // passes everywhere else.
    writeFileSync(path.join(throwaway, ".DS_Store"), "");
    writeFileSync(path.join(throwaway, "id-shape", ".DS_Store"), "");
    mkdirSync(path.join(throwaway, ".cache"));
    writeFileSync(path.join(throwaway, ".cache", "cases.json"), "{}");

    expect(fixturesOnDisk(throwaway)).toEqual(["id-shape/cases.json"]);
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
