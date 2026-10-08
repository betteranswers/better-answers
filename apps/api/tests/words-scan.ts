import path from "node:path";

import { parseSync } from "oxc-parser";

import type { CarveOut, OldWord, Renamed, Sense } from "./old-words.ts";
import { readUnder, treeFilesUnder } from "./tree-walk.ts";

export const GLOSSARY = "CONCEPTS.md";

/** The glossary carries no list of old words in any emphasis: those live in old-words.ts. */
export const AVOID_LIST = /_Avoid_|\bAvoid\b\W{0,3}:/;

const BULLET_HEAD = /^- \*\*(?<term>.+?)\*\* — (?<rest>.*)$/;
const HEADING_HEAD = /^### (?<term>.+?)\s*$/;

type Entry = { readonly term: string; readonly definition: string };

type Open = { readonly shape: "bullet" | "heading"; readonly entry: Entry };

const openedBy = (line: string): Open | undefined => {
  const bullet = BULLET_HEAD.exec(line)?.groups;
  if (bullet?.["term"] !== undefined) {
    return { shape: "bullet", entry: { term: bullet["term"], definition: bullet["rest"] ?? "" } };
  }
  const term = HEADING_HEAD.exec(line)?.groups?.["term"];
  return term === undefined ? undefined : { shape: "heading", entry: { term, definition: "" } };
};

const continues = ({ shape }: Open, line: string): boolean =>
  shape === "bullet" ? line.startsWith("  ") : !line.startsWith("#");

const grown = ({ shape, entry }: Open, line: string): Open => ({
  shape,
  entry: { term: entry.term, definition: `${entry.definition} ${line.trim()}`.trim() },
});

/** An entry is a `- **head** —` bullet or a `### head` heading, as Compound Engineering writes one. */
export const entriesOf = (glossary: string): readonly Entry[] => {
  const entries: Entry[] = [];
  let open: Open | undefined;
  for (const line of glossary.split("\n")) {
    const opening = openedBy(line);
    if (opening !== undefined) {
      open = opening;
      entries.push(opening.entry);
    } else if (open !== undefined && continues(open, line)) {
      open = line.trim() === "" ? open : grown(open, line);
      entries[entries.length - 1] = open.entry;
    } else {
      open = undefined;
    }
  }
  return entries;
};

const markOf = ({ definition }: Entry): "internal" | "pending" | undefined => {
  if (definition.startsWith("_Internal._")) return "internal";
  if (definition.startsWith("_Code rename pending._")) return "pending";
  return undefined;
};

/** A head's qualifier tells entries apart in the glossary; a page writes the word alone. */
const bareWordOf = (head: string): string => head.replace(/ \(.*\)$/, "").replaceAll("`", "");

type Internal = {
  readonly head: string;
  readonly word: string;
  readonly pagesSay: string | undefined;
};

const PAGES_SAY = /\bA page (?:says|shows|names them) \*?(?<words>[^*.]+?)\*?\./;

const internalsOf = (glossary: string): readonly Internal[] =>
  entriesOf(glossary)
    .filter((entry) => markOf(entry) === "internal")
    .map((entry) => ({
      head: entry.term,
      word: bareWordOf(entry.term),
      pagesSay: PAGES_SAY.exec(entry.definition)?.groups?.["words"],
    }));

export const isRenamed = (row: OldWord): row is Renamed => row.sweep !== null;

const outOfOrder = (rows: readonly OldWord[]): readonly string[] =>
  rows.slice(1).flatMap((row, index) => {
    const before = rows[index]?.word ?? "";
    return before.toLowerCase() >= row.word.toLowerCase()
      ? [`"${before}" is listed before "${row.word}", out of order or twice`]
      : [];
  });

const unheaded = (rows: readonly OldWord[], heads: ReadonlySet<string>): readonly string[] =>
  rows
    .filter(({ entry }) => !heads.has(entry))
    .map(({ word, entry }) => `"${word}" sits under "${entry}", which heads no glossary entry`);

const unlisted = (rows: readonly OldWord[], glossary: string): readonly string[] => {
  const named = new Set(
    rows.filter((row) => isRenamed(row) && row.state === "pending").map(({ entry }) => entry),
  );
  return entriesOf(glossary)
    .filter((entry) => markOf(entry) === "pending" && !named.has(entry.term))
    .map(({ term }) => `"${term}" is marked pending, but no pending row names its code's word`);
};

