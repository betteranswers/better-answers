import { boundarySchemas, FAMILIES } from "@better-answers/schema";
import { z } from "zod";

import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  PERSON_PREFIX,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { hasNoDisplayName } from "../workspaces/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const AUDIT_LOG_PAGE = 50;

const AUDIT_LOG_PAGE_MOST = 200;

/** The glossary's words for an actor the audit log can no longer, or never could, name. */
const A_FORMER_MEMBER = "a former member";
const THE_PLATFORM = "the platform";

const AUDIT_EVENT = boundarySchemas.auditEvent.select.shape;

export const readAuditLogInput = z.object({
  family: z.enum(FAMILIES).optional(),
  /** The last event of the page before; absent for the newest page. */
  cursor: AUDIT_EVENT.id.nullish(),
  limit: z.int().min(1).max(AUDIT_LOG_PAGE_MOST).default(AUDIT_LOG_PAGE),
});

export type ReadAuditLogInput = z.output<typeof readAuditLogInput>;

const readAuditLogAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: readAuditLogInput,
  refuses: ["role-forbids"],
  effect: "read",
});

export type ReadAuditLogRefusal = MemberRefusal<RefusalOf<typeof readAuditLogAct>> | Error;

const READ_ROW = z.object({
  id: AUDIT_EVENT.id,
  act: AUDIT_EVENT.act,
  family: AUDIT_EVENT.family,
  subjectKind: AUDIT_EVENT.subjectKind,
  subjectId: AUDIT_EVENT.subjectId,
  at: AUDIT_EVENT.at,
  detail: AUDIT_EVENT.detail,
  /** Null for an actor who is no person; blank for a person whose display name is gone. */
  actorName: z.string().nullable(),
});

type ReadRow = z.output<typeof READ_ROW>;

type ReadAuditEvent = Omit<ReadRow, "at" | "actorName" | "detail"> & {
  /** An ISO instant, which is what a `Date` becomes on the wire anyway. */
  readonly at: string;
  readonly by: string;
  readonly detail: NonNullable<ReadRow["detail"]>;
};

export type AuditLogPage = {
  readonly events: readonly ReadAuditEvent[];
  /** The cursor that reads the page after this one; null when this page is the oldest. */
  readonly nextCursor: ReadAuditEvent["id"] | null;
};

/**
 * The person is joined by the actor's id, not through the membership, so a name outlives it; one
 * row past the page says another follows.
 */
const EVENTS = `SELECT e.id, e.act, e.family, e.subject_kind AS "subjectKind",
            e.subject_id AS "subjectId", e.at, e.detail,
            CASE WHEN starts_with(e.actor, $5) THEN coalesce(u.name, '') END AS "actorName"
       FROM audit_event e
       LEFT JOIN "user" u
         ON starts_with(e.actor, $5) AND u.id = substr(e.actor, length($5) + 1)
      WHERE e.workspace_id = $1
        AND ($2::text IS NULL OR e.family = $2)
        AND ($3::text IS NULL OR (e.at, e.id) < (
              SELECT page_end.at, page_end.id FROM audit_event page_end
               WHERE page_end.workspace_id = $1 AND page_end.id = $3))
      ORDER BY e.at DESC, e.id DESC
      LIMIT $4 + 1`;

const actorNamed = (actorName: string | null): string => {
  if (actorName === null) return THE_PLATFORM;
  return hasNoDisplayName(actorName) ? A_FORMER_MEMBER : actorName;
};

const eventOf = ({ at, actorName, detail, ...row }: ReadRow): ReadAuditEvent => ({
  ...row,
  at: at.toISOString(),
  by: actorNamed(actorName),
  detail: detail ?? {},
});

/**
 * The workspace's own audit log, newest first, from the event after `cursor`. A cursor naming no
 * event of this workspace reads nothing, so another workspace's id learns nothing of it.
 */
export const readAuditLog = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReadAuditLogInput,
): Promise<Result<AuditLogPage, ReadAuditLogRefusal>> => {
  const admitted = admit(readAuditLogAct, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const { family, cursor, limit } = input;

  // The parse brands the ids; a row it throws on fails the read like the query would.
  const read = await attempt(async () => {
    const found = await tx.query(EVENTS, [
      admitted.value.workspaceId,
      family ?? null,
      cursor ?? null,
      limit,
      PERSON_PREFIX,
    ]);
    return z.array(READ_ROW).parse(found.rows);
  });
  if (!read.ok) return err(read.error);

  const events = read.value.slice(0, limit).map(eventOf);
  const more = read.value.length > limit;
  return ok({ events, nextCursor: more ? (events.at(-1)?.id ?? null) : null });
};
