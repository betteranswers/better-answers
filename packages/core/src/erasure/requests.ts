import { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

import { act, declareActs, record, type DetailOf } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  requireAdmin,
  ulid,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * The **subject request** (`CONTEXT.md`; ADR 0020): a person's access or erasure request as
 * an Admin recorded it on their behalf — a member's, or one made for a person the company's
 * files name who never signed in — with the identifier set they gave and the one-month clock
 * it runs on.
 *
 * Three things live here and nowhere else. **The act**, declared against the audit slice's
 * template and landing with its row in one transaction. **The clock's arithmetic**, which the
 * table states the order of and never computes: `due_at` is a month from the clock's start,
 * and the deadline moves to `extended_to` where Article 12's further two months were taken.
 * **The Admin-only read**, because the identifier set is restricted personal data of a
 * suppression's class — the names, addresses and references a subject wrote down — and no
 * other role and no other tier reaches it (the substrate revokes the worker outright).
 */

/**
 * The act an Admin performs on a subject's behalf. Its subject is the request, and its
 * detail carries the person id where the subject holds a login and how many identifiers the
 * set names — never one of them. A detail carries ids and role words and never an email or
 * a name, which matters most here of anywhere: a ledger holding one would need rewriting on
 * the erasure it is the record of, and the ledger is never rewritten.
 */
const SUBJECT_REQUEST_ACTS = declareActs("people", {
  received: act("people.subject_request.received", {
    personId: "id?",
    identifierCount: "count",
  }),
});

/** The detail one row of the act carries — the person id optional, as the act declares it. */
type ReceivedDetail = DetailOf<(typeof SUBJECT_REQUEST_ACTS)["received"]["detail"]>;

/** A subject request as the platform holds it, identifier set and all. */
export type SubjectRequest = z.infer<typeof boundarySchemas.subjectRequest.select>;

/**
 * The identifier set: what the subject gave, across the three kinds the boundary closes the
 * list at. Read off the boundary rather than restated, so the finders that walk it in the
 * erasure map walk the shape the column is held to (ADR 0028).
 */
export type SubjectIdentifiers = NonNullable<SubjectRequest["identifiers"]>;

/**
 * What an Admin hands the act. Both instants come from the caller as `Date`s — no ambient
 * clock read and no defaulted parameter (ADR 0040) — and `clockStartedAt` is receipt or the
 * later instant identity was confirmed when the Admin had to ask (the ICO's pause).
 */
export type RecordSubjectRequestInput = {
  /** *access* or *erasure*; the closed pair is the boundary's, refused here as `malformed`. */
  readonly kind: string;
  readonly identifiers: SubjectIdentifiers;
  /** The person where the subject holds a login (ADR 0035); `null` where they hold none. */
  readonly personId: string | null;
  readonly receivedAt: Date;
  readonly clockStartedAt: Date;
};

export type SubjectRequestRecorded = {
  readonly requestId: string;
  readonly auditEventId: string;
  /** The month the clock ran to, so a caller need not recompute what the row already holds. */
  readonly dueAt: Date;
};

/**
 * Why recording was refused. A clock started before the request arrived is not here: the
 * table's own `subject_request_clock_check` refuses it, and the act lets it speak rather
 * than second-guessing an order the database already holds — the refusal arrives as the
 * store failure it is, and the transaction it aborted is what the caller's opener reports.
 */
export type RecordSubjectRequestRefusal = RoleRefusal | "malformed" | Error;

/** Why a read was refused. `no-such-request` is an id this workspace holds no request for. */
export type ReadSubjectRequestRefusal = RoleRefusal | "malformed" | "no-such-request" | Error;

const REQUEST_ID = boundarySchemas.subjectRequest.select.shape.id;

/**
 * **A month, as Postgres adds one**: the same instant that many months on, landing on the same
 * day of the month or on the target month's last day where that month has no such day. The
 * 31st of January one month on is the 28th of February — the 29th in a leap year — because a
 * day a short month does not have lands in the month after it.
 *
 * It is one function because the platform states this rule in two documents a person is handed
 * and they must agree: the subject request's deadline below, and the erasure routine's
 * beyond-use dates, which are `now() + interval '<life>'` on a `backup_run` row and so are
 * Postgres's own month arithmetic whether or not the report agrees with it. A count of days
 * would be two to three days out for every six-month copy.
 */
export const monthsOn = (from: Date, months: number): Date => {
  const dayAsked = from.getUTCDate();
  const landed = new Date(from);
  // Onto the first, which every month has, before the month moves — so the month arrives
  // where it was asked for, and the day is put back under the length of the month it landed
  // in. Day zero of the month after is that month's last day, leap years included.
  landed.setUTCDate(1);
  landed.setUTCMonth(landed.getUTCMonth() + months);
  const lastDayOfTheMonth = new Date(
    Date.UTC(landed.getUTCFullYear(), landed.getUTCMonth() + 1, 0),
  ).getUTCDate();
  landed.setUTCDate(Math.min(dayAsked, lastDayOfTheMonth));
  return landed;
};

/**
 * The deadline the clock starts on: one month on, by the rule above. A statutory deadline
 * moved later is one the platform has already missed, which is why the short-month arm runs
 * back rather than over.
 *
 * Its pair is the schema factory's `subjectRequest` seed (`packages/schema/test/factory.ts`),
 * which states the same rule in its own line because the schema's tests cannot import this
 * package. Change one and change the other in the same commit; the table's
 * `subject_request_clock_check` only holds the answer to running forward, never to being the
 * right day.
 */
export const dueDateOf = (clockStartedAt: Date): Date => monthsOn(clockStartedAt, 1);

/**
 * The date the platform must answer by: the month, or the extension where Article 12's
 * further two months were taken and notified inside the first. One function, so a screen
 * and a report never disagree about which of the two columns is the deadline.
 */
export const deadlineOf = (request: Pick<SubjectRequest, "dueAt" | "extendedTo">): Date =>
  request.extendedTo ?? request.dueAt;

/**
 * How many identifiers the set names across its kinds — the one thing the ledger says about
 * it. Over the object's own values rather than the three keys by name, so a fourth kind
 * added to the closed list is counted the day it exists.
 */
const identifierCountOf = (identifiers: SubjectIdentifiers): number =>
  Object.values(identifiers).reduce((total, named) => total + named.length, 0);

/**
 * Record a subject's request, with its ledger row, in one transaction.
 *
 * Every refusal is decided before a row is written: the role, then the shape at the
 * boundary — the kind's closed pair, the person id's one form, the identifier set's bounds.
 * The row is written, and the ledger row after it and **bare** (ADR 0014 rule 4): the door
 * rejects rather than answering a value, and that rejection aborts the transaction the
 * request row landed in, so an act whose event cannot be written did not happen.
 *
 * The extension and the answer are later acts'; their three columns start as the NULLs the
 * table gives them, which is what an Admin has just written.
 */
export const recordSubjectRequest = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RecordSubjectRequestInput,
): Promise<Result<SubjectRequestRecorded, RecordSubjectRequestRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  const row = boundarySchemas.subjectRequest.insert.safeParse({
    workspaceId,
    id: ulid(),
    personId: input.personId,
    identifiers: input.identifiers,
    kind: input.kind,
    receivedAt: input.receivedAt,
    clockStartedAt: input.clockStartedAt,
    dueAt: dueDateOf(input.clockStartedAt),
    extendedTo: null,
    answeredAt: null,
    answer: null,
  });
  if (!row.success) return err("malformed");
  const { id: requestId, dueAt } = row.data;

  const written = await attempt(() =>
    tx.query(
      `INSERT INTO subject_request
         (workspace_id, id, person_id, identifiers, kind, received_at, clock_started_at, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        workspaceId,
        requestId,
        input.personId,
        input.identifiers,
        row.data.kind,
        row.data.receivedAt,
        row.data.clockStartedAt,
        dueAt,
      ],
    ),
  );
  if (!written.ok) return err(written.error);

  const identifierCount = identifierCountOf(input.identifiers);
  // The person id where the subject has one, and the field left out where they have none —
  // an absent optional, never a null standing in for a person.
  const detail: ReceivedDetail =
    input.personId === null ? { identifierCount } : { personId: input.personId, identifierCount };
  const auditEventId = ulid();
  // Bare, after the row: the door's rejection aborts the transaction the row landed in.
  await record(admin.value, tx, {
    id: auditEventId,
    act: SUBJECT_REQUEST_ACTS.received,
    subjectId: requestId,
    detail,
  });
  return ok({ requestId, auditEventId, dueAt });
};

/**
 * Read one subject request **with** its identifier set, as an Admin. The role is the gate
 * and the workspace scope the fence: an Editor and a Viewer are refused before the
 * statement runs, and a request another workspace holds is one this workspace holds none
 * of, which is the same answer as an id nobody ever minted.
 */
export const subjectRequestFor = async (
  principal: UserPrincipal,
  tx: Tx,
  id: string,
): Promise<Result<SubjectRequest, ReadSubjectRequestRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const requestId = REQUEST_ID.safeParse(id);
  if (!requestId.success) return err("malformed");

  const found = await attempt(() =>
    tx.query(
      `SELECT workspace_id AS "workspaceId", id, person_id AS "personId", identifiers, kind,
              received_at AS "receivedAt", clock_started_at AS "clockStartedAt",
              due_at AS "dueAt", extended_to AS "extendedTo", answered_at AS "answeredAt", answer
         FROM subject_request
        WHERE workspace_id = $1 AND id = $2`,
      [admin.value.workspaceId, requestId.data],
    ),
  );
  if (!found.ok) return err(found.error);
  const row = found.value.rows[0];
  if (row === undefined) return err("no-such-request");
  // Parsed at the boundary rather than asserted (ADR 0028): the row is the schema's shape.
  return ok(boundarySchemas.subjectRequest.select.parse(row));
};
