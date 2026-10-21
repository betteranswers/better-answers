import {
  autolinkClosesAt,
  autolinkEndsOf,
  collapsedWhitespace,
  nextOf,
} from "@better-answers/schema/scan";

type SpanOf = (bracket: number, ending: Int32Array, close: Int32Array) => number | undefined;

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

const flattenedLinks = (text: string): string =>
  ANGLE_BRACKETED(BRACKETED(BRACKETED_REFERENCE(BRACKETED_INLINE(text))));

const HEADING = /^#{1,6}[ \t\n\r\f\v]+([^\n]*)/;

export const sectionAt = (body: string, index: number): string | null => {
  const lines = body.slice(0, index).split("\n");
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const heading = HEADING.exec(lines[at] ?? "");
    if (heading !== null) return collapsedWhitespace(heading[1] ?? "");
  }
  return null;
};

const BLANK = /^[ \t\r\f\v]*$/;

const paragraphAround = (body: string, index: number): readonly [number, number] => {
  let above = body.lastIndexOf("\n", index);
  while (above !== -1) {
    const line = body.lastIndexOf("\n", above - 1);
    if (BLANK.test(body.slice(line + 1, above))) break;
    above = line;
  }
  let below = body.indexOf("\n", index);
  while (below !== -1) {
    const line = body.indexOf("\n", below + 1);
    if (BLANK.test(body.slice(below + 1, line === -1 ? body.length : line))) break;
    below = line;
  }
  return [above + 1, below === -1 ? body.length : below];
};

export const sentenceAt = (body: string, prose: string, index: number): string => {
  const [paragraphStart, paragraphEnd] = paragraphAround(body, index);
  const paragraph = prose.slice(paragraphStart, paragraphEnd);
  const at = index - paragraphStart;

  let start = 0;
  let end = paragraph.length;
  for (const boundary of paragraph.matchAll(/[.!?](?:\[\^[^[\]]*\])*(?=[ \t\n\r\f\v]|$)/g)) {
    const after = boundary.index + boundary[0].length;
    if (after <= at) start = after;
    else {
      end = after;
      break;
    }
  }
  return collapsedWhitespace(flattenedLinks(paragraph.slice(start, end)));
};
