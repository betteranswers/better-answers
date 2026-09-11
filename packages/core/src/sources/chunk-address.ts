import { ULID } from "@better-answers/schema";

import { err, ok, type Result } from "../kernel/index.ts";

/**
 * A chunk's address: the id derived from it, and the locator written on the wire.
 *
 * Two pure functions and one cut, with no store and no principal between them, because both
 * tiers have to answer the same way and only one of them has a database in front of it. The
 * agreement they are held to is `contracts/document-chunk/cases.json` (ADR 0031); the suite
 * that holds them is `packages/core/test/document-chunk.contract.test.ts`.
 *
 * **The id is derived, never minted.** A chunk's id is its document and its ordinal joined,
 * so a reprocess upserts on the row's own key rather than making a second row, and either
 * tier can name a row from its address without asking the other (ADR 0036's stable id). It is
 * therefore not a ULID and the boundary that takes a minted id refuses it, which is the point:
 * the two are different things and a reader can tell them apart.
 *
 * **The offsets are code points.** A locator is a span into the document's normalised redacted
 * text, counted in Unicode code points (`CONTEXT.md`, *locator*). This tier indexes a string
 * by UTF-16 unit, so every span after a character outside the basic plane would be one place
 * late if it were cut with `slice`; the span below is taken from the text's code points, which
 * is what the worker's half counts natively. That difference is the reason this module exists
 * rather than the arithmetic living inline at each caller.
 *
 * **One word for every refusal.** A locator whose shape is wrong, a span past the end of the
 * text, and a document the reader may not see all answer the same: a reader who could tell a
 * malformed address from a withheld passage would learn what the workspace holds by guessing.
 * The parser refuses only what it can see from the string — the read refuses the rest, and
 * `passageAt` (T-133) is where that happens.
 */

/** The digits the ordinal is padded to, so a document's chunks sort by ordinal as text. */
const ORDINAL_DIGITS = 6;
const CHUNK_ID_SEPARATOR = "#";
const SPAN_PREFIX = "chars:";
const SPAN_SEPARATOR = "-";
const PATH_SEPARATOR = "/";
/** The one word a locator is refused with, whatever was wrong with it. */
const NOT_FOUND = "not-found";
/** A whole number written one way: no sign, no leading zero, no fraction. */
const OFFSET = /^(?:0|[1-9][0-9]*)$/;

export type LocatorRefusal = typeof NOT_FOUND;

/** A span inside one document's normalised redacted text: the start inclusive, the end not. */
export type Locator = {
  readonly sourceDocumentId: string;
  readonly charStart: number;
  readonly charEnd: number;
};

/**
 * A chunk's id from the address it sits at. The ordinal is the splitter's position and is
 * never a person's input, so this is total: the row's own columns are what refuse a number
 * the splitter could not have produced.
 */
export const chunkIdOf = (sourceDocumentId: string, ordinal: number): string =>
  `${sourceDocumentId}${CHUNK_ID_SEPARATOR}${String(ordinal).padStart(ORDINAL_DIGITS, "0")}`;

/**
 * The document and the span a wire locator names, or the one refusal word.
 *
 * What is refused here is what the string itself is wrong about — a missing span, an end
 * before its start, an empty span, an offset written two ways, a document id that is not one.
 * Whether the document exists and whether the text runs that far are the read's questions,
 * and this answers them by leaving them alone.
 */
export const parseLocator = (wire: string): Result<Locator, LocatorRefusal> => {
  const [documentPart, spanPart, ...beyond] = wire.split(PATH_SEPARATOR);
  if (documentPart === undefined || spanPart === undefined || beyond.length > 0) {
    return err(NOT_FOUND);
  }
  if (!spanPart.startsWith(SPAN_PREFIX)) return err(NOT_FOUND);

  const [start, end, ...extra] = spanPart.slice(SPAN_PREFIX.length).split(SPAN_SEPARATOR);
  if (start === undefined || end === undefined || extra.length > 0) return err(NOT_FOUND);
  if (!OFFSET.test(start) || !OFFSET.test(end)) return err(NOT_FOUND);

  // The document half is held to the one shape the platform mints (ADR 0035), which is
  // where the case and the excluded letters are settled; `source_document.id` carries no
  // refinement of its own at the boundary today.
  if (!ULID.test(documentPart)) return err(NOT_FOUND);

  const charStart = Number(start);
  const charEnd = Number(end);
  // The end is exclusive, so an end at or before the start addresses no text at all.
  if (charStart >= charEnd) return err(NOT_FOUND);
  return ok({ sourceDocumentId: documentPart, charStart, charEnd });
};

/**
 * The text a locator's span covers, cut by code points, or the same refusal word when the
 * span runs past the end of the text.
 *
 * `Array.from` is what makes this right rather than convenient: iterating a string yields its
 * code points, where indexing it yields UTF-16 units, and one astral character is enough to
 * put every later offset one place out. A code point is deliberately the unit and a grapheme
 * cluster is not — a locator is written by one tier and read by the other, and code points are
 * what both count the same without a locale or a segmenter between them.
 */
export const spanText = (text: string, locator: Locator): Result<string, LocatorRefusal> => {
  const points = Array.from(text);
  if (locator.charEnd > points.length) return err(NOT_FOUND);
  return ok(points.slice(locator.charStart, locator.charEnd).join(""));
};