type Unwatched = { readonly head: string };

const unwatchedStrays = (notWatched: readonly Unwatched[], glossary: string): readonly string[] => {
  const internal = new Set(internalsOf(glossary).map(({ head }) => head));
  return notWatched
    .filter(({ head }) => !internal.has(head))
    .map(({ head }) => `"${head}" is left unwatched on pages, but it heads no internal entry`);
};

/** What is wrong with the list against the glossary it serves; nothing, when they agree. */
export const listFaults = (
  rows: readonly OldWord[],
  glossary: string,
  notWatched: readonly Unwatched[],
): readonly string[] => {
  const heads = new Set(entriesOf(glossary).map(({ term }) => term));
  return [
    ...outOfOrder(rows),
    ...unheaded(rows, heads),
    ...unlisted(rows, glossary),
    ...unwatchedStrays(notWatched, glossary),
  ];
};

const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `auditRowsOf`, `AUDIT_ACTION`, `HTTPAudit` and `an_audit_row` read as words, and an acronym's plural
 * (`IRIs`) stays whole.
 */
const wordsOfCompounds = (text: string): string =>
  text.replace(/(?<=[a-z\d])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z]{2})/g, " ").replaceAll("_", " ");

/** Bounded by what is not a word character, so a head such as `ui://` is found as well. */
const anyFormOf = (word: string, flags: string): RegExp =>
  new RegExp(`(?<!\\w)${word.split(" ").map(escaped).join("[\\s-]+")}s?(?!\\w)`, flags);

/** Every form, compounds and plurals included, for a word refused outright; whole, otherwise. */
const findsIn = (word: string, anyForm: boolean): ((text: string) => boolean) => {
  if (!anyForm) {
    const whole = new RegExp(`(?<!\\w)${escaped(word)}(?!\\w)`, "i");
    return (text) => whole.test(text);
  }
  const forms = anyFormOf(word, "i");
  return (text) => forms.test(wordsOfCompounds(text));
};

const countIn = (word: string, text: string): number =>
  wordsOfCompounds(text).match(anyFormOf(word, "gi"))?.length ?? 0;

const blankedBy = (text: string, patterns: readonly RegExp[]): string =>
  patterns.reduce(
    (left, pattern) => left.replace(pattern, (found) => " ".repeat(found.length)),
    text,
  );

/**
 * A kept name that is one plain word is the code's only when written as code, so prose naming the
 * same word stays read.
 */
const keptPatternsOf = (kept: readonly string[]): readonly RegExp[] =>
  [...new Set(kept)].map((name) =>
    /^[a-z]+$/i.test(name)
      ? new RegExp(`[\`"']${escaped(name)}[\`"']`, "g")
      : new RegExp(`(?<![\\w./-])${escaped(name)}(?![\\w/-])`, "g"),
  );

export type Finding = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly word: string;
  readonly use: string;
  readonly sweep: string;
};

const holdsAny = (holders: readonly Pick<CarveOut, "holds">[], file: string): boolean =>
  holders.some(({ holds }) => holds(file));

/** A rules file binds every directory, so no carve-out holds it. */
const isCarvedOut = (carveOuts: readonly CarveOut[], file: string): boolean =>
  path.basename(file) !== "CODING_STANDARDS.md" && holdsAny(carveOuts, file);

type LineScan = {
  readonly row: Renamed;
  readonly reads: (file: string) => boolean;
  readonly finds: (text: string) => boolean;
  readonly unexplained: (file: string, text: string) => string;
};

/** `waiting` holds each sweep that still has a pending row. */
const keepsIn = (sense: Sense, file: string, waiting: ReadonlySet<string>): boolean =>
  (sense.within === undefined || file.startsWith(sense.within)) &&
  (sense.until === undefined || waiting.has(sense.until));

const lineScanOf = (
  row: Renamed,
  carvedOut: readonly CarveOut[],
  kept: readonly RegExp[],
  waiting: ReadonlySet<string>,
): LineScan => ({
  row,
  reads: (file) =>
    !isCarvedOut([...carvedOut, ...(row.carvedOut ?? [])], file) && (row.reads?.(file) ?? true),
  finds: findsIn(row.word, row.reach === "everywhere"),
  unexplained: (file, text) =>
    blankedBy(text, [
      ...(row.permitted ?? [])
        .filter((sense) => keepsIn(sense, file, waiting))
        .map(({ written }) => written),
      ...kept,
    ]),
});

