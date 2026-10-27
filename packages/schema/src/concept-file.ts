import { z } from "zod";

import {
  autolinkClosesAt,
  autolinkEndsOf,
  collapsedWhitespace,
  isAsciiWhitespace,
  nextOf,
} from "./scan.ts";
import { ULID_CHARACTERS, type Ulid } from "./ulid.ts";

export const CONCEPT_IRI_PREFIX = "https://better-answers.com/c/";

export const IRI = new RegExp(
  `^${CONCEPT_IRI_PREFIX.replaceAll(".", String.raw`\.`)}${ULID_CHARACTERS}$`,
  "u",
);

export const CONCEPT_IRI = z.string().regex(IRI).brand<"ConceptIri">();

export const conceptIriOf = (minted: Ulid): z.output<typeof CONCEPT_IRI> =>
  CONCEPT_IRI.parse(`${CONCEPT_IRI_PREFIX}${minted}`);

/** The ULID a concept IRI ends in; `undefined` for any other value, a foreign host included. */
export const ulidOfConceptIri = (iri: string): string | undefined =>
  IRI.test(iri) ? iri.slice(CONCEPT_IRI_PREFIX.length) : undefined;

export const uriDecoded = (address: string): string => {
  try {
    return decodeURI(address);
  } catch {
    return address;
  }
};

/** `id` is what a citation mark names; only a record-form `sources` entry can carry one. */
export type CitedSource = {
  readonly resource: string;
  readonly locator: string | null;
  readonly id: string | null;
};

const lineStartFrom = (text: string, from: number): number => {
  if (from <= 0) return 0;
  if (text[from - 1] === "\n") return from;
  const found = text.indexOf("\n", from);
  return found === -1 ? text.length : found + 1;
};

type Found = { readonly at: number; readonly text: string };

const inlineFormAt = (prose: string, bracket: number, ending: Int32Array): number | undefined => {
  if (prose[bracket + 1] !== "(") return undefined;
  const closed = ending[bracket + 2] ?? -1;
  return closed === -1 ? undefined : closed + 1;
};

const referenceFormAt = (
  prose: string,
  at: number,
  bracket: number,
  close: Int32Array,
): number | undefined => {
  if (prose[bracket + 1] !== "[" || prose[at + 1] === "^") return undefined;
  const reference = close[bracket + 2] ?? -1;
  return reference === -1 ? undefined : reference + 1;
};

const bracketFormAt = (
  prose: string,
  at: number,
  close: Int32Array,
  ending: Int32Array,
): number | undefined => {
  const bracket = close[at + 1] ?? -1;
  if (bracket === -1) return undefined;
  return (
    inlineFormAt(prose, bracket, ending) ??
    referenceFormAt(prose, at, bracket, close) ??
    bracket + 1
  );
};

const linkMatchesOf = (
  prose: string,
  bracketedTargetSpans: ReadonlyMap<number, number>,
): readonly Found[] => {
  const close = nextOf(prose, "]");
  const ending = nextOf(prose, ")");
  const ends = autolinkEndsOf(prose);
  const found: Found[] = [];
  for (let at = 0; at < prose.length;) {
    const target = bracketedTargetSpans.get(at);
    if (target !== undefined) {
      at = target;
      continue;
    }
    const ch = prose[at] ?? "";
    if (ch === "[") {
      const end = bracketFormAt(prose, at, close, ending);
      if (end !== undefined) {
        found.push({ at, text: prose.slice(at, end) });
        at = end;
        continue;
      }
    } else if (ch === "<") {
      const end = autolinkClosesAt(prose, at, ends);
      if (end !== undefined) {
        found.push({ at, text: prose.slice(at, end + 1) });
        at = end + 1;
        continue;
      }
    }
    at += 1;
  }
  return found;
};

const markRunOf = (body: string, at: number, mark: string): number => {
  let marker = at;
  while (body[marker] === mark) marker += 1;
  return marker;
};

const leadingSpacesOf = (body: string, at: number): number => {
  let spaces = 0;
  while (spaces < 4 && body[at + spaces] === " ") spaces += 1;
  return spaces;
};

type OpenedFence = { readonly mark: string; readonly marks: number; readonly lineEnd: number };

const openedFenceAt = (body: string, at: number): OpenedFence | undefined => {
  const spaces = leadingSpacesOf(body, at);
  const opened = at + spaces;
  const mark = body[opened] ?? "";
  if (spaces > 3 || (mark !== "`" && mark !== "~")) return undefined;
  const run = markRunOf(body, opened, mark);
  if (run - opened < 3) return undefined;
  const lineEnd = body.indexOf("\n", run);
  return lineEnd === -1 ? undefined : { mark, marks: run - opened, lineEnd };
};

