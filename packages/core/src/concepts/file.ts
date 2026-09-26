import { createHash } from "node:crypto";

import { citedSourcesOf, resolvedResource } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { err, ok, type Result } from "../kernel/index.ts";

export type FrontmatterSource = Readonly<Record<string, string | number | boolean | null>>;

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly FrontmatterSource[];

export type Frontmatter = Readonly<Record<string, FrontmatterValue>>;

/**
 * Keys the platform derives or mints: hashing one would let recording a check move the hash
 * that check was taken against.
 */
const UNHASHED_KEYS: ReadonlySet<string> = new Set([
  "generated",
  "verified",
  "stale_after",
  "status",
  "iri",
]);

const normalisedBody = (body: string): string =>
  `${body
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")}\n`;

export type HashedSource = readonly [string, string | null];

type HashedFile = {
  readonly contentHash: string;
  readonly sources: readonly HashedSource[];
};

const reducedSources = (
  value: FrontmatterValue | undefined,
  path: string,
): readonly HashedSource[] =>
  citedSourcesOf(value).map((cited) => [resolvedResource(cited.resource, path), cited.locator]);

/** The text the hash reads: keys sorted, derived keys left out, sources resolved against `path`. */
export const canonicalFrontmatter = (frontmatter: Frontmatter, path: string): string =>
  canonicalOver(frontmatter, reducedSources(frontmatter["sources"], path));

const canonicalOver = (frontmatter: Frontmatter, sources: readonly HashedSource[]): string => {
  const pairs = Object.keys(frontmatter)
    .toSorted(byCodeUnit)
    .filter((key) => !UNHASHED_KEYS.has(key))
    .map((key) => {
      const text = key === "sources" ? JSON.stringify(sources) : canonicalText(frontmatter[key]);
      return `${JSON.stringify(key)}:${text}`;
    });
  return `{${pairs.join(",")}}`;
};

const canonicalText = (value: FrontmatterValue | undefined): string =>
  Array.isArray(value)
    ? `[${value
        .map((item) =>
          typeof item === "object" && item !== null
            ? `{${Object.keys(item)
                .toSorted(byCodeUnit)
                .map((key) => `${JSON.stringify(key)}:${JSON.stringify(item[key])}`)
                .join(",")}}`
            : JSON.stringify(item),
        )
        .join(",")}]`
    : JSON.stringify(value);

/**
 * Hex SHA-256 of `canonicalFrontmatter` and the body. CRLF line endings, trailing whitespace and
 * trailing blank lines in the body do not move it.
 */
export const contentHashOf = (frontmatter: Frontmatter, body: string, path: string): string =>
  hashedFileOf(frontmatter, body, path).contentHash;

/** `contentHashOf`, with the resolved `[resource, locator]` pairs it hashed. */
export const hashedFileOf = (frontmatter: Frontmatter, body: string, path: string): HashedFile => {
  const sources = reducedSources(frontmatter["sources"], path);
  const contentHash = createHash("sha256")
    .update(`${canonicalOver(frontmatter, sources)}\n${normalisedBody(body)}`, "utf8")
    .digest("hex");
  return { contentHash, sources };
};

const yamlEntry = (entry: FrontmatterSource): string =>
  Object.entries(entry)
    .map(
      ([key, value], index) =>
        `${index === 0 ? "  - " : "    "}${JSON.stringify(key)}: ${JSON.stringify(value)}`,
    )
    .join("\n");

const yamlValue = (value: FrontmatterValue): string => {
  if (!Array.isArray(value)) return ` ${JSON.stringify(value)}`;
  if (value.length === 0) return " []";
  return `\n${value
    .map((item) =>
      typeof item === "object" && item !== null ? yamlEntry(item) : `  - ${JSON.stringify(item)}`,
    )
    .join("\n")}`;
};

/**
 * Writes every key and scalar JSON-quoted, in `frontmatter`'s order: the one form
 * `parseConceptFile` reads.
 */
