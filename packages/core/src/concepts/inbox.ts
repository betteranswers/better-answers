import {
  boundarySchemas,
  conceptFrontmatter,
  SUGGESTION_DECLINED_STATUS,
  SUGGESTION_KINDS_FROM_THE_APP,
  SUGGESTION_RETURNED_STATUS,
  SUGGESTION_SET_MAX,
  SUGGESTION_WAITING_STATUS,
} from "@better-answers/schema";
import type { z } from "zod";

import { readableClause, readableParameters } from "../access/index.ts";
import { act, declareActs, record, type Act } from "../audit/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  isActorId,
  ok,
  requireAdmin,
  ulid,
  type ActorId,
  type Principal,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { withRepositoryLock, type GitDoor } from "../store/git/index.ts";
import {
  scopeClause,
  scopeParameter,
  withMembership,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";
import type { Frontmatter } from "./index.ts";

const INBOX_ACTS = declareActs("knowledge", {
  declined: act("knowledge.suggestion.declined", { setId: "id" }),
  returned: act("knowledge.suggestion.returned", { setId: "id" }),
});

type SuggestionRow = z.infer<typeof boundarySchemas.suggestion.select>;

export type SuggestionKind = SuggestionRow["kind"];
export type SuggestionStatus = SuggestionRow["status"];

export type SuggestionSummaryItem = {
  readonly suggestionId: string;
  readonly kind: SuggestionKind;
  readonly status: SuggestionStatus;
  readonly proposer: ActorId;
  readonly decider: ActorId | null;

  readonly reason: string | null;
  readonly mergeKey: string;
  readonly title: string;
  readonly path: string;

  readonly target: string | null;

  readonly baseMoved: boolean;
};

type SummaryRow = {
  readonly suggestion_id: string;
  readonly kind: string;
  readonly status: string;
  readonly proposer: string;
  readonly decider: string | null;
  readonly reason: string | null;
  readonly merge_key: string;
  readonly title: string;
  readonly path: string;
  readonly resolved_iri: string | null;
  readonly base_moved: boolean;
};

const actorOf = (value: string): ActorId => {
  if (!isActorId(value)) throw new Error(`the inbox holds an actor of no known form`);
  return value;
};

const summaryItem = (row: SummaryRow): SuggestionSummaryItem => {
  const parsed = boundarySchemas.suggestion.select
    .pick({ kind: true, status: true })
    .parse({ kind: row.kind, status: row.status });
  return {
    suggestionId: row.suggestion_id,
    kind: parsed.kind,
    status: parsed.status,
    proposer: actorOf(row.proposer),
    decider: row.decider === null ? null : actorOf(row.decider),
    reason: row.reason,
    mergeKey: row.merge_key,
    title: row.title,
    path: row.path,
    target: row.resolved_iri,
    baseMoved: row.base_moved,
  };
};

export const suggestionSetSummary = async (
  principal: UserPrincipal,
  tx: Tx,
  setId: string,
): Promise<Result<readonly SuggestionSummaryItem[], RoleRefusal | Error>> => {
  const found = await attempt(() =>
    tx.query<SummaryRow>(
      `SELECT s.suggestion_id, s.kind, s.status, s.proposer, s.decider, s.reason,
              s.merge_key, s.title, s.path, c.iri AS resolved_iri,
              CASE WHEN c.iri IS NULL THEN s.base_content_hash IS NOT NULL ELSE s.base_moved END
                AS base_moved
         FROM suggestion_set_summary($1) s
         LEFT JOIN concept_index c
                ON c.iri = s.resolved_iri
               AND ($2 = 'Admin' OR (${readableClause("c", 2)}))`,
      [setId, ...readableParameters(principal)],
    ),
  );
  if (!found.ok) return err(found.error);

  const mine = actorIdOf(principal);
  if (principal.role !== "Admin" && found.value.rows.some((row) => row.proposer !== mine)) {
    return err("role-forbids");
  }

  return attempt(async () => found.value.rows.map(summaryItem));
};

export type SuggestionRequest = {
  readonly mergeKey: string;
  readonly path: string;

  readonly conceptKind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;

  readonly baseContentHash?: string;
};

export type SubmitSuggestionSetInput = {
  readonly kind: SuggestionKind;
  readonly requests: readonly SuggestionRequest[];
};

export type SuggestionSetSubmitted = {
  readonly setId: string;
  readonly suggestionIds: readonly string[];
};

export type SubmitSuggestionSetRefusal = PrincipalRefusal | "malformed" | "kind-forbids";

export const submitSuggestionSet = async (
  principal: UserPrincipal,
  doors: { readonly postgres: PostgresDoor },
  input: SubmitSuggestionSetInput,
): Promise<Result<SuggestionSetSubmitted, SubmitSuggestionSetRefusal | Error>> => {
  const kind = boundarySchemas.suggestion.insert.shape.kind.safeParse(input.kind);
  if (!kind.success) return err("malformed");
  if (!SUGGESTION_KINDS_FROM_THE_APP.some((allowed) => allowed === kind.data)) {
    return err("kind-forbids");
  }
  const setId = ulid();
  const payloads = boundarySchemas.conceptWriteRequest.insert
    .omit({ workspaceId: true })

    .extend({ frontmatter: conceptFrontmatter })
    .array()
    .nonempty()
    .max(SUGGESTION_SET_MAX)
    .safeParse(
      input.requests.map((request) => ({
        suggestionId: ulid(),
        mergeKey: request.mergeKey,
        path: request.path,
        conceptKind: request.conceptKind,
        title: request.title,
        frontmatter: request.frontmatter,
        body: request.body,
        baseContentHash: request.baseContentHash ?? null,
      })),
    );
  if (!payloads.success) return err("malformed");

  const submitted = await attempt(() =>
    withMembership(principal, doors.postgres, async (fresh, tx) => {
      const landed = await tx.query<{ suggestion_id: string }>(
        "SELECT submitted AS suggestion_id FROM submit_suggestion_set($1, $2, $3, $4::jsonb) AS submitted",
        [
          setId,
          kind.data,
          actorIdOf(fresh),
          JSON.stringify(
            payloads.data.map((payload) => ({
              suggestion_id: payload.suggestionId,
              merge_key: payload.mergeKey,
              path: payload.path,
              concept_kind: payload.conceptKind,
              title: payload.title,

              frontmatter: JSON.stringify(payload.frontmatter),
              body: payload.body,
              base_content_hash: payload.baseContentHash,
            })),
          ),
        ],
      );
      return landed.rows.map((row) => row.suggestion_id);
    }),
  );
  if (!submitted.ok) return err(submitted.error);
  if (!submitted.value.ok) return err(submitted.value.error);
  return ok({ setId, suggestionIds: submitted.value.value });
};

export const markDeciding = async (tx: Tx, suggestionId: string): Promise<void> => {
  await tx.query("SELECT set_config('app.deciding_suggestion', $1, true)", [suggestionId]);
};

export type DecideSuggestionInput = {
  readonly suggestionId: string;

  readonly reason: string;
};

export type DecideSuggestionRefusal =
  | RoleRefusal
  | PrincipalRefusal
  | "malformed"
  | "no-such-suggestion"
  | "already-decided";

export type SuggestionDecided = {
  readonly suggestionId: string;
  readonly setId: string;
  readonly status: SuggestionStatus;
};

const decide = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: DecideSuggestionInput,
  decision: { readonly status: SuggestionStatus; readonly act: Act },
): Promise<Result<SuggestionDecided, DecideSuggestionRefusal | Error>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const reason = boundarySchemas.suggestion.insert.shape.reason.safeParse(input.reason);
  if (!reason.success || reason.data === null) return err("malformed");

  const decided = await withRepositoryLock(principal, doors.git, () =>
    attempt(() =>
      withMembership(principal, doors.postgres, async (fresh, tx) => {
        const waiting = await tx.query<{ set_id: string; status: string }>(
          "SELECT set_id, status FROM suggestion WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [fresh.workspaceId, input.suggestionId],
        );
        const row = waiting.rows[0];
        if (row === undefined) return err("no-such-suggestion" as const);
        if (row.status !== SUGGESTION_WAITING_STATUS) return err("already-decided" as const);

        await record(fresh, tx, {
          id: ulid(),
          act: decision.act,
          subjectId: input.suggestionId,
          detail: { setId: row.set_id },
        });

        await markDeciding(tx, input.suggestionId);
        const written = await tx.query<{ id: string }>(
          `UPDATE suggestion
              SET status = $3, decider = $4, decided_at = now(), reason = $5
            WHERE workspace_id = $1 AND id = $2 AND status = $6
          RETURNING id`,
          [
            fresh.workspaceId,
            input.suggestionId,
            decision.status,
            actorIdOf(fresh),
            reason.data,
            SUGGESTION_WAITING_STATUS,
          ],
        );

        if (written.rows.length === 0) {
          throw new Error("the suggestion moved under the lock that was holding it");
        }
        return ok({ suggestionId: input.suggestionId, setId: row.set_id, status: decision.status });
      }),
    ),
  );
  if (!decided.ok) return err(decided.error);
  if (!decided.value.ok) return err(decided.value.error);
  return decided.value.value;
};

