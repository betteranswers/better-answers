import { globSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { flagValues } from "./flags.ts";

const position = z.looseObject({ line: z.number(), column: z.number() });

const test = z.looseObject({
  id: z.string(),
  name: z.string(),
  location: z.looseObject({ start: position }).optional(),
});

const mutant = z.looseObject({
  status: z.string(),
  static: z.boolean().optional(),
  coveredBy: z.array(z.string()).optional(),
  killedBy: z.array(z.string()).optional(),
});

const fileResult = z.looseObject({ mutants: z.array(mutant) });

const testFile = z.looseObject({ tests: z.array(test) });

// Loose, so every key survives: the merged file is the one the next run's Stryker reads back.
const results = z.looseObject({
  files: z.record(z.string(), fileResult),
  testFiles: z.record(z.string(), testFile).optional(),
});
type Results = z.infer<typeof results>;
type FileResult = z.infer<typeof fileResult>;
type TestFile = z.infer<typeof testFile>;
type Mutant = z.infer<typeof mutant>;

export type Leg = {
  readonly root: string;
  readonly mutate: readonly string[];
};

const USAGE = [
  "usage: mutation-shards slice --leg <name> --shard <n> --of <count> --baseline <path>",
  "       mutation-shards merge --leg <name> --of <count> --shards <directory> --baseline <path> --out <directory>",
].join("\n");

// In order, as Stryker reads `mutate`: a `!` pattern takes back what an earlier one chose. The
// glob, like Stryker's, never matches a hidden file.
export const mutateSet = (root: string, patterns: readonly string[]): readonly string[] => {
  const chosen = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      for (const file of chosen) if (path.matchesGlob(file, pattern.slice(1))) chosen.delete(file);
    } else {
      for (const found of globSync(pattern, { cwd: root })) {
        const file = found.split(path.sep).join("/");
        if (statSync(path.join(root, file)).isFile()) chosen.add(file);
      }
    }
  }
  return [...chosen].toSorted();
};

// Seconds of a worker, fitted to a forced run of every shard. A timeout waits out the whole
// related suite.
const ORDINARY_SECONDS = 10;
const STATIC_SECONDS = 13;
const TIMEOUT_SECONDS = 370;

const secondsOf = (found: Mutant): number => {
  if (found.status === "Timeout") return TIMEOUT_SECONDS;
  if (found.status === "NoCoverage") return 0;
  return found.static === true ? STATIC_SECONDS : ORDINARY_SECONDS;
};

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

// Unmeasured, a file is priced by size at the previous run's seconds a byte; with no previous
// run, by size alone.
export const weightsOf = (
  root: string,
  files: readonly string[],
  previous: Results | undefined,
): ReadonlyMap<string, number> => {
  const bytes = new Map(files.map((file) => [file, statSync(path.join(root, file)).size] as const));
  const measured = new Map(
    files.flatMap((file) => {
      const entry = previous?.files[file];
      return entry === undefined ? [] : [[file, sum(entry.mutants.map(secondsOf))] as const];
    }),
  );
  const measuredBytes = sum([...measured.keys()].map((file) => bytes.get(file) ?? 0));
  const perByte = measuredBytes === 0 ? 1 : sum([...measured.values()]) / measuredBytes;
  return new Map(
    files.map((file) => [file, measured.get(file) ?? (bytes.get(file) ?? 0) * perByte] as const),
  );
};

type Load = { weight: number; readonly files: string[] };

// The heaviest file first, each onto the lightest shard so far. A stable sort over files in path
// order gives every job the same slices.
export const shardSlices = (
  weights: ReadonlyMap<string, number>,
  of: number,
): readonly (readonly string[])[] => {
  if (of > weights.size) {
    throw new Error(
      `a leg of ${String(weights.size)} files cannot be cut into ${String(of)} shards: each needs a file to mutate`,
    );
  }
  const weighed = [...weights]
    .map(([file, weight]) => ({ file, weight }))
    .toSorted((left, right) => right.weight - left.weight);
  const loads: Load[] = Array.from({ length: of }, () => ({ weight: 0, files: [] }));
  for (const { file, weight } of weighed) {
    const lightest = loads.reduce((best, load) => (load.weight < best.weight ? load : best));
    lightest.files.push(file);
    lightest.weight += weight;
  }
  return loads.map((load) => load.files.toSorted());
};

