import { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

import { actorIdOf } from "../kernel/index.ts";
import type {
  ActorId,
  AuditEventId,
  OperatorPrincipal,
  PlatformPrincipal,
  Principal,
} from "../kernel/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";
import {
  DETAIL_KINDS,
  type DetailKind,
  type DetailOf,
  type DetailShape,
  type DetailValue,
  isDeclared,
  isIdentitySetAct,
  isOptionalKind,
  type LedgerAct,
} from "./vocabulary.ts";

export { act, declareActs, declareIdentitySetActs, declarations } from "./vocabulary.ts";
export type { ActName, LedgerAct, DetailOf } from "./vocabulary.ts";

export type AuditEvent<A extends LedgerAct> = {
  readonly id: string;
  readonly act: A;
  readonly subjectId: string;
  readonly detail: DetailOf<A["detail"]>;

  readonly batchId?: string | undefined;
};

export type Recorded = {
  readonly id: AuditEventId;
  readonly actorId: ActorId;
};

export type LedgerRow = z.infer<typeof boundarySchemas.auditEvent.select>;

const LEDGER_ROW = `id, workspace_id AS "workspaceId", act, family, actor, subject_kind AS "subjectKind",
            subject_id AS "subjectId", at, detail, batch_id AS "batchId"`;

/** Oldest first; `since` is inclusive. */
export const eventsOfAct = async (
  principal: Principal,
  tx: Tx,
  act: LedgerAct,
  since?: Date,
): Promise<readonly LedgerRow[]> => {
  const found = await tx.query(
    `SELECT ${LEDGER_ROW}
       FROM audit_event
      WHERE workspace_id = ${scopeClause(1)}
        AND act = $2
        AND ($3::timestamptz IS NULL OR at >= $3)
      ORDER BY at, id`,
    [scopeParameter(principal), act.name, since ?? null],
  );

  return found.rows.map((row) => boundarySchemas.auditEvent.select.parse(row));
};

/**
 * The latest instant each subject met `act` on the identity-set audit log; a subject that never
 * did is left out. Naming the subject kind reaches the log's index on kind and subject.
 */
export const latestOnIdentitySet = async (
  _operator: OperatorPrincipal,
  tx: Tx,
  act: LedgerAct,
  subjectIds: readonly string[],
): Promise<ReadonlyMap<string, Date>> => {
  const found = await tx.query<{ subject_id: string; at: Date }>(
    `SELECT subject_id, max(at) AS at FROM identity_audit_event
      WHERE subject_kind = split_part($1, '.', 2) AND subject_id = ANY($2::text[]) AND act = $1
      GROUP BY subject_id`,
    [act.name, subjectIds],
  );
  return new Map(found.rows.map((row) => [row.subject_id, row.at]));
};

export type LedgerPage = {
  readonly rows: readonly LedgerRow[];
  /** The last row's id when an older row follows it; null when this page holds the oldest. */
  readonly nextCursor: AuditEventId | null;
};

/**
 * Newest first, from the row after `cursor`. A cursor naming no row in scope reads nothing, so
 * another workspace's id learns nothing of it; one row past the page says another follows.
 */
export const eventsNewestFirst = async (
  principal: Principal,
  tx: Tx,
  asked: {
    readonly family?: LedgerRow["family"] | undefined;
    readonly cursor?: string | null | undefined;
    readonly limit: number;
  },
): Promise<LedgerPage> => {
  const found = await tx.query(
    `SELECT ${LEDGER_ROW}
       FROM audit_event
      WHERE workspace_id = ${scopeClause(1)}
        AND ($2::text IS NULL OR family = $2)
        AND ($3::text IS NULL OR (at, id) < (
              SELECT page_end.at, page_end.id FROM audit_event page_end
               WHERE page_end.workspace_id = ${scopeClause(1)} AND page_end.id = $3))
      ORDER BY at DESC, id DESC
      LIMIT $4 + 1`,
    [scopeParameter(principal), asked.family ?? null, asked.cursor ?? null, asked.limit],
  );

  const rows = found.rows.map((row) => boundarySchemas.auditEvent.select.parse(row));
  const lastOfAFullPage = rows.length > asked.limit ? rows[asked.limit - 1] : undefined;
  return { rows: rows.slice(0, asked.limit), nextCursor: lastOfAFullPage?.id ?? null };
};

const eventInsert = boundarySchemas.auditEvent.insert.omit({ workspaceId: true });

const identitySetInsert = boundarySchemas.identityAuditEvent.insert;

/** Both ledgers take the same row; only a workspace's ledger adds the workspace it belongs to. */
const ROW_COLUMNS = "id, act, actor, subject_id, detail, batch_id";

const AN_KINDS: ReadonlySet<string> = new Set(["id", "iri", "audience"]);

const kindRefusal = (kind: DetailKind): string => {
  const optional = isOptionalKind(kind);
  const base = optional ? kind.slice(0, -1) : kind;
  const article = AN_KINDS.has(base) ? "an" : "a";
  return optional ? `${article} ${base}, or absent` : `${article} ${base}`;
};

const detailRefusal = (
  shape: DetailShape,
  detail: Readonly<Record<string, DetailValue | undefined>>,
) => {
  for (const field of Object.keys(detail)) {
    if (!Object.hasOwn(shape, field)) return `detail names a field the act does not: ${field}`;
  }
  for (const [field, kind] of Object.entries(shape)) {
    const value = detail[field];

    if (value === undefined) {
      if (isOptionalKind(kind)) continue;
      return `detail is missing the field ${field}`;
    }
    if (!DETAIL_KINDS[kind](value)) return `detail's ${field} is not ${kindRefusal(kind)}`;
  }
  return undefined;
};

const rowToInsert = <A extends LedgerAct>(
  ledger: typeof eventInsert | typeof identitySetInsert,
  actor: ActorId,
  event: AuditEvent<A>,
) => {
  if (!isDeclared(event.act.name)) throw new Error(`audit: ${event.act.name} was never declared`);
  const row = ledger.safeParse({
    id: event.id,
    act: event.act.name,
    actor,
    subjectId: event.subjectId,
    detail: event.detail,
    batchId: event.batchId ?? null,
  });
  if (!row.success) {
    throw new Error(`audit: ${event.act.name} refused at the boundary`, { cause: row.error });
  }
  const refusal = detailRefusal(event.act.detail, event.detail);
  if (refusal !== undefined) throw new Error(`audit: ${event.act.name} ${refusal}`);
  return row.data;
};

const write = async <A extends LedgerAct>(
  tx: Tx,
  workspaceId: string | null,
  actor: ActorId,
  event: AuditEvent<A>,
): Promise<Recorded> => {
  const identitySet = isIdentitySetAct(event.act.name);
  const data = rowToInsert(identitySet ? identitySetInsert : eventInsert, actor, event);
  const values = [data.id, data.act, data.actor, data.subjectId, data.detail, data.batchId];
  const inserted = await tx.query<{ id: string }>(
    identitySet
      ? `INSERT INTO identity_audit_event (${ROW_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
      : `INSERT INTO audit_event (${ROW_COLUMNS}, workspace_id)
         VALUES ($1, $2, $3, $4, $5, $6, ${scopeClause(7)}) RETURNING id`,
    identitySet ? values : [...values, workspaceId],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error(`audit: ${event.act.name} landed no row`);
  return { id: boundarySchemas.auditEvent.select.shape.id.parse(id), actorId: actor };
};

/**
 * Writes the event to the ledger its act was declared for. Rejects when the act was never
 * declared, or the event does not fit the ledger's row or its act's detail shape; under the
 * operator, who stands in no workspace, when the act is not the identity set's.
 */
export const record = <A extends LedgerAct>(
  principal: Principal | OperatorPrincipal,
  tx: Tx,
  event: AuditEvent<A>,
): Promise<Recorded> => write(tx, scopeParameter(principal), actorIdOf(principal), event);

/** As `record`, but the event's own `actor` is recorded rather than the platform. */
export const recordFor = <A extends LedgerAct>(
  platform: PlatformPrincipal,
  tx: Tx,
  event: AuditEvent<A> & { readonly actor: ActorId },
): Promise<Recorded> => write(tx, null, event.actor, event);
