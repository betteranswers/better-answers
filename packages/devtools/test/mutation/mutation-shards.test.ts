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

import { afterAll, assert, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  mergeShards,
  mutateSet,
  mutationShardsFromArgv,
  piecesOf,
  shardSlices,
  weightsOf,
} from "@better-answers/devtools/mutation-shards";
import type { Leg, ShardResults } from "@better-answers/devtools/mutation-shards";

import { runStryker, strykerWorkspace, writtenTree } from "../support/stryker-workspace.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "mutation-shards-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const NO_PREVIOUS_RUN = path.join(scratch, "no-previous-run.json");

const sliceOf = (
  legs: ReadonlyMap<string, Leg>,
  shard: number | string,
  of: number | string,
  baseline = NO_PREVIOUS_RUN,
): Promise<string> => {
  const [name = ""] = legs.keys();
  return mutationShardsFromArgv(
    ["slice", "--leg", name, "--shard", String(shard), "--of", String(of), "--baseline", baseline],
    legs,
  );
};

const sourcesIn = (name: string, files: Readonly<Record<string, string>>): string =>
  writtenTree(path.join(scratch, name), files);

const treeOf = (name: string, files: Readonly<Record<string, number>>): string =>
  sourcesIn(
    name,
    Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, "x".repeat(bytes)])),
  );

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

  it("reads patterns in order, applies `!` exclusions, skips hidden files", () => {
    expect(mutateSet(root, PATTERNS)).toEqual([
      "src/access/index.ts",
      "src/access/vocabulary.ts",
      "src/audit/index.ts",
      "src/kernel/legacy.ts/index.ts",
      "src/kernel/parse.ts",
    ]);
    expect(mutateSet(root, [...PATTERNS, "src/main.ts"])).toContain("src/main.ts");
  });

  it("assigns files biggest first, each to the lightest shard", () => {
    expect(shardSlices(weightsOf(root, mutateSet(root, PATTERNS), undefined), 2)).toEqual([
      ["src/access/index.ts", "src/audit/index.ts"],
      ["src/access/vocabulary.ts", "src/kernel/legacy.ts/index.ts", "src/kernel/parse.ts"],
    ]);
    expect(shardSlices(weightsOf(root, mutateSet(root, PATTERNS), undefined), 3)).toEqual([
      ["src/access/index.ts"],
      ["src/access/vocabulary.ts", "src/kernel/legacy.ts/index.ts"],
      ["src/audit/index.ts", "src/kernel/parse.ts"],
    ]);
  });

  it("keeps files of one size in path order", () => {
    const tied = treeOf("tied", {
      "src/a.ts": 100,
      "src/b.ts": 100,
      "src/c.ts": 100,
      "src/d.ts": 100,
    });

    expect(shardSlices(weightsOf(tied, mutateSet(tied, ["src/**/*.ts"]), undefined), 2)).toEqual([
      ["src/a.ts", "src/c.ts"],
      ["src/b.ts", "src/d.ts"],
    ]);
  });

  it("keeps slices disjoint and complete as files change", () => {
    const grown = treeOf("grown", {
      "src/a.ts": 120,
      "src/b.ts": 80,
      "src/c/d.ts": 300,
      "src/c/e.ts": 40,
      "src/f.ts": 220,
    });
    const holds = (of: number): void => {
      const set = mutateSet(grown, ["src/**/*.ts"]);
      const slices = shardSlices(weightsOf(grown, set, undefined), of);
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

  it("refuses more shards than files", () => {
    expect(shardSlices(weightsOf(root, mutateSet(root, PATTERNS), undefined), 5)).toHaveLength(5);
    expect(() => shardSlices(weightsOf(root, mutateSet(root, PATTERNS), undefined), 6)).toThrow(
      new Error(
        "the leg has 5 files, so it cannot be split into 6 shards, because each shard needs at least one file. Set --of to 5 or fewer.",
      ),
    );
  });
});

type Test = { readonly id: string; readonly name: string; readonly line?: number };

type Results = NonNullable<ShardResults["checkpoint"]>;
type Found = Results["files"][string]["mutants"][number];

/** A test with no line is one the runner could not place, as Stryker writes it with no location. */
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
const PREVIOUS_WITH_A_GONE_TEST = results(
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
  ["src/a.ts", [{ shard: 1 }]],
  ["src/b.ts", [{ shard: 2 }]],
  ["src/c.ts", [{ shard: 2 }]],
]);

