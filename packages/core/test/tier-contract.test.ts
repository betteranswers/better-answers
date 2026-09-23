import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintOver, writeUnder } from "@better-answers/devtools/throwaway-tree";
import {
  boundarySchemas,
  CONTRACT_DIGEST,
  contractDigest,
  ULID_PATTERN,
} from "@better-answers/schema";

import { ulid } from "../src/kernel/index.ts";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

// Hardcoded on purpose, never read from a shared constant: that is what fails a tier not yet
// taught a contract change.
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
} as const;

const NOT_FIXTURES = new Set(["manifest.json", "README.md"]);

const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");

const manifest = z.object({
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
const digestRoots = mkdtempSync(path.join(tmpdir(), "tier-contract-digest-"));

afterAll(() => {
  rmSync(throwaway, { recursive: true, force: true });
  rmSync(brokenRoot, { recursive: true, force: true });
  rmSync(digestRoots, { recursive: true, force: true });
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
  writeUnder(root, "manifest.json", JSON.stringify(brokenContracts));
};

describe("the tier contract", () => {
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

// Each hex below is worked out of band from the framing, never by calling this tier's own
// reading a second time.
const DIGEST_CASES = [
  { why: "the manifest alone", tree: { "manifest.json": "{}" } },
  { why: "a nested directory", tree: { "manifest.json": "{}", "deep/under/cases.json": "[1]" } },
  {
    why: "a file with no trailing newline",
    tree: { "manifest.json": "{}", "id-shape/cases.json": "no newline here" },
  },
  {
    why: "a file holding CRLF bytes",
    tree: { "manifest.json": "{}", "queue/cases.json": "one\r\ntwo\r\n" },
  },
  {
    why: "an astral character in a filename and in content",
    tree: { "manifest.json": "{}", "🚀/🛰.json": "🌍" },
  },
  { why: "an empty file", tree: { "manifest.json": "{}", "redaction/cases.json": "" } },
  {
    why: "a dotfile that must not count",
    tree: {
      "manifest.json": "{}",
      ".DS_Store": "junk",
      ".cache/cases.json": "junk",
      "citation/.hidden": "junk",
    },
  },
  {
    why: "a README that must not count",
    tree: { "manifest.json": "{}", "README.md": "prose for a person" },
  },
] as const satisfies readonly { readonly why: string; readonly tree: Tree }[];

const EXPECTED_HEX: Record<string, string> = {
  "the manifest alone": "672dd81724a921629ec57079d240c5d4240d85207c5c577acc3d938a1da9a4b2",
  "a nested directory": "1310b1d47249afd06d6da598edb9e740822903427cea944583bcd09cdad30f4b",
  "a file with no trailing newline":
    "c61774dee59597de850816f074c5b3898df77407b81f994c8f532db6ccdf9b01",
  "a file holding CRLF bytes": "d46eb55502392e4b377c93fc25bd904e84c3d3c1222ce84db61209ff9b3c229f",
  "an astral character in a filename and in content":
    "157a522841253276bd185d632b885a7193389d3181826ac45bd0611acba19457",
  "an empty file": "d86176b333d785144bf5abef1f09c05550d49e57602b9965c15b9c919b4e38c3",
  "a dotfile that must not count":
    "672dd81724a921629ec57079d240c5d4240d85207c5c577acc3d938a1da9a4b2",
  "a README that must not count":
    "672dd81724a921629ec57079d240c5d4240d85207c5c577acc3d938a1da9a4b2",
};

const materialised = (index: number, tree: Tree): string => {
  const root = path.join(digestRoots, String(index));
  mkdirSync(root, { recursive: true });
  for (const [file, content] of Object.entries(tree)) writeUnder(root, file, content);
  return root;
};

describe("the contract's digest, which is this tier's version of the contract", () => {
  it("answers the hex the framing says over every tree the cases name", () => {
    expect(
      DIGEST_CASES.map(({ why, tree }, index) => ({
        why,
        hex: contractDigest(materialised(index, tree)),
      })),
    ).toEqual(DIGEST_CASES.map(({ why }) => ({ why, hex: EXPECTED_HEX[why] })));
  });

  it("counts a symlink for nothing, so neither tier reads one file as two", () => {
    const root = materialised(DIGEST_CASES.length, { "manifest.json": "{}" });
    mkdirSync(path.join(root, "queue"));
    symlinkSync(path.join(root, "manifest.json"), path.join(root, "queue", "cases.json"));

    expect(contractDigest(root)).toBe(EXPECTED_HEX["the manifest alone"]);
  });

  it("carries the whole hash, so nothing an operator compares by eye is a short form", () => {
    expect(CONTRACT_DIGEST).toMatch(/^[0-9a-f]{64}$/);
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
