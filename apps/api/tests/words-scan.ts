import path from "node:path";

import { parseSync } from "oxc-parser";

import type { CarveOut, OldWord, Renamed } from "./old-words.ts";
import { readUnder, treeFilesUnder } from "./tree-walk.ts";

export const GLOSSARY = "CONTEXT.md";

const ENTRY_HEAD = /^- \*\*(?<term>.+?)\*\* — (?<rest>.*)$/;

export type Entry = { readonly term: string; readonly text: string };

export const entriesOf = (glossary: string): readonly Entry[] => {
  const entries: Entry[] = [];
  let open: Entry | undefined;
  for (const line of glossary.split("\n")) {
    const term = ENTRY_HEAD.exec(line)?.groups?.["term"];
    if (term !== undefined) {
      open = { term, text: line };
      entries.push(open);
    } else if (open !== undefined && line.startsWith("  ")) {
      const grown: Entry = { term: open.term, text: `${open.text} ${line.trim()}` };
      entries[entries.length - 1] = grown;
      open = grown;
    } else {
      open = undefined;
    }
  }
  return entries;
};

const markOf = ({ text }: Entry): "internal" | "pending" | undefined => {
  const rest = ENTRY_HEAD.exec(text)?.groups?.["rest"] ?? "";
  if (rest.startsWith("_Internal._")) return "internal";
  if (rest.startsWith("_Code rename pending._")) return "pending";
  return undefined;
};

/** A head's qualifier tells entries apart in the glossary; a page writes the word alone. */
const bareWordOf = (head: string): string => head.replace(/ \(.*\)$/, "").replaceAll("`", "");

export type Internal = { readonly head: string; readonly word: string; readonly pagesSay?: string };

const PAGES_SAY = /\bA page (?:says|shows|names them) \*?(?<words>[^*.]+?)\*?\./;

export const internalsOf = (glossary: string): readonly Internal[] =>
  entriesOf(glossary)
    .filter((entry) => markOf(entry) === "internal")
    .map((entry) => {
      const pagesSay = PAGES_SAY.exec(entry.text)?.groups?.["words"];
      const word = bareWordOf(entry.term);
      return pagesSay === undefined
        ? { head: entry.term, word }
        : { head: entry.term, word, pagesSay };
    });

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

const unwatchedStrays = (
  notWatched: readonly { readonly head: string }[],
  glossary: string,
): readonly string[] => {
  const internal = new Set(internalsOf(glossary).map(({ head }) => head));
  return notWatched
    .filter(({ head }) => !internal.has(head))
    .map(({ head }) => `"${head}" is left unwatched on pages, but it heads no internal entry`);
};

