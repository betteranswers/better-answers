import { boundarySchemas, FAMILIES } from "@better-answers/schema";
import { z } from "zod";

import { eventsNewestFirst, type AuditEventPage, type AuditEventRow } from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  isActorId,
  ok,
  personOfActor,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { hasNoDisplayName } from "../workspaces/index.ts";
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

/** The kind, not the words: a person may give any display name, "the platform" among them. */
type AuditEventActor =
  | { readonly kind: "person"; readonly displayName: string }
  | { readonly kind: "former-member" }
  | { readonly kind: "platform" };

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

const personIn = (actor: string): UserId | undefined =>
  isActorId(actor) ? personOfActor(actor) : undefined;

/** By person id, never through the membership, so a name stands after its member leaves. */
const namesOf = async (
  tx: Tx,
  rows: readonly AuditEventRow[],
): Promise<ReadonlyMap<string, string>> => {
  const people = new Set(rows.map((row) => personIn(row.actor)));
  people.delete(undefined);
  const found = await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM "user" WHERE id = ANY($1::text[])',
    [[...people]],
  );
  return new Map(found.rows.map((row) => [row.id, row.name]));
};

const actorOf = (actor: string, names: ReadonlyMap<string, string>): AuditEventActor => {
  const person = personIn(actor);
  if (person === undefined) return { kind: "platform" };
  const displayName = names.get(person) ?? "";
  return hasNoDisplayName(displayName)
    ? { kind: "former-member" }
    : { kind: "person", displayName };
};

const eventOf = (row: AuditEventRow, names: ReadonlyMap<string, string>): ReadAuditEvent => ({
  id: row.id,
  act: row.act,
  family: row.family,
  subjectKind: row.subjectKind,
  subjectId: row.subjectId,
  actor: row.actor,
  at: row.at.toISOString(),
  by: actorOf(row.actor, names),
  detail: row.detail ?? {},
});

/** The workspace's own audit log, newest first; the identity-set audit log is never read. */
export const readAuditLog = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReadAuditLogInput,
): Promise<Result<AuditLogPage, ReadAuditLogRefusal>> => {
  const admitted = admit(readAuditLogAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const read = await attempt(async () => {
    const page = await eventsNewestFirst(admitted.value, tx, input);
    const names = await namesOf(tx, page.rows);
    return { events: page.rows.map((row) => eventOf(row, names)), nextCursor: page.nextCursor };
  });
  return read.ok ? ok(read.value) : err(read.error);
};