const left = (
  report: Results | undefined,
  checkpoint: Results | undefined = report,
): ShardResults => ({ report, checkpoint });

const merge = (
  shards: ReadonlyMap<number, ShardResults>,
  baseline: Results | undefined = PREVIOUS_WITH_A_GONE_TEST,
) => mergeShards({ leg: "core", files: OWNERS, of: 2, shards, baseline });

const entry = (file: string, ...mutants: readonly Found[]) => ({
  language: "typescript",
  source: `// ${file}`,
  mutants,
});

describe("a leg's results, merged from its shards", () => {
  it("takes each file from its shard, renumbering the tests", () => {
    const merged = merge(
      new Map([
        [1, left(SHARD_ONE)],
        [2, left(SHARD_TWO)],
      ]),
    );

    expect(
      merged.checkpoint,
      "the merge did not renumber the tests. Two dry runs can number tests differently, and test 9, which shard one never listed, matches no test.",
    ).toEqual({
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

  it("keeps same-titled tests apart by file and line", () => {
    const TWIN = { ...A_TEST, line: 12 };
    const one = results(
      { "src/a.ts": [killed("1", "1", ["1", "2"])] },
      {
        ...tests("test/answer.test.ts", { id: "0", ...A_TEST }, { id: "1", ...TWIN }),
        ...tests("test/other.test.ts", { id: "2", ...A_TEST }),
      },
    );
    const two = results(
      { "src/b.ts": [killed("2", "0", ["0"])], "src/c.ts": [killed("3", "2", ["1", "2"])] },
      {
        ...tests("test/other.test.ts", { id: "0", ...A_TEST }),
        ...tests("test/answer.test.ts", { id: "1", ...A_TEST }, { id: "2", ...TWIN }),
      },
    );
    const merged = merge(
      new Map([
        [1, left(one)],
        [2, left(two)],
      ]),
    );

    expect(
      merged.checkpoint?.testFiles,
      "the merge joined two tests with the same title. Key each test by file, line and title.",
    ).toEqual(one.testFiles);
    expect(
      merged.checkpoint?.files,
      "the merge matched tests by something other than file, line and title. Stryker matches a test between runs by all three.",
    ).toEqual({
      "src/a.ts": entry("src/a.ts", killed("1", "1", ["1", "2"])),
      "src/b.ts": entry("src/b.ts", killed("2", "2", ["2"])),
      "src/c.ts": entry("src/c.ts", killed("3", "1", ["0", "1"])),
    });
  });

  it("keeps a stopped shard's checkpoint, minus files it never reached", () => {
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
      "### core shards: 0 of 2 finished\n- shards that stopped before writing a report, so the next run tests the mutants they did not reach: 1, 2\n",
    );
  });

  it("fills an empty shard from last run, minus deleted files", () => {
    const merged = merge(new Map([[1, left(SHARD_ONE)]]));

    expect(merged.checkpoint?.files).toEqual({
      "src/a.ts": entry("src/a.ts", killed("1", "0", ["0", "1"])),
      "src/b.ts": entry("src/b.ts", survived("2", ["0", "3"])),
      "src/c.ts": entry("src/c.ts", survived("3", ["0"])),
    });
    expect(merged.report).toBeUndefined();
    expect(merged.summary).toBe(
      "### core shards: 1 of 2 finished\n- shards that left no results, so their files keep the previous run's results: 2\n",
    );
  });

  it("takes a test file's source from this run's shards", () => {
    const older = results(
      { "src/b.ts": [survived("2", ["5"])], "src/c.ts": [survived("3", ["5"])] },
      { "test/answer.test.ts": { source: "describe() as it was", tests: [] } },
    );
    const merged = merge(new Map([[2, left(SHARD_TWO)]]), older);

    expect(merged.checkpoint?.testFiles?.["test/answer.test.ts"]?.["source"]).toBe("describe()");
  });

  it("keeps the previous run's results when no shard wrote any", () => {
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

  describe("for a cut file held whole by each shard", () => {
    const at = (line: number, status: string): Found => ({
      id: String(line),
      mutatorName: "StringLiteral",
      status,
      location: { start: { line, column: 3 }, end: { line: line + 1, column: 1 } },
    });
    const PIECES = new Map([
      [
        "src/cut.ts",
        [
          { shard: 1, lines: { from: 1, to: 4 } },
          { shard: 2, lines: { from: 5, to: 9 } },
        ],
      ],
    ]);
    const cut = (shards: ReadonlyMap<number, ShardResults>) =>
      mergeShards({
        leg: "core",
        files: PIECES,
        of: 2,
        shards,
        baseline: results({ "src/cut.ts": [at(4, "Timeout"), at(5, "Timeout")] }, {}),
      });

    it("takes each mutant from the piece containing its first line", () => {
      const nowhere: Found = { id: "nowhere", mutatorName: "StringLiteral", status: "Killed" };
      const merged = cut(
        new Map([
          [1, left(results({ "src/cut.ts": [at(4, "Killed"), at(5, "Survived"), nowhere] }, {}))],
          [2, left(results({ "src/cut.ts": [at(4, "Survived"), at(5, "Killed")] }, {}))],
        ]),
      );

      expect(
        merged.checkpoint?.files["src/cut.ts"]?.mutants,
        "the merge took a mutant from the wrong piece. Each shard tests its own piece and copies the other pieces from the results it started with.",
      ).toEqual([at(4, "Killed"), at(5, "Killed")]);
    });

    it("fills empty pieces from a sibling shard, not last run", () => {
      const sibling = left(results({ "src/cut.ts": [at(4, "Survived"), at(5, "Killed")] }, {}));

      expect(
        cut(new Map([[2, sibling]])).checkpoint?.files["src/cut.ts"]?.mutants,
        "the merge filled a piece from the previous run. The file may have changed since then, so its line numbers may point at other code.",
      ).toEqual([at(4, "Survived"), at(5, "Killed")]);
    });

    it("fills a cut file from last run if none ran", () => {
      expect(cut(new Map()).checkpoint?.files["src/cut.ts"]?.mutants).toEqual([
        at(4, "Timeout"),
        at(5, "Timeout"),
      ]);
    });
  });

  it("omits an empty shard's files when no previous run exists", () => {
    const merged = mergeShards({
      leg: "core",
      files: OWNERS,
      of: 2,
      shards: new Map([[1, left(SHARD_ONE)]]),
      baseline: undefined,
    });

    assert(merged.checkpoint !== undefined, "the merge wrote no checkpoint");
    expect(Object.keys(merged.checkpoint.files)).toEqual(["src/a.ts"]);
  });

  it("writes nothing when no shard left results", () => {
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
      "### core shards: 0 of 2 finished\n- shards that left no results, so their files keep the previous run's results: 1, 2\n",
    );
  });
});

const ordinary = (id: string): Found => ({ id, mutatorName: "ArrowFunction", status: "Killed" });

describe("a leg's files, weighted by their cost last run", () => {
  it("weights a file by its mutants, else by its size", () => {
    const root = treeOf("weighed", {
      "src/big.ts": 800,
      "src/new.ts": 300,
      "src/quiet.ts": 106,
      "src/small.ts": 100,
    });
    const previous = results(
      {
        "src/big.ts": [
          { ...ordinary("1"), static: true },
          ...Array.from({ length: 10 }, (_, index) => ordinary(`big-${String(index)}`)),
        ],
        "src/quiet.ts": [
          { id: "2", mutatorName: "StringLiteral", status: "NoCoverage" },
          ordinary("3"),
        ],
        "src/small.ts": [
          { id: "4", mutatorName: "BlockStatement", status: "Timeout" },
          { ...ordinary("5"), status: "Survived" },
        ],
      },
      {},
    );
    const weights = weightsOf(root, mutateSet(root, ["src/**/*.ts"]), previous);

    expect(weights).toEqual(
      new Map([
        ["src/big.ts", 113],
        ["src/new.ts", 150],
        ["src/quiet.ts", 10],
        ["src/small.ts", 380],
      ]),
    );
    expect(shardSlices(weights, 2)).toEqual([
      ["src/small.ts"],
      ["src/big.ts", "src/new.ts", "src/quiet.ts"],
    ]);
  });
});

const THREE_STATEMENTS = `export type Name = string;
export const greet = (name: Name): string =>
  name === "" ? "nobody" : \`hello \${name}\`;

export const within = (count: number): boolean => {
  if (count < 0) return false;
  return count <= 3;
};

export const double = (value: number): number => value * 2;
export type Doubled = number;
`;

const lineOfTwoMutants = (name: string, text = name): string =>
  `export const ${name} = (): string => "${text}";`;

/** Stryker's mutant format: line and columns count from 1, and the end column is one past the mutant. */
const reported = (
  lines: readonly string[],
  at: number,
  text: string,
  found: Pick<Found, "mutatorName" | "replacement" | "status">,
): Found => {
  const column = (lines[at - 1] ?? "").indexOf(text) + 1;
  return {
    id: `${String(at)}:${String(column)}`,
    ...found,
    location: { start: { line: at, column }, end: { line: at, column: column + text.length } },
  };
};

const previousRun = (
  lines: readonly string[],
  timedOut: number,
  order: readonly number[] = lines.map((_, index) => index + 1),
): Results => ({
  files: {
    "src/lines.ts": {
      source: lines.join("\n"),
      mutants: order.flatMap((at) => {
        const text = /"(.*)"/u.exec(lines[at - 1] ?? "")?.[0] ?? "";
        return [
          reported(lines, at, `(): string => ${text}`, {
            mutatorName: "ArrowFunction",
            replacement: "() => undefined",
            status: "Killed",
          }),
          reported(lines, at, text, {
            mutatorName: "StringLiteral",
            replacement: '""',
            status: at === timedOut ? "Timeout" : "Killed",
          }),
        ];
      }),
    },
  },
});

describe("a file too heavy for one shard, cut by line", () => {
  const root = sourcesIn("pieces", { "src/cut.ts": THREE_STATEMENTS });
  const cut = (count: number, lines: readonly string[], previous?: Results) =>
    piecesOf(
      sourcesIn(`pieces-${String(count)}-${lines.join("-")}`, { "src/lines.ts": lines.join("\n") }),
      "src/lines.ts",
      count,
      previous,
    );
  const FOUR = [
    lineOfTwoMutants("a"),
    lineOfTwoMutants("b"),
    lineOfTwoMutants("c"),
    lineOfTwoMutants("d"),
  ];

  it("cuts only between mutants, sharing the mutants evenly", async () => {
    expect(
      await piecesOf(root, "src/cut.ts", 2, undefined),
      "the pieces do not split the mutants evenly. The file has nineteen mutants: seven on lines 2 and 3, ten on 5 to 8, one across both groups, and two on line 10.",
    ).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 11 },
    ]);
    expect(await piecesOf(root, "src/cut.ts", 3, undefined)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 8 },
      { from: 9, to: 11 },
    ]);
    expect(await cut(2, FOUR)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ]);
    expect(await cut(3, FOUR)).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 3 },
      { from: 4, to: 4 },
    ]);
  });

  it("chooses the earlier cut in a tie", async () => {
    expect(await cut(2, FOUR.slice(0, 3))).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 3 },
    ]);
  });

  it("refuses more pieces than the file has safe cuts", async () => {
    await expect(piecesOf(root, "src/cut.ts", 4, undefined)).rejects.toThrow(
      new Error(
        "src/cut.ts cannot be split into 4 pieces. Only 2 line boundaries fall between its mutants, so it splits into 3 pieces at most. Lower its count in the leg's split map.",
      ),
    );
  });

  it("prices each mutant by its text's cost last run", async () => {
    const moved = [...FOUR.slice(3), ...FOUR.slice(0, 3)];
    const previous = previousRun(moved, 1);
    const placedNowhere = { id: "nowhere", mutatorName: "StringLiteral", status: "Timeout" };
    previous.files["src/lines.ts"]?.mutants.push(placedNowhere);

    expect(await cut(2, FOUR, previous)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 4 },
    ]);
    expect(await cut(3, FOUR, previous)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 3 },
      { from: 4, to: 4 },
    ]);
  });

  it("never cuts before a cut already made", async () => {
    expect(await cut(3, FOUR, previousRun(FOUR, 1))).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: 3, to: 4 },
    ]);
  });

  it("pairs two identical mutants in the order they appear", async () => {
    const alike = [
      lineOfTwoMutants("a", "x"),
      lineOfTwoMutants("b", "x"),
      lineOfTwoMutants("c"),
      lineOfTwoMutants("d"),
    ];

    expect(await cut(2, alike, previousRun(alike, 1, [2, 1, 3, 4]))).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 4 },
    ]);
  });

  describe("in a leg that lists the file to be cut", () => {
    const leg = sourcesIn("split-leg", {
      "src/cut.ts": THREE_STATEMENTS,
      "src/a.ts": "x".repeat(300),
      "src/b.ts": "x".repeat(100),
      "src/c.ts": "x".repeat(200),
    });
    const sliced = (
      split: ReadonlyMap<string, number>,
      shard: number,
      of: number,
      mutate: readonly string[] = ["src/**/*.ts"],
    ): Promise<string> => sliceOf(new Map([["core", { root: leg, mutate, split }]]), shard, of);

    it("gives each piece its own shard, then assigns the rest", async () => {
      const split = new Map([["src/cut.ts", 2]]);

      expect(await Promise.all([1, 2, 3, 4].map((shard) => sliced(split, shard, 4)))).toEqual([
        "src/cut.ts:1-3",
        "src/cut.ts:4-11",
        "src/a.ts",
        "src/b.ts,src/c.ts",
      ]);
    });

    it("leaves the other slices unchanged when a file is cut", async () => {
      const whole = await Promise.all([1, 2, 3].map((shard) => sliced(new Map(), shard, 3)));
      const pieces = await Promise.all(
        [1, 2, 3, 4].map((shard) => sliced(new Map([["src/cut.ts", 2]]), shard, 4)),
      );

      expect(whole).toContain("src/cut.ts");
      expect(
        pieces.filter((slice) => !slice.startsWith("src/cut.ts:")),
        "cutting src/cut.ts changed the other files' slices. Each piece gets its own shard, and the other slices stay the same.",
      ).toEqual(whole.filter((slice) => slice !== "src/cut.ts"));
    });

    it("cuts a leg of one file into only its pieces", async () => {
      const split = new Map([["src/cut.ts", 2]]);

      expect(
        await Promise.all([1, 2].map((shard) => sliced(split, shard, 2, ["src/cut.ts"]))),
      ).toEqual(["src/cut.ts:1-3", "src/cut.ts:4-11"]);
    });

    it("refuses cutting an unmutated file, and too few shards", async () => {
      await expect(sliced(new Map([["src/gone.ts", 2]]), 1, 4)).rejects.toThrow(
        new Error(
          "src/gone.ts is in the split map, but the core leg does not mutate it. Remove it from the split map, or add it to the leg's mutate patterns.",
        ),
      );
      await expect(sliced(new Map([["src/cut.ts", 3]]), 1, 3)).rejects.toThrow(
        new Error(
          "the split files take 3 of the 3 shards, which leaves none for the leg's other 3 files. Set --of above 3.",
        ),
      );
    });
  });
});

