import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  mergeShards,
  mutateSet,
  mutationShardsFromArgv,
  shardSlices,
} from "@better-answers/devtools/mutation-shards";
import type { Leg, ShardResults } from "@better-answers/devtools/mutation-shards";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { runStryker, strykerWorkspace } from "./stryker-workspace.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "mutation-shards-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const treeOf = (name: string, files: Readonly<Record<string, number>>): string => {
  const root = path.join(scratch, name);
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "x".repeat(bytes));
  }
  return root;
};

const PATTERNS = ["src/**/*.ts", "!src/main.ts"];

describe("a leg's mutate set, cut into shards", () => {
  const root = treeOf("cut", {
    "src/main.ts": 900,
    "src/access/index.ts": 700,
    "src/access/vocabulary.ts": 500,
    "src/kernel/parse.ts": 400,
    "src/kernel/.draft.ts": 800,
    "src/.hidden/secret.ts": 800,
    "src/audit/index.ts": 300,
    "src/audit/README.md": 1000,
    "src/kernel/legacy.ts/index.ts": 100,
    "test/audit.test.ts": 600,
  });

  it("reads the patterns in order, a `!` taking back what an earlier one chose, and chooses files alone, never a hidden one", () => {
    expect(mutateSet(root, PATTERNS)).toEqual([
      "src/access/index.ts",
      "src/access/vocabulary.ts",
      "src/audit/index.ts",
      "src/kernel/legacy.ts/index.ts",
      "src/kernel/parse.ts",
    ]);
    expect(mutateSet(root, [...PATTERNS, "src/main.ts"])).toContain("src/main.ts");
  });

  it("cuts disjoint slices that together are the set, each file onto the lightest shard, the biggest first", () => {
    expect(shardSlices(root, mutateSet(root, PATTERNS), 2)).toEqual([
      ["src/access/index.ts", "src/audit/index.ts"],
      ["src/access/vocabulary.ts", "src/kernel/legacy.ts/index.ts", "src/kernel/parse.ts"],
    ]);
    expect(shardSlices(root, mutateSet(root, PATTERNS), 3)).toEqual([
      ["src/access/index.ts"],
      ["src/access/vocabulary.ts", "src/kernel/legacy.ts/index.ts"],
      ["src/audit/index.ts", "src/kernel/parse.ts"],
    ]);
  });

  it("keeps files of one size in path order, so every job cuts the same slices", () => {
    const tied = treeOf("tied", {
      "src/a.ts": 100,
      "src/b.ts": 100,
      "src/c.ts": 100,
      "src/d.ts": 100,
    });

    expect(shardSlices(tied, mutateSet(tied, ["src/**/*.ts"]), 2)).toEqual([
      ["src/a.ts", "src/c.ts"],
      ["src/b.ts", "src/d.ts"],
    ]);
  });

  it("keeps the slices disjoint and whole as files are added and removed", () => {
    const grown = treeOf("grown", {
      "src/a.ts": 120,
      "src/b.ts": 80,
      "src/c/d.ts": 300,
      "src/c/e.ts": 40,
      "src/f.ts": 220,
    });
    const holds = (of: number): void => {
      const set = mutateSet(grown, ["src/**/*.ts"]);
      const slices = shardSlices(grown, set, of);
      const flat = slices.flat();

      expect(slices.every((slice) => slice.length > 0)).toBe(true);
      expect(new Set(flat).size).toBe(flat.length);
      expect(flat.toSorted()).toEqual(set);
    };

    for (const of of [1, 2, 3, 4]) holds(of);
    writeFileSync(path.join(grown, "src/c/g.ts"), "x".repeat(500));
    for (const of of [1, 2, 3, 4, 5]) holds(of);
    unlinkSync(path.join(grown, "src/f.ts"));
    unlinkSync(path.join(grown, "src/a.ts"));
    for (const of of [1, 2, 3, 4]) holds(of);
  });

  it("refuses more shards than files, since a shard with nothing to mutate cannot run", () => {
    expect(shardSlices(root, mutateSet(root, PATTERNS), 5)).toHaveLength(5);
    expect(() => shardSlices(root, mutateSet(root, PATTERNS), 6)).toThrow(
      new Error("a leg of 5 files cannot be cut into 6 shards: each needs a file to mutate"),
    );
  });
});

type Test = { readonly id: string; readonly name: string; readonly line?: number };

type Results = NonNullable<ShardResults["checkpoint"]>;
type Found = Results["files"][string]["mutants"][number];

