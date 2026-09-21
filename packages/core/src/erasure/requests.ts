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

const SUBJECT_REQUEST_ACTS = declareActs("people", {
  received: act("people.subject_request.received", {
    personId: "id?",
    identifierCount: "count",
  }),
});

type ReceivedDetail = DetailOf<(typeof SUBJECT_REQUEST_ACTS)["received"]["detail"]>;

export type SubjectRequest = z.infer<typeof boundarySchemas.subjectRequest.select>;

export type SubjectIdentifiers = NonNullable<SubjectRequest["identifiers"]>;

export type RecordSubjectRequestInput = {
  readonly kind: string;
  readonly identifiers: SubjectIdentifiers;

  readonly personId: string | null;
  readonly receivedAt: Date;
  readonly clockStartedAt: Date;
};

export type SubjectRequestRecorded = {
  readonly requestId: string;
  readonly auditEventId: string;

  readonly dueAt: Date;
};

export type RecordSubjectRequestRefusal = RoleRefusal | "malformed" | Error;

export type ReadSubjectRequestRefusal = RoleRefusal | "malformed" | "no-such-request" | Error;

const REQUEST_ID = boundarySchemas.subjectRequest.select.shape.id;

export const monthsOn = (from: Date, months: number): Date => {
  const dayAsked = from.getUTCDate();
  const landed = new Date(from);

  landed.setUTCDate(1);
  landed.setUTCMonth(landed.getUTCMonth() + months);
  const lastDayOfTheMonth = new Date(
    Date.UTC(landed.getUTCFullYear(), landed.getUTCMonth() + 1, 0),
  ).getUTCDate();
  landed.setUTCDate(Math.min(dayAsked, lastDayOfTheMonth));
  return landed;
};

// A statutory deadline moved later is one already missed, so a short month clamps back;
// packages/schema/test/factory.ts seeds the same clamp.
export const dueDateOf = (clockStartedAt: Date): Date => monthsOn(clockStartedAt, 1);

export const deadlineOf = (request: Pick<SubjectRequest, "dueAt" | "extendedTo">): Date =>
  request.extendedTo ?? request.dueAt;

const identifierCountOf = (identifiers: SubjectIdentifiers): number =>
  Object.values(identifiers).reduce((total, named) => total + named.length, 0);

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
        row.data.personId,
        row.data.identifiers,
        row.data.kind,
        row.data.receivedAt,
        row.data.clockStartedAt,
        dueAt,
      ],
    ),
  );
  if (!written.ok) return err(written.error);

  const identifierCount = identifierCountOf(input.identifiers);

  const detail: ReceivedDetail =
    input.personId === null ? { identifierCount } : { personId: input.personId, identifierCount };
  const auditEventId = ulid();

  await record(admin.value, tx, {
    id: auditEventId,
    act: SUBJECT_REQUEST_ACTS.received,
    subjectId: requestId,
    detail,
  });
  return ok({ requestId, auditEventId, dueAt });
};

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

  return ok(boundarySchemas.subjectRequest.select.parse(row));
};