const legs = (root: string): ReadonlyMap<string, Leg> =>
  new Map([["core", { root, mutate: PATTERNS }]]);

const USAGE = [
  "usage: mutation-shards slice --leg <name> --shard <n> --of <count> --baseline <path>",
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

const incrementalSchema = z.object({ files: z.record(z.string(), z.unknown()) });

const writtenTo = (
  out: string,
): { readonly files: readonly string[]; readonly report: boolean } => ({
  files: existsSync(path.join(out, "stryker-incremental.json"))
    ? Object.keys(
        incrementalSchema.parse(
          JSON.parse(readFileSync(path.join(out, "stryker-incremental.json"), "utf8")),
        ).files,
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
  const merging = (shards: string, out: string, baseline = NO_PREVIOUS_RUN): Promise<string> =>
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

  it("prints a shard's slice as `--mutate` takes it", async () => {
    expect(await sliceOf(legs(root), 1, 2)).toBe("src/a.ts");
    expect(
      await mutationShardsFromArgv(
        ["slice", "--leg", "core", "--of", "2", "--baseline", NO_PREVIOUS_RUN, "--shard", "2"],
        legs(root),
      ),
    ).toBe("src/b.ts,src/c.ts");
  });

  it("cuts the slices by each file's cost last run", async () => {
    const previous = path.join(scratch, "costed.json");
    writeFileSync(
      previous,
      JSON.stringify(
        results(
          {
            "src/a.ts": [{ id: "1", mutatorName: "StringLiteral", status: "NoCoverage" }],
            "src/b.ts": [{ id: "2", mutatorName: "StringLiteral", status: "Timeout" }],
          },
          {},
        ),
      ),
    );
    expect(
      await Promise.all([1, 2].map((shard) => sliceOf(legs(root), shard, 2, previous))),
    ).toEqual(["src/b.ts", "src/a.ts,src/c.ts"]);
  });

  it("merges shards into a checkpoint, and no report while missing", async () => {
    const out = path.join(scratch, "merged-one", "deep");
    const summary = await merging(
      downloaded({
        "1.checkpoint.json": JSON.stringify(SHARD_ONE),
        "1.report.json": JSON.stringify(SHARD_ONE),
        "2.checkpoint.json": '{"files": {',
      }),
      out,
    );

    expect(summary).toBe(
      "### core shards: 1 of 2 finished\n- shards that left no results, so their files keep the previous run's results: 2\n",
    );
    expect(writtenTo(out)).toEqual({ files: ["src/a.ts"], report: false });
  });

  it("reads a stopped shard's checkpoint, and fills a silent one", async () => {
    const out = path.join(scratch, "merged-two");
    const baseline = path.join(scratch, "previous.json");
    writeFileSync(baseline, JSON.stringify(PREVIOUS_WITH_A_GONE_TEST));

    const summary = await merging(
      downloaded({ "1.checkpoint.json": JSON.stringify(SHARD_ONE) }),
      out,
      baseline,
    );

    expect(summary).toBe(
      "### core shards: 0 of 2 finished\n- shards that stopped before writing a report, so the next run tests the mutants they did not reach: 1\n- shards that left no results, so their files keep the previous run's results: 2\n",
    );
    expect(
      writtenTo(out),
      "the merge wrote the wrong files. The previous run gave every file the same cost, so the slices are [a, c] and [b].",
    ).toEqual({ files: ["src/a.ts", "src/b.ts"], report: false });
  });

  it("writes the report beside the checkpoint once every shard finished", async () => {
    const out = path.join(scratch, "merged-three");
    await merging(
      downloaded({
        "1.report.json": JSON.stringify(SHARD_ONE),
        "2.report.json": JSON.stringify(SHARD_TWO),
      }),
      out,
    );

    expect(writtenTo(out)).toEqual({ files: ["src/a.ts", "src/b.ts", "src/c.ts"], report: true });
    expect(
      JSON.parse(readFileSync(path.join(out, "stryker-incremental.json"), "utf8")),
      "the merge dropped keys the schema does not name. Keep them, because the next run's Stryker reads this file back.",
    ).toMatchObject({ schemaVersion: "1.0", thresholds: { high: 80, low: 60 } });
  });

  it("writes nothing and says so when no shard left results", async () => {
    const out = path.join(scratch, "merged-four");

    expect(await merging(downloaded({}), out)).toBe(
      "### core shards: 0 of 2 finished\n- shards that left no results, so their files keep the previous run's results: 1, 2\n",
    );
    expect(writtenTo(out)).toEqual({ files: [], report: false });
  });

  it.each([
    { what: "no files", text: '{"schemaVersion": "1.0"}' },
    { what: "a file without mutants", text: '{"files": {"src/b.ts": {"source": ""}}}' },
    {
      what: "a mutant's tests outside a list",
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
  ])("discards a report holding $what", async ({ text }) => {
    const summary = await merging(
      downloaded({ "1.report.json": JSON.stringify(SHARD_ONE), "2.report.json": text }),
      path.join(scratch, `merged-${String(downloads)}`),
    );

    expect(summary).toBe(
      "### core shards: 1 of 2 finished\n- shards that left no results, so their files keep the previous run's results: 2\n",
    );
  });

  it.each([
    { what: "an unknown leg", argv: ["slice", "--leg", "web"], says: USAGE },
    {
      what: "a slice without --baseline",
      argv: ["slice", "--leg", "core", "--shard", "1", "--of", "2"],
      says: USAGE,
    },
    {
      what: "a flag without its value",
      argv: [
        "slice",
        "--leg",
        "core",
        "--shard",
        "1",
        "--of",
        "2",
        "--baseline",
        NO_PREVIOUS_RUN,
        "--out",
      ],
      says: USAGE,
    },
    {
      what: "an unknown command",
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
      what: "a merge without --baseline",
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
      argv: ["slice", "--leg", "core", "--shard", "1", "--of", "0", "--baseline", "."],
      says: `--of must be a whole number of 1 or more\n${USAGE}`,
    },
    {
      what: "part of a shard",
      argv: ["slice", "--leg", "core", "--shard", "1", "--of", "1.5", "--baseline", "."],
      says: `--of must be a whole number of 1 or more\n${USAGE}`,
    },
    {
      what: "a non-numeric count",
      argv: ["slice", "--leg", "core", "--shard", "1", "--of", "two", "--baseline", "."],
      says: `--of must be a whole number of 1 or more\n${USAGE}`,
    },
    {
      what: "shard nought",
      argv: ["slice", "--leg", "core", "--shard", "0", "--of", "2", "--baseline", "."],
      says: `--shard must be a whole number of 1 or more\n${USAGE}`,
    },
    {
      what: "a shard past the count",
      argv: ["slice", "--leg", "core", "--shard", "3", "--of", "2", "--baseline", "."],
      says: "--shard 3 is greater than --of 2. Pick a shard from 1 to 2.",
    },
  ])("refuses $what, saying what it takes", async ({ argv, says }) => {
    await expect(mutationShardsFromArgv(argv, legs(root))).rejects.toThrow(new Error(says));
  });
});

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
    .flatMap(([name, fileEntry]) =>
      fileEntry.mutants.map((found) => ({
        file: name,
        mutant: `${String(found.location.start.line)}:${String(found.location.start.column)} ${found.mutatorName} ${found.replacement ?? ""}`,
        status: found.statusReason === CARRIED ? `${found.status}, carried` : found.status,
      })),
    )
    .toSorted((leftEntry, right) =>
      `${leftEntry.file} ${leftEntry.mutant}` < `${right.file} ${right.mutant}` ? -1 : 1,
    );

const runAsShards = async (
  root: string,
  leg: ReadonlyMap<string, Leg>,
  of: number,
  merged: string,
): Promise<void> => {
  const [name = ""] = leg.keys();
  const reports = path.join(root, "reports");
  const shards = `${merged}-shards`;
  mkdirSync(shards, { recursive: true });
  for (let shard = 1; shard <= of; shard += 1) {
    runStryker(root, "--mutate", await sliceOf(leg, shard, of));
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
  await mutationShardsFromArgv(
    [
      "merge",
      "--leg",
      name,
      "--of",
      String(of),
      "--shards",
      shards,
      "--baseline",
      NO_PREVIOUS_RUN,
      "--out",
      merged,
    ],
    leg,
  );
};

const wholeRunLeavingNoPreviousRun = (root: string): readonly Verdict[] => {
  runStryker(root);
  const verdicts = verdictsIn(path.join(root, "reports", "mutation.json"));
  rmSync(path.join(root, "reports"), { recursive: true, force: true });
  return verdicts;
};

describe("a throwaway leg run as shards by Stryker", () => {
  const root = throwawayLeg();
  const leg = new Map([["throwaway", { root, mutate: THROWAWAY_PATTERNS }]]);
  const merged = path.join(scratch, "leg-merged");
  const reports = path.join(root, "reports");
  const slice = (shard: number, of: number): Promise<string> => sliceOf(leg, shard, of);
  let whole: readonly Verdict[] = [];

  beforeAll(async () => {
    whole = wholeRunLeavingNoPreviousRun(root);
    await runAsShards(root, leg, 2, merged);
  }, 120_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("tests as two merged shards what one whole run tests", async () => {
    expect(await slice(1, 2)).toBe("src/one.ts");
    expect(await slice(2, 2)).toBe("src/three.ts,src/two.ts");
    expect(whole.map((verdict) => verdict.file)).toContain("src/one.ts");
    expect(whole.map((verdict) => verdict.file)).not.toContain("src/entry.ts");
    expect(verdictsIn(path.join(merged, "mutation.json"))).toEqual(whole);
  });

  it("reuses a file's results when a new file moves it", async () => {
    const mergedResults = readReportFile(path.join(merged, "stryker-incremental.json"));
    const one = mergedResults.files["src/one.ts"];
    assert(one !== undefined, "the merged results have no src/one.ts");
    const marked = {
      ...mergedResults,
      files: {
        ...mergedResults.files,
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

    expect(await slice(2, 2)).toBe("src/one.ts,src/two.ts");
    runStryker(root, "--mutate", await slice(2, 2));

    const moved = verdictsIn(path.join(reports, "mutation.json")).filter(
      (verdict) => verdict.file === "src/one.ts",
    );
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((verdict) => verdict.status.endsWith(", carried"))).toBe(true);
  });
});

const CUT_SUITE = `import { expect, it } from "vitest";

import { double, greet, within } from "../src/cut.ts";
import { negate } from "../src/zero.ts";

it("greets a name, and nobody", () => {
  expect(greet("Ada")).toBe("hello Ada");
  expect(greet("")).toBe("nobody");
});

it("counts within the limit, and never below nought", () => {
  expect(within(3)).toBe(true);
  expect(within(-1)).toBe(false);
});

it("doubles", () => {
  expect(double(2)).toBe(4);
});

it("negates", () => {
  expect(negate(true)).toBe(false);
});
`;

describe("a throwaway leg with a cut file, run by Stryker", () => {
  const root = strykerWorkspace(path.join(scratch, "cut-leg"), {
    "stryker.config.mjs": THROWAWAY_CONFIG,
    "src/cut.ts": THREE_STATEMENTS,
    "src/zero.ts": ZERO,
    "test/cut.test.ts": CUT_SUITE,
  });
  const leg = new Map([
    ["cut", { root, mutate: THROWAWAY_PATTERNS, split: new Map([["src/cut.ts", 2]]) }],
  ]);
  const merged = path.join(scratch, "cut-leg-merged");
  let whole: readonly Verdict[] = [];

  beforeAll(async () => {
    whole = wholeRunLeavingNoPreviousRun(root);
    await runAsShards(root, leg, 3, merged);
  }, 120_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("tests as merged pieces what one whole run tests", () => {
    expect(whole.filter((verdict) => verdict.file === "src/cut.ts")).toHaveLength(19);
    expect(verdictsIn(path.join(merged, "mutation.json"))).toEqual(whole);
  });
});