const closingAt = (body: string, at: number, mark: string, marks: number): number | undefined => {
  const spaces = leadingSpacesOf(body, at);
  if (spaces > 3) return undefined;
  const run = markRunOf(body, at + spaces, mark);
  if (run - (at + spaces) < marks) return undefined;
  let tail = run;
  while (body[tail] === " " || body[tail] === "\t") tail += 1;
  return body[tail] === "\n" || tail === body.length ? tail : undefined;
};

const closingLineEnd = (
  body: string,
  from: number,
  mark: string,
  marks: number,
): number | undefined => {
  for (let at = from; at < body.length; at = lineStartFrom(body, at + 1)) {
    const end = closingAt(body, at, mark, marks);
    if (end !== undefined) return end;
  }
  return undefined;
};

const fencedBlocksOf = (body: string): readonly { start: number; end: number }[] => {
  const blocks: { start: number; end: number }[] = [];
  for (let at = 0; at < body.length; at = lineStartFrom(body, at + 1)) {
    const opened = openedFenceAt(body, at);
    if (opened === undefined) continue;
    const end = closingLineEnd(body, opened.lineEnd + 1, opened.mark, opened.marks) ?? body.length;
    blocks.push({ start: at, end });
    at = end;
  }
  return blocks;
};

const blanked = (text: string): string =>
  text.replaceAll(/[^\n]/gu, (character) => " ".repeat(character.length));

const laterRunsByLength = (
  runs: readonly RegExpExecArray[],
): ReadonlyMap<number, readonly number[]> => {
  const queued = new Map<number, number[]>();
  for (const [position, run] of runs.entries()) {
    const queue = queued.get(run[0].length);
    if (queue === undefined) queued.set(run[0].length, []);
    else queue.push(position);
  }
  return queued;
};

const headAfter = (queue: readonly number[], from: number, at: number): number => {
  let head = from;
  while (head < queue.length) {
    const position = queue[head];
    if (position === undefined || position > at) break;
    head += 1;
  }
  return head;
};

