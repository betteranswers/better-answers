import { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

import { actorIdOf } from "../kernel/index.ts";
import type { ActorId, AuditEventId, PlatformPrincipal, Principal } from "../kernel/index.ts";
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

export const eventsOfAct = async (
  principal: Principal,
  tx: Tx,
  act: LedgerAct,
  since?: Date,
): Promise<readonly LedgerRow[]> => {
  const found = await tx.query(
    `SELECT id, workspace_id AS "workspaceId", act, family, actor, subject_kind AS "subjectKind",
            subject_id AS "subjectId", at, detail, batch_id AS "batchId"
       FROM audit_event
      WHERE workspace_id = ${scopeClause(1)}
        AND act = $2
        AND ($3::timestamptz IS NULL OR at >= $3)
      ORDER BY at, id`,
    [scopeParameter(principal), act.name, since ?? null],
  );

  return found.rows.map((row) => boundarySchemas.auditEvent.select.parse(row));
};

const eventInsert = boundarySchemas.auditEvent.insert.omit({ workspaceId: true });

const identitySetInsert = boundarySchemas.identityAuditEvent.insert;

// Both ledgers take the same row; only a workspace's ledger adds the workspace it belongs to.
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

const write = async <A extends LedgerAct>(
  tx: Tx,
  workspaceId: string | null,
  actor: ActorId,
  event: AuditEvent<A>,
): Promise<Recorded> => {
  if (!isDeclared(event.act.name)) throw new Error(`audit: ${event.act.name} was never declared`);
  const identitySet = isIdentitySetAct(event.act.name);
  const row = (identitySet ? identitySetInsert : eventInsert).safeParse({
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

  const { data } = row;
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

export const record = <A extends LedgerAct>(
  principal: Principal,
  tx: Tx,
  event: AuditEvent<A>,
): Promise<Recorded> => write(tx, scopeParameter(principal), actorIdOf(principal), event);

export const recordFor = <A extends LedgerAct>(
  platform: PlatformPrincipal,
  tx: Tx,
  event: AuditEvent<A> & { readonly actor: ActorId },
): Promise<Recorded> => write(tx, null, event.actor, event);