export const renderConceptFile = (frontmatter: Frontmatter, body: string): string => {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${JSON.stringify(key)}:${yamlValue(value)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${normalisedBody(body)}`;
};

const FRONTMATTER_LINE = /^("(?:[^"\\]|\\.)*"):(?: (.*))?$/;

const scalarOf = (text: string | undefined): string | number | boolean | null | undefined => {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

type Pair = { readonly key: string; readonly rest: string | undefined };

const pairOf = (line: string): Pair | undefined => {
  const match = FRONTMATTER_LINE.exec(line);
  const key = scalarOf(match?.[1]);
  return match === null || typeof key !== "string" ? undefined : { key, rest: match[2] };
};

/** Reads one `"key": <JSON scalar>` line; `undefined` for a line of any other form. */
export const scalarPairOf = (
  line: string,
): { readonly key: string; readonly value: FrontmatterSource[string] } | undefined => {
  const pair = pairOf(line);
  const value = scalarOf(pair?.rest);
  return pair === undefined || value === undefined ? undefined : { key: pair.key, value };
};

type Parsed<T> = { readonly value: T; readonly next: number };

const entryOf = (
  lines: readonly string[],
  first: Pair,
  from: number,
  close: number,
): Parsed<FrontmatterSource> | undefined => {
  const entry: Record<string, string | number | boolean | null> = {};
  let field = first;
  let at = from;
  for (;;) {
    const value = scalarOf(field.rest);
    if (value === undefined) return undefined;
    entry[field.key] = value;
    const continuation = lines[at] ?? "";
    if (at >= close || !continuation.startsWith("    ")) break;
    const next = pairOf(continuation.slice(4));
    if (next === undefined) return undefined;
    field = next;
    at += 1;
  }
  return { value: entry, next: at };
};

const itemOf = (
  lines: readonly string[],
  at: number,
  close: number,
): Parsed<string | FrontmatterSource> | undefined => {
  const opener = (lines[at] ?? "").slice(4);
  const field = pairOf(opener);
  if (field !== undefined) return entryOf(lines, field, at + 1, close);
  const item = scalarOf(opener);
  return typeof item === "string" ? { value: item, next: at + 1 } : undefined;
};

const listOf = (
  items: readonly (string | FrontmatterSource)[],
): readonly string[] | readonly FrontmatterSource[] | undefined => {
  const strings = items.filter((item) => typeof item === "string");
  const entries = items.filter((item) => typeof item !== "string");
  if (items.length === 0 || (strings.length > 0 && entries.length > 0)) return undefined;
  return entries.length > 0 ? entries : strings;
};

const listItemsOf = (
  lines: readonly string[],
  from: number,
  close: number,
): Parsed<readonly string[] | readonly FrontmatterSource[]> | undefined => {
  const items: (string | FrontmatterSource)[] = [];
  let at = from;
  while (at < close && (lines[at] ?? "").startsWith("  - ")) {
    const item = itemOf(lines, at, close);
    if (item === undefined) return undefined;
    items.push(item.value);
    at = item.next;
  }
  const value = listOf(items);
  return value === undefined ? undefined : { value, next: at };
};

const valueOf = (
  lines: readonly string[],
  pair: Pair,
  from: number,
  close: number,
): Parsed<FrontmatterValue> | undefined => {
  if (pair.rest === undefined) return listItemsOf(lines, from, close);
  const value = pair.rest === "[]" ? [] : scalarOf(pair.rest);
  return value === undefined ? undefined : { value, next: from };
};

const frontmatterAbove = (lines: readonly string[], close: number): Frontmatter | undefined => {
  const frontmatter: Record<string, FrontmatterValue> = {};
  let at = 1;
  while (at < close) {
    const pair = pairOf(lines[at] ?? "");
    if (pair === undefined || Object.hasOwn(frontmatter, pair.key)) return undefined;
    const parsed = valueOf(lines, pair, at + 1, close);
    if (parsed === undefined) return undefined;
    frontmatter[pair.key] = parsed.value;
    at = parsed.next;
  }
  return frontmatter;
};

/**
 * Reads back only the form `renderConceptFile` writes: JSON-quoted keys and scalars, and lists of
 * strings or of flat mappings. Any other line, a repeated key, or no blank line after the closing
 * fence is `malformed`.
 */
export const parseConceptFile = (
  content: string,
): Result<{ readonly frontmatter: Frontmatter; readonly body: string }, "malformed"> => {
  const lines = content.split("\n");
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (close === -1 || lines[close + 1] !== "") return err("malformed");
  const frontmatter = frontmatterAbove(lines, close);
  return frontmatter === undefined
    ? err("malformed")
    : ok({ frontmatter, body: lines.slice(close + 2).join("\n") });
};
