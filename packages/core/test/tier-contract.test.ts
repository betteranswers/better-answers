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
import { z } from "zod";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { boundarySchemas, ULID_PATTERN } from "@better-answers/schema";

import { ulid } from "../src/kernel/index.ts";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

// Version and agreements hardcoded on purpose, never read from a shared constant: that is
// what fails a tier not yet taught a contract change.
const SPOKEN_CONTRACT_VERSION = 11;
const SPOKEN_AGREEMENTS = {
  citation: "fixtured",
  "concept-file": "fixtured",
  "concept-inbox": "sql-function",
  "cost-ledger": "generated",
  "document-chunk": "fixtured",
  "id-shape": "fixtured",
  "credential-envelope": "fixtured",
  "llm-routing": "sql-function",
  queue: "sql-function",
  redaction: "fixtured",
  "upload-media-types": "fixtured",
  "visibility-columns": "fixtured",
} as const;

const NOT_FIXTURES = new Set(["manifest.json", "README.md"]);

const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");

const manifest = z.object({
  contract_version: z.number(),
  agreements: z.record(z.string(), z.object({ form: z.string() })),
  fixtures: z.array(z.object({ agreement: z.string(), path: z.string() })),
});

const readManifest = () =>
  manifest.parse(JSON.parse(readFileSync(path.join(contractsDir, "manifest.json"), "utf8")));

const fixturesOnDisk = (directory: string): readonly string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .filter((relative) => !relative.split(path.sep).some((segment) => segment.startsWith(".")))
    .filter((relative) => !NOT_FIXTURES.has(relative))
    .toSorted();

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

    expect(fixturesOnDisk(contractsDir)).toEqual(
      manifest.fixtures.map((fixture) => fixture.path).toSorted(),
    );
  });

  it("counts a fixture and never a dotfile, so a stray .DS_Store is not an unlisted one", () => {
    mkdirSync(path.join(throwaway, "id-shape"));
    writeFileSync(path.join(throwaway, "id-shape", "cases.json"), "{}");
    writeFileSync(path.join(throwaway, "manifest.json"), "{}");
    writeFileSync(path.join(throwaway, "README.md"), "");

    writeFileSync(path.join(throwaway, ".DS_Store"), "");
    writeFileSync(path.join(throwaway, "id-shape", ".DS_Store"), "");
    mkdirSync(path.join(throwaway, ".cache"));
    writeFileSync(path.join(throwaway, ".cache", "cases.json"), "{}");

    expect(fixturesOnDisk(throwaway)).toEqual(["id-shape/cases.json"]);
  });
});

const idShape = z.object({
  pattern: z.string(),
  must_parse: z.array(z.string()),
  must_not_parse: z.array(z.object({ id: z.string(), why: z.string() })),
});

const readIdShape = () =>
  idShape.parse(
    JSON.parse(readFileSync(path.join(contractsDir, "id-shape", "cases.json"), "utf8")),
  );

describe("id-shape, the agreement about what an id looks like", () => {
  it("pins the very pattern this tier narrows an identity id to at its boundary", () => {
    expect(readIdShape().pattern).toBe(ULID_PATTERN);
  });

  it("parses at this tier's boundary every id the other tier may mint, and refuses every id it may not", () => {
    const fixture = readIdShape();
    const atTheBoundary = boundarySchemas.workspace.select.shape.id;

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

const citation = z.object({
  patterns: z.array(
    z.object({
      name: z.string(),
      pattern: z.string(),
      why: z.string(),
      cites: z.array(z.object({ prose: z.array(z.string()), cited: z.array(z.string()) })),
    }),
  ),
  cites_nothing: z.array(z.string()),
});

const readCitation = () =>
  citation.parse(
    JSON.parse(readFileSync(path.join(contractsDir, "citation", "cases.json"), "utf8")),
  );

const commenting = (prose: string): string => `// ${prose}\nexport const keep = 1;\n`;

const citedSentences = readCitation().patterns.flatMap(({ name, cites }) =>
  cites.map((one) => ({ name, prose: one.prose.join(""), cited: one.cited.join("") })),
);

const probeFor = (index: number): string => `probe-${index}.ts`;

const treeOf = (sentences: readonly string[]): Tree =>
  Object.fromEntries(sentences.map((prose, index) => [probeFor(index), commenting(prose)]));

const citedTree = treeOf(citedSentences.map((one) => one.prose));

const commentGate = oxlintOver(
  pluginConfigFor({ "better-answers/comment-only-the-why": "error" }),
  {
    tree: citedTree,
    flagged: citedSentences.map((_sentence, index) => probeFor(index)),
  },
);

const lineFor = (file: string, said: string): string =>
  said.split("\n").find((line) => line.startsWith(`${file}:`)) ?? "";

describe("citation, the agreement about what a citation looks like", () => {
  it("refuses every sentence the fixture says cites, quoting back the text the fixture names", () => {
    const said = commentGate.output(citedTree);

    expect(
      citedSentences.map(({ name, prose, cited }, index) => ({
        prose,
        names: lineFor(probeFor(index), said).includes(`cites ${name} (\`${cited}\`)`),
      })),
    ).toEqual(citedSentences.map(({ prose }) => ({ prose, names: true })));
  });

  it("walks past every sentence the fixture says cites nothing, so the gate holds no pattern of its own", () => {
    const clean = readCitation().cites_nothing;

    expect({ clean, flagged: commentGate.flagged(treeOf(clean)) }).toEqual({ clean, flagged: [] });
  });
});
