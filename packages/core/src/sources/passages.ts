import { boundarySchemas } from "@better-answers/schema";

import {
  narrower,
  readableClause,
  readableParameters,
  sensitivityAndAudienceClause,
  type Sensitivity,
} from "../access/index.ts";
import {
  attempt,
  err,
  ok,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { adminOnBinding } from "./admin-binding.ts";
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

/**
 * One hit of a search: the document a matching chunk belongs to, what that document is
 * catalogued under, the address the chunk opens at and the class the reader is being offered
 * it under. No excerpt — the text is what `passageAt` hands over once the reader asks for the
 * address — and no layer word, because the union across the three knowledge layers and the
 * marker on what is not company knowledge belong to the entry that composes them (T-134).
 */
export type PassageHit = {
  readonly sourceDocumentId: string;
  readonly title: string;
  readonly locator: string;
  readonly sensitivity: Sensitivity;
};

/**
 * The most hits one search ever hands back, whatever the caller asks for.
 *
 * A ceiling rather than a page: there is no total, no cursor and no *more where that came
 * from* anywhere in this platform's reads (ADR 0016), so the number is what a person can read
 * at once rather than the first slice of something longer.
 */
export const MAX_PASSAGE_HITS = 20;

/** The caller's limit held between nothing and the ceiling — `LIMIT -1` is an error, not a read. */
const hitsAsked = (limit: number): number =>
  Math.min(Math.max(Math.trunc(limit), 0), MAX_PASSAGE_HITS);

/**
 * The wire address of one chunk row, composed from the three columns the splitter wrote rather
 * than read out of the row's own `locator` column. The column and the composition are one
 * address (ADR 0031) and `passages.test.ts` holds them to it, so composing costs nothing and
 * keeps a hit honest about where it sits even if a row's text column were ever wrong.
 */
const wireLocatorOf = (row: {
  readonly source_document_id: string;
  readonly char_start: number;
  readonly char_end: number;
}): string => `${row.source_document_id}/chars:${row.char_start}-${row.char_end}`;

/**
 * The chunk rows a reader's words match, ranked, with the documents a concept they may see
 * already covers left out.
 *
 * `websearch_to_tsquery` and never `to_tsquery`: a caller's words are prose, and the other
 * parser raises a syntax error on two words with a space between them rather than reading
 * them. The match is against the generated `search` column, so the per-partition GIN index is
 * what answers it, and the predicate sits in the same WHERE as the match — before the ranking,
 * so nothing this reader may not see is ever ranked, let alone counted.
 *
 * The exclusion is one `NOT EXISTS` in this same statement and never a second read, which
 * would be a second round trip and a race against a concept landing between the two. What it
 * asks is only *is this document already covered by something this reader may see* — ADR 0016's
 * *a document or a section stands alone only when no concept covers it* — and the concept arm
 * of a search is the concepts slice's own read, not this one. Its predicate comes from the
 * same builder as the chunk's, which is what the ADR's 2026-08-28 amendment requires: the same
 * predicate, once, from the same builder.
 *
 * The parameters are positional and their order is the order the clauses read them: the
 * workspace, the caller's words, the two the chunk's predicate reads (the role and the group
 * ids), the same two again for the concept's, and the limit. Four placeholders for one
 * predicate used twice, and a number out of step is a wrong answer rather than an error, so
 * the suite is what holds the count.
 */
const MATCHING_ROWS = `SELECT c.source_document_id, c.char_start, c.char_end, c.sensitivity, d.title
     FROM "index".chunk c
     JOIN source_document d ON d.workspace_id = c.workspace_id AND d.id = c.source_document_id
    CROSS JOIN websearch_to_tsquery('english', $2) AS q
    WHERE c.workspace_id = $1
      AND c.search @@ q
      AND c.char_start IS NOT NULL
      AND c.char_end IS NOT NULL
      AND ${readableClause("c", 3)}
      AND NOT EXISTS (SELECT 1
                        FROM concept_evidence ce
                        JOIN concept_index ci ON ci.workspace_id = ce.workspace_id AND ci.iri = ce.iri
                       WHERE ce.workspace_id = c.workspace_id
                         AND ce.source_document_id = c.source_document_id
                         AND ${readableClause("ci", 5)})
    ORDER BY ts_rank(c.search, q) DESC, c.source_document_id, c.char_start
    LIMIT $7`;

type HitRow = {
  readonly source_document_id: string;
  readonly char_start: number;
  readonly char_end: number;
  readonly sensitivity: Sensitivity;
  readonly title: string;
};

/**
 * The passages a reader's words find, best first — and nothing else.
 *
 * A list and only a list: no total, no count and no *some results were withheld*, because each
 * of those tells a reader outside an audience that there was something to be outside of. A
 * reader who may see none of what matched gets the empty list, which is the same answer a
 * workspace holding nothing gives.
 *
 * **A document a concept covers is not offered on its own.** Where a concept this reader may
 * see already cites the document, the concept is what they should be reading and the raw
 * passage is left out; where they may not see that concept, the document stands alone and is
 * offered. The same row answers two ways for two readers, and the difference is one predicate
 * inside one statement.
 *
 * Each hit carries the address rather than the text: the caller opens it with `passageAt` when
 * the reader asks, which is the one door the class and audience arms are applied at twice.
 */
export const findPassages = (
  principal: UserPrincipal,
  tx: Tx,
  query: string,
  limit: number,
): Promise<Result<readonly PassageHit[], Error>> => {
  const parameters = readableParameters(principal);
  return attempt(async () => {
    const read = await tx.query<HitRow>(MATCHING_ROWS, [
      principal.workspaceId,
      query,
      ...parameters,
      ...parameters,
      hitsAsked(limit),
    ]);
    // The word and the column disagreeing is a broken database, not a guess to make.
    return read.rows.map((row) => ({
      sourceDocumentId: row.source_document_id,
      title: row.title,
      locator: wireLocatorOf(row),
      sensitivity: CHUNK_SENSITIVITY.parse(row.sensitivity),
    }));
  });
};

/**
 * One chunk row as the review list shows it: the row's own id, the document it belongs to, the
 * address it will open at once the binding is published, and its text.
 *
 * The text is here and not on a search hit, because the question this list is put in front of
 * an Admin to answer is *should any of this be published at all*, and nobody can answer that
 * from an address. No class word either: every row of one binding carries the binding's, which
 * is what the screen already has in front of it.
 */
export type PreviewedChunk = {
  readonly id: string;
  readonly sourceDocumentId: string;
  readonly locator: string;
  readonly content: string;
};

/**
 * One binding's chunk rows, under the class and the audience arms and **not** the published one.
 *
 * This is the only statement anywhere in the platform that builds its predicate from
 * `sensitivityAndAudienceClause` rather than `readableClause`, and the omission is the whole
 * act rather than an oversight (T-133). A binding still under review carries no published
 * instant, and a run copies that absence onto every chunk it lands, so every other read steps
 * over those rows by design — which would leave the Admin who has to decide whether to publish
 * the binding with nothing to look at. The two arms that remain are the same builder's and are
 * applied unchanged: this road reaches *earlier* than the others, never wider, so a class or an
 * audience that withholds a row from this Admin withholds it here too.
 *
 * The parameters are positional and their order is this clause's: the workspace, the binding,
 * the two the predicate reads (the role and the group ids, in that order) and the limit. A
 * number out of step is a wrong answer rather than an error, so the suite is what holds it.
 */
const BINDING_CHUNKS = `SELECT c.id, c.source_document_id, c.char_start, c.char_end, c.content
     FROM "index".chunk c
    WHERE c.workspace_id = $1
      AND c.binding_id = $2
      AND c.char_start IS NOT NULL
      AND c.char_end IS NOT NULL
      AND ${sensitivityAndAudienceClause("c", 3)}
    ORDER BY c.source_document_id, c.ordinal
    LIMIT $5`;

type PreviewRow = {
  readonly id: string;
  readonly source_document_id: string;
  readonly char_start: number;
  readonly char_end: number;
  readonly content: string;
};

/**
 * The chunks of one binding, for the Admin reviewing it before it is published.
 *
 * The Sources screen's review list (T-136) and the one road to a binding still under review:
 * `passageAt` and `findPassages` both carry the published arm, so neither can show an Admin
 * what they are being asked to decide about. The role is decided first and on its own, before
 * a row is read and before the id is even parsed, so a Viewer or an Editor learns nothing from
 * asking — not whether the binding exists, not what shape its id should have been.
 *
 * What this widens is the instant and nothing else. The class and the audience arms are
 * applied as they are everywhere, which means an Admin still reads only what their groups
 * reach; the one door the role opens here is the same one it opens on every other read, the
 * Restricted class.
 *
 * Ordered by document and then by ordinal, so the screen lists a document's text in the order
 * it was written rather than the order the splitter happened to commit. Each row's address is
 * composed from its three columns, as a search hit's is, so the list and the `open` a reviewer
 * follows it with cannot disagree.
 */
export const previewChunks = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly bindingId: string; readonly limit?: number },
): Promise<Result<readonly PreviewedChunk[], RoleRefusal | "malformed" | Error>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, bindingId } = acting.value;

  return attempt(async () => {
    const read = await tx.query<PreviewRow>(BINDING_CHUNKS, [
      admin.workspaceId,
      bindingId,
      ...readableParameters(admin),
      hitsAsked(input.limit ?? MAX_PASSAGE_HITS),
    ]);
    return read.rows.map((row) => ({
      id: row.id,
      sourceDocumentId: row.source_document_id,
      locator: wireLocatorOf(row),
      content: row.content,
    }));
  });
};