/** What is wrong with the list against the glossary it serves; nothing, when they agree. */
export const listFaults = (
  rows: readonly OldWord[],
  glossary: string,
  notWatched: readonly { readonly head: string }[],
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

/** `auditRowsOf`, `AUDIT_ACT` and `an_audit_row` read as words, so a word is seen inside each. */
export const wordsOfCompounds = (text: string): string =>
  text.replace(/(?<=[a-z\d])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ").replaceAll("_", " ");

const anyFormOf = (word: string, flags: string): RegExp =>
  new RegExp(`\\b${word.split(" ").map(escaped).join("[\\s-]+")}s?\\b`, flags);

/** Every form, compounds and plurals included, for a word refused outright; whole, otherwise. */
export const findsIn = (word: string, anyForm: boolean): ((text: string) => boolean) => {
  if (!anyForm) {
    const whole = new RegExp(`\\b${escaped(word)}\\b`, "i");
    return (text) => whole.test(text);
  }
  const forms = anyFormOf(word, "i");
  return (text) => forms.test(wordsOfCompounds(text));
};

export const countIn = (word: string, text: string): number =>
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
export const keptPatternsOf = (kept: readonly string[]): readonly RegExp[] =>
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

const holdsAny = (carveOuts: readonly CarveOut[], file: string): boolean =>
  carveOuts.some(({ holds }) => holds(file));

/** A rules file binds every directory, so no carve-out holds it. */
const isCarvedOut = (carveOuts: readonly CarveOut[], file: string): boolean =>
  path.basename(file) !== "CODING_STANDARDS.md" && holdsAny(carveOuts, file);

type LineScan = {
  readonly row: Renamed;
  readonly reads: (file: string) => boolean;
  readonly finds: (text: string) => boolean;
  readonly unexplained: (file: string, text: string) => string;
};

const lineScanOf = (
  row: Renamed,
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
        .filter(({ within }) => within === undefined || file.startsWith(within))
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

export type Scan = {
  readonly rows: readonly OldWord[];
  readonly carvedOut: readonly CarveOut[];
  readonly kept: readonly string[];
};

const landed = (rows: readonly OldWord[]): readonly Renamed[] =>
  rows.filter((row): row is Renamed => isRenamed(row) && row.state === "landed");

/** Every landed word a tracked line still uses, outside its carve-outs and the senses it keeps. */
export const lineFindings = (root: string, { rows, carvedOut, kept }: Scan): readonly Finding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const scans = landed(rows)
    .filter(({ reach }) => reach !== "reader text")
    .map((row) => lineScanOf(row, carvedOut, keptPatterns));
  return treeFilesUnder(root).flatMap((file) => {
    const reading = scans.filter((scan) => scan.reads(file));
    return reading.length === 0 ? [] : lineFindingsIn(reading, file, readUnder(root, file));
  });
};

const WORDS_MODULE = /^apps\/web\/src\/.+words\.ts$/;
const NAVIGATION = "apps/web/src/shared/navigation.ts";
const MCP_AND_ANSWERS = new Set([
  "apps/api/src/mcp/entries/index.ts",
  "packages/core/src/answering/index.ts",
]);
const TEMPLATE = /^apps\/api\/src\/(?:.+-email|email-page|auth\/pages)\.ts$/;

/** Where a page's words, an MCP tool's text, an answer and an email are written. */
export const isReaderText = (file: string): boolean =>
  WORDS_MODULE.test(file) ||
  file === NAVIGATION ||
  MCP_AND_ANSWERS.has(file) ||
  TEMPLATE.test(file);

/** The files the ratchet counts in: where a page's words are written. */
export const isPageWords = (file: string): boolean =>
  WORDS_MODULE.test(file) || file === NAVIGATION;

export type ReaderString = { readonly line: number; readonly text: string };

type Node = { readonly type: string; readonly start: number; readonly [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const SKIPPED_TYPES = new Set([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "TSLiteralType",
  "TSImportType",
  "TSExternalModuleReference",
]);

const LOGGERS = new Set(["log", "logger", "console"]);

const calleeNameOf = (node: Node): string | undefined => {
  const callee = node["callee"];
  if (!isNode(callee)) return undefined;
  if (callee.type === "Identifier") return String(callee["name"]);
  const object = callee["object"];
  return isNode(object) && object.type === "Identifier" ? `${String(object["name"])}.` : undefined;
};

/** A thrown error and a log line are written for whoever runs the platform, not for a reader. */
const isForTheOperator = (node: Node): boolean => {
  const name = calleeNameOf(node) ?? "";
  if (node.type === "NewExpression") return name.endsWith("Error");
  return node.type === "CallExpression" && LOGGERS.has(name.replace(/\.$/, ""));
};

const NOT_READ = new Set([
  "className",
  "class",
  "style",
  "id",
  "key",
  "href",
  "src",
  "data-testid",
]);

const attributeNameOf = (node: Node): string => {
  const name = node["name"];
  return isNode(name) ? String(name["name"]) : "";
};

const skipsSubtree = (node: Node): boolean =>
  SKIPPED_TYPES.has(node.type) ||
  isForTheOperator(node) ||
  (node.type === "JSXAttribute" && NOT_READ.has(attributeNameOf(node)));

/** Keys and import paths are the code's own; only a value can reach a reader. */
const childrenOf = (node: Node): readonly unknown[] =>
  Object.entries(node)
    .filter(([key]) => key !== "source" && key !== "key")
    .map(([, value]) => value);

const CAPITALISED_WORD = /^[A-Z][a-z]+$/;

/**
 * No space marks an identifier, a path or a key; one capitalised word is a label, and a template
 * fragment keeps its joining space.
 */
const isRead = (text: string): boolean =>
  text.trim() !== "" && (/\s/.test(text) || CAPITALISED_WORD.test(text));

const quasiTextOf = (quasi: unknown): string => {
  const value = isNode(quasi) ? quasi["value"] : undefined;
  if (typeof value !== "object" || value === null) return "";
  if ("cooked" in value && typeof value.cooked === "string") return value.cooked;
  return "raw" in value ? String(value.raw) : "";
};

const textOf = (node: Node): readonly string[] => {
  if (node.type === "Literal" && typeof node["value"] === "string") return [node["value"]];
  if (node.type === "JSXText") return [String(node["value"])];
  const quasis = node["quasis"];
  return node.type === "TemplateLiteral" && Array.isArray(quasis) ? quasis.map(quasiTextOf) : [];
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

/** The strings and JSX text a person reads in one source file, each with its line. */
export const readerStringsIn = (file: string, source: string): readonly ReaderString[] => {
  const starts = [0, ...[...source.matchAll(/\n/g)].map((match) => match.index + 1)];
  const strings: ReaderString[] = [];
  visit(parseSync(file, source).program, (node) => {
    for (const text of textOf(node).filter(isRead)) {
      strings.push({ line: lineAt(starts, node.start), text: text.trim() });
    }
  });
  return strings;
};

const readerStringsUnder = (
  root: string,
  reads: (file: string) => boolean,
): readonly (ReaderString & { readonly file: string })[] =>
  treeFilesUnder(root)
    .filter(reads)
    .flatMap((file) =>
      readerStringsIn(file, readUnder(root, file)).map((one) => ({ file, ...one })),
    );

/** Every landed word whose reach is reader text, in what a person reads. */
export const readerFindings = (root: string, { rows, kept }: Scan): readonly Finding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const scans = landed(rows)
    .filter(({ reach }) => reach === "reader text")
    .map((row) => ({ row, finds: findsIn(row.word, true) }));
  return readerStringsUnder(root, isReaderText).flatMap(({ file, line, text }) =>
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
  notWatched: readonly { readonly head: string }[],
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
  notWatched: readonly { readonly head: string }[],
): readonly InternalFinding[] => {
  const keptPatterns = keptPatternsOf(kept);
  const scans = watchedInternals(glossary, rows, notWatched).map((internal) => ({
    internal,
    finds: findsIn(internal.word, true),
  }));
  return readerStringsUnder(root, isReaderText).flatMap(({ file, line, text }) =>
    scans
      .filter(({ finds }) => finds(blankedBy(text, keptPatterns)))
      .map(({ internal }) => ({ file, line, text, internal })),
  );
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
  const counted = rows.filter((row): row is Renamed => isRenamed(row) && row.state === "pending");
  const byFile = new Map<string, string[]>();
  for (const { file, text } of readerStringsUnder(root, isPageWords)) {
    byFile.set(file, [...(byFile.get(file) ?? []), text]);
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
