/** The sentence a link sits in, and the flattening that reads it: a body is tenant input,
 * so its worst shapes cost one walk. */
import { autolinkClosesAt, nextOf, nextStopsOf } from "@better-answers/schema/scan";

const SPACE = /\s/;

/** The next `>` or whitespace at or after each position, `-1` where there is none. */
const autolinkEndsOf = (text: string): Int32Array =>
  nextStopsOf(text, (ch) => ch === ">" || SPACE.test(ch));

type SpanOf = (bracket: number, ending: Int32Array, close: Int32Array) => number | undefined;

/** One bracket pass: the label replaces the match, leftmost and non-overlapping, as the
 * pass's `replaceAll` held it. */
const labelsOf = (text: string, spanOf: SpanOf): string => {
  const close = nextOf(text, "]");
  const ending = nextOf(text, ")");
  const pieces: string[] = [];
  let cursor = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] !== "[") continue;
    const bracket = close[at + 1] ?? -1;
    if (bracket === -1) continue;
    const end = spanOf(bracket, ending, close);
    if (end === undefined) continue;
    pieces.push(text.slice(cursor, at), text.slice(at + 1, bracket));
    cursor = end;
    at = end - 1;
  }
  pieces.push(text.slice(cursor));
  return pieces.join("");
};

const BRACKETED_INLINE = (text: string): string =>
  labelsOf(text, (bracket, ending) => {
    if (text[bracket + 1] !== "(") return undefined;
    const closed = ending[bracket + 2] ?? -1;
    return closed === -1 ? undefined : closed + 1;
  });

const BRACKETED_REFERENCE = (text: string): string =>
  labelsOf(text, (bracket, _ending, close) => {
    if (text[bracket + 1] !== "[") return undefined;
    const reference = close[bracket + 2] ?? -1;
    return reference === -1 ? undefined : reference + 1;
  });

const BRACKETED = (text: string): string => labelsOf(text, (bracket) => bracket + 1);

const ANGLE_BRACKETED = (text: string): string => {
  const ends = autolinkEndsOf(text);
  const pieces: string[] = [];
  let cursor = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] !== "<") continue;
    const end = autolinkClosesAt(text, at, ends);
    if (end === undefined) continue;
    pieces.push(text.slice(cursor, at), text.slice(at + 1, end));
    cursor = end + 1;
    at = end;
  }
  pieces.push(text.slice(cursor));
  return pieces.join("");
};

/** Every link form collapsed to what it held, in the four passes' order: inline,
 * reference, bare, autolink. */
const flattenedLinks = (text: string): string =>
  ANGLE_BRACKETED(BRACKETED(BRACKETED_REFERENCE(BRACKETED_INLINE(text))));

/** The sentence holding `index`: the paragraph around it, cut at its own bounds, links
 * flattened and whitespace run together. */
export const sentenceAt = (body: string, index: number): string => {
  const before = body.lastIndexOf("\n\n", index);
  const paragraphStart = before === -1 ? 0 : before + 2;
  const after = body.indexOf("\n\n", index);
  const paragraph = body.slice(paragraphStart, after === -1 ? body.length : after);
  const at = index - paragraphStart;

  let start = 0;
  let end = paragraph.length;
  for (const boundary of paragraph.matchAll(/[.!?](?=\s|$)/g)) {
    if (boundary.index < at) start = boundary.index + 1;
    else {
      end = boundary.index + 1;
      break;
    }
  }
  return flattenedLinks(paragraph.slice(start, end)).replaceAll(/\s+/g, " ").trim();
};