// A test with no line is one the runner could not place, as Stryker writes it with no location.
const tests = (file: string, ...found: readonly Test[]): NonNullable<Results["testFiles"]> => ({
  [file]: {
    source: "describe()",
    tests: found.map(({ id, name, line }) =>
      line === undefined ? { id, name } : { id, name, location: { start: { line, column: 3 } } },
    ),
  },
});

const results = (
  files: Readonly<Record<string, readonly Found[]>>,
  testFiles: Results["testFiles"],
): Results => ({
  schemaVersion: "1.0",
  thresholds: { high: 80, low: 60 },
  config: { mutate: ["src/a.ts"] },
  files: Object.fromEntries(
    Object.entries(files).map(([file, mutants]) => [
      file,
      { language: "typescript", source: `// ${file}`, mutants: [...mutants] },
    ]),
  ),
  testFiles,
});

const killed = (id: string, by: string, covered: readonly string[]): Found => ({
  id,
  mutatorName: "StringLiteral",
  status: "Killed",
  killedBy: [by],
  coveredBy: [...covered],
});

const survived = (id: string, covered: readonly string[]): Found => ({
  id,
  mutatorName: "BooleanLiteral",
  status: "Survived",
  coveredBy: [...covered],
});

const A_TEST = { name: "answers > a", line: 4 };
const B_TEST = { name: "answers > b", line: 9 };
const C_TEST = { name: "answers > c" };
const GONE_TEST = { name: "answers > gone", line: 20 };

// Two dry runs may number the tests differently; a mutant naming a test its shard never listed
// names none.
const SHARD_ONE = results(
  {
    "src/a.ts": [killed("1", "0", ["0", "1", "9"])],
    "src/b.ts": [survived("2", ["1", "2"])],
  },
  tests(
    "test/answer.test.ts",
    { id: "0", ...A_TEST },
    { id: "1", ...B_TEST },
    { id: "2", ...C_TEST },
  ),
);
const SHARD_TWO = results(
  {
    "src/a.ts": [survived("1", ["1"])],
    "src/b.ts": [killed("2", "0", ["0"])],
    "src/c.ts": [killed("3", "2", ["1", "2"])],
  },
  tests(
    "test/answer.test.ts",
    { id: "0", ...B_TEST },
    { id: "1", ...A_TEST },
    { id: "2", ...C_TEST },
  ),
);
// The previous run held a test this run no longer has.
const PREVIOUS = results(
  {
    "src/a.ts": [survived("1", ["5"])],
    "src/b.ts": [survived("2", ["5", "6"])],
    "src/c.ts": [survived("3", ["5"])],
    "src/gone.ts": [survived("4", ["5"])],
  },
  tests("test/answer.test.ts", { id: "5", ...A_TEST }, { id: "6", ...GONE_TEST }),
);

const MERGED_TESTS = tests(
  "test/answer.test.ts",
  { id: "0", ...A_TEST },
  { id: "1", ...B_TEST },
  { id: "2", ...C_TEST },
);

const OWNERS = new Map([
  ["src/a.ts", 1],
  ["src/b.ts", 2],
  ["src/c.ts", 2],
]);

const left = (
  report: Results | undefined,
  checkpoint: Results | undefined = report,
): ShardResults => ({ report, checkpoint });

const merge = (
  shards: ReadonlyMap<number, ShardResults>,
  baseline: Results | undefined = PREVIOUS,
) => mergeShards({ leg: "core", files: OWNERS, of: 2, shards, baseline });

const entry = (file: string, ...mutants: readonly Found[]) => ({
  language: "typescript",
  source: `// ${file}`,
  mutants,
});