const ownersOf = (slices: readonly (readonly string[])[]): ReadonlyMap<string, number> =>
  new Map(slices.flatMap((slice, index) => slice.map((file) => [file, index + 1] as const)));

export type ShardResults = {
  readonly checkpoint: Results | undefined;
  readonly report: Results | undefined;
};

type Test = z.infer<typeof test>;

const testKey = (file: string, found: Test): string =>
  JSON.stringify([file, found.location?.start.line, found.location?.start.column, found.name]);

const keysById = (source: Results): ReadonlyMap<string, string> =>
  new Map(
    Object.entries(source.testFiles ?? {}).flatMap(([file, tests]) =>
      tests.tests.map((found) => [found.id, testKey(file, found)] as const),
    ),
  );

type TestTable = {
  readonly idByKey: ReadonlyMap<string, string>;
  readonly files: ReadonlyMap<string, TestFile>;
};

// Each shard numbers its tests itself; a test is matched by file, place and title, as Stryker
// matches one between runs.
const testTableOf = (sources: readonly Results[]): TestTable => {
  const idByKey = new Map<string, string>();
  const files = new Map<string, { readonly entry: TestFile; readonly tests: Test[] }>();
  for (const [file, entry] of sources.flatMap((source) => Object.entries(source.testFiles ?? {}))) {
    const held = files.get(file) ?? { entry, tests: [] };
    files.set(file, held);
    for (const found of entry.tests) {
      const key = testKey(file, found);
      if (idByKey.has(key)) continue;
      const id = String(idByKey.size);
      idByKey.set(key, id);
      held.tests.push({ ...found, id });
    }
  }
  return {
    idByKey,
    files: new Map([...files].map(([file, held]) => [file, { ...held.entry, tests: held.tests }])),
  };
};

const renumbered = (
  entry: FileResult,
  source: Results,
  idByKey: ReadonlyMap<string, string>,
): FileResult => {
  const movedTo = new Map(
    [...keysById(source)].map(([id, key]) => [id, idByKey.get(key)] as const),
  );
  const carry = (ids: readonly string[] | undefined): string[] | undefined =>
    ids?.flatMap((id) => {
      const moved = movedTo.get(id);
      return moved === undefined ? [] : [moved];
    });
  return {
    ...entry,
    mutants: entry.mutants.map((found): Mutant => ({
      ...found,
      coveredBy: carry(found.coveredBy),
      killedBy: carry(found.killedBy),
    })),
  };
};

type Merged = {
  readonly checkpoint: Results | undefined;
  // Only when every shard finished, as one run writes its report only when it finishes.
  readonly report: Results | undefined;
  readonly summary: string;
};

const numbered = (of: number): readonly number[] =>
  Array.from({ length: of }, (_, index) => index + 1);

// A finished shard's report and its checkpoint are one report written twice.
const leftBy = (shards: ReadonlyMap<number, ShardResults>, shard: number): Results | undefined =>
  shards.get(shard)?.report ?? shards.get(shard)?.checkpoint;

const shardLines = (
  leg: string,
  of: number,
  shards: ReadonlyMap<number, ShardResults>,
): readonly string[] => {
  const finished = numbered(of).filter((shard) => shards.get(shard)?.report !== undefined);
  const stopped = numbered(of).filter(
    (shard) => shards.get(shard)?.report === undefined && leftBy(shards, shard) !== undefined,
  );
  const silent = numbered(of).filter((shard) => leftBy(shards, shard) === undefined);
  return [
    `### ${leg} shards: ${String(finished.length)} of ${String(of)} finished`,
    ...(stopped.length === 0
      ? []
      : [
          `- stopped before writing a report, what they had not tested waiting for the next run: ${stopped.join(", ")}`,
        ]),
    ...(silent.length === 0
      ? []
      : [`- left no results, their files keeping the previous run's: ${silent.join(", ")}`]),
  ];
};