const findingOf = (row: Renamed, file: string, index: number, text: string): Finding => ({
  file,
  line: index + 1,
  text: text.trim(),
  word: row.word,
  use: row.use,
  sweep: row.sweep,
});

/** The raw line is tried first, so the blanking runs only on the few lines that name the word. */
const lineFindingsIn = (scans: readonly LineScan[], file: string, text: string): Finding[] =>
  text
    .split("\n")
    .flatMap((line, index) =>
      scans
        .filter((scan) => scan.finds(line) && scan.finds(scan.unexplained(file, line)))
        .map(({ row }) => findingOf(row, file, index, line)),
    );

type Scan = {
  readonly rows: readonly OldWord[];
  readonly carvedOut: readonly CarveOut[];
  readonly kept: readonly string[];
};

const inState = (rows: readonly OldWord[], state: Renamed["state"]): readonly Renamed[] =>
  rows.filter((row): row is Renamed => isRenamed(row) && row.state === state);

const landed = (rows: readonly OldWord[]): readonly Renamed[] => inState(rows, "landed");

const stillPending = (rows: readonly OldWord[]): readonly Renamed[] => inState(rows, "pending");

const A_DAY = /^\d{4}-\d{2}-\d{2}$/;

const overdueIn = ({ word, sweep, landsBy }: Renamed, today: string): readonly string[] => {
  if (landsBy === undefined || !A_DAY.test(landsBy)) {
    return [
      `"${word}" is pending for the ${sweep} sweep, but names no day it lands by, as YYYY-MM-DD`,
    ];
  }
  return landsBy < today
    ? [`"${word}" is still pending, but the ${sweep} sweep was due to land by ${landsBy}`]
    : [];
};

/** Each pending row that names no day its sweep lands by, or whose day is before `today`. */
export const overduePending = (rows: readonly OldWord[], today: string): readonly string[] =>
  stillPending(rows).flatMap((row) => overdueIn(row, today));

/** Every landed word a tracked line still uses, outside its carve-outs and the senses it keeps. */
export const lineFindings = (root: string, { rows, carvedOut, kept }: Scan): readonly Finding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const waiting = new Set(stillPending(rows).map(({ sweep }) => sweep));
  const scans = landed(rows)
    .filter(({ reach }) => reach !== "reader text")
    .map((row) => lineScanOf(row, carvedOut, keptPatterns, waiting));
  return treeFilesUnder(root).flatMap((file) => {
    const reading = scans.filter((scan) => scan.reads(file));
    return reading.length === 0 ? [] : lineFindingsIn(reading, file, readUnder(root, file));
  });
};

type Source = Pick<CarveOut, "holds"> & { readonly name: string };

const WORDS_MODULE = /^apps\/web\/src\/.+words\.ts$/;
const TEMPLATE = /^apps\/api\/src\/(?:.+-email|email-page|auth\/pages)\.ts$/;

/** Where a page's words are written: the files the ratchet counts in. */
const PAGE_WORDS: readonly Source[] = [
  { name: "page words modules", holds: (file) => WORDS_MODULE.test(file) },
  { name: "the navigation", holds: (file) => file === "apps/web/src/shared/navigation.ts" },
];

/** Where a page's words, an MCP tool's text, an answer and an email are written. */
const READER_TEXT: readonly Source[] = [
  ...PAGE_WORDS,
  { name: "MCP entries", holds: (file) => file === "apps/api/src/mcp/entries/index.ts" },
  { name: "answers", holds: (file) => file === "packages/core/src/answering/index.ts" },
  { name: "emails and consent pages", holds: (file) => TEMPLATE.test(file) },
];

const isReaderText = (file: string): boolean => holdsAny(READER_TEXT, file);

const isPageWords = (file: string): boolean => holdsAny(PAGE_WORDS, file);

type ReaderString = { readonly line: number; readonly text: string };

