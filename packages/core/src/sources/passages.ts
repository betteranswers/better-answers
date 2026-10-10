import { z } from "zod";

import { anyWordMatch, SENSITIVITIES, type MatchBound } from "@better-answers/schema";

import {
  narrower,
  readableClause,
  readableParameters,
  sensitivityAndAudienceClause,
  type Sensitivity,
} from "../access/index.ts";
import { evidenceForAReadableConcept } from "../concepts/index.ts";
import {
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  NOT_FOUND,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { adminOnConnectedSource, CONNECTED_SOURCE_ID } from "./admin-connected-source.ts";
import { locatorOf, parseLocator, spanText, type LocatorRefusal } from "./passage-address.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export type Passage = {
  readonly locator: string;
  readonly title: string;
  readonly text: string;
  readonly sensitivity: Sensitivity;
};

/**
 * The view's sensitivity is NULL only for a word both source columns' CHECKs refuse; the predicate's
 * Admin arm passes it, and the parse fails it.
 */
const PASSAGE_SENSITIVITY = z.enum(SENSITIVITIES);

const COVERING_ROWS = `SELECT c.content, c.char_start, c.char_end, c.sensitivity, d.title
     FROM "index".readable_passage c
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
  readonly sensitivity: string | null;
  readonly title: string;
};

/**
 * `not-found` unless passages the caller can read cover the whole span without a gap. The sensitivity is
 * the narrowest among them.
 */
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

    return read.rows.map((row) => {
      const points = Array.from(row.content).length;
      // No CHECK holds a row's content to its span; one that misses shifts every later offset or
      // opens a passage no row covers.
      if (points !== row.char_end - row.char_start) {
        throw new Error(
          `the passage row at ${locatorOf(sourceDocumentId, row.char_start, row.char_end)} holds ${String(points)} code points`,
        );
      }
      return { ...row, sensitivity: PASSAGE_SENSITIVITY.parse(row.sensitivity) };
    });
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

export type PassageMatch = {
  readonly sourceDocumentId: string;
  readonly title: string;
  readonly locator: string;
  readonly sensitivity: Sensitivity;
};

const MAX_PASSAGE_MATCHES = 20;

const matchesAsked = (limit: number): number =>
  Math.min(Math.max(Math.trunc(limit), 0), MAX_PASSAGE_MATCHES);

const wireLocatorOf = (row: {
  readonly source_document_id: string;
  readonly char_start: number;
  readonly char_end: number;
}): string => locatorOf(row.source_document_id, row.char_start, row.char_end);

const MATCH = anyWordMatch("c.search", "$2", ["c.source_document_id", "c.char_start"]);

const matchingRows = (
  after: string,
): string => `SELECT c.source_document_id, c.char_start, c.char_end, c.sensitivity, d.title,
          ${MATCH.columns}
     FROM "index".readable_passage c
     JOIN source_document d ON d.workspace_id = c.workspace_id AND d.id = c.source_document_id
     ${MATCH.joins}
    WHERE c.workspace_id = $1
      AND ${MATCH.matches}
      AND c.char_start IS NOT NULL
      AND c.char_end IS NOT NULL
      AND ${readableClause("c", 3)}
      AND NOT ${evidenceForAReadableConcept("c", 5)}
      ${after}
    ORDER BY ${MATCH.order}
    LIMIT $7`;

const MATCHING_ROWS = matchingRows("");

const MATCHING_ROWS_AFTER = matchingRows(
  `AND ${MATCH.after({ matched: "$8", rank: "$9", key: ["$10", "$11"] })}`,
);

type MatchRow = {
  readonly source_document_id: string;
  readonly char_start: number;
  readonly char_end: number;
  readonly sensitivity: string | null;
  readonly title: string;
  readonly matched: number;
  readonly rank: number;
};

export type PassageBound = MatchBound<{
  readonly sourceDocumentId: string;
  readonly charStart: number;
}>;

export type PassageFound = { readonly passage: PassageMatch; readonly bound: PassageBound };

const boundParameters = (after: PassageBound | undefined): readonly unknown[] =>
  after === undefined
    ? []
    : [after.matched, after.rank, after.key.sourceDocumentId, after.key.charStart];

/**
 * By the any-word rule, after `after` when given. Leaves out a passage whose document is evidence for
 * a concept the caller can read.
 */
export const findPassages = (
  principal: UserPrincipal,
  tx: Tx,
  input: {
    readonly query: string;
    readonly limit: number;
    readonly after?: PassageBound | undefined;
  },
): Promise<Result<readonly PassageFound[], Error>> => {
  const parameters = readableParameters(principal);
  return attempt(async () => {
    const read = await tx.query<MatchRow>(
      input.after === undefined ? MATCHING_ROWS : MATCHING_ROWS_AFTER,
      [
        principal.workspaceId,
        input.query,
        ...parameters,
        ...parameters,
        input.limit,
        ...boundParameters(input.after),
      ],
    );

    return read.rows.map((row) => ({
      passage: {
        sourceDocumentId: row.source_document_id,
        title: row.title,
        locator: wireLocatorOf(row),
        sensitivity: PASSAGE_SENSITIVITY.parse(row.sensitivity),
      },
      bound: {
        matched: row.matched,
        rank: row.rank,
        key: { sourceDocumentId: row.source_document_id, charStart: row.char_start },
      },
    }));
  });
};

export type PreviewedPassage = {
  readonly id: string;
  readonly sourceDocumentId: string;
  readonly locator: string;
  readonly content: string;
};

const CONNECTED_SOURCE_PASSAGES = `SELECT c.id, c.source_document_id, c.char_start, c.char_end, c.content
     FROM "index".readable_passage c
    WHERE c.workspace_id = $1
      AND c.connected_source_id = $2
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

export const previewPassagesInput = z.object({
  connectedSourceId: CONNECTED_SOURCE_ID,

  limit: z.int().positive().default(MAX_PASSAGE_MATCHES),
});

export type PreviewPassagesInput = z.output<typeof previewPassagesInput>;

const previewPassagesAction = declareAction({
  admits: ADMIN_ALONE,
  input: previewPassagesInput,
  refuses: ["role-forbids"],
});

type PreviewPassagesRefusal = SourceRefusal<RefusalOf<typeof previewPassagesAction>> | Error;

/** `limit` is held to 20 at most. */
export const previewPassages = async (
  principal: UserPrincipal,
  tx: Tx,
  input: PreviewPassagesInput,
): Promise<Result<readonly PreviewedPassage[], PreviewPassagesRefusal>> => {
  const admitted = admit(previewPassagesAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const acting = adminOnConnectedSource(admitted.value, input.connectedSourceId);
  const { admin, connectedSourceId } = acting;

  return attempt(async () => {
    const read = await tx.query<PreviewRow>(CONNECTED_SOURCE_PASSAGES, [
      admin.workspaceId,
      connectedSourceId,
      ...readableParameters(admin),
      matchesAsked(input.limit),
    ]);
    return read.rows.map((row) => ({
      id: row.id,
      sourceDocumentId: row.source_document_id,
      locator: wireLocatorOf(row),
      content: row.content,
    }));
  });
};
