import { createHash } from "node:crypto";

import { citedSourceOf, resolvedResource } from "@better-answers/schema";

import { err, ok, type Result } from "../kernel/index.ts";

/**
 * The **concept-file grammar**: what the governed write puts in the bundle and how the
 * platform reads it back (ADRs 0002, 0012, 0014, 0019). Three things, one shape —
 *
 * - `renderConceptFile` writes the file: quoted-key YAML frontmatter between `---` fences,
 *   then the body as ADR 0014 normalises it;
 * - `parseConceptFile` is its inverse and deliberately no more: the bundle is written only
 *   by the app, so every file on the ref was rendered here, and a reader that accepted more
 *   would read some files differently from the Python tier's parser, which the nightly audit
 *   cross-checks against this one hash by hash (T-057);
 * - `contentHashOf` is the hash a check confirms — SHA-256 over the canonical frontmatter
 *   (trust and identity keys dropped, `sources[]` reduced to `(resource, locator)` pairs) and
 *   the normalised body — which is why the reduction and the normalisation live beside the
 *   renderer and nowhere else.
 *
 * Nothing here touches a store or a principal: it is the one place the file's bytes are
 * decided, imported by the governed write for the live act and by the reconciler for the
 * replay, so the two roads cannot disagree about what a file says.
 */

/**
 * One `sources[]` entry (`docs/okf-v02.md`): OKF's provenance object — `resource` required,
 * `id`, `title`, `author`, `usage_count`, `last_modified` — and the platform's `locator`
 * beside them — one of the two keys the platform may add to a concept file at all (ADR 0002).
 */
export type FrontmatterSource = Readonly<Record<string, string | number | boolean | null>>;

/**
 * An OKF frontmatter value: scalars, string lists, and the one list of objects the spec
 * defines. One level of nesting and no more, which is what the boundary narrows to.
 */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly FrontmatterSource[];

export type Frontmatter = Readonly<Record<string, FrontmatterValue>>;

/**
 * The frontmatter keys ADR 0014's content hash leaves out: the trust the platform derives
 * and the identity it minted. Hashing them would make a check of its own recording move the
 * hash and turn *Checked* into *Changed since checked* on the next read.
 */
const UNHASHED_KEYS: ReadonlySet<string> = new Set([
  "generated",
  "verified",
  "stale_after",
  "status",
  "iri",
]);

/** The body as ADR 0014 normalises it: `\r\n` to `\n`, no trailing whitespace, one final newline. */
const normalisedBody = (body: string): string =>
  `${body
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")}\n`;

// `resolvedResource` — the hash's path resolution — is the boundary's (`@better-answers/schema`),
// beside `citedSourceOf` and for the same reason: the graph door's delta resolves the same
// references, and two resolutions would be two chances to disagree about which concept a
// file names (ADR 0019).

/** One `sources[]` entry as the hash carries it: the resolved resource, then the locator. */
export type HashedSource = readonly [string, string | null];

/**
 * `sources[]` **reduced to ordered `(resource, locator)` pairs** with paths resolved — ADR
 * 0019's own reduction, and what makes a source-title fix or a `usage_count` update leave a
 * check standing while a swapped source un-checks it.
 */
export const reducedSources = (
  value: FrontmatterValue | undefined,
  path: string,
): readonly HashedSource[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const cited = citedSourceOf(entry);
    return cited === undefined ? [] : [[resolvedResource(cited.resource, path), cited.locator]];
  });
};

/**
 * The frontmatter as ADR 0014's hash reads it, written straight as canonical JSON: keys
 * sorted, the trust and identity keys dropped, `sources[]` reduced. A string rather than an
 * object, because the object was never anything but a step on the way to these bytes.
 */
const canonicalFrontmatter = (frontmatter: Frontmatter, path: string): string => {
  const pairs = Object.keys(frontmatter)
    .toSorted()
    .filter((key) => !UNHASHED_KEYS.has(key))
    .map((key) => {
      const value = frontmatter[key];
      const reduced = key === "sources" ? reducedSources(value, path) : value;
      return `${JSON.stringify(key)}:${JSON.stringify(reduced)}`;
    });
  return `{${pairs.join(",")}}`;
};

