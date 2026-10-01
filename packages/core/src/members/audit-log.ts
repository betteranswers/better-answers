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
import {
  actorOf,
  type AuditEventActor,
  detailsNamed,
  hasNoDisplayName,
  namesOfPeople,
  peopleAmong,
} from "../workspaces/index.ts";
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

/**
 * The kind, not the words, as an actor's is. Only erasure deletes an invitation, so an invitation
 * no row holds was erased.
 */
type AuditEventSubject =
  | { readonly kind: "person"; readonly displayName: string }
  | { readonly kind: "former-member" }
  | { readonly kind: "group"; readonly name: string }
  | { readonly kind: "deleted-group" }
  | { readonly kind: "invitation"; readonly address: string }
  | { readonly kind: "erased-invitation" };

type ReadAuditEvent = Pick<
  AuditEventRow,
  "id" | "act" | "family" | "subjectKind" | "subjectId" | "actor"
> & {
  /** An ISO instant, which is what a `Date` becomes on the wire anyway. */
  readonly at: string;
  readonly by: AuditEventActor;
  /** Null for a subject that is not a person, a group or an invitation. */
  readonly subject: AuditEventSubject | null;
  readonly detail: NonNullable<AuditEventRow["detail"]>;
};

export type AuditLogPage = Omit<AuditEventPage, "rows"> & {
  readonly events: readonly ReadAuditEvent[];
};

type NamedKind = "person" | "group" | "invitation";

/** The subject kinds a person's id stands under. */
export const PERSON_SUBJECT_KINDS = ["member", "person"] as const;

const NAMED_KINDS: ReadonlyMap<string, NamedKind> = new Map([
  ...PERSON_SUBJECT_KINDS.map((kind): [string, NamedKind] => [kind, "person"]),
  ["group", "group"],
  ["invitation", "invitation"],
]);

type Names = ReadonlyMap<string, string>;

type SubjectNames = Readonly<Record<NamedKind, Names>>;

const idsNamedAs = (rows: readonly AuditEventRow[], kind: NamedKind): readonly string[] => [
  ...new Set(
    rows.filter((row) => NAMED_KINDS.get(row.subjectKind) === kind).map((row) => row.subjectId),
  ),
];

const byId = (rows: readonly { id: string; name: string }[]): Names =>
  new Map(rows.map((row) => [row.id, row.name]));

const groupNames = async (
  principal: UserPrincipal,
  tx: Tx,
  groupIds: readonly string[],
): Promise<Names> => {
  if (groupIds.length === 0) return new Map();
  const found = await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM "group" WHERE workspace_id = $1 AND id = ANY($2::text[])',
    [principal.workspaceId, groupIds],
  );
  return byId(found.rows);
};

/** The invitation table has no row-level security, so the workspace is named here or nowhere. */
const invitationAddresses = async (
  principal: UserPrincipal,
  tx: Tx,
  invitationIds: readonly string[],
): Promise<Names> => {
  if (invitationIds.length === 0) return new Map();
  const found = await tx.query<{ id: string; name: string }>(
    "SELECT id, email AS name FROM invitation WHERE workspace_id = $1 AND id = ANY($2::text[])",
    [principal.workspaceId, invitationIds],
  );
  return byId(found.rows);
};

const SUBJECT_OF = {
  person: (name) =>
    name === undefined || hasNoDisplayName(name)
      ? { kind: "former-member" }
      : { kind: "person", displayName: name },
  group: (name) => (name === undefined ? { kind: "deleted-group" } : { kind: "group", name }),
  invitation: (address) =>
    address === undefined ? { kind: "erased-invitation" } : { kind: "invitation", address },
} as const satisfies Readonly<Record<NamedKind, (name: string | undefined) => AuditEventSubject>>;

const subjectOf = (row: AuditEventRow, names: SubjectNames): AuditEventSubject | null => {
  const kind = NAMED_KINDS.get(row.subjectKind);
  return kind === undefined ? null : SUBJECT_OF[kind](names[kind].get(row.subjectId));
};

const eventOf = (
  row: AuditEventRow,
  names: { readonly people: Names; readonly subjects: SubjectNames },
  detail: ReadAuditEvent["detail"] | undefined,
): ReadAuditEvent => ({
  id: row.id,
  act: row.act,
  family: row.family,
  subjectKind: row.subjectKind,
  subjectId: row.subjectId,
  actor: row.actor,
  at: row.at.toISOString(),
  by: actorOf(row.actor, names.people),
  subject: subjectOf(row, names.subjects),
  detail: detail ?? {},
});

/**
 * Each event of the principal's workspace with its actor, subject and ended grants named as they
 * stand now, reading each table once for all the rows.
 */
export const eventsNamed = async (
  principal: UserPrincipal,
  tx: Tx,
  rows: readonly AuditEventRow[],
): Promise<readonly ReadAuditEvent[]> => {
  const people = await namesOfPeople(tx, [
    ...peopleAmong(rows.map((row) => row.actor)),
    ...idsNamedAs(rows, "person"),
  ]);
  const subjects = {
    person: people,
    group: await groupNames(principal, tx, idsNamedAs(rows, "group")),
    invitation: await invitationAddresses(principal, tx, idsNamedAs(rows, "invitation")),
  } satisfies SubjectNames;
  const details = await detailsNamed(
    tx,
    rows.map((row) => row.detail ?? {}),
  );
  return rows.map((row, index) => eventOf(row, { people, subjects }, details[index]));
};

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
    return {
      events: await eventsNamed(admitted.value, tx, page.rows),
      nextCursor: page.nextCursor,
    };
  });
  return read.ok ? ok(read.value) : err(read.error);
};