type Node = { readonly type: string; readonly start: number; readonly [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const nameOf = (value: unknown): string =>
  isNode(value) && value.type === "Identifier" ? String(value["name"]) : "";

/** `log.warn(…)` or `ctx.log.warn(…)`: the logger is the callee's object, or that object's property. */
const isLogger = (object: unknown): boolean =>
  nameOf(object) === "log" || (isNode(object) && nameOf(object["property"]) === "log");

/** A thrown error and a log line are written for whoever runs the platform, not for a reader. */
const isForTheOperator = (node: Node): boolean => {
  const callee = node["callee"];
  if (node.type === "NewExpression") return nameOf(callee).endsWith("Error");
  return node.type === "CallExpression" && isNode(callee) && isLogger(callee["object"]);
};

/** A class name with spaces in it is styling, never words. */
const isClassName = (node: Node): boolean => {
  const name = node["name"];
  return node.type === "JSXAttribute" && isNode(name) && name["name"] === "className";
};

const skipsSubtree = (node: Node): boolean =>
  node.type === "TSLiteralType" || isForTheOperator(node) || isClassName(node);

/** Keys and import paths are the code's own; only a value can reach a reader. */
const childrenOf = (node: Node): readonly unknown[] =>
  Object.entries(node)
    .filter(([key]) => key !== "source" && key !== "key")
    .map(([, value]) => value);

const CAPITALISED_WORD = /^[A-Z][a-z]+$/;

const LOWERCASE_WORD = /^[a-z]+$/;

/**
 * No space marks a code token, and one capitalised word a label; a lone lowercase word is a label
 * only in a words module.
 */
const isRead = (text: string, inWordsModule: boolean): boolean =>
  text.trim() !== "" &&
  (/\s/.test(text) || CAPITALISED_WORD.test(text) || (inWordsModule && LOWERCASE_WORD.test(text)));

type Piece = { readonly offset: number; readonly text: string };

const leadingSpaceOf = (text: string): number => text.length - text.trimStart().length;

/** A template's piece is found by its raw text, so a sentence split over lines reports each line. */
const pieceOfQuasi =
  (source: string) =>
  (quasi: unknown): readonly Piece[] => {
    const value = isNode(quasi) ? quasi["value"] : undefined;
    if (!isNode(quasi) || typeof value !== "object" || value === null) return [];
    const raw = "raw" in value ? String(value.raw) : "";
    const cooked = "cooked" in value && typeof value.cooked === "string" ? value.cooked : "";
    return [{ offset: source.indexOf(raw, quasi.start) + leadingSpaceOf(raw), text: cooked }];
  };

const piecesOf = (node: Node, source: string): readonly Piece[] => {
  const value = node["value"];
  if (node.type === "Literal" && typeof value === "string") {
    return [{ offset: node.start, text: value }];
  }
  if (node.type === "JSXText") {
    return [{ offset: node.start + leadingSpaceOf(String(value)), text: String(value) }];
  }
  const quasis = node["quasis"];
  return node.type === "TemplateLiteral" && Array.isArray(quasis)
    ? quasis.flatMap(pieceOfQuasi(source))
    : [];
};

const lineAt = (starts: readonly number[], offset: number): number =>
  starts.findLastIndex((start) => start <= offset) + 1;

const visit = (value: unknown, found: (node: Node) => void): void => {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, found);
    return;
  }
  if (!isNode(value) || skipsSubtree(value)) return;
  found(value);
  for (const child of childrenOf(value)) visit(child, found);
};

/** @throws when the file does not parse, which would otherwise read as holding no words. */
export const readerStringsIn = (file: string, source: string): readonly ReaderString[] => {
  const parsed = parseSync(file, source);
  const [first] = parsed.errors;
  if (first !== undefined) throw new Error(`${file} does not parse: ${first.message}`);
  const starts = [0, ...[...source.matchAll(/\n/g)].map((match) => match.index + 1)];
  const strings: ReaderString[] = [];
  const inWordsModule = WORDS_MODULE.test(file);
  visit(parsed.program, (node) => {
    const read = piecesOf(node, source).filter((piece) => isRead(piece.text, inWordsModule));
    for (const { offset, text } of read) {
      strings.push({ line: lineAt(starts, offset), text: text.trim() });
    }
  });
  return strings;
};

type FileString = ReaderString & { readonly file: string };

