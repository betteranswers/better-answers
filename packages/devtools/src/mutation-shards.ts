import { globSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Instrumenter } from "@stryker-mutator/instrumenter";
import { z } from "zod";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { flagValues } from "./flags.ts";

const position = z.looseObject({ line: z.number(), column: z.number() });

const test = z.looseObject({
  id: z.string(),
  name: z.string(),
  location: z.looseObject({ start: position }).optional(),
});

const place = z.looseObject({ start: position, end: position });
type Place = z.infer<typeof place>;

const mutant = z.looseObject({
  mutatorName: z.string().optional(),
  replacement: z.string().optional(),
  status: z.string(),
  static: z.boolean().optional(),
  coveredBy: z.array(z.string()).optional(),
  killedBy: z.array(z.string()).optional(),
  location: place.optional(),
});

const fileResult = z.looseObject({ source: z.string().optional(), mutants: z.array(mutant) });

const testFile = z.looseObject({ tests: z.array(test) });

/** Loose, so every key survives: the merged file is the one the next run's Stryker reads back. */
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
  // No count of shards moves the floor one heavy file sets, so such a file is cut by line.
  readonly split?: ReadonlyMap<string, number>;
};

const USAGE = [
  "usage: mutation-shards slice --leg <name> --shard <n> --of <count> --baseline <path>",
  "       mutation-shards merge --leg <name> --of <count> --shards <directory> --baseline <path> --out <directory>",
].join("\n");

/**
 * In order, as Stryker reads `mutate`: a `!` pattern takes back what an earlier one chose. The
 * glob, like Stryker's, never matches a hidden file.
 */
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
  return [...chosen].toSorted(byCodeUnit);
};

/** Seconds of a worker, fitted to a forced run of every shard. */
const ORDINARY_SECONDS = 10;
const STATIC_SECONDS = 13;
/** A timeout waits out the whole related suite. */
const TIMEOUT_SECONDS = 370;

const secondsOf = (found: Mutant): number => {
  if (found.status === "Timeout") return TIMEOUT_SECONDS;
  if (found.status === "NoCoverage") return 0;
  return found.static === true ? STATIC_SECONDS : ORDINARY_SECONDS;
};

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

/**
 * Unmeasured, a file is priced by size at the previous run's seconds a byte; with no previous
 * run, by size alone.
 */
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

/**
 * The heaviest file first, each onto the lightest shard so far. A stable sort over files in path
 * order gives every job the same slices.
 */
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
  return loads.map((load) => load.files.toSorted(byCodeUnit));
};

export type Lines = { readonly from: number; readonly to: number };

type Span = { readonly start: number; readonly end: number; readonly seconds: number };

const never = (): boolean => false;
const nothing = (): void => undefined;

const SILENT: ConstructorParameters<typeof Instrumenter>[0] = {
  isTraceEnabled: never,
  isDebugEnabled: never,
  isInfoEnabled: never,
  isWarnEnabled: never,
  isErrorEnabled: never,
  isFatalEnabled: never,
  trace: nothing,
  debug: nothing,
  info: nothing,
  warn: nothing,
  error: nothing,
  fatal: nothing,
};

/** A place as Stryker reports it: lines and columns from 1, the end column past the text. */
const textAt = (source: string, { start, end }: Place): string => {
  const rows = source.split("\n");
  const offset = ({ line, column }: Place["start"]): number =>
    sum(rows.slice(0, line - 1).map((text) => text.length + 1)) + column - 1;
  return source.slice(offset(start), offset(end));
};

const mutantKey = (
  mutatorName: string | undefined,
  replacement: string | undefined,
  text: string,
) => JSON.stringify([mutatorName, replacement, text]);

/**
 * Known by what it mutates, not where, so a mutant keeps its price when its file moves it. Two
 * alike pair in line order.
 */
const pricesIn = (entry: FileResult | undefined): ReadonlyMap<string, number[]> => {
  const prices = new Map<string, number[]>();
  if (entry?.source === undefined) return prices;
  const { source } = entry;
  const placed = entry.mutants.flatMap((found) =>
    found.location === undefined ? [] : [{ found, location: found.location }],
  );
  for (const { found, location } of placed.toSorted(
    (left, right) => left.location.start.line - right.location.start.line,
  )) {
    const key = mutantKey(found.mutatorName, found.replacement, textAt(source, location));
    prices.set(key, [...(prices.get(key) ?? []), secondsOf(found)]);
  }
  return prices;
};

/**
 * Stryker's own instrumenter, with its default options, lists the mutants a run makes. Its
 * lines and columns count from 0.
 */