const blankedSpans = (body: string): string => {
  const runs = [...body.matchAll(/`+/gu)];
  const queued = laterRunsByLength(runs);
  const heads = new Map<number, number>();

  const pieces: string[] = [];
  let cursor = 0;

  for (let at = 0; at < runs.length; at += 1) {
    const opener = runs[at];
    if (opener === undefined) continue;
    const queue = queued.get(opener[0].length) ?? [];
    const head = headAfter(queue, heads.get(opener[0].length) ?? 0, at);
    heads.set(opener[0].length, head);
    const closer = runs[queue[head] ?? -1];
    if (closer === undefined) continue;
    const end = closer.index + closer[0].length;
    pieces.push(body.slice(cursor, opener.index), blanked(body.slice(opener.index, end)));
    cursor = end;
    at = queue[head] ?? at;
  }
  pieces.push(body.slice(cursor));
  return pieces.join("");
};

/** The body with fenced blocks and code spans blanked to spaces, so an offset into one is into both. */
export const proseOf = (body: string): string => {
  const pieces: string[] = [];
  let cursor = 0;
  for (const block of fencedBlocksOf(body)) {
    pieces.push(body.slice(cursor, block.start), blanked(body.slice(block.start, block.end)));
    cursor = block.end;
  }
  pieces.push(body.slice(cursor));
  return blankedSpans(pieces.join(""));
};

const normalisedLabel = (label: string): string => collapsedWhitespace(label).toLowerCase();

const labelKey = (label: string): string =>
  label.startsWith("^") ? `^${normalisedLabel(label.slice(1))}` : normalisedLabel(label);

const targetAfter = (
  prose: string,
  from: number,
): { readonly start: number; readonly end: number } | undefined => {
  let start = from;
  while (start < prose.length && isAsciiWhitespace(prose[start] ?? "")) start += 1;
  if (start === prose.length) return undefined;
  let end = start;
  while (end < prose.length && !isAsciiWhitespace(prose[end] ?? "")) end += 1;
  return { start, end };
};

type Definition = { readonly key: string; readonly start: number; readonly end: number };

const definitionAt = (prose: string, at: number, close: Int32Array): Definition | undefined => {
  const spaces = leadingSpacesOf(prose, at);
  const opened = at + spaces;
  if (spaces > 3 || prose[opened] !== "[") return undefined;
  const bracket = close[opened + 1] ?? -1;
  if (bracket === -1 || bracket === opened + 1 || prose[bracket + 1] !== ":") return undefined;
  const target = targetAfter(prose, bracket + 2);
  if (target === undefined) return undefined;
  return { key: labelKey(prose.slice(opened + 1, bracket)), ...target };
};

type Definitions = {
  readonly definitions: ReadonlyMap<string, string>;
  readonly bracketedTargetSpans: ReadonlyMap<number, number>;
};

const definitionsOf = (prose: string): Definitions => {
  const definitions = new Map<string, string>();
  const bracketedTargetSpans = new Map<number, number>();
  const close = nextOf(prose, "]");
  for (let at = 0; at < prose.length; at = lineStartFrom(prose, at + 1)) {
    const found = definitionAt(prose, at, close);
    if (found === undefined) continue;
    const target = prose.slice(found.start, found.end);
    if (target.startsWith("<")) bracketedTargetSpans.set(found.start, found.end);
    if (!definitions.has(found.key)) {
      definitions.set(found.key, target.replace(/^</u, "").replace(/>$/u, ""));
    }
    at = found.end - 1;
  }
  return { definitions, bracketedTargetSpans };
};

const sourcesById = (sources: readonly CitedSource[]): ReadonlyMap<string, number> => {
  const byId = new Map<string, number>();
  for (const [index, { id }] of sources.entries()) {
    const key = normalisedLabel(id ?? "");
    if (key !== "" && !byId.has(key)) byId.set(key, index);
  }
  return byId;
};

// oxlint-disable-next-line eslint/require-unicode-regexp -- Stryker negates \v to \V, which the u flag refuses at load
const INLINE_TARGET = /\]\([ \t\n\r\f\v]*<?([^) \t\n\r\f\v>]+)/;
const REFERENCE = /^\[([^\]]*)\]\[([^\]]*)\]$/u;

const linkTargetOf = (
  found: Found,
  prose: string,
  definitions: ReadonlyMap<string, string>,
): string | undefined => {
  const text = found.text;
  if (text.startsWith("<")) return text.slice(1, -1);
  if (text.includes("](")) return INLINE_TARGET.exec(text)?.[1];
  const reference = REFERENCE.exec(text);
  if (reference !== null) {
    return definitions.get(labelKey((reference[2] === "" ? reference[1] : reference[2]) ?? ""));
  }

  if (prose[found.at + text.length] === ":") return undefined;
  return definitions.get(labelKey(text.slice(1, -1)));
};

type Reading =
  | { readonly as: "link"; readonly target: string | undefined }
  | { readonly as: "mark"; readonly source: number }
  | { readonly as: "text" };

type BodyRefs = {
  readonly definitions: ReadonlyMap<string, string>;
  readonly sourcesById: ReadonlyMap<string, number>;
};

const FOOTNOTE = /^\[\^([^\]]*)\]$/u;

const footnoteReading = (found: Found, prose: string, refs: BodyRefs): Reading | undefined => {
  const footnote = FOOTNOTE.exec(found.text);
  if (footnote === null) return undefined;
  if (prose[found.at + found.text.length] === ":") return { as: "text" };
  const key = normalisedLabel(footnote[1] ?? "");
  const source = refs.sourcesById.get(key);
  if (source !== undefined) return { as: "mark", source };
  const target = refs.definitions.get(`^${key}`);
  return target === undefined ? { as: "text" } : { as: "link", target };
};

const readingOf = (found: Found, prose: string, refs: BodyRefs): Reading => {
  if (prose[found.at - 1] === "!") return { as: "link", target: undefined };
  return (
    footnoteReading(found, prose, refs) ?? {
      as: "link",
      target: linkTargetOf(found, prose, refs.definitions),
    }
  );
};

type BodyLink = {
  readonly ordinal: number;
  readonly at: number;
  readonly target: string;
};

type CitationMark = {
  readonly at: number;
  readonly mark: string;
  readonly source: number;
};

export type BodyReading = {
  readonly links: readonly BodyLink[];
  readonly marks: readonly CitationMark[];
};

/**
 * A link's ordinal counts every prose link, images and links naming nothing included. A footnote
 * naming a source is a citation mark: no ordinal.
 */
export const linksAndMarksOf = (body: string, sources: readonly CitedSource[]): BodyReading => {
  const prose = proseOf(body);
  const { definitions, bracketedTargetSpans } = definitionsOf(prose);
  const refs = { definitions, sourcesById: sourcesById(sources) };
  const links: BodyLink[] = [];
  const marks: CitationMark[] = [];
  let ordinal = 0;
  for (const found of linkMatchesOf(prose, bracketedTargetSpans)) {
    const reading = readingOf(found, prose, refs);
    if (reading.as === "mark")
      marks.push({ at: found.at, mark: found.text, source: reading.source });
    if (reading.as !== "link") continue;
    if (reading.target !== undefined) links.push({ ordinal, at: found.at, target: reading.target });
    ordinal += 1;
  }
  return { links, marks };
};
