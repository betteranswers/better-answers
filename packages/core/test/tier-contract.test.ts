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
import { oxlintOver, writeUnder } from "@better-answers/devtools/throwaway-tree";
import { boundarySchemas, ULID_PATTERN } from "@better-answers/schema";

import { ulid } from "../src/kernel/index.ts";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

// Version and agreements hardcoded on purpose, never read from a shared constant: that is
// what fails a tier not yet taught a contract change.
const SPOKEN_CONTRACT_VERSION = 12;
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

const readManifest = (directory = contractsDir) =>
  manifest.parse(JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")));

const fixturesOnDisk = (directory: string): readonly string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .filter((relative) => !relative.split(path.sep).some((segment) => segment.startsWith(".")))
    .filter((relative) => !NOT_FIXTURES.has(relative))
    .toSorted();

const directoriesIn = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);

const filesUnder = (root: string, agreement: string): readonly string[] => {
  const directory = path.join(root, agreement);
  return existsSync(directory) ? fixturesOnDisk(directory) : [];
};

const formFailures = (contract: z.infer<typeof manifest>, root: string): readonly string[] => {
  const failures: string[] = [];

  for (const [agreement, { form }] of Object.entries(contract.agreements)) {
    const listed = contract.fixtures.filter((fixture) => fixture.agreement === agreement);

    if (form === "fixtured") {
      if (listed.length === 0)
        failures.push(`${agreement} declares fixtured and the manifest lists no fixture under it`);
      for (const fixture of listed)
        if (!fixture.path.startsWith(`${agreement}/`))
          failures.push(
            `${agreement} declares fixtured and lists ${fixture.path}, which is not under ${agreement}/`,
          );
        else if (!existsSync(path.join(root, fixture.path)))
          failures.push(
            `${agreement} declares fixtured and lists ${fixture.path}, which is not on disk`,
          );
    } else if (form === "generated") {
      if (filesUnder(root, agreement).length === 0)
        failures.push(`${agreement} declares generated and has no golden rows on disk`);
    } else if (form !== "sql-function") {
      failures.push(`${agreement} declares ${form}, a form this check does not know`);
    }
  }

  for (const directory of directoriesIn(root))
    if (contract.agreements[directory] === undefined)
      failures.push(`${directory} is a directory under contracts/ that no agreement claims`);

  return failures.toSorted();
};

const throwaway = mkdtempSync(path.join(tmpdir(), "tier-contract-"));
const brokenRoot = mkdtempSync(path.join(tmpdir(), "tier-contract-broken-"));

afterAll(() => {
  rmSync(throwaway, { recursive: true, force: true });
  rmSync(brokenRoot, { recursive: true, force: true });
});

const brokenContracts = {
  agreements: {
    shape: { form: "fixtured" },
    "empty-handed": { form: "fixtured" },
    "missing-file": { form: "fixtured" },
    astray: { form: "fixtured" },
    ledger: { form: "generated" },
    rows: { form: "generated" },
    routing: { form: "sql-function" },
    hearsay: { form: "spoken" },
  },
  fixtures: [
    { agreement: "shape", path: "shape/cases.json" },
    { agreement: "missing-file", path: "missing-file/cases.json" },
    { agreement: "astray", path: "shape/cases.json" },
    { agreement: "rows", path: "rows/rows.json" },
  ],
} as const;

const LISTED_BUT_ABSENT = "missing-file/cases.json";
const ON_DISK_BUT_UNLISTED = ["routing/cases.json", "orphan/cases.json"];

const materialiseBrokenContracts = (root: string) => {
  for (const { path: listed } of brokenContracts.fixtures)
    if (listed !== LISTED_BUT_ABSENT) writeUnder(root, listed, "{}");
  for (const unlisted of ON_DISK_BUT_UNLISTED) writeUnder(root, unlisted, "{}");
  writeUnder(root, "manifest.json", JSON.stringify({ contract_version: 1, ...brokenContracts }));
};

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

  it("finds the disk answering every form the manifest declares, and claiming every directory", () => {
    expect(formFailures(readManifest(), contractsDir)).toEqual([]);
  });

  it("names the agreement and the form it declared for each entry the disk does not answer", () => {
    materialiseBrokenContracts(brokenRoot);

    expect(formFailures(readManifest(brokenRoot), brokenRoot)).toEqual([
      "astray declares fixtured and lists shape/cases.json, which is not under astray/",
      "empty-handed declares fixtured and the manifest lists no fixture under it",
      "hearsay declares spoken, a form this check does not know",
      "ledger declares generated and has no golden rows on disk",
      "missing-file declares fixtured and lists missing-file/cases.json, which is not on disk",
      "orphan is a directory under contracts/ that no agreement claims",
    ]);
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
