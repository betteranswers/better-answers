import { z } from "zod";

import { boundarySchemas, FAMILIES } from "@better-answers/schema";

import { eventsNewestFirst, type AuditEventPage, type AuditEventRow } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { actorOf, type AuditEventActor, detailsNamed, namesOfActors } from "../workspaces/index.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const AUDIT_LOG_PAGE = 50;

export const readAuditLogInput = z.object({
  family: z.enum(FAMILIES).optional(),
  /** The last event of the page before; absent for the newest page. */
  cursor: boundarySchemas.auditEvent.select.shape.id.nullish(),
  limit: z.int().min(1).max(AUDIT_LOG_PAGE).default(AUDIT_LOG_PAGE),
});

export type ReadAuditLogInput = z.output<typeof readAuditLogInput>;

const readAuditLogAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: readAuditLogInput,
  refuses: ["role-forbids"],
  effect: "read",
});

export type ReadAuditLogRefusal = MemberRefusal<RefusalOf<typeof readAuditLogAct>> | Error;

type ReadAuditEvent = Pick<
  AuditEventRow,
  "id" | "act" | "family" | "subjectKind" | "subjectId" | "actor"
> & {
  /** An ISO instant, which is what a `Date` becomes on the wire anyway. */
  readonly at: string;
  readonly by: AuditEventActor;
  readonly detail: NonNullable<AuditEventRow["detail"]>;
};

export type AuditLogPage = Omit<AuditEventPage, "rows"> & {
  readonly events: readonly ReadAuditEvent[];
};

const eventOf = (
  row: AuditEventRow,
  names: ReadonlyMap<string, string>,
  detail: ReadAuditEvent["detail"] | undefined,
): ReadAuditEvent => ({
  id: row.id,
  act: row.act,
  family: row.family,
  subjectKind: row.subjectKind,
  subjectId: row.subjectId,
  actor: row.actor,
  at: row.at.toISOString(),
  by: actorOf(row.actor, names),
  detail: detail ?? {},
});

/**
 * The workspace's own audit log, newest first; the identity-set audit log is never read. A grant
 * an act ended is named from its client and workspace as they stand now.
 */
export const readAuditLog = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReadAuditLogInput,
): Promise<Result<AuditLogPage, ReadAuditLogRefusal>> => {
  const admitted = admit(readAuditLogAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const read = await attempt(async () => {
    const page = await eventsNewestFirst(admitted.value, tx, input);
    const names = await namesOfActors(
      tx,
      page.rows.map((row) => row.actor),
    );
    const details = await detailsNamed(
      tx,
      page.rows.map((row) => row.detail ?? {}),
    );
    return {
      events: page.rows.map((row, index) => eventOf(row, names, details[index])),
      nextCursor: page.nextCursor,
    };
  });
  return read.ok ? ok(read.value) : err(read.error);
};