describe("a leg's results, merged from its shards", () => {
  it("takes each file from the shard that owned it, each mutant naming the tests it named in that shard", () => {
    const merged = merge(
      new Map([
        [1, left(SHARD_ONE)],
        [2, left(SHARD_TWO)],
      ]),
    );

    expect(merged.checkpoint).toEqual({
      schemaVersion: "1.0",
      thresholds: { high: 80, low: 60 },
      files: {
        "src/a.ts": entry("src/a.ts", killed("1", "0", ["0", "1"])),
        "src/b.ts": entry("src/b.ts", killed("2", "1", ["1"])),
        "src/c.ts": entry("src/c.ts", killed("3", "2", ["0", "2"])),
      },
      testFiles: MERGED_TESTS,
    });
    expect(merged.report).toEqual(merged.checkpoint);
    expect(merged.summary).toBe("### core shards: 2 of 2 finished\n");
  });

  it("keeps a stopped shard's checkpoint and leaves out what it never reached, writing no report", () => {
    const stopped = results(
      { "src/b.ts": [killed("2", "0", ["0"])] },
      tests("test/answer.test.ts", { id: "0", ...B_TEST }, { id: "1", ...A_TEST }),
    );
    const merged = merge(
      new Map([
        [1, left(undefined, SHARD_ONE)],
        [2, left(undefined, stopped)],
      ]),
    );

    expect(merged.checkpoint?.files).toEqual({
      "src/a.ts": entry("src/a.ts", killed("1", "0", ["0", "1"])),
      "src/b.ts": entry("src/b.ts", killed("2", "1", ["1"])),
    });
    expect(merged.report).toBeUndefined();
    expect(merged.summary).toBe(
      "### core shards: 0 of 2 finished\n- stopped before writing a report, what they had not tested waiting for the next run: 1, 2\n",
    );
  });

  it("gives a shard that left nothing the previous run's results for its files, and drops a file the leg no longer has", () => {
    const merged = merge(new Map([[1, left(SHARD_ONE)]]));

    expect(merged.checkpoint?.files).toEqual({
      "src/a.ts": entry("src/a.ts", killed("1", "0", ["0", "1"])),
      "src/b.ts": entry("src/b.ts", survived("2", ["0", "3"])),
      "src/c.ts": entry("src/c.ts", survived("3", ["0"])),
    });
    expect(merged.report).toBeUndefined();
    expect(merged.summary).toBe(
      "### core shards: 1 of 2 finished\n- left no results, their files keeping the previous run's: 2\n",
    );
  });

  it("takes a test file's source from this run's shards, not the previous run's, where both hold it", () => {
    const older = results(
      { "src/b.ts": [survived("2", ["5"])], "src/c.ts": [survived("3", ["5"])] },
      { "test/answer.test.ts": { source: "describe() as it was", tests: [] } },
    );
    const merged = merge(new Map([[2, left(SHARD_TWO)]]), older);

    expect(merged.checkpoint?.testFiles?.["test/answer.test.ts"]?.["source"]).toBe("describe()");
  });

  it("keeps the whole previous run's results for the leg's files when no shard left anything", () => {
    const merged = merge(new Map());

    expect(merged.checkpoint).toEqual({
      schemaVersion: "1.0",
      thresholds: { high: 80, low: 60 },
      files: {
        "src/a.ts": entry("src/a.ts", survived("1", ["0"])),
        "src/b.ts": entry("src/b.ts", survived("2", ["0", "1"])),
        "src/c.ts": entry("src/c.ts", survived("3", ["0"])),
      },
      testFiles: tests("test/answer.test.ts", { id: "0", ...A_TEST }, { id: "1", ...GONE_TEST }),
    });
    expect(merged.report).toBeUndefined();
  });

  it("leaves nothing to write when no shard and no previous run left anything", () => {
    const merged = mergeShards({
      leg: "core",
      files: OWNERS,
      of: 2,
      shards: new Map(),
      baseline: undefined,
    });

    expect(merged.checkpoint).toBeUndefined();
    expect(merged.report).toBeUndefined();
    expect(merged.summary).toBe(
      "### core shards: 0 of 2 finished\n- left no results, their files keeping the previous run's: 1, 2\n",
    );
  });
});

const legs = (root: string): ReadonlyMap<string, Leg> =>
  new Map([["core", { root, mutate: PATTERNS }]]);

const USAGE = [
  "usage: mutation-shards slice --leg <name> --shard <n> --of <count>",
  "       mutation-shards merge --leg <name> --of <count> --shards <directory> --baseline <path> --out <directory>",
].join("\n");

let downloads = 0;

const downloaded = (files: Readonly<Record<string, string>>): string => {
  downloads += 1;
  const directory = path.join(scratch, `downloaded-${String(downloads)}`);
  mkdirSync(directory, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(directory, name), text);
  return directory;
};

const writtenTo = (
  out: string,
): { readonly files: readonly string[]; readonly report: boolean } => ({
  files: existsSync(path.join(out, "stryker-incremental.json"))
    ? Object.keys(
        JSON.parse(readFileSync(path.join(out, "stryker-incremental.json"), "utf8")).files,
      )
    : [],
  report: existsSync(path.join(out, "mutation.json")),
});