const spansIn = async (
  name: string,
  content: string,
  previous: FileResult | undefined,
): Promise<readonly Span[]> => {
  const { mutants } = await new Instrumenter(SILENT).instrument([{ name, content, mutate: true }], {
    plugins: null,
    excludedMutations: [],
    ignorers: [],
  });
  const prices = pricesIn(previous);
  return mutants.map((found) => {
    const { start, end } = found.location;
    const location = {
      start: { line: start.line + 1, column: start.column + 1 },
      end: { line: end.line + 1, column: end.column + 1 },
    };
    const key = mutantKey(found.mutatorName, found.replacement, textAt(content, location));
    return {
      start: location.start.line,
      end: location.end.line,
      seconds: prices.get(key)?.shift() ?? ORDINARY_SECONDS,
    };
  });
};

/**
 * Stryker mutates only what a range holds whole, so a mutant across a cut would be in neither
 * piece.
 */
const cutsBetween = (spans: readonly Span[], lastLine: number): readonly number[] => {
  // Of the cuts leaving the same mutants either side, the first stands for all.
  const held = new Set<number>();
  return Array.from({ length: lastLine - 1 }, (_, index) => index + 1).filter((after) => {
    if (spans.some((span) => span.start <= after && after < span.end)) return false;
    const before = spans.filter((span) => span.start <= after).length;
    if (before === 0 || before === spans.length || held.has(before)) return false;
    held.add(before);
    return true;
  });
};

const costBefore = (spans: readonly Span[], after: number): number =>
  sum(spans.filter((span) => span.start <= after).map((span) => span.seconds));

/** Nearest its share, but never so late that a later piece is left without a cut. */
const chosenCuts = (spans: readonly Span[], cuts: readonly number[], count: number) => {
  const total = sum(spans.map((span) => span.seconds));
  const chosen: number[] = [];
  for (let piece = 1; piece < count; piece += 1) {
    const share = (total * piece) / count;
    const open = cuts.filter(
      (after, index) => after > (chosen.at(-1) ?? 0) && cuts.length - index >= count - piece,
    );
    const distance = (after: number): number => Math.abs(costBefore(spans, after) - share);
    chosen.push(open.reduce((best, after) => (distance(after) < distance(best) ? after : best)));
  }
  return chosen;
};

/** Line ranges as `stryker run --mutate` takes them, covering the file end to end. */
export const piecesOf = async (
  root: string,
  file: string,
  count: number,
  previous: Results | undefined,
): Promise<readonly Lines[]> => {
  const name = path.join(root, file);
  const content = readFileSync(name, "utf8");
  const lastLine = content.replace(/\n$/u, "").split("\n").length;
  const spans = await spansIn(name, content, previous?.files[file]);
  const safe = cutsBetween(spans, lastLine);
  if (safe.length < count - 1) {
    throw new Error(
      `${file} cannot be cut into ${String(count)} pieces: its mutants leave room for ${String(safe.length + 1)} at most`,
    );
  }
  const cuts = chosenCuts(spans, safe, count);
  return [0, ...cuts].map((after, index) => ({ from: after + 1, to: cuts[index] ?? lastLine }));
};

type Part = { readonly file: string; readonly lines?: Lines | undefined };

const partName = ({ file, lines }: Part): string =>
  lines === undefined ? file : `${file}:${String(lines.from)}-${String(lines.to)}`;

/**
 * A shard apiece for the pieces, so cutting a file that had a shard to itself leaves the others'
 * slices as they were.
 */
const legSlices = async (
  name: string,
  { root, mutate, split = new Map<string, number>() }: Leg,
  of: number,
  baseline: Results | undefined,
): Promise<readonly (readonly Part[])[]> => {
  const files = mutateSet(root, mutate);
  const pieces: Part[][] = [];
  for (const [file, count] of split) {
    if (!files.includes(file)) {
      throw new Error(`${file} is named to be cut, but the ${name} leg does not mutate it`);
    }
    for (const lines of await piecesOf(root, file, count, baseline)) pieces.push([{ file, lines }]);
  }
  const rest = files.filter((file) => !split.has(file));
  if (rest.length > 0 && of <= pieces.length) {
    throw new Error(
      `a leg whose cut files take ${String(pieces.length)} shards cannot be cut into ${String(of)}: its other ${String(rest.length)} files need at least one`,
    );
  }
  const dealt = shardSlices(weightsOf(root, rest, baseline), of - pieces.length);
  return [...pieces, ...dealt.map((slice) => slice.map((file) => ({ file })))];
};

export type Owner = { readonly shard: number; readonly lines?: Lines | undefined };

const ownersOf = (slices: readonly (readonly Part[])[]): ReadonlyMap<string, readonly Owner[]> => {
  const owners = new Map<string, Owner[]>();
  slices.forEach((slice, index) => {
    for (const { file, lines } of slice) {
      owners.set(file, [...(owners.get(file) ?? []), { shard: index + 1, lines }]);
    }
  });
  return owners;
};

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

/**
 * Each shard numbers its tests itself; a test is matched by file, place and title, as Stryker
 * matches one between runs.
 */
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