/**
 * The content hash a check confirms (ADR 0014, ADR 0019): SHA-256 over the canonical JSON of
 * the frontmatter — trust and identity keys removed, `sources[]` reduced to its ordered
 * `(resource, locator)` pairs — and the normalised body.
 *
 * RFC 8785's canonicalisation is *sorted keys, no insignificant whitespace*, which is what
 * this produces for the one shape a concept's frontmatter can hold: scalars, string lists and
 * `sources[]`'s objects, whose own keys never reach the hash because the reduction replaces
 * them with a pair. The concept's own path is an argument because the reduction resolves a
 * relative `resource` against it.
 */
export const contentHashOf = (frontmatter: Frontmatter, body: string, path: string): string =>
  createHash("sha256")
    .update(`${canonicalFrontmatter(frontmatter, path)}\n${normalisedBody(body)}`, "utf8")
    .digest("hex");

/** One `sources[]` entry as YAML: a block of quoted keys under a list dash. */
const yamlEntry = (entry: FrontmatterSource): string =>
  Object.entries(entry)
    .map(
      ([key, value], index) =>
        `${index === 0 ? "  - " : "    "}${JSON.stringify(key)}: ${JSON.stringify(value)}`,
    )
    .join("\n");

/** One frontmatter value as YAML: a list over lines, everything else as JSON, which YAML reads. */
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
 * The file as it lands in the bundle: YAML frontmatter between `---` fences, then the body.
 * Keys keep the order they were given, because that is the order a person wrote them and
 * the file is the thing a company keeps; the content hash above is what needs an order
 * nobody chose, and it sorts its own.
 *
 * **Every key is quoted**, not only every value. A concept's frontmatter is open — OKF's keys
 * plus whatever else the file carried, preserved verbatim (ADR 0019) — so a key holding a
 * colon, a `#` or a leading `-` would otherwise write YAML that parses as something else.
 * JSON is a subset of YAML 1.2, so quoting is all that is needed and any YAML parser reads
 * the result back, which is what "readable by any OKF tool" (ADR 0012) has to mean for a file
 * this tier writes and the Python tier parses.
 */
export const renderConceptFile = (frontmatter: Frontmatter, body: string): string => {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${JSON.stringify(key)}:${yamlValue(value)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${normalisedBody(body)}`;
};

/** One line of the frontmatter as the renderer writes it: a JSON-quoted key, a colon, then a value or nothing. */
const FRONTMATTER_LINE = /^("(?:[^"\\]|\\.)*"):(?: (.*))?$/;

/** A JSON text read as one scalar the frontmatter may hold, or nothing for anything else. */
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
    // Text that is not JSON is a line the renderer never wrote, and "no scalar" is the
    // whole of what a caller needs to know about it — the parse below answers `malformed`.
    return undefined;
  }
};

/** A frontmatter line split into its key and what follows the colon — `undefined` when a list follows. */
const pairOf = (
  line: string,
): { readonly key: string; readonly rest: string | undefined } | undefined => {
  const match = FRONTMATTER_LINE.exec(line);
  const key = match?.[1] === undefined ? undefined : scalarOf(match[1]);
  return match === null || typeof key !== "string" ? undefined : { key, rest: match[2] };
};

/**
 * The items of one list, from the line after its key: `  - ` opens an item, and an entry's
 * later fields sit indented beneath it. A list is strings or OKF's objects and never a mix —
 * the renderer writes no other shape, so a mix is a file it did not write.
 */
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
    while (field !== undefined) {
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
  if (strings.length > 0 && entries.length > 0) return undefined;
  return { value: entries.length > 0 ? entries : strings, next: at };
};

/**
 * The file read back — `renderConceptFile`'s inverse, and deliberately no more than that.
 *
 * The bundle is written only by the app, one commit per act (ADR 0012), so every file on
 * the ref was rendered by the function above and this reads exactly that grammar: quoted
 * keys, JSON values, OKF's one list of objects. A general YAML reader would accept files
 * the platform never wrote and read some of them differently from the Python tier, whose
 * parser the nightly audit cross-checks against this one hash by hash (T-057). What the
 * grammar does not cover answers `malformed`, and the reconciler stops at such a commit
 * rather than guessing what it meant.
 *
 * The body comes back as the renderer normalised it — one trailing newline — which is what
 * the content hash is over either way (`contentHashOf`).
 */
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
    // A key the renderer wrote once and the file carries twice is a file it did not write:
    // letting the later one win would let a forged `iri` or `type` win over the first.
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