describe("the shards command", () => {
  const root = treeOf("command", {
    "src/a.ts": 300,
    "src/b.ts": 100,
    "src/c.ts": 200,
    "src/main.ts": 900,
  });
  const merging = (
    shards: string,
    out: string,
    baseline = path.join(scratch, "no-previous-run.json"),
  ): string =>
    mutationShardsFromArgv(
      [
        "merge",
        "--leg",
        "core",
        "--of",
        "2",
        "--shards",
        shards,
        "--baseline",
        baseline,
        "--out",
        out,
      ],
      legs(root),
    );

  it("prints a shard's slice as the list `stryker run --mutate` takes", () => {
    expect(
      mutationShardsFromArgv(["slice", "--leg", "core", "--shard", "1", "--of", "2"], legs(root)),
    ).toBe("src/a.ts");
    expect(
      mutationShardsFromArgv(["slice", "--leg", "core", "--of", "2", "--shard", "2"], legs(root)),
    ).toBe("src/b.ts,src/c.ts");
  });

  it("merges the shards' files into the leg's checkpoint, and writes no report while a shard is missing", () => {
    const out = path.join(scratch, "merged-one", "deep");
    const summary = merging(
      downloaded({
        "1.checkpoint.json": JSON.stringify(SHARD_ONE),
        "1.report.json": JSON.stringify(SHARD_ONE),
        "2.checkpoint.json": '{"files": {',
      }),
      out,
    );

    expect(summary).toBe(
      "### core shards: 1 of 2 finished\n- left no results, their files keeping the previous run's: 2\n",
    );
    expect(writtenTo(out)).toEqual({ files: ["src/a.ts"], report: false });
  });

  it("reads a stopped shard's checkpoint, and fills a shard that left nothing from the baseline it is given", () => {
    const out = path.join(scratch, "merged-two");
    const baseline = path.join(scratch, "previous.json");
    writeFileSync(baseline, JSON.stringify(PREVIOUS));

    const summary = merging(
      downloaded({ "1.checkpoint.json": JSON.stringify(SHARD_ONE) }),
      out,
      baseline,
    );

    expect(summary).toBe(
      "### core shards: 0 of 2 finished\n- stopped before writing a report, what they had not tested waiting for the next run: 1\n- left no results, their files keeping the previous run's: 2\n",
    );
    expect(writtenTo(out)).toEqual({ files: ["src/a.ts", "src/b.ts", "src/c.ts"], report: false });
  });

  it("writes the report beside the checkpoint once every shard finished", () => {
    const out = path.join(scratch, "merged-three");
    merging(
      downloaded({
        "1.report.json": JSON.stringify(SHARD_ONE),
        "2.report.json": JSON.stringify(SHARD_TWO),
      }),
      out,
    );

    expect(writtenTo(out)).toEqual({ files: ["src/a.ts", "src/b.ts", "src/c.ts"], report: true });
  });

  it("writes nothing, and says so, when no shard and no previous run left anything", () => {
    const out = path.join(scratch, "merged-four");

    expect(merging(downloaded({}), out)).toBe(
      "### core shards: 0 of 2 finished\n- left no results, their files keeping the previous run's: 1, 2\n",
    );
    expect(writtenTo(out)).toEqual({ files: [], report: false });
  });

  it.each([
    { what: "no files", text: '{"schemaVersion": "1.0"}' },
    { what: "a file without mutants", text: '{"files": {"src/b.ts": {"source": ""}}}' },
    {
      what: "a mutant naming its tests other than in a list",
      text: '{"files": {"src/b.ts": {"mutants": [{"coveredBy": "0"}]}}}',
    },
    { what: "a test file without tests", text: '{"files": {}, "testFiles": {"t.ts": {}}}' },
    {
      what: "a test without an id",
      text: '{"files": {}, "testFiles": {"t.ts": {"tests": [{"name": "a"}]}}}',
    },
    {
      what: "a test placed nowhere",
      text: '{"files": {}, "testFiles": {"t.ts": {"tests": [{"id": "0", "name": "a", "location": {}}]}}}',
    },
    {
      what: "a test placed on no line",
      text: '{"files": {}, "testFiles": {"t.ts": {"tests": [{"id": "0", "name": "a", "location": {"start": {}}}]}}}',
    },
  ])("reads a shard's report holding $what as no report at all", ({ text }) => {
    const summary = merging(
      downloaded({ "1.report.json": JSON.stringify(SHARD_ONE), "2.report.json": text }),
      path.join(scratch, `merged-${String(downloads)}`),
    );

    expect(summary).toBe(
      "### core shards: 1 of 2 finished\n- left no results, their files keeping the previous run's: 2\n",
    );
  });

  it.each([
    { what: "a leg it does not know", argv: ["slice", "--leg", "web"], says: USAGE },
    { what: "a flag without its value", argv: ["slice", "--leg"], says: USAGE },
    {
      what: "a command it does not have",
      argv: [
        "list",
        "--leg",
        "core",
        "--of",
        "2",
        "--shards",
        ".",
        "--baseline",
        ".",
        "--out",
        ".",
      ],
      says: USAGE,
    },
    {
      what: "a merge without the shards",
      argv: ["merge", "--leg", "core", "--of", "2", "--baseline", ".", "--out", "."],
      says: USAGE,
    },
    {
      what: "a merge without the previous run's results",
      argv: ["merge", "--leg", "core", "--of", "2", "--shards", ".", "--out", "."],
      says: USAGE,
    },
    {
      what: "a merge without its output",
      argv: ["merge", "--leg", "core", "--of", "2", "--shards", ".", "--baseline", "."],
      says: USAGE,
    },
    {
      what: "no shards",
      argv: ["slice", "--leg", "core", "--shard", "1", "--of", "0"],
      says: `--of takes a whole number from 1\n${USAGE}`,
    },
    {
      what: "part of a shard",
      argv: ["slice", "--leg", "core", "--shard", "1", "--of", "1.5"],
      says: `--of takes a whole number from 1\n${USAGE}`,
    },
    {
      what: "a count that is not a number",
      argv: ["slice", "--leg", "core", "--shard", "1", "--of", "two"],
      says: `--of takes a whole number from 1\n${USAGE}`,
    },
    {
      what: "shard nought",
      argv: ["slice", "--leg", "core", "--shard", "0", "--of", "2"],
      says: `--shard takes a whole number from 1\n${USAGE}`,
    },
    {
      what: "a shard past the count",
      argv: ["slice", "--leg", "core", "--shard", "3", "--of", "2"],
      says: "--shard 3 is past --of 2",
    },
  ])("refuses $what, saying what it takes", ({ argv, says }) => {
    expect(() => mutationShardsFromArgv(argv, legs(root))).toThrow(new Error(says));
  });
});

