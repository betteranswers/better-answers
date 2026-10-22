import { z } from "zod";

import {
  boundarySchemas,
  collectionOf,
  ids,
  LINKS_TO_LABEL,
  SUGGESTION_EDIT_KIND,
  SUGGESTION_SET_MAX,
  SUGGESTION_WAITING_STATUS,
  type ConceptIri,
} from "@better-answers/schema";

import { readableClause, readableParameters } from "../access/index.ts";
import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  NOT_FOUND,
  ok,
  PERSON_PREFIX,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { Frontmatter, FrontmatterValue } from "./file.ts";
import {
  projectedFrontmatter,
  resolvedSourcesOf,
  type PassageNamer,
  type PassageReader,
} from "./read.ts";
import { payloadFor } from "./suggestions.ts";

type WaitingPerson = { readonly id: UserId; readonly name: string };

export type WaitingItem = {
  readonly suggestionId: string;
  readonly title: string;
  readonly proposer: WaitingPerson | null;
  readonly proposedAt: string;
  readonly target: ConceptIri | null;
  readonly collection: string | null;
  readonly owner: WaitingPerson | null;
  readonly baseMoved: boolean;
  readonly places: number;
};

type ConceptParts = {
  readonly title: string;
  readonly body: string;
  readonly sources: FrontmatterValue | undefined;
};

export type WaitingEdit = {
  readonly item: WaitingItem;
  readonly current: ConceptParts | null;
  readonly proposed: ConceptParts;
};

export type WaitingReads = {
  readonly passageAt: PassageReader;
  readonly namesPassage: PassageNamer;
};

type WaitingRow = {
  readonly suggestion_id: string;
  readonly title: string;
  readonly collection: string | null;
  readonly proposed_at: Date;
  readonly resolved_iri: string | null;
  readonly base_moved: boolean;
  readonly owner_id: UserId | null;
  readonly owner_name: string | null;
  readonly proposer_id: UserId | null;
  readonly proposer_name: string | null;
  readonly places: string;
};

const waitingSelect = (narrowed: boolean): string => `WITH sets AS (
    SELECT DISTINCT set_id FROM suggestion
     WHERE workspace_id = $1 AND kind = '${SUGGESTION_EDIT_KIND}'
       AND status = '${SUGGESTION_WAITING_STATUS}'${narrowed ? " AND id = $5" : ""})
  SELECT s.suggestion_id, s.title, ${collectionOf("coalesce(c.path, s.path)")} AS collection,
         p.proposed_at,
         s.resolved_iri, s.base_moved, o.person_id AS owner_id, ou.name AS owner_name,
         pu.id AS proposer_id, pu.name AS proposer_name,
         (SELECT count(DISTINCT i.write_up_id) FROM write_up_include i
           WHERE i.workspace_id = $1 AND i.iri = s.resolved_iri)
       + (SELECT count(DISTINCT e.from_uid)
            FROM map_generation g
            JOIN map_edge e ON e.workspace_id = g.workspace_id AND e.gen = g.live_gen
           WHERE g.workspace_id = $1 AND e.to_uid = s.resolved_iri
             AND e.label = '${LINKS_TO_LABEL}' AND e.from_uid <> s.resolved_iri) AS places
    FROM sets
   CROSS JOIN LATERAL suggestion_set_summary(sets.set_id) s
    JOIN suggestion p ON p.workspace_id = $1 AND p.id = s.suggestion_id
    LEFT JOIN concept_index c ON c.workspace_id = $1 AND c.iri = s.resolved_iri
    LEFT JOIN LATERAL (
          SELECT person_id FROM concept_owner
           WHERE workspace_id = $1
             AND (iri = s.resolved_iri OR collection = ${collectionOf("coalesce(c.path, s.path)")})
           ORDER BY iri IS NULL
           LIMIT 1) o ON true
    LEFT JOIN "user" ou ON ou.id = o.person_id
    LEFT JOIN "user" pu
           ON starts_with(s.proposer, '${PERSON_PREFIX}')
          AND pu.id = substr(s.proposer, ${PERSON_PREFIX.length + 1})
   WHERE s.kind = '${SUGGESTION_EDIT_KIND}' AND s.status = '${SUGGESTION_WAITING_STATUS}'
     AND ($2 = 'Admin'
          OR (o.person_id = $4 AND (s.resolved_iri IS NULL OR (${readableClause("c", 2)}))))${
            narrowed ? "\n     AND s.suggestion_id = $5" : ""
          }
   ORDER BY p.proposed_at, s.suggestion_id`;

const WAITING = waitingSelect(false);

