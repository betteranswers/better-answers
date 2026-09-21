import { ULID } from "@better-answers/schema";

import { err, ok, type Result } from "../kernel/index.ts";

const ORDINAL_DIGITS = 6;
const CHUNK_ID_SEPARATOR = "#";
const SPAN_PREFIX = "chars:";
const SPAN_SEPARATOR = "-";
const PATH_SEPARATOR = "/";

const NOT_FOUND = "not-found";

const OFFSET = /^(?:0|[1-9][0-9]*)$/;

export type LocatorRefusal = typeof NOT_FOUND;

export type Locator = {
  readonly sourceDocumentId: string;
  readonly charStart: number;
  readonly charEnd: number;
};

export const chunkIdOf = (sourceDocumentId: string, ordinal: number): string =>
  `${sourceDocumentId}${CHUNK_ID_SEPARATOR}${String(ordinal).padStart(ORDINAL_DIGITS, "0")}`;

export const locatorOf = (sourceDocumentId: string, charStart: number, charEnd: number): string =>
  `${sourceDocumentId}${PATH_SEPARATOR}${SPAN_PREFIX}${charStart}${SPAN_SEPARATOR}${charEnd}`;

export const parseLocator = (wire: string): Result<Locator, LocatorRefusal> => {
  const [documentPart, spanPart, ...beyond] = wire.split(PATH_SEPARATOR);
  if (documentPart === undefined || spanPart === undefined || beyond.length > 0) {
    return err(NOT_FOUND);
  }
  if (!spanPart.startsWith(SPAN_PREFIX)) return err(NOT_FOUND);

  const [start, end, ...extra] = spanPart.slice(SPAN_PREFIX.length).split(SPAN_SEPARATOR);
  if (start === undefined || end === undefined || extra.length > 0) return err(NOT_FOUND);
  if (!OFFSET.test(start) || !OFFSET.test(end)) return err(NOT_FOUND);

  if (!ULID.test(documentPart)) return err(NOT_FOUND);

  const charStart = Number(start);
  const charEnd = Number(end);

  if (charStart >= charEnd) return err(NOT_FOUND);
  return ok({ sourceDocumentId: documentPart, charStart, charEnd });
};

export const spanText = (text: string, locator: Locator): Result<string, LocatorRefusal> => {
  const points = Array.from(text);
  if (locator.charEnd > points.length) return err(NOT_FOUND);
  return ok(points.slice(locator.charStart, locator.charEnd).join(""));
};