// A stopped shard's gaps stay out, or a forced run's would refill with what it was replacing.
// Only a shard that left nothing is filled.
export const mergeShards = ({
  leg,
  files,
  of,
  shards,
  baseline,
}: {
  readonly leg: string;
  readonly files: ReadonlyMap<string, number>;
  readonly of: number;
  readonly shards: ReadonlyMap<number, ShardResults>;
  readonly baseline: Results | undefined;
}): Merged => {
  const summary = `${shardLines(leg, of, shards).join("\n")}\n`;
  const sourceOf = (shard: number): Results | undefined => leftBy(shards, shard) ?? baseline;
  const fromShards = numbered(of).flatMap((shard) => leftBy(shards, shard) ?? []);
  const fills = [...files.values()].some((shard) => leftBy(shards, shard) === undefined);
  // This run's shards first, so a test file's source is this run's wherever one holds it.
  const sources = fills && baseline !== undefined ? [...fromShards, baseline] : fromShards;
  const [first] = sources;
  if (first === undefined) return { checkpoint: undefined, report: undefined, summary };
  const tests = testTableOf(sources);
  const entries = [...files].flatMap(([file, shard]) => {
    const source = sourceOf(shard);
    if (source === undefined) return [];
    const entry = source.files[file];
    return entry === undefined ? [] : [[file, renumbered(entry, source, tests.idByKey)] as const];
  });
  // A shard's `config` names its own slice as `mutate`, which the merged file is not.
  const kept = Object.entries(first).filter(([key]) => key !== "config");
  const checkpoint: Results = {
    ...Object.fromEntries(kept),
    files: Object.fromEntries(entries),
    testFiles: Object.fromEntries(tests.files),
  };
  const everyShardFinished = numbered(of).every((shard) => shards.get(shard)?.report !== undefined);
  return { checkpoint, report: everyShardFinished ? checkpoint : undefined, summary };
};

// Absent, not JSON or not a report reads as nothing left: a shard cut before or during its
// write, or a leg never run.
const readResults = (file: string): Results | undefined => {
  try {
    const read = results.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
};

const positive = (value: string | undefined, name: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} takes a whole number from 1\n${USAGE}`);
  }
  return parsed;
};

// The workflow's gather step writes these names, each after its shard's number, so one
// directory holds every shard.
const CHECKPOINT = "checkpoint.json";
const REPORT = "report.json";

export const mutationShardsFromArgv = (
  argv: readonly string[],
  legs: ReadonlyMap<string, Leg>,
): string => {
  const [command, ...rest] = argv;
  const values = flagValues(rest) ?? new Map<string, string>();
  const named = [...legs].find(([name]) => name === values.get("leg"));
  if (named === undefined) throw new Error(USAGE);
  const [leg, { root, mutate }] = named;
  const of = positive(values.get("of"), "of");
  const baselineFile = values.get("baseline");
  if (baselineFile === undefined) throw new Error(USAGE);
  const baseline = readResults(baselineFile);
  const slices = shardSlices(weightsOf(root, mutateSet(root, mutate), baseline), of);
  if (command === "slice") {
    const shard = positive(values.get("shard"), "shard");
    const slice = slices[shard - 1];
    if (slice === undefined) throw new Error(`--shard ${String(shard)} is past --of ${String(of)}`);
    return slice.join(",");
  }
  const shardsDirectory = values.get("shards");
  const out = values.get("out");
  if (command !== "merge" || shardsDirectory === undefined || out === undefined) {
    throw new Error(USAGE);
  }
  const shards = new Map(
    Array.from({ length: of }, (_, index) => {
      const shard = index + 1;
      return [
        shard,
        {
          checkpoint: readResults(path.join(shardsDirectory, `${String(shard)}.${CHECKPOINT}`)),
          report: readResults(path.join(shardsDirectory, `${String(shard)}.${REPORT}`)),
        },
      ] as const;
    }),
  );
  const merged = mergeShards({
    leg,
    files: ownersOf(slices),
    of,
    shards,
    baseline,
  });
  mkdirSync(out, { recursive: true });
  if (merged.checkpoint !== undefined) {
    writeFileSync(path.join(out, "stryker-incremental.json"), JSON.stringify(merged.checkpoint));
  }
  if (merged.report !== undefined) {
    writeFileSync(path.join(out, "mutation.json"), JSON.stringify(merged.report));
  }
  return merged.summary;
};