// Padded to a size, since a file's size decides its shard.
const sourceOf = (body: string, bytes: number): string => {
  const padding = bytes - body.length - 4;
  return `${body}// ${"x".repeat(padding)}\n`;
};

const ONE = `export const greet = (name: string): string => (name === "" ? "nobody" : \`hello \${name}\`);\n`;
const TWO = `export const LIMIT = 3;\nexport const within = (count: number): boolean => count <= LIMIT;\n`;
const THREE = `export const double = (value: number): number => value * 2;\n`;
const ZERO = `export const negate = (flag: boolean): boolean => !flag;\n`;
const ENTRY = `export const start = (): string => "started";\n`;

const SUITE = `import { describe, expect, it } from "vitest";

import { greet } from "../src/one.ts";
import { within } from "../src/two.ts";
import { double } from "../src/three.ts";

describe("the throwaway leg", () => {
  it("greets a name, and nobody", () => {
    expect(greet("Ada")).toBe("hello Ada");
    expect(greet("")).toBe("nobody");
  });

  it("counts within the limit", () => {
    expect(within(3)).toBe(true);
  });

  it("doubles", () => {
    expect(double(2)).toBe(4);
  });
});
`;

const ZERO_SUITE = `import { expect, it } from "vitest";

import { negate } from "../src/zero.ts";

it("negates", () => {
  expect(negate(true)).toBe(false);
});
`;

const THROWAWAY_CONFIG = `export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/**/*.ts", "!src/entry.ts"],
  coverageAnalysis: "perTest",
  reporters: ["json"],
  jsonReporter: { fileName: "reports/mutation.json" },
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  tempDirName: ".stryker-tmp",
  concurrency: 1,
  timeoutMS: 30_000,
};
`;

const THROWAWAY_PATTERNS = ["src/**/*.ts", "!src/entry.ts"];

const throwawayLeg = (): string =>
  strykerWorkspace(path.join(scratch, "leg"), {
    "stryker.config.mjs": THROWAWAY_CONFIG,
    "src/one.ts": sourceOf(ONE, 600),
    "src/two.ts": sourceOf(TWO, 400),
    "src/three.ts": sourceOf(THREE, 300),
    "src/entry.ts": ENTRY,
    "test/leg.test.ts": SUITE,
  });

const CARRIED = "carried from the merged results";