const WAITING_ONE = waitingSelect(true);

const personOf = (id: UserId | null, name: string | null): WaitingPerson | null =>
  id === null ? null : { id, name: name ?? "" };

const itemOf = (row: WaitingRow): WaitingItem => ({
  suggestionId: row.suggestion_id,
  title: row.title,
  proposer: personOf(row.proposer_id, row.proposer_name),
  proposedAt: row.proposed_at.toISOString(),
  target: row.resolved_iri === null ? null : ids.conceptIri.parse(row.resolved_iri),
  collection: row.collection,
  owner: personOf(row.owner_id, row.owner_name),
  baseMoved: row.base_moved,
  places: Number(row.places),
});

const waitingOnYouAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

export const waitingOnYou = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<
  Result<{ readonly items: readonly WaitingItem[] }, RefusalOf<typeof waitingOnYouAction> | Error>
> => {
  const admitted = admit(waitingOnYouAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  return attempt(async () => {
    const found = await tx.query<WaitingRow>(WAITING, [
      reader.workspaceId,
      ...readableParameters(reader),
      reader.userId,
    ]);
    return { items: found.rows.map(itemOf) };
  });
};

export const waitingEditInput = z.strictObject({
  suggestionId: boundarySchemas.suggestion.select.shape.id,
});

const waitingEditAction = declareAction({
  admits: ANY_ROLE,
  input: waitingEditInput,
  refuses: ["role-forbids", "malformed", "not-found"],
});

type StandingRow = {
  readonly title: string;
  readonly body: string;
  readonly frontmatter: Frontmatter;
};

const STANDING = `SELECT c.title, c.body, c.frontmatter FROM concept_index c
   WHERE c.workspace_id = $1 AND c.iri = $4 AND ${readableClause("c", 2)}`;

type Projecting = WaitingReads & {
  readonly principal: UserPrincipal;
  readonly tx: Tx;
};

const partsOf = async (
  projecting: Projecting,
  concept: StandingRow,
): Promise<Result<ConceptParts, Error>> => {
  const resolved = await resolvedSourcesOf(projecting, concept.frontmatter);
  if (!resolved.ok) return err(resolved.error);
  return ok({
    title: concept.title,
    body: concept.body,
    sources: projectedFrontmatter(concept.frontmatter, resolved.value)["sources"],
  });
};

const standingOf = async (
  projecting: Projecting,
  target: ConceptIri | null,
): Promise<Result<ConceptParts | null, Error>> => {
  if (target === null) return ok(null);
  const { principal, tx } = projecting;
  const found = await attempt(() =>
    tx.query<StandingRow>(STANDING, [
      principal.workspaceId,
      ...readableParameters(principal),
      target,
    ]),
  );
  if (!found.ok) return err(found.error);
  const row = found.value.rows[0];
  return row === undefined ? ok(null) : partsOf(projecting, row);
};

export const waitingEdit = async (
  principal: UserPrincipal,
  tx: Tx,
  input: z.output<typeof waitingEditInput>,
  reads: WaitingReads,
): Promise<Result<WaitingEdit, RefusalOf<typeof waitingEditAction> | Error>> => {
  const admitted = admit(waitingEditAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  const kept = await attempt(async () => {
    const found = await tx.query<WaitingRow>(WAITING_ONE, [
      reader.workspaceId,
      ...readableParameters(reader),
      reader.userId,
      input.suggestionId,
    ]);
    const row = found.rows[0];
    if (row === undefined) return undefined;
    const payload = await payloadFor(reader, tx, input.suggestionId);
    return payload === undefined ? undefined : { item: itemOf(row), payload };
  });
  if (!kept.ok) return err(kept.error);
  if (kept.value === undefined) return err(NOT_FOUND);
  const { item, payload } = kept.value;

  const projecting = { principal: reader, tx, ...reads };
  const proposed = await partsOf(projecting, payload);
  if (!proposed.ok) return err(proposed.error);
  const current = await standingOf(projecting, item.target);
  if (!current.ok) return err(current.error);
  return ok({ item, current: current.value, proposed: proposed.value });
};

export const acceptWaitingInput = z.strictObject({
  decisions: z
    .array(
      z.strictObject({
        suggestionId: boundarySchemas.suggestion.select.shape.id,
        expectedTarget: boundarySchemas.suggestion.select.shape.targetIri,
      }),
    )
    .min(1)
    .max(SUGGESTION_SET_MAX),
});

export const declineWaitingInput = z.strictObject({
  suggestionId: boundarySchemas.suggestion.select.shape.id,
  reason: z.string(),
});
