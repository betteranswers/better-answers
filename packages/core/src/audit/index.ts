import { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

import { actorIdOf } from "../kernel/index.ts";
import type { ActorId, AuditEventId, PlatformPrincipal, Principal } from "../kernel/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";
import {
  type Act,
  DETAIL_KINDS,
  type DetailOf,
  type DetailShape,
  type DetailValue,
  isDeclared,
} from "./vocabulary.ts";

/**
 * The one append-only *ledger* (`CONTEXT.md`): the typed act vocabulary (`vocabulary.ts`)
 * and the two doors every slice writes it through (ADR 0014 rule 4; ADR 0035; ADR 0038).
 *
 * Imports `kernel` and `store` and nothing else in `core` — ADR 0029 rule 3 lets `audit`
 * reach `kernel`, `access` and `store`, never a slice and never `llm`. Two doors and no
 * third, rather than one write per slice, is what keeps the vocabulary typed and the
 * ledger one source of truth:
 *
 * - `record` derives the actor from the caller's Principal — a person by their person id,
 *   the platform by its own actor id — and is the door every act uses.
 * - `recordFor` takes the platform principal **and an explicit actor**, for the one act a
 *   person performs while holding no membership and so no Principal: the *access request*
 *   (T-061). Typed so a user principal cannot reach it.
 *
 * And one read, `eventsOfAct`: the rows of one act in one workspace, which is what a
 * *signal* over the ledger is (ADR 0025) — the reconciler's hits, first (T-056).
 *
 * **Both run inside the caller's transaction and reject on any failure.** That is the
 * one place a `core` function is designed to reject rather than return a `Result`
 * (`kernel/result.ts`, rule 5), and it is the point of the ledger: an act and its event
 * land or fail together, so a door that answered a value the caller might not read would
 * let an act commit without its row. The rejection aborts the transaction the door was
 * called in, and the enclosing act's `attempt` is where it becomes a value at that act's
 * own seam. The refusals here are all programming errors — an act nobody declared, a
 * detail carrying a field the act does not name, an id that is not the minter's — never
 * a refusal a caller could act on.
 *
 * **What the row carries** is the boundary's business (`packages/schema`): the id the
 * caller minted, the workspace the transaction is scoped to, the act, the actor, the
 * subject's id, the detail, an optional batch id; the database derives the family and
 * the subject's kind from the act and refuses an act outside the four families.
 */

export { act, declareActs, declarations } from "./vocabulary.ts";
export type {
  Act,
  ActName,
  Declaration,
  DetailKind,
  DetailOf,
  DetailShape,
  Family,
} from "./vocabulary.ts";

/**
 * What a caller hands a door: the id it minted (`kernel`'s `ulid`), the act it declared,
 * the id of the record acted on, the detail the act names, and a batch id when this row is
 * one of N a bulk act writes (ADR 0014 rule 4).
 */
export type AuditEvent<A extends Act> = {
  readonly id: string;
  readonly act: A;
  readonly subjectId: string;
  readonly detail: DetailOf<A["detail"]>;
  /** Explicitly `| undefined`, so a bulk act's caller passes the id it holds, batch or none. */
  readonly batchId?: string | undefined;
};

/** What a door answers: the row's id, and the actor it was booked to. */
export type Recorded = {
  readonly id: AuditEventId;
  readonly actorId: ActorId;
};

/** A row as the ledger holds it — the boundary's own shape, family and subject kind derived. */
export type LedgerRow = z.infer<typeof boundarySchemas.auditEvent.select>;

/**
 * The one read: every row of one act in the caller's workspace, oldest first, from an
 * instant when the caller names one. A signal is a query over rows the platform already
 * keeps and never a counter (ADR 0025), and this is that query over the ledger: the
 * reconciler's hits are it over `platform.reconciler.replayed`. Inside the caller's
 * transaction and under its scope — a user principal's own workspace, written so a
 * disagreement with the scope reads nothing; the platform's, the scope alone. A read
 * writes no row.
 */
export const eventsOfAct = async (
  principal: Principal,
  tx: Tx,
  act: Act,
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
  // Parsed at the boundary rather than asserted (ADR 0028): the row is the schema's shape.
  return found.rows.map((row) => boundarySchemas.auditEvent.select.parse(row));
};

/**
 * The row's own columns, parsed through the boundary less the workspace: the transaction's
 * scope supplies that, below, because the platform principal carries no workspace id.
 */
const eventInsert = boundarySchemas.auditEvent.insert.omit({ workspaceId: true });

const detailRefusal = (shape: DetailShape, detail: Readonly<Record<string, DetailValue>>) => {
  for (const field of Object.keys(detail)) {
    if (!Object.hasOwn(shape, field)) return `detail names a field the act does not: ${field}`;
  }
  for (const [field, kind] of Object.entries(shape)) {
    const value = detail[field];
    // Every DETAIL_KINDS predicate starts with a `typeof` check, none of which a
    // `value` of `undefined` ever passes — so a missing field would still be refused
    // one line down. This check stays for the sharper message naming what is missing,
    // never the fallback "is not a kind" a masked check would settle for.
    if (value === undefined) return `detail is missing the field ${field}`;
    if (!DETAIL_KINDS[kind](value)) return `detail's ${field} is not a ${kind}`;
  }
  return undefined;
};

const write = async <A extends Act>(
  tx: Tx,
  workspaceId: string | null,
  actor: ActorId,
  event: AuditEvent<A>,
): Promise<Recorded> => {
  if (!isDeclared(event.act.name)) throw new Error(`audit: ${event.act.name} was never declared`);
  const row = eventInsert.safeParse({
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

  // The workspace is the one the transaction is scoped to: a user principal's is its own,
  // written so a disagreement with the scope is refused by the policy rather than landed;
  // the platform principal carries none, so the scope alone says where the row lands — and
  // an unscoped transaction lands nothing, because the policy refuses the NULL it resolves to.
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail, batch_id)
     VALUES ($1, ${scopeClause(2)}, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      row.data.id,
      workspaceId,
      row.data.act,
      row.data.actor,
      row.data.subjectId,
      row.data.detail,
      row.data.batchId,
    ],
  );
  // A plain `INSERT ... RETURNING` with no `ON CONFLICT` always yields exactly one row;
  // Postgres guarantees it, not the type, which is all the throw below is guarding.
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error(`audit: ${event.act.name} landed no row`);
  return { id: boundarySchemas.auditEvent.select.shape.id.parse(id), actorId: actor };
};

/**
 * The first door: write one event as the caller, the actor derived from the Principal by
 * the kernel's one function. Inside the caller's own transaction, so the row lands with
 * the act's rows or not at all.
 */
export const record = <A extends Act>(
  principal: Principal,
  tx: Tx,
  event: AuditEvent<A>,
): Promise<Recorded> => write(tx, scopeParameter(principal), actorIdOf(principal), event);

/**
 * The second door: write one event as the platform, booked to an actor the platform
 * names — the person who asked to join a workspace they hold no membership in (T-061),
 * whose act is theirs and not the platform's. The first parameter is the platform
 * principal and only that: the type refuses a user principal, and the type is the one
 * guard — every caller of this package is compiled against it — so no person's session
 * can ever book a row to somebody else.
 */
export const recordFor = <A extends Act>(
  platform: PlatformPrincipal,
  tx: Tx,
  event: AuditEvent<A> & { readonly actor: ActorId },
): Promise<Recorded> => write(tx, null, event.actor, event);