const readerStringsUnder = (
  root: string,
  reads: (file: string) => boolean,
): readonly FileString[] =>
  treeFilesUnder(root)
    .filter(reads)
    .flatMap((file) =>
      readerStringsIn(file, readUnder(root, file)).map((one) => ({ file, ...one })),
    );

/** A source with none leaves every check of reader text passing on nothing. */
export const readerStringsPerSource = (root: string): Readonly<Record<string, number>> => {
  const strings = readerStringsUnder(root, isReaderText);
  return Object.fromEntries(
    READER_TEXT.map(
      ({ name, holds }) => [name, strings.filter(({ file }) => holds(file)).length] as const,
    ),
  );
};

/** A string that is a kept name whole, as an MCP schema's `bundles` is, is the code's own. */
const readerTextUnder = (root: string, kept: readonly string[]): readonly FileString[] => {
  const names = new Set(kept);
  return readerStringsUnder(root, isReaderText).filter(({ text }) => !names.has(text));
};

/** Every landed word whose reach is reader text, in what a person reads. */
export const readerFindings = (root: string, { rows, kept }: Scan): readonly Finding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const scans = landed(rows)
    .filter(({ reach }) => reach === "reader text")
    .map((row) => ({ row, finds: findsIn(row.word, true) }));
  return readerTextUnder(root, kept).flatMap(({ file, line, text }) =>
    scans
      .filter(({ finds }) => finds(text) && finds(blankedBy(text, keptPatterns)))
      .map(({ row }) => findingOf(row, file, line - 1, text)),
  );
};

export type InternalFinding = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly internal: Internal;
};

/** A head a pending row still owns stays unwatched until that row's sweep lands. */
const watchedInternals = (
  glossary: string,
  rows: readonly OldWord[],
  notWatched: readonly Unwatched[],
): readonly Internal[] => {
  const unwatched = new Set(notWatched.map(({ head }) => head));
  const stillPending = new Set(
    rows
      .filter((row) => isRenamed(row) && row.state === "pending")
      .map(({ word }) => word.toLowerCase()),
  );
  return internalsOf(glossary).filter(
    ({ head, word }) => !unwatched.has(head) && !stillPending.has(word.toLowerCase()),
  );
};

/** Every internal word a person would read, for the heads not left unwatched. */
export const internalFindings = (
  root: string,
  glossary: string,
  { rows, kept }: Scan,
  notWatched: readonly Unwatched[],
): readonly InternalFinding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const scans = watchedInternals(glossary, rows, notWatched).map((internal) => ({
    internal,
    finds: findsIn(internal.word, true),
  }));
  return readerTextUnder(root, kept).flatMap(({ file, line, text }) => {
    const unexplained = blankedBy(text, keptPatterns);
    return scans
      .filter(({ finds }) => finds(unexplained))
      .map(({ internal }) => ({ file, line, text, internal }));
  });
};

export type Counts = Readonly<Record<string, Readonly<Record<string, number>>>>;

const countsOf = (strings: readonly string[], rows: readonly Renamed[]): Record<string, number> =>
  Object.fromEntries(
    rows
      .map(
        ({ word }) => [word, strings.reduce((sum, text) => sum + countIn(word, text), 0)] as const,
      )
      .filter(([, count]) => count > 0),
  );

/** How often each pending word is still written where a page's words are, file by file. */
export const ratchetCounts = (root: string, rows: readonly OldWord[]): Counts => {
  const counted = stillPending(rows);
  const byFile = new Map<string, string[]>();
  for (const { file, text } of readerStringsUnder(root, isPageWords)) {
    const strings = byFile.get(file) ?? [];
    strings.push(text);
    byFile.set(file, strings);
  }
  return Object.fromEntries(
    [...byFile]
      .map(([file, strings]) => [file, countsOf(strings, counted)] as const)
      .filter(([, counts]) => Object.keys(counts).length > 0)
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
};

/** Each count above its baseline; a count may fall, and a word new to a file starts at none. */
export const ratchetRises = (counts: Counts, baseline: Counts): readonly string[] =>
  Object.entries(counts).flatMap(([file, words]) =>
    Object.entries(words)
      .filter(([word, count]) => count > (baseline[file]?.[word] ?? 0))
      .map(
        ([word, count]) =>
          `${file}: "${word}" ${String(count)} times, against ${String(baseline[file]?.[word] ?? 0)}`,
      ),
  );
