import path from "node:path";

import { parseSync } from "oxc-parser";

import type { CarveOut, OldWord, Sense } from "./old-words.ts";
import { readUnder, treeFilesUnder } from "./tree-walk.ts";

export const GLOSSARY = "CONCEPTS.md";

/** The glossary carries no `Avoid:` line in any emphasis, so an agent reads only the word to write. */
export const AVOID_LIST = /_Avoid_|\bAvoid\b\W{0,3}:/;

const HEADING_HEAD = /^### (?<term>.+?)\s*$/;
const BULLET_ENTRY = /^- \*\*(?<term>.+?)\*\* — /;
const TAIL = /^## (?:Flagged ambiguities|Retired)\s*$/;

type Entry = { readonly term: string; readonly definition: string };

type Line = { readonly text: string; readonly inTail: boolean };

const linesOf = (glossary: string): readonly Line[] => {
  let inTail = false;
  return glossary.split("\n").map((text) => {
    if (text.startsWith("## ")) inTail = TAIL.test(text);
    return { text, inTail };
  });
};

const grown = (entry: Entry, line: string): Entry => ({
  term: entry.term,
  definition: `${entry.definition} ${line.trim()}`.trim(),
});

const headOf = ({ text, inTail }: Line): string | undefined =>
  inTail ? undefined : HEADING_HEAD.exec(text)?.groups?.["term"];

const closes = ({ text, inTail }: Line): boolean => inTail || text.startsWith("#");

/** An entry is a `### head` heading, as Compound Engineering writes one, outside the two tails. */
export const entriesOf = (glossary: string): readonly Entry[] => {
  const entries: Entry[] = [];
  let open: Entry | undefined;
  for (const line of linesOf(glossary)) {
    const term = headOf(line);
    if (term !== undefined) {
      open = { term, definition: "" };
      entries.push(open);
    } else if (closes(line)) {
      open = undefined;
    } else if (open !== undefined && line.text.trim() !== "") {
      open = grown(open, line.text);
      entries[entries.length - 1] = open;
    }
  }
  return entries;
};

const unreadAt = ({ text, inTail }: Line, number: number): readonly string[] => {
  const where = `line ${String(number)}: "${text}"`;
  if (inTail) {
    return HEADING_HEAD.test(text)
      ? [`${where} sits under a tail, which holds no entry; move it into its cluster`]
      : [];
  }
  const term = BULLET_ENTRY.exec(text)?.groups?.["term"];
  return term === undefined ? [] : [`${where} is a bullet; write it as "### ${term}"`];
};

/** Each entry written where `entriesOf` would not read it: as a bullet, or under a tail. */
export const unreadEntriesIn = (glossary: string): readonly string[] =>
  linesOf(glossary).flatMap((line, index) => unreadAt(line, index + 1));

const isInternal = ({ definition }: Entry): boolean => definition.startsWith("_Internal._");

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
    .filter(isInternal)
    .map((entry) => ({
      head: entry.term,
      word: bareWordOf(entry.term),
      pagesSay: PAGES_SAY.exec(entry.definition)?.groups?.["words"],
    }));

/** Each listed head the glossary no longer heads with `_Internal._`; a head marked unlisted passes. */
export const unmarkedInternals = (
  listed: readonly string[],
  glossary: string,
): readonly string[] => {
  const marked = new Set(internalsOf(glossary).map(({ head }) => head));
  return listed
    .filter((head) => !marked.has(head))
    .map(
      (head) => `"${head}" is listed internal, but no glossary entry under it opens _Internal._`,
    );
};

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
  return [...outOfOrder(rows), ...unheaded(rows, heads), ...unwatchedStrays(notWatched, glossary)];
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
  readonly row: OldWord;
  readonly reads: (file: string) => boolean;
  readonly finds: (text: string) => boolean;
  readonly unexplained: (file: string, text: string) => string;
};

const keepsIn = (sense: Sense, file: string): boolean =>
  sense.within === undefined || file.startsWith(sense.within);

const lineScanOf = (
  row: OldWord,
  carvedOut: readonly CarveOut[],
  kept: readonly RegExp[],
): LineScan => ({
  row,
  reads: (file) =>
    !isCarvedOut([...carvedOut, ...(row.carvedOut ?? [])], file) && (row.reads?.(file) ?? true),
  finds: findsIn(row.word, row.reach === "everywhere"),
  unexplained: (file, text) =>
    blankedBy(text, [
      ...(row.permitted ?? [])
        .filter((sense) => keepsIn(sense, file))
        .map(({ written }) => written),
      ...kept,
    ]),
});

const findingOf = (row: OldWord, file: string, index: number, text: string): Finding => ({
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

/** Every old word a tracked line still uses, outside its carve-outs and the senses it keeps. */
export const lineFindings = (root: string, { rows, carvedOut, kept }: Scan): readonly Finding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const scans = rows
    .filter(({ reach }) => reach !== "reader text")
    .map((row) => lineScanOf(row, carvedOut, keptPatterns));
  return treeFilesUnder(root).flatMap((file) => {
    const reading = scans.filter((scan) => scan.reads(file));
    return reading.length === 0 ? [] : lineFindingsIn(reading, file, readUnder(root, file));
  });
};

type Source = Pick<CarveOut, "holds"> & { readonly name: string };

const WORDS_MODULE = /^apps\/web\/src\/.+words\.ts$/;
const TEMPLATE = /^apps\/api\/src\/(?:.+-email|email-page|auth\/pages)\.ts$/;

/** Where a page's words, an MCP tool's text, an answer and an email are written. */
const READER_TEXT: readonly Source[] = [
  { name: "page words modules", holds: (file) => WORDS_MODULE.test(file) },
  { name: "the navigation", holds: (file) => file === "apps/web/src/shared/navigation.ts" },
  { name: "MCP entries", holds: (file) => file === "apps/api/src/mcp/entries/index.ts" },
  { name: "answers", holds: (file) => file === "packages/core/src/answering/index.ts" },
  { name: "emails and consent pages", holds: (file) => TEMPLATE.test(file) },
];

const isReaderText = (file: string): boolean => holdsAny(READER_TEXT, file);

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

/** Every old word whose reach is reader text, in what a person reads. */
export const readerFindings = (root: string, { rows, kept }: Scan): readonly Finding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const scans = rows
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

const watchedInternals = (
  glossary: string,
  notWatched: readonly Unwatched[],
): readonly Internal[] => {
  const unwatched = new Set(notWatched.map(({ head }) => head));
  return internalsOf(glossary).filter(({ head }) => !unwatched.has(head));
};

/** Every internal word a person would read, for the heads not left unwatched. */
export const internalFindings = (
  root: string,
  glossary: string,
  { kept }: Scan,
  notWatched: readonly Unwatched[],
): readonly InternalFinding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const scans = watchedInternals(glossary, notWatched).map((internal) => ({
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
