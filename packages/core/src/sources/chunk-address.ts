import { ULID } from "@better-answers/schema";

import { err, NOT_FOUND, ok, type Result } from "../kernel/index.ts";
import type { SourceRefusal } from "./vocabulary.ts";

const ORDINAL_DIGITS = 6;
const CHUNK_ID_SEPARATOR = "#";
const SPAN_PREFIX = "chars:";
const SPAN_SEPARATOR = "-";
const PATH_SEPARATOR = "/";

const OFFSET = /^(?:0|[1-9][0-9]*)$/;

export type LocatorRefusal = SourceRefusal<"not-found">;

export type Locator = {
  readonly sourceDocumentId: string;
  readonly charStart: number;
  readonly charEnd: number;
};

export const chunkIdOf = (sourceDocumentId: string, ordinal: number): string =>
  `${sourceDocumentId}${CHUNK_ID_SEPARATOR}${String(ordinal).padStart(ORDINAL_DIGITS, "0")}`;

export const locatorOf = (sourceDocumentId: string, charStart: number, charEnd: number): string =>
  `${sourceDocumentId}${PATH_SEPARATOR}${SPAN_PREFIX}${charStart}${SPAN_SEPARATOR}${charEnd}`;

type Span = Pick<Locator, "charStart" | "charEnd">;

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

/**
 * Reads `<document>/chars:<start>-<end>`: offsets count code points, and the end is exclusive.
 * Any other shape is `not-found`.
 */
export const parseLocator = (wire: string): Result<Locator, LocatorRefusal> => {
  const parts = twoParts(wire, PATH_SEPARATOR);
  if (parts === undefined) return err(NOT_FOUND);
  const [documentPart, spanPart] = parts;

  const span = spanOf(spanPart);
  if (span === undefined || !ULID.test(documentPart)) return err(NOT_FOUND);
  return ok({ sourceDocumentId: documentPart, ...span });
};

/** Offsets count code points, not UTF-16 units; a span past the text's end is `not-found`. */
export const spanText = (text: string, locator: Locator): Result<string, LocatorRefusal> => {
  const points = Array.from(text);
  if (locator.charEnd > points.length) return err(NOT_FOUND);
  return ok(points.slice(locator.charStart, locator.charEnd).join(""));
};
