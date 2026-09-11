import { boundarySchemas } from "@better-answers/schema";

import { narrower, readableClause, readableParameters, type Sensitivity } from "../access/index.ts";
import { attempt, err, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { parseLocator, spanText, type LocatorRefusal } from "./chunk-address.ts";

/**
 * The reads over a chunk's columns: what a locator opens.
 *
 * A chunk row is a readable unit like any other — it carries the three visibility columns a
 * run copies onto it from its binding and its document (ADR 0023, ADR 0039) — so the reads
 * here append the one predicate every read appends, in the same statement as everything else
 * they ask. That is what makes a withheld passage answer the way an absent one does: the row
 * is simply not returned, and there is no second step that could tell the two apart.
 *
 * The arithmetic these reads rest on is `chunk-address.ts` and the agreement both tiers are
 * held to is `contracts/document-chunk/cases.json`; the suite is `test/passages.test.ts`,
 * which seeds that agreement's own rows and asks the read its own `open` cases.
 */

/**
 * What a locator resolves to: the address it was asked with, the document it names, the text
 * of its span and the class the reader is being handed it under. The four fields `open`
 * renders (ADR 0018) and the unit a citation previews.
 */
export type Passage = {
  readonly locator: string;
  readonly title: string;
  readonly text: string;
  readonly sensitivity: Sensitivity;
};

/** The class word as the column carries it, narrowed to the glossary's closed set. */
const CHUNK_SENSITIVITY = boundarySchemas.chunk.select.shape.sensitivity;

/**
 * The one word every refusal here answers with — the parser's own, so the type is what holds
 * the two together: were the locator's refusal to become some other word, this would stop
 * compiling rather than quietly answer a second one.
 */
const NOT_FOUND: LocatorRefusal = "not-found";

/**
 * The rows of one document whose span overlaps the locator's, under the reader's predicate.
 *
 * The overlap is two comparisons on the columns the splitter wrote rather than any parse of
 * the `locator` column, which is why the ordinal and the two offsets are columns at all. The
 * predicate sits in the same WHERE as the overlap, so a row this reader may not see is not a
 * row this statement returns — and the coverage check below then fails for exactly the reason
 * an unknown document's does.
 *
 * The parameters are positional and their order is this clause's: the workspace, then the
 * two the predicate reads (the role and the group ids, in that order), then the document and
 * the span. A number out of step here is a wrong answer rather than an error, so the suite is
 * what holds the count.
 */
const COVERING_ROWS = `SELECT c.content, c.char_start, c.char_end, c.sensitivity, d.title
     FROM "index".chunk c
     JOIN source_document d ON d.workspace_id = c.workspace_id AND d.id = c.source_document_id
    WHERE c.workspace_id = $1
      AND c.source_document_id = $4
      AND c.char_start < $6
      AND c.char_end > $5
      AND ${readableClause("c", 2)}
    ORDER BY c.ordinal`;

type CoveringRow = {
  readonly content: string;
  readonly char_start: number;
  readonly char_end: number;
  readonly sensitivity: Sensitivity;
  readonly title: string;
};

/**
 * The passage a wire locator opens, or the one refusal word.
 *
 * `open` by locator, S2's unmapped passages and S4's citation repair take this door and no
 * other. Four things can be wrong and all four answer alike: the string is not an address,
 * the workspace holds no such document, the text does not run that far, or a row covering the
 * span is one this reader may not see. A reader who could tell those apart would learn what
 * the workspace holds by probing addresses, which is the whole reason the word is one word.
 *
 * **Coverage is checked, never assumed.** The chunk rows partition a document's text — the
 * first starts at zero, each one's end is the next one's start — so a span is answerable only
 * when the rows that came back run contiguously from at or below its start to at or above its
 * end. A gap, a short tail or no rows at all is the same refusal. That is what makes a well
 * formed span past the end of the text *not found* from the read rather than from the parser,
 * which has no text in front of it and would be guessing.
 *
 * **The text is cut by code points**, never by indexing a string: the covering rows' content
 * is joined in ordinal order and the span is taken out of it offset by the first row's start,
 * through the one cut in `chunk-address.ts`. One character outside the basic plane is enough
 * to put every later offset one place out, and the agreement's document carries one.
 *
 * **The class is the narrowest of the rows actually read**, so a span straddling two rows of
 * two classes is handed over under the narrower of them and never the wider.
 */
export const passageAt = async (
  principal: UserPrincipal,
  tx: Tx,
  wire: string,
): Promise<Result<Passage, LocatorRefusal | Error>> => {
  const locator = parseLocator(wire);
  // Already the one word, so it travels as it stands rather than being re-wrapped.
  if (!locator.ok) return err(locator.error);
  const { sourceDocumentId, charStart, charEnd } = locator.value;

  const covering = await attempt(async () => {
    const read = await tx.query<CoveringRow>(COVERING_ROWS, [
      principal.workspaceId,
      ...readableParameters(principal),
      sourceDocumentId,
      charStart,
      charEnd,
    ]);
    // The word and the column disagreeing is a broken database, not a guess to make: the
    // boundary is what says which words the column may hold.
    return read.rows.map((row) => ({
      ...row,
      sensitivity: CHUNK_SENSITIVITY.parse(row.sensitivity),
    }));
  });
  if (!covering.ok) return err(covering.error);

  const rows = covering.value;
  const first = rows[0];
  if (first === undefined || first.char_start > charStart) return err(NOT_FOUND);
  let reach = first.char_start;
  for (const row of rows) {
    if (row.char_start !== reach) return err(NOT_FOUND);
    reach = row.char_end;
  }
  if (reach < charEnd) return err(NOT_FOUND);

  const covered = spanText(rows.map((row) => row.content).join(""), {
    sourceDocumentId,
    charStart: charStart - first.char_start,
    charEnd: charEnd - first.char_start,
  });
  if (!covered.ok) return err(covered.error);

  return ok({
    locator: wire,
    title: first.title,
    text: covered.value,
    sensitivity: rows.reduce(
      (narrowest, row) => narrower(narrowest, row.sensitivity),
      first.sensitivity,
    ),
  });
};
