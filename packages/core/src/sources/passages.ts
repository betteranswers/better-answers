import { boundarySchemas } from "@better-answers/schema";

import {
  narrower,
  readableClause,
  readableParameters,
  sensitivityAndAudienceClause,
  type Sensitivity,
} from "../access/index.ts";
import { attempt, err, NOT_FOUND, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { adminOnBinding } from "./admin-binding.ts";
import { locatorOf, parseLocator, spanText, type LocatorRefusal } from "./chunk-address.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export type Passage = {
  readonly locator: string;
  readonly title: string;
  readonly text: string;
  readonly sensitivity: Sensitivity;
};

const CHUNK_SENSITIVITY = boundarySchemas.chunk.select.shape.sensitivity;

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

export const passageAt = async (
  principal: UserPrincipal,
  tx: Tx,
  wire: string,
): Promise<Result<Passage, LocatorRefusal | Error>> => {
  const locator = parseLocator(wire);

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

export type PassageHit = {
  readonly sourceDocumentId: string;
  readonly title: string;
  readonly locator: string;
  readonly sensitivity: Sensitivity;
};

export const MAX_PASSAGE_HITS = 20;

const hitsAsked = (limit: number): number =>
  Math.min(Math.max(Math.trunc(limit), 0), MAX_PASSAGE_HITS);

const wireLocatorOf = (row: {
  readonly source_document_id: string;
  readonly char_start: number;
  readonly char_end: number;
}): string => locatorOf(row.source_document_id, row.char_start, row.char_end);

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

    return read.rows.map((row) => ({
      sourceDocumentId: row.source_document_id,
      title: row.title,
      locator: wireLocatorOf(row),
      sensitivity: CHUNK_SENSITIVITY.parse(row.sensitivity),
    }));
  });
};

export type PreviewedChunk = {
  readonly id: string;
  readonly sourceDocumentId: string;
  readonly locator: string;
  readonly content: string;
};

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

type PreviewChunksRefusal = SourceRefusal<"role-forbids" | "malformed"> | Error;

export const previewChunks = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly bindingId: string; readonly limit?: number },
): Promise<Result<readonly PreviewedChunk[], PreviewChunksRefusal>> => {
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
