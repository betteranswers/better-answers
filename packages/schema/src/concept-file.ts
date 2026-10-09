import { z } from "zod";

import { ULID_CHARACTERS } from "./ulid.ts";

export const CONCEPT_IRI_PREFIX = "https://better-answers.com/c/";

export const IRI = new RegExp(
  `^${CONCEPT_IRI_PREFIX.replaceAll(".", String.raw`\.`)}${ULID_CHARACTERS}$`,
);

/** The registry's `iri` columns carry the same brand; this one cannot import the registry. */
const MINTED_IRI = z.string().regex(IRI).brand<"ConceptIri">();

/** `minted` is a fresh ULID, so a throw here is a broken invariant, not input to refuse. */
export const conceptIriOf = (minted: string): z.output<typeof MINTED_IRI> =>
  MINTED_IRI.parse(`${CONCEPT_IRI_PREFIX}${minted}`);

/** The ULID a concept IRI ends in; `undefined` for any other value, a foreign host included. */
export const ulidOfConceptIri = (iri: string): string | undefined =>
  IRI.test(iri) ? iri.slice(CONCEPT_IRI_PREFIX.length) : undefined;

/** `id` is what a citation mark names; only a record-form `sources` entry can carry one. */
export type CitedSource = {
  readonly resource: string;
  readonly locator: string | null;
  readonly id: string | null;
};

/** Lines break at `\n` alone and whitespace is these six, so both tiers' regex engines read alike. */
const LINK_DEFINITION = /(?<=^|\n) {0,3}\[([^\]]+)\]:[ \t\n\r\f\v]*([^ \t\n\r\f\v]+)/g;

const LINK =
  /\[[^\]]*\]\([^)]*\)|\[(?!\^)[^\]]*\]\[[^\]]*\]|\[[^\]]*\]|<[a-z][a-z0-9+.-]*:[^> \t\n\r\f\v]*>/gi;

const FOOTNOTE = /^\[\^([^\]]*)\]$/;

const FENCED_BLOCK =
  /(?<=^|\n) {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:(?<=\n) {0,3}\1\2*[ \t]*(?=\n|(?![\s\S]))|(?![\s\S]))/g;

const blanked = (text: string): string => text.replaceAll(/[^\n]/g, " ");

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
  const runs = [...body.matchAll(/`+/g)];
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
export const proseOf = (body: string): string => blankedSpans(body.replace(FENCED_BLOCK, blanked));

const normalisedLabel = (label: string): string =>
  label
    .split(/[ \t\n\r\f\v]+/)
    .filter((word) => word !== "")
    .join(" ")
    .toLowerCase();

const labelKey = (label: string): string =>
  label.startsWith("^") ? `^${normalisedLabel(label.slice(1))}` : normalisedLabel(label);

const definitionsOf = (prose: string): ReadonlyMap<string, string> => {
  const definitions = new Map<string, string>();
  for (const match of prose.matchAll(LINK_DEFINITION)) {
    const label = labelKey(match[1] ?? "");
    if (!definitions.has(label)) {
      definitions.set(label, (match[2] ?? "").replace(/^</, "").replace(/>$/, ""));
    }
  }
  return definitions;
};

const sourcesById = (sources: readonly CitedSource[]): ReadonlyMap<string, number> => {
  const byId = new Map<string, number>();
  for (const [index, { id }] of sources.entries()) {
    const key = normalisedLabel(id ?? "");
    if (key !== "" && !byId.has(key)) byId.set(key, index);
  }
  return byId;
};

const linkTargetOf = (
  match: RegExpExecArray,
  prose: string,
  definitions: ReadonlyMap<string, string>,
): string | undefined => {
  const text = match[0];
  if (text.startsWith("<")) return text.slice(1, -1);
  if (text.includes("](")) return /\]\([ \t\n\r\f\v]*<?([^) \t\n\r\f\v>]+)/.exec(text)?.[1];
  const reference = /^\[([^\]]*)\]\[([^\]]*)\]$/.exec(text);
  if (reference !== null) {
    return definitions.get(labelKey((reference[2] === "" ? reference[1] : reference[2]) ?? ""));
  }

  if (prose[match.index + text.length] === ":") return undefined;
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

const footnoteReading = (
  match: RegExpExecArray,
  prose: string,
  refs: BodyRefs,
): Reading | undefined => {
  const footnote = FOOTNOTE.exec(match[0]);
  if (footnote === null) return undefined;
  if (prose[match.index + match[0].length] === ":") return { as: "text" };
  const key = normalisedLabel(footnote[1] ?? "");
  const source = refs.sourcesById.get(key);
  if (source !== undefined) return { as: "mark", source };
  const target = refs.definitions.get(`^${key}`);
  return target === undefined ? { as: "text" } : { as: "link", target };
};

const readingOf = (match: RegExpExecArray, prose: string, refs: BodyRefs): Reading => {
  if (prose[match.index - 1] === "!") return { as: "link", target: undefined };
  return (
    footnoteReading(match, prose, refs) ?? {
      as: "link",
      target: linkTargetOf(match, prose, refs.definitions),
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
 * A link's ordinal counts every link in the prose, images and links naming nothing included. A
 * footnote naming a source is a citation mark, resolving to the first entry of `sources` with that
 * id: it takes no ordinal. Any other footnote is a link only when the body defines it.
 */
export const linksAndMarksOf = (body: string, sources: readonly CitedSource[]): BodyReading => {
  const prose = proseOf(body);
  const refs = { definitions: definitionsOf(prose), sourcesById: sourcesById(sources) };
  const links: BodyLink[] = [];
  const marks: CitationMark[] = [];
  let ordinal = 0;
  for (const match of prose.matchAll(LINK)) {
    const reading = readingOf(match, prose, refs);
    if (reading.as === "mark")
      marks.push({ at: match.index, mark: match[0], source: reading.source });
    if (reading.as !== "link") continue;
    if (reading.target !== undefined)
      links.push({ ordinal, at: match.index, target: reading.target });
    ordinal += 1;
  }
  return { links, marks };
};
