import type { RenameMap } from "./map.ts";

type WordRule = { readonly from: readonly string[]; readonly to: readonly string[] };

export type Words = readonly WordRule[];

/** Camel humps, acronyms, digits and everything else, so joining the tokens gives the text back. */
const TOKEN = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+|[^A-Za-z0-9]+/g;

const JOINERS: readonly string[] = ["_", "-", " "];

const IDENTIFIER_JOINERS: readonly string[] = ["_", "-"];

/** Longest first, so `llm route` is taken before `route` can take half of it. */
export const wordsOf = (map: RenameMap): Words =>
  map.words
    .map((rule) => ({ from: rule.from.split(" "), to: rule.to.split(" ") }))
    .sort((left, right) => right.from.length - left.from.length);

/** Any text a rule could rewrite, for a scan to narrow to. Flag-free: ast-grep and JavaScript spell case-blind differently. */
export const wordSource = (words: Words): string =>
  `(?:${words.map((rule) => rule.from.join("[-_ ]?")).join("|")})`;

type Match = {
  readonly end: number;
  readonly joiner: string | undefined;
  readonly matched: readonly string[];
};

const joinerAt = (tokens: readonly string[], index: number): string => {
  const token = tokens[index] ?? "";
  return JOINERS.includes(token) ? token : "";
};

const matchAt = (
  tokens: readonly string[],
  start: number,
  from: readonly string[],
): Match | undefined => {
  const matched: string[] = [];
  let index = start;
  let joiner: string | undefined;
  for (const word of from) {
    if (matched.length > 0) {
      const between = joinerAt(tokens, index);
      if (joiner !== undefined && between !== joiner) return undefined;
      joiner = between;
      index += between.length;
    }
    const token = tokens[index] ?? "";
    if (token.toLowerCase() !== word) return undefined;
    matched.push(token);
    index += 1;
  }
  return { end: index, joiner, matched };
};

const firstMatch = (tokens: readonly string[], start: number, words: Words) => {
  for (const rule of words) {
    const match = matchAt(tokens, start, rule.from);
    if (match !== undefined) return { match, to: rule.to };
  }
  return undefined;
};

const isUpper = (token: string): boolean =>
  token.toUpperCase() === token && token.toLowerCase() !== token;

const capitalised = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A statement's words are names, so `AS routes` becomes `AS model_choices` and never two words. */
const SQL = /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|ALTER|CREATE)\b/;

/** An underscore or hyphen binds tighter than a space: `SELECT route_id` is snake case, `no route set` prose. */
const joinerNear = (
  tokens: readonly string[],
  match: Match,
  start: number,
  spaced: string,
): string => {
  if (match.joiner !== undefined) return match.joiner;
  const neighbours = [tokens[start - 1] ?? "", tokens[match.end] ?? ""];
  const bound = IDENTIFIER_JOINERS.find((joiner) => neighbours.includes(joiner));
  return bound ?? (neighbours.some((neighbour) => neighbour.includes(" ")) ? spaced : "");
};

const isShouted = (matched: readonly string[]): boolean =>
  matched.every(isUpper) && matched.some((token) => token.length > 1);

const rendered = (to: readonly string[], match: Match, joiner: string): string => {
  if (isShouted(match.matched)) {
    return to.map((word) => word.toUpperCase()).join(joiner === "" ? "_" : joiner);
  }
  const [head = "", ...rest] = to;
  const first = match.matched[0] ?? "";
  const tail = rest.map((word) => (joiner === "" ? capitalised(word) : word));
  return [first === first.toLowerCase() ? head : capitalised(head), ...tail].join(joiner);
};

/** The text with every old word in it rewritten, each in the casing and joiner it was found in. */
export const renamedText = (text: string, words: Words): string => {
  const tokens = text.match(TOKEN) ?? [];
  const spaced = SQL.test(text) ? "_" : " ";
  const parts: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const found = firstMatch(tokens, index, words);
    if (found === undefined) {
      parts.push(tokens[index] ?? "");
      index += 1;
      continue;
    }
    parts.push(rendered(found.to, found.match, joinerNear(tokens, found.match, index, spaced)));
    index = found.match.end;
  }
  return parts.join("");
};
