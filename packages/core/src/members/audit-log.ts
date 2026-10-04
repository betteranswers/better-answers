import { z } from "zod";

import { boundarySchemas, FAMILIES } from "@better-answers/schema";

import {
  type DetailNaming,
  eventsNewestFirst,
  eventsSoughtNewestFirst,
  type EventsSought,
  STORED_ACT_NAMES,
  type AuditEventPage,
  type AuditEventRow,
} from "../audit/index.ts";
import {
  admit,
  attempt,
  declareAct,
  err,
  ok,
  PERSON_PREFIX,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import { type Bind, boundValues, containing, type Tx } from "../store/postgres/index.ts";
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

/** People's names and addresses, group names, or an act's words; never stored, never logged. */
const auditSearch = z.string().trim().max(100);

export const readAuditLogInput = z.object({
  family: z.enum(FAMILIES).optional(),
  search: auditSearch.optional(),
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
export type AuditEventSubject =
  | { readonly kind: "person"; readonly displayName: string }
  | { readonly kind: "former-member" }
  | { readonly kind: "group"; readonly name: string }
  | { readonly kind: "deleted-group" }
  | { readonly kind: "invitation"; readonly address: string }
  | { readonly kind: "erased-invitation" };

export type ReadAuditEvent = Pick<
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

export type SearchedAuditLogPage = AuditLogPage & {
  /** The search named more than 100 people or groups, and only the first 100 were read. */
  readonly searchTooBroad: boolean;
};

type NamedKind = "person" | "group" | "invitation";

/** The subject kinds a person's id stands under. */
export const PERSON_SUBJECT_KINDS = ["member", "person"] as const;

/**
 * The only places a person's id is read beyond the actor. An invitation names an address, so it
 * reaches its inviter alone.
 */
export const PERSON_NAMED_IN = [
  {
    key: "userId",
    subjectKinds: ["group", "member"],
    acts: ["people.group.member_added", "people.group.member_removed", "people.member.added"],
  },
  {
    key: "requesterId",
    subjectKinds: ["request"],
    acts: ["people.request.asked", "people.request.approved", "people.request.declined"],
  },
  {
    key: "adminUserId",
    subjectKinds: ["workspace"],
    acts: ["platform.workspace.provisioned"],
  },
] as const satisfies readonly DetailNaming[];

/** What a search names inside the workspace; each list is empty when nothing of its kind matched. */
type Found = {
  readonly people: readonly UserId[];
  readonly groups: readonly string[];
  readonly acts: readonly string[];
  /** More people or groups matched than are read, so the events of the rest are left out. */
  readonly tooBroad: boolean;
};

/** The events naming any of the people or groups, or taking any of the acts. */
export const soughtFor = (found: Omit<Found, "tooBroad">): EventsSought => ({
  people: found.people,
  subjects: [
    { kinds: PERSON_SUBJECT_KINDS, ids: found.people },
    { kinds: ["group"], ids: found.groups },
  ],
  acts: found.acts,
  detail: PERSON_NAMED_IN,
});

/** Enough for any search a person types; one row past it says the search named more. */
const IDS_SOUGHT = 100;

/** A subject and verb, as `member.role_changed` reads "member role changed". */
const wordsOfAct = (name: string): string =>
  name.split(".").slice(1).join(" ").replaceAll("_", " ");

/** The stored register, not the declarations, which hold only the slices this process imported. */
const actsWorded = (search: string): readonly string[] => {
  const words = search.toLowerCase().split(/\s+/).join(" ");
  return STORED_ACT_NAMES.filter((name) => wordsOfAct(name).includes(words));
};

/** An event of the workspace in `$scope` naming the person `u` in its detail, as the read finds them. */
const namedInDetail = (scope: number, bind: Bind): string =>
  PERSON_NAMED_IN.map(
    ({ key, subjectKinds, acts }) =>
      `OR EXISTS (SELECT 1 FROM audit_event e
                   WHERE e.workspace_id = $${scope}
                     AND e.subject_kind = ANY($${bind(subjectKinds)}::text[])
                     AND e.act = ANY($${bind(acts)}::text[])
                     AND e.detail ->> $${bind(key)}::text = u.id)`,
  ).join("\n");

/** Members and people its events name: a former member is found, an outsider never. */
const peopleNamed = async (
  principal: UserPrincipal,
  tx: Tx,
  pattern: string,
): Promise<readonly UserId[]> => {
  const { values, bind } = boundValues();
  const scope = bind(principal.workspaceId);
  const like = bind(pattern);
  const found = await tx.query<{ id: string }>(
    `SELECT u.id FROM "user" u
      WHERE (u.name ILIKE $${like} OR u.email ILIKE $${like})
        AND (EXISTS (SELECT 1 FROM member m WHERE m.workspace_id = $${scope} AND m.user_id = u.id)
          OR EXISTS (SELECT 1 FROM audit_event e
                      WHERE e.workspace_id = $${scope} AND e.actor = $${bind(PERSON_PREFIX)} || u.id)
          OR EXISTS (SELECT 1 FROM audit_event e
                      WHERE e.workspace_id = $${scope}
                        AND e.subject_kind = ANY($${bind(PERSON_SUBJECT_KINDS)}::text[])
                        AND e.subject_id = u.id)
          ${namedInDetail(scope, bind)})
      ORDER BY u.id LIMIT $${bind(IDS_SOUGHT + 1)}`,
    values,
  );
  return found.rows.map((row) => boundarySchemas.user.select.shape.id.parse(row.id));
};

const groupsNamed = async (
  principal: UserPrincipal,
  tx: Tx,
  pattern: string,
): Promise<readonly string[]> => {
  const found = await tx.query<{ id: string }>(
    'SELECT id FROM "group" WHERE workspace_id = $1 AND name ILIKE $2 ORDER BY id LIMIT $3',
    [principal.workspaceId, pattern, IDS_SOUGHT + 1],
  );
  return found.rows.map((row) => row.id);
};

/** The people, groups and acts a search names, each read inside the principal's workspace. */
const foundBy = async (principal: UserPrincipal, tx: Tx, search: string): Promise<Found> => {
  const pattern = containing(search);
  const people = await peopleNamed(principal, tx, pattern);
  const groups = await groupsNamed(principal, tx, pattern);
  return {
    people: people.slice(0, IDS_SOUGHT),
    groups: groups.slice(0, IDS_SOUGHT),
    acts: actsWorded(search),
    tooBroad: people.length > IDS_SOUGHT || groups.length > IDS_SOUGHT,
  };
};

/** Newest first, narrowed to the search's events, and what it found, when there is a search. */
export const eventsAsked = async (
  principal: UserPrincipal,
  tx: Tx,
  asked: Pick<ReadAuditLogInput, "family" | "search" | "cursor" | "limit">,
): Promise<{ readonly page: AuditEventPage; readonly found?: Found }> => {
  const { search, ...paged } = asked;
  if (search === undefined || search === "") {
    return { page: await eventsNewestFirst(principal, tx, paged) };
  }
  const found = await foundBy(principal, tx, search);
  const sought = soughtFor(found);
  return { page: await eventsSoughtNewestFirst(principal, tx, { ...paged, sought }), found };
};

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
): Promise<Result<SearchedAuditLogPage, ReadAuditLogRefusal>> => {
  const admitted = admit(readAuditLogAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const read = await attempt(async () => {
    const { page, found } = await eventsAsked(admitted.value, tx, input);
    return {
      events: await eventsNamed(admitted.value, tx, page.rows),
      nextCursor: page.nextCursor,
      searchTooBroad: found?.tooBroad ?? false,
    };
  });
  return read.ok ? ok(read.value) : err(read.error);
};
