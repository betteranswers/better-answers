import { ULID, ULID_CHARACTERS } from "./ulid.ts";

const SPAN_PREFIX = "chars:";
const SPAN_SEPARATOR = "-";
const PATH_SEPARATOR = "/";

const OFFSET = /^(?:0|[1-9][0-9]*)$/;

const WRITTEN_LOCATOR = new RegExp(
  `(?<![0-9A-Z])${ULID_CHARACTERS}${PATH_SEPARATOR}${SPAN_PREFIX}[0-9]+${SPAN_SEPARATOR}[0-9]+`,
  "g",
);

export type PassageLocator = {
  readonly sourceDocumentId: string;
  readonly charStart: number;
  readonly charEnd: number;
};

export const passageLocatorOf = (
  sourceDocumentId: string,
  charStart: number,
  charEnd: number,
): string =>
  `${sourceDocumentId}${PATH_SEPARATOR}${SPAN_PREFIX}${charStart}${SPAN_SEPARATOR}${charEnd}`;

type Span = Pick<PassageLocator, "charStart" | "charEnd">;

const twoParts = (joined: string, separator: string): readonly [string, string] | undefined => {
  const [first, second, ...beyond] = joined.split(separator);
  if (first === undefined || second === undefined || beyond.length > 0) return undefined;
  return [first, second];
};

const spanOf = (spanPart: string): Span | undefined => {
  if (!spanPart.startsWith(SPAN_PREFIX)) return undefined;
  const offsets = twoParts(spanPart.slice(SPAN_PREFIX.length), SPAN_SEPARATOR);
  if (offsets === undefined) return undefined;
  const [start, end] = offsets;
  if (!OFFSET.test(start) || !OFFSET.test(end)) return undefined;

  const charStart = Number(start);
  const charEnd = Number(end);

  if (charStart >= charEnd) return undefined;
  return { charStart, charEnd };
};

export const parsedPassageLocator = (wire: string): PassageLocator | undefined => {
  const parts = twoParts(wire, PATH_SEPARATOR);
  if (parts === undefined) return undefined;
  const [documentPart, spanPart] = parts;

  const span = spanOf(spanPart);
  if (span === undefined || !ULID.test(documentPart)) return undefined;
  return { sourceDocumentId: documentPart, ...span };
};

/** Every passage locator written anywhere in the text, in the order written. */
export const passageLocatorsIn = (text: string): readonly string[] =>
  [...text.matchAll(WRITTEN_LOCATOR)]
    .map(([written]) => written)
    .filter((written) => parsedPassageLocator(written) !== undefined);
