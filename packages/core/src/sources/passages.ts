import { z } from "zod";

import {
  anyWordMatch,
  SENSITIVITIES,
  type CorpusCounts,
  type MatchBound,
} from "@better-answers/schema";

import {
  narrower,
  readableClause,
  readableParameters,
  sensitivityAndAudienceClause,
  type Sensitivity,
} from "../access/index.ts";
import { corpusCountsOf, evidenceForAReadableConcept } from "../concepts/index.ts";
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

const MATCH = anyWordMatch("c.search", "$2", ["c.source_document_id", "c.char_start"], {
  size: "$8",
  frequencies: "$9",
});

export const passageCountsOf = (
  principal: UserPrincipal,
  tx: Tx,
  query: string,
): Promise<Result<CorpusCounts, Error>> =>
  corpusCountsOf(
    tx,
    `SELECT d.search FROM "index".readable_passage d
      WHERE d.workspace_id = $1 AND ${readableClause("d", 2)}`,
    [principal.workspaceId, ...readableParameters(principal)],
    query,
  );

const matchingRows = (
  carried: string,
  after: string,
): string => `SELECT c.source_document_id, c.char_start, c.char_end, c.sensitivity, d.title, ${carried}
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

const AFTER = `AND ${MATCH.after({ weight: "$10", rank: "$11", key: ["$12", "$13"] })}`;

const OPENING_POINTS = 160;

const OPENING_READ_WITH_ROOM_TO_TRIM = OPENING_POINTS * 2;

const SPACE_WITHIN_A_LINE = String.raw`[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]`;

const LINE_END = String.raw`(?:\r\n|[\n\r\v\f\u0085\u2028\u2029])`;

const BLANK_AND_HEADING_ONLY_LINES_AHEAD = String.raw`^(?:${SPACE_WITHIN_A_LINE}*(?:#{1,6})?${SPACE_WITHIN_A_LINE}*${LINE_END})+`;

/** Over the page alone: in the matching query, Postgres would cut every matched row's text before its sort. */
const withOpenings = (
  rows: string,
): string => `SELECT found.source_document_id, found.char_start, found.char_end, found.sensitivity,
          found.title, found.weight, found.rank,
          left(
            regexp_replace(
              regexp_replace(found.content, '${BLANK_AND_HEADING_ONLY_LINES_AHEAD}', ''),
              '${SPACE_WITHIN_A_LINE}+', ' ', 'g'
            ),
            ${String(OPENING_READ_WITH_ROOM_TO_TRIM)}
          ) AS head
     FROM (${rows}) AS found
    ORDER BY found.weight DESC, found.rank DESC, found.source_document_id, found.char_start`;

type MatchRow = {
  readonly source_document_id: string;
  readonly char_start: number;
  readonly char_end: number;
  readonly sensitivity: string | null;
  readonly title: string;
  readonly weight: number;
  readonly rank: number;
};

type OpeningRow = MatchRow & { readonly head: string | null };

export type PassageBound = MatchBound<{
  readonly sourceDocumentId: string;
  readonly charStart: number;
}>;

export type PassageFound<Match = PassageMatch> = {
  readonly passage: Match;
  readonly bound: PassageBound;
};

const boundParameters = (after: PassageBound | undefined): readonly unknown[] =>
  after === undefined
    ? []
    : [after.weight, after.rank, after.key.sourceDocumentId, after.key.charStart];

type PassageSearch = {
  readonly query: string;
  readonly limit: number;
  readonly after?: PassageBound | undefined;
  readonly counts?: CorpusCounts | undefined;
};

type Reading<Row extends MatchRow, Match> = {
  readonly first: string;
  readonly after: string;
  readonly matchOf: (row: Row) => Match;
};

const readingOf = <Row extends MatchRow, Match>(
  query: (after: string) => string,
  matchOf: (row: Row) => Match,
): Reading<Row, Match> => ({ first: query(""), after: query(AFTER), matchOf });

const passageMatchOf = (row: MatchRow): PassageMatch => ({
  sourceDocumentId: row.source_document_id,
  title: row.title,
  locator: wireLocatorOf(row),
  sensitivity: PASSAGE_SENSITIVITY.parse(row.sensitivity),
});

const LINE_BREAK = new RegExp(LINE_END, "u");

const openingLineOf = (head: string | null): string => {
  const line =
    (head ?? "")
      .split(LINE_BREAK)
      .map((each) =>
        each
          .replace(/^\s*#{1,6}(?:\s|$)/u, "")
          .replace(/\s+/gu, " ")
          .trim(),
      )
      .find((each) => each !== "") ?? "";
  const points = Array.from(line);
  return points.length > OPENING_POINTS
    ? `${points
        .slice(0, OPENING_POINTS - 1)
        .join("")
        .trimEnd()}…`
    : line;
};

export type PassageMatchWithOpening = PassageMatch & { readonly openingLine: string };

const LOCATED = readingOf((after) => matchingRows("", after), passageMatchOf);

const WITH_OPENING = readingOf(
  (after) => withOpenings(matchingRows("c.content,", after)),
  (row: OpeningRow): PassageMatchWithOpening => ({
    ...passageMatchOf(row),
    openingLine: openingLineOf(row.head),
  }),
);

export const findPassages = (
  principal: UserPrincipal,
  tx: Tx,
  input: PassageSearch,
): Promise<Result<readonly PassageFound[], Error>> => passagesFound(principal, tx, input, LOCATED);

export const findPassagesWithOpening = (
  principal: UserPrincipal,
  tx: Tx,
  input: PassageSearch,
): Promise<Result<readonly PassageFound<PassageMatchWithOpening>[], Error>> =>
  passagesFound(principal, tx, input, WITH_OPENING);

const passagesFound = async <Row extends MatchRow, Match>(
  principal: UserPrincipal,
  tx: Tx,
  input: PassageSearch,
  reading: Reading<Row, Match>,
): Promise<Result<readonly PassageFound<Match>[], Error>> => {
  const counts =
    input.counts === undefined
      ? await passageCountsOf(principal, tx, input.query)
      : ok(input.counts);
  return counts.ok ? passagesWeighed(principal, tx, input, counts.value, reading) : counts;
};

const passagesWeighed = <Row extends MatchRow, Match>(
  principal: UserPrincipal,
  tx: Tx,
  input: PassageSearch,
  counts: CorpusCounts,
  reading: Reading<Row, Match>,
): Promise<Result<readonly PassageFound<Match>[], Error>> => {
  const parameters = readableParameters(principal);
  return attempt(async () => {
    const read = await tx.query<Row>(input.after === undefined ? reading.first : reading.after, [
      principal.workspaceId,
      input.query,
      ...parameters,
      ...parameters,
      input.limit,
      counts.size,
      counts.frequencies,
      ...boundParameters(input.after),
    ]);

    return read.rows.map((row) => ({
      passage: reading.matchOf(row),
      bound: {
        weight: row.weight,
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
