import type { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { actorIdOf, actorIdOfPerson, ulid } from "../kernel/index.ts";
import type {
  ActorId,
  AuditEventId,
  OperatorPrincipal,
  PlatformPrincipal,
  Principal,
  UserId,
} from "../kernel/index.ts";
import {
  type Bind,
  boundValues,
  scopeClause,
  scopeParameter,
  type Tx,
} from "../store/postgres/index.ts";
import {
  type ActName,
  DETAIL_KINDS,
  type DetailKind,
  type DetailOf,
  type DetailShape,
  type DetailValue,
  isDeclared,
  isIdentitySetAct,
  isOptionalKind,
  type AuditAct,
} from "./vocabulary.ts";

export {
  act,
  declareActs,
  declareIdentitySetActs,
  declarations,
  endedGrant,
} from "./vocabulary.ts";
export { STORED_ACT_NAMES, STORED_DETAIL_KEYS } from "./stored-names.ts";
export type {
  ActName,
  AuditAct,
  DetailOf,
  EndedGrant,
  Matched,
  SecondFactor,
  SignInMethod,
} from "./vocabulary.ts";

export type AuditEvent<A extends AuditAct> = {
  readonly id: string;
  readonly act: A;
  readonly subjectId: string;
  readonly detail: DetailOf<A["detail"]>;

  readonly batchId?: string | undefined;

  /**
   * Stamps `at` as the row is written, not as its transaction began, so rows a lock serialises
   * sort in the lock's order.
   */
  readonly stampedAsWritten?: true;
};

export type Recorded = {
  readonly id: AuditEventId;
  readonly actorId: ActorId;
};

export type AuditEventRow = z.infer<typeof boundarySchemas.auditEvent.select>;

const AUDIT_EVENT_ROW = `id, workspace_id AS "workspaceId", act, family, actor, subject_kind AS "subjectKind",
            subject_id AS "subjectId", at, detail, batch_id AS "batchId"`;

/** Oldest first; `since` is inclusive. */
export const eventsOfAct = async (
  principal: Principal,
  tx: Tx,
  act: AuditAct,
  since?: Date,
): Promise<readonly AuditEventRow[]> => {
  const found = await tx.query(
    `SELECT ${AUDIT_EVENT_ROW}
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
  act: AuditAct,
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

export type AuditEventPage = {
  readonly rows: readonly AuditEventRow[];
  /** The last row's id when an older row follows it; null when this page holds the oldest. */
  readonly nextCursor: AuditEventId | null;
};

type CursorAt = { readonly scope: number; readonly cursor: number };

/** Compared in SQL, never through a `Date`, whose milliseconds would tie rows Postgres orders. */
const afterTheCursor = (at: CursorAt): string =>
  `($${at.cursor}::text IS NULL OR (at, id) < (
     SELECT page_end.at, page_end.id FROM audit_event page_end
      WHERE page_end.workspace_id = ${scopeClause(at.scope)} AND page_end.id = $${at.cursor}))`;

/** Fetched one row past the page, so that row says another follows. */
const pageOf = (rows: readonly AuditEventRow[], limit: number): AuditEventPage => {
  const lastOfAFullPage = rows.length > limit ? rows[limit - 1] : undefined;
  return { rows: rows.slice(0, limit), nextCursor: lastOfAFullPage?.id ?? null };
};

/**
 * Newest first, from the row after `cursor`. A cursor naming no row in scope reads nothing, so
 * another workspace's id learns nothing of it; one row past the page says another follows.
 */
export const eventsNewestFirst = async (
  principal: Principal,
  tx: Tx,
  asked: {
    readonly family?: AuditEventRow["family"] | undefined;
    readonly cursor?: string | null | undefined;
    readonly limit: number;
  },
): Promise<AuditEventPage> => {
  const found = await tx.query(
    `SELECT ${AUDIT_EVENT_ROW}
       FROM audit_event
      WHERE workspace_id = ${scopeClause(1)}
        AND ($2::text IS NULL OR family = $2)
        AND ${afterTheCursor({ scope: 1, cursor: 3 })}
      ORDER BY at DESC, id DESC
      LIMIT $4 + 1`,
    [scopeParameter(principal), asked.family ?? null, asked.cursor ?? null, asked.limit],
  );

  return pageOf(
    found.rows.map((row) => boundarySchemas.auditEvent.select.parse(row)),
    asked.limit,
  );
};

/** Ids under subject kinds; a kind left out of `kinds` hides the events its subjects stand under. */
type SoughtSubjects = {
  readonly kinds: readonly string[];
  readonly ids: readonly string[];
};

/** Where a person's id may stand in an event's detail: under `key`, in the listed acts alone. */
export type DetailNaming = {
  readonly key: string;
  /** Every kind the acts' subjects take, so the arm reaches the subject index. */
  readonly subjectKinds: readonly string[];
  readonly acts: readonly ActName[];
};

/** What a read looks for, each list read as its own arm; an empty list adds no arm. */
export type EventsSought = {
  readonly people: readonly UserId[];
  readonly subjects: readonly SoughtSubjects[];
  readonly acts: readonly string[];
  /** The keys a person's id stands under in detail, matched against `people`. */
  readonly detail: readonly DetailNaming[];
};

type ArmAt = CursorAt & { readonly limit: number; readonly family: number };

/** Each arm is limited on its own index; one query that ORs them would scan the workspace. */
const armOf = (at: ArmAt, predicate: string): string =>
  `(SELECT ${AUDIT_EVENT_ROW}
      FROM audit_event
     WHERE workspace_id = ${scopeClause(at.scope)} AND ${predicate}
       AND ($${at.family}::text IS NULL OR family = $${at.family})
       AND ${afterTheCursor(at)}
     ORDER BY at DESC, id DESC
     LIMIT $${at.limit} + 1)`;

/** One value compares by `=`, so an arm on one person keeps its index's order and needs no sort. */
const oneOf = (values: readonly string[], bind: Bind): string =>
  values.length === 1 ? `= $${bind(values[0] ?? "")}` : `= ANY($${bind(values)}::text[])`;

const predicatesOf = (sought: EventsSought, bind: Bind): readonly string[] => {
  const personMatch = sought.people.length === 0 ? undefined : oneOf(sought.people, bind);
  const subjects = sought.subjects.filter(({ ids }) => ids.length > 0);
  return [
    ...(personMatch === undefined
      ? []
      : [
          `actor ${oneOf(
            sought.people.map((id) => actorIdOfPerson(id)),
            bind,
          )}`,
        ]),
    ...subjects.map(
      ({ kinds, ids }) =>
        `subject_kind = ANY($${bind(kinds)}::text[]) AND subject_id ${oneOf(ids, bind)}`,
    ),
    ...(sought.acts.length === 0 ? [] : [`act = ANY($${bind(sought.acts)}::text[])`]),
    ...(personMatch === undefined ? [] : sought.detail).map(
      ({ key, subjectKinds, acts }) =>
        `subject_kind = ANY($${bind(subjectKinds)}::text[]) AND act = ANY($${bind(acts)}::text[])
         AND detail ->> $${bind(key)}::text ${personMatch}`,
    ),
  ];
};

/**
 * Newest first, from the row after `cursor`, within `family` when one is asked for: the events
 * whose actor or detail names one of the people, whose subject is one sought, or whose act is.
 * An event two arms reach is answered once, and nothing sought reads nothing.
 */
export const eventsSoughtNewestFirst = async (
  principal: Principal,
  tx: Tx,
  asked: {
    readonly sought: EventsSought;
    readonly family?: AuditEventRow["family"] | undefined;
    readonly cursor?: string | null | undefined;
    readonly limit: number;
  },
): Promise<AuditEventPage> => {
  const { values, bind } = boundValues();
  const at: ArmAt = {
    scope: bind(scopeParameter(principal)),
    cursor: bind(asked.cursor ?? null),
    limit: bind(asked.limit),
    family: bind(asked.family ?? null),
  };
  const arms = predicatesOf(asked.sought, bind).map((predicate) => armOf(at, predicate));
  if (arms.length === 0) return { rows: [], nextCursor: null };
  const found = await tx.query(
    `SELECT * FROM (${arms.join(" UNION ALL ")}) AS arms
     ORDER BY at DESC, id DESC`,
    values,
  );

  const rows = found.rows.map((row) => boundarySchemas.auditEvent.select.parse(row));
  return pageOf([...new Map(rows.map((row) => [row.id, row])).values()], asked.limit);
};

const eventInsert = boundarySchemas.auditEvent.insert.omit({ workspaceId: true });

const identitySetInsert = boundarySchemas.identityAuditEvent.insert;

/** Both audit logs take the same row; only a workspace's audit log adds the workspace it belongs to. */
const ROW_COLUMNS = "id, act, actor, subject_id, detail, batch_id";

const AN_KINDS: ReadonlySet<string> = new Set(["id", "iri", "audience"]);

const kindRefusal = (kind: DetailKind): string => {
  if (kind === "grants") return "a list of ended grants";
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

const rowToInsert = <A extends AuditAct>(
  auditLog: typeof eventInsert | typeof identitySetInsert,
  actor: ActorId,
  event: AuditEvent<A>,
) => {
  if (!isDeclared(event.act.name)) throw new Error(`audit: ${event.act.name} was never declared`);
  const row = auditLog.safeParse({
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

const write = async <A extends AuditAct>(
  tx: Tx,
  workspaceId: string | null,
  actor: ActorId,
  event: AuditEvent<A>,
): Promise<Recorded> => {
  const identitySet = isIdentitySetAct(event.act.name);
  const data = rowToInsert(identitySet ? identitySetInsert : eventInsert, actor, event);
  const values = [data.id, data.act, data.actor, data.subjectId, data.detail, data.batchId];
  const stamp = event.stampedAsWritten === true ? "clock_timestamp()" : "now()";
  const inserted = await tx.query<{ id: string }>(
    identitySet
      ? `INSERT INTO identity_audit_event (${ROW_COLUMNS}, at)
         VALUES ($1, $2, $3, $4, $5, $6, ${stamp}) RETURNING id`
      : `INSERT INTO audit_event (${ROW_COLUMNS}, at, workspace_id)
         VALUES ($1, $2, $3, $4, $5, $6, ${stamp}, ${scopeClause(7)}) RETURNING id`,
    identitySet ? values : [...values, workspaceId],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error(`audit: ${event.act.name} landed no row`);
  return { id: boundarySchemas.auditEvent.select.shape.id.parse(id), actorId: actor };
};

/**
 * Writes the event to the audit log its act was declared for. Rejects when the act was never
 * declared, or the event does not fit the audit log's row or its act's detail shape; under the
 * operator, who stands in no workspace, when the act is not the identity set's.
 */
export const record = <A extends AuditAct>(
  principal: Principal | OperatorPrincipal,
  tx: Tx,
  event: AuditEvent<A>,
): Promise<Recorded> => write(tx, scopeParameter(principal), actorIdOf(principal), event);

/** A lone event stands in no batch. */
export const batchIdFor = (count: number): string | undefined => (count > 1 ? ulid() : undefined);

/** Answers the batch the events share, or undefined for a lone one, which stands in none. */
export const recordEach = async <A extends AuditAct>(
  principal: Principal | OperatorPrincipal,
  tx: Tx,
  act: A,
  events: readonly Pick<AuditEvent<A>, "subjectId" | "detail">[],
): Promise<string | undefined> => {
  const batchId = batchIdFor(events.length);
  for (const { subjectId, detail } of events) {
    await record(principal, tx, { id: ulid(), act, subjectId, detail, batchId });
  }
  return batchId;
};

/** As `record`, but the event's own `actor` is recorded rather than the platform. */
export const recordFor = <A extends AuditAct>(
  platform: PlatformPrincipal,
  tx: Tx,
  event: AuditEvent<A> & { readonly actor: ActorId },
): Promise<Recorded> => write(tx, null, event.actor, event);