export const declineSuggestion = (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: DecideSuggestionInput,
): Promise<Result<SuggestionDecided, DecideSuggestionRefusal | Error>> =>
  decide(principal, doors, input, {
    status: SUGGESTION_DECLINED_STATUS,
    act: INBOX_ACTS.declined,
  });

export const returnToProposer = (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: DecideSuggestionInput,
): Promise<Result<SuggestionDecided, DecideSuggestionRefusal | Error>> =>
  decide(principal, doors, input, {
    status: SUGGESTION_RETURNED_STATUS,
    act: INBOX_ACTS.returned,
  });

export type SuggestionPayload = {
  readonly setId: string;
  readonly kind: SuggestionKind;
  readonly proposer: ActorId;
  readonly mergeKey: string;
  readonly path: string;
  readonly conceptKind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly baseContentHash: string | null;
};

type PayloadRow = {
  readonly set_id: string;
  readonly kind: string;
  readonly proposer: string;
  readonly merge_key: string;
  readonly path: string;
  readonly concept_kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly base_content_hash: string | null;
};

export const payloadFor = async (
  principal: Principal,
  tx: Tx,
  suggestionId: string,
): Promise<SuggestionPayload | undefined> => {
  const found = await tx.query<PayloadRow>(
    `SELECT set_id, kind, proposer, merge_key, path, concept_kind, title, frontmatter, body,
            base_content_hash
       FROM concept_write_request_for($1)`,
    [suggestionId],
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  return {
    setId: row.set_id,
    kind: boundarySchemas.suggestion.select.shape.kind.parse(row.kind),
    proposer: actorOf(row.proposer),
    mergeKey: row.merge_key,
    path: row.path,
    conceptKind: row.concept_kind,
    title: row.title,
    frontmatter: row.frontmatter,
    body: row.body,
    baseContentHash: row.base_content_hash,
  };
};

export const suggestionIsWaiting = async (
  principal: UserPrincipal,
  tx: Tx,
  suggestionId: string,
): Promise<boolean> => {
  const found = await tx.query<{ status: string }>(
    "SELECT status FROM suggestion WHERE workspace_id = $1 AND id = $2",
    [principal.workspaceId, suggestionId],
  );
  return found.rows[0]?.status === SUGGESTION_WAITING_STATUS;
};

export const targetOfMergeKey = async (
  principal: Principal,
  tx: Tx,
  mergeKey: string,
): Promise<string | undefined> => {
  const found = await tx.query<{ iri: string }>(
    `SELECT iri FROM concept_identity WHERE workspace_id = ${scopeClause(1)} AND merge_key = $2`,
    [scopeParameter(principal), mergeKey],
  );
  return found.rows[0]?.iri;
};