/** A finished shard's report and its checkpoint are one report written twice. */
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

/**
 * A piece's shard holds the whole file, the rest carried forward, so each mutant comes from the
 * piece holding its first line.
 */
const heldBy = (lines: Lines | undefined, found: Mutant): boolean => {
  if (lines === undefined) return true;
  const line = found.location?.start.line ?? 0;
  return lines.from <= line && line <= lines.to;
};

/**
 * A stopped shard's gaps stay out, or a forced run's would refill with what it was replacing.
 * Only a shard that left nothing is filled.
 */
export const mergeShards = ({
  leg,
  files,
  of,
  shards,
  baseline,
}: {
  readonly leg: string;
  readonly files: ReadonlyMap<string, readonly Owner[]>;
  readonly of: number;
  readonly shards: ReadonlyMap<number, ShardResults>;
  readonly baseline: Results | undefined;
}): Merged => {
  const summary = `${shardLines(leg, of, shards).join("\n")}\n`;
  const fromShards = numbered(of).flatMap((shard) => leftBy(shards, shard) ?? []);
  const fills = [...files.values()].flat().some(({ shard }) => leftBy(shards, shard) === undefined);
  // This run's shards first, so a test file's source is this run's wherever one holds it.
  const sources = fills && baseline !== undefined ? [...fromShards, baseline] : fromShards;
  const [first] = sources;
  if (first === undefined) return { checkpoint: undefined, report: undefined, summary };
  const tests = testTableOf(sources);
  const entries = [...files].flatMap(([file, owners]) => {
    // A piece's shard carried the rest of its file forward onto the text as it now stands,
    // which the previous run's lines may not match.
    const sibling = owners
      .map(({ shard }) => leftBy(shards, shard))
      .find((left) => left !== undefined);
    const held = owners.flatMap(({ shard, lines }) => {
      const source = leftBy(shards, shard) ?? sibling ?? baseline;
      if (source === undefined) return [];
      const entry = source.files[file];
      if (entry === undefined) return [];
      const carried = renumbered(entry, source, tests.idByKey);
      return [{ ...carried, mutants: carried.mutants.filter((found) => heldBy(lines, found)) }];
    });
    const [kept] = held;
    return kept === undefined
      ? []
      : [[file, { ...kept, mutants: held.flatMap((piece) => piece.mutants) }] as const];
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

/**
 * Absent, not JSON or not a report reads as nothing left: a shard cut before or during its
 * write, or a leg never run.
 */
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

/** The gather step puts a shard's number before each name, so one directory holds every shard. */
const CHECKPOINT = "checkpoint.json";
const REPORT = "report.json";

const shardsIn = (directory: string, of: number): ReadonlyMap<number, ShardResults> =>
  new Map(
    numbered(of).map((shard) => [
      shard,
      {
        checkpoint: readResults(path.join(directory, `${String(shard)}.${CHECKPOINT}`)),
        report: readResults(path.join(directory, `${String(shard)}.${REPORT}`)),
      },
    ]),
  );

const writtenMerge = (merged: Merged, out: string): string => {
  mkdirSync(out, { recursive: true });
  if (merged.checkpoint !== undefined) {
    writeFileSync(path.join(out, "stryker-incremental.json"), JSON.stringify(merged.checkpoint));
  }
  if (merged.report !== undefined) {
    writeFileSync(path.join(out, "mutation.json"), JSON.stringify(merged.report));
  }
  return merged.summary;
};

const sliceNamed = (slices: readonly (readonly Part[])[], shard: number): string => {
  const slice = slices[shard - 1];
  if (slice === undefined) {
    throw new Error(`--shard ${String(shard)} is past --of ${String(slices.length)}`);
  }
  return slice.map(partName).join(",");
};

export const mutationShardsFromArgv = async (
  argv: readonly string[],
  legs: ReadonlyMap<string, Leg>,
): Promise<string> => {
  const [command, ...rest] = argv;
  const values = flagValues(rest) ?? new Map<string, string>();
  const named = [...legs].find(([name]) => name === values.get("leg"));
  if (named === undefined) throw new Error(USAGE);
  const [leg, config] = named;
  const of = positive(values.get("of"), "of");
  const baselineFile = values.get("baseline");
  if (baselineFile === undefined) throw new Error(USAGE);
  const baseline = readResults(baselineFile);
  const slices = await legSlices(leg, config, of, baseline);
  if (command === "slice") return sliceNamed(slices, positive(values.get("shard"), "shard"));
  const shardsDirectory = values.get("shards");
  const out = values.get("out");
  if (command !== "merge" || shardsDirectory === undefined || out === undefined) {
    throw new Error(USAGE);
  }
  const shards = shardsIn(shardsDirectory, of);
  return writtenMerge(mergeShards({ leg, files: ownersOf(slices), of, shards, baseline }), out);
};