const reportMutant = z.looseObject({
  mutatorName: z.string(),
  replacement: z.string().optional(),
  status: z.string(),
  statusReason: z.string().optional(),
  location: z.looseObject({ start: z.looseObject({ line: z.number(), column: z.number() }) }),
});

const reportFile = z.looseObject({
  files: z.record(z.string(), z.looseObject({ mutants: z.array(reportMutant) })),
});

const readReportFile = (file: string) => reportFile.parse(JSON.parse(readFileSync(file, "utf8")));

type Verdict = {
  readonly file: string;
  readonly mutant: string;
  readonly status: string;
};

const verdictsIn = (file: string): readonly Verdict[] =>
  Object.entries(readReportFile(file).files)
    .flatMap(([name, entry]) =>
      entry.mutants.map((found) => ({
        file: name,
        mutant: `${String(found.location.start.line)}:${String(found.location.start.column)} ${found.mutatorName} ${found.replacement ?? ""}`,
        status: found.statusReason === CARRIED ? `${found.status}, carried` : found.status,
      })),
    )
    .toSorted((left, right) =>
      `${left.file} ${left.mutant}` < `${right.file} ${right.mutant}` ? -1 : 1,
    );

describe("a leg run as shards by Stryker, over a throwaway workspace", () => {
  const root = throwawayLeg();
  const leg = new Map([["throwaway", { root, mutate: THROWAWAY_PATTERNS }]]);
  const shards = path.join(scratch, "leg-shards");
  const merged = path.join(scratch, "leg-merged");
  const reports = path.join(root, "reports");
  const slice = (shard: number, of: number): string =>
    mutationShardsFromArgv(
      ["slice", "--leg", "throwaway", "--shard", String(shard), "--of", String(of)],
      leg,
    );
  let whole: readonly Verdict[] = [];

  beforeAll(() => {
    runStryker(root);
    whole = verdictsIn(path.join(reports, "mutation.json"));
    rmSync(reports, { recursive: true, force: true });
    mkdirSync(shards, { recursive: true });
    for (const shard of [1, 2]) {
      runStryker(root, "--mutate", slice(shard, 2));
      renameSync(
        path.join(reports, "mutation.json"),
        path.join(shards, `${String(shard)}.report.json`),
      );
      renameSync(
        path.join(reports, "stryker-incremental.json"),
        path.join(shards, `${String(shard)}.checkpoint.json`),
      );
      rmSync(reports, { recursive: true, force: true });
    }
    mutationShardsFromArgv(
      [
        "merge",
        "--leg",
        "throwaway",
        "--of",
        "2",
        "--shards",
        shards,
        "--baseline",
        path.join(scratch, "no-previous-run.json"),
        "--out",
        merged,
      ],
      leg,
    );
  }, 120_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("tests, as two shards merged, exactly the mutants one whole run tests, with the same verdicts", () => {
    expect(slice(1, 2)).toBe("src/one.ts");
    expect(slice(2, 2)).toBe("src/three.ts,src/two.ts");
    expect(whole.map((verdict) => verdict.file)).toContain("src/one.ts");
    expect(whole.map((verdict) => verdict.file)).not.toContain("src/entry.ts");
    expect(verdictsIn(path.join(merged, "mutation.json"))).toEqual(whole);
  });

  it("reuses a file's results when a new file moves it to another shard, since each shard starts from the whole leg's", () => {
    const results = readReportFile(path.join(merged, "stryker-incremental.json"));
    const one = results.files["src/one.ts"];
    if (one === undefined) throw new Error("the merged results hold nothing for src/one.ts");
    const marked = {
      ...results,
      files: {
        ...results.files,
        "src/one.ts": {
          ...one,
          mutants: one.mutants.map((found) => ({ ...found, statusReason: CARRIED })),
        },
      },
    };
    mkdirSync(reports, { recursive: true });
    writeFileSync(path.join(reports, "stryker-incremental.json"), JSON.stringify(marked));
    writeFileSync(path.join(root, "src/zero.ts"), sourceOf(ZERO, 1000));
    writeFileSync(path.join(root, "test/zero.test.ts"), ZERO_SUITE);

    expect(slice(2, 2)).toBe("src/one.ts,src/two.ts");
    runStryker(root, "--mutate", slice(2, 2));

    const moved = verdictsIn(path.join(reports, "mutation.json")).filter(
      (verdict) => verdict.file === "src/one.ts",
    );
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((verdict) => verdict.status.endsWith(", carried"))).toBe(true);
  });
});
