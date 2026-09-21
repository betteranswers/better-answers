import { createHash } from "node:crypto";

import { citedSourcesOf, resolvedResource } from "@better-answers/schema";

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

// Keys the platform derives or mints: hashing one would let recording a check move the hash
// that check was taken against.
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

export const canonicalFrontmatter = (frontmatter: Frontmatter, path: string): string =>
  canonicalOver(frontmatter, reducedSources(frontmatter["sources"], path));

const canonicalOver = (frontmatter: Frontmatter, sources: readonly HashedSource[]): string => {
  const pairs = Object.keys(frontmatter)
    .toSorted()
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
                .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
                .map((key) => `${JSON.stringify(key)}:${JSON.stringify(item[key])}`)
                .join(",")}}`
            : JSON.stringify(item),
        )
        .join(",")}]`
    : JSON.stringify(value);

export const contentHashOf = (frontmatter: Frontmatter, body: string, path: string): string =>
  hashedFileOf(frontmatter, body, path).contentHash;

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

export const renderConceptFile = (frontmatter: Frontmatter, body: string): string => {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${JSON.stringify(key)}:${yamlValue(value)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${normalisedBody(body)}`;
};

const FRONTMATTER_LINE = /^("(?:[^"\\]|\\.)*"):(?: (.*))?$/;

const scalarOf = (text: string): string | number | boolean | null | undefined => {
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

const pairOf = (
  line: string,
): { readonly key: string; readonly rest: string | undefined } | undefined => {
  const match = FRONTMATTER_LINE.exec(line);
  const key = match?.[1] === undefined ? undefined : scalarOf(match[1]);
  return match === null || typeof key !== "string" ? undefined : { key, rest: match[2] };
};

const listItemsOf = (
  lines: readonly string[],
  from: number,
  close: number,
):
  | { readonly value: readonly string[] | readonly FrontmatterSource[]; readonly next: number }
  | undefined => {
  const strings: string[] = [];
  const entries: FrontmatterSource[] = [];
  let at = from;
  while (at < close && (lines[at] ?? "").startsWith("  - ")) {
    const opener = (lines[at] ?? "").slice(4);
    at += 1;
    let field = pairOf(opener);
    if (field === undefined) {
      const item = scalarOf(opener);
      if (typeof item !== "string") return undefined;
      strings.push(item);
      continue;
    }
    const entry: Record<string, string | number | boolean | null> = {};

    for (;;) {
      const value = field.rest === undefined ? undefined : scalarOf(field.rest);
      if (value === undefined) return undefined;
      entry[field.key] = value;
      const continuation = lines[at] ?? "";
      if (at >= close || !continuation.startsWith("    ")) break;
      field = pairOf(continuation.slice(4));
      if (field === undefined) return undefined;
      at += 1;
    }
    entries.push(entry);
  }
  if (at === from || (strings.length > 0 && entries.length > 0)) return undefined;
  return { value: entries.length > 0 ? entries : strings, next: at };
};

export const parseConceptFile = (
  content: string,
): Result<{ readonly frontmatter: Frontmatter; readonly body: string }, "malformed"> => {
  const lines = content.split("\n");
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (close === -1 || lines[close + 1] !== "") return err("malformed");
  const frontmatter: Record<string, FrontmatterValue> = {};
  let at = 1;
  while (at < close) {
    const pair = pairOf(lines[at] ?? "");

    if (pair === undefined || Object.hasOwn(frontmatter, pair.key)) return err("malformed");
    at += 1;
    if (pair.rest !== undefined) {
      const value = pair.rest === "[]" ? [] : scalarOf(pair.rest);
      if (value === undefined) return err("malformed");
      frontmatter[pair.key] = value;
      continue;
    }
    const items = listItemsOf(lines, at, close);
    if (items === undefined) return err("malformed");
    frontmatter[pair.key] = items.value;
    at = items.next;
  }
  return ok({ frontmatter, body: lines.slice(close + 2).join("\n") });
};
