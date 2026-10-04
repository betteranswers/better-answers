import { z } from "zod";

import { boundarySchemas, FAMILIES } from "@better-answers/schema";

import {
  type DetailNaming,
  eventsNewestFirst,
  eventsSoughtNewestFirst,
  type EventsSought,
  STORED_ACT_NAMES,
  STORED_DETAIL_KEYS,
  matchedList,
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
  namesOfPeople,
  peopleAmong,
  type PeopleNames,
  personNamed,
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

/** A thing an event names that has a name of its own; one since removed is said by its kind. */
type ThingKind = "connected-source" | "document" | "concept";

/**
 * The kind, not the words, as an actor's is. Only erasure deletes an invitation, so an invitation
 * no row holds was erased.
 */
export type AuditEventSubject =
  | Extract<AuditEventActor, { kind: "person" | "former-member" }>
  | { readonly kind: "group"; readonly name: string }
  | { readonly kind: "deleted-group" }
  | { readonly kind: "invitation"; readonly address: string }
  | { readonly kind: "erased-invitation" }
  | { readonly kind: ThingKind; readonly name: string }
  | { readonly kind: "removed"; readonly of: ThingKind };

export type ReadAuditEvent = Pick<
  AuditEventRow,
  "id" | "act" | "family" | "subjectKind" | "subjectId" | "actor"
> & {
  /** An ISO instant, which is what a `Date` becomes on the wire anyway. */
  readonly at: string;
  readonly by: AuditEventActor;
  /** Null for a subject with no name of its own, such as a suggestion or a request. */
  readonly subject: AuditEventSubject | null;
  readonly detail: NonNullable<AuditEventRow["detail"]>;
  /** Each detail key holding the id of something named, or a list of them, as it stands now. */
  readonly named: Readonly<Record<string, AuditEventSubject | readonly AuditEventSubject[]>>;
};

export type AuditLogPage = Omit<AuditEventPage, "rows"> & {
  readonly events: readonly ReadAuditEvent[];
};

export type SearchedAuditLogPage = AuditLogPage & {
  /** The search named more than 100 people or groups, and only the first 100 were read. */
  readonly searchTooBroad: boolean;
};

type NamedKind = "person" | "group" | "invitation" | ThingKind;

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
  ["binding", "connected-source"],
  ["document", "document"],
  ["concept", "concept"],
]);

/** Stored detail keys holding an id, by what the id names. */
const DETAIL_NAMED_KINDS: ReadonlyMap<string, NamedKind> = new Map([
  [STORED_DETAIL_KEYS.userId, "person"],
  [STORED_DETAIL_KEYS.requesterId, "person"],
  [STORED_DETAIL_KEYS.adminUserId, "person"],
  [STORED_DETAIL_KEYS.personId, "person"],
  [STORED_DETAIL_KEYS.invitationId, "invitation"],
  [STORED_DETAIL_KEYS.replacedByInvitationId, "invitation"],
  [STORED_DETAIL_KEYS.connectedSourceId, "connected-source"],
  [STORED_DETAIL_KEYS.documentId, "document"],
  [STORED_DETAIL_KEYS.iri, "concept"],
]);

type Names = ReadonlyMap<string, string>;

type ThingNames = Readonly<Record<Exclude<NamedKind, "person">, Names>>;

/** The invitation table has no row-level security, so the workspace is named here or nowhere. */
const NAMES_IN = {
  group: 'SELECT id, name FROM "group" WHERE workspace_id = $1 AND id = ANY($2::text[])',
  invitation:
    "SELECT id, email AS name FROM invitation WHERE workspace_id = $1 AND id = ANY($2::text[])",
  "connected-source":
    "SELECT id, name FROM source_binding WHERE workspace_id = $1 AND id = ANY($2::text[])",
  document:
    "SELECT id, title AS name FROM source_document WHERE workspace_id = $1 AND id = ANY($2::text[])",
  concept:
    "SELECT iri AS id, title AS name FROM concept_index WHERE workspace_id = $1 AND iri = ANY($2::text[])",
} as const satisfies Readonly<Record<keyof ThingNames, string>>;

type DetailId = readonly [key: string, kind: NamedKind, id: string];

const MATCHED = STORED_DETAIL_KEYS.matched;

const matchedIds = (value: NonNullable<AuditEventRow["detail"]>[string]): readonly DetailId[] => {
  const matched = matchedList.safeParse(value);
  return matched.success ? matched.data.map(({ kind, id }) => [MATCHED, kind, id]) : [];
};

const detailIds = (row: AuditEventRow): readonly DetailId[] =>
  Object.entries(row.detail ?? {}).flatMap(([key, value]): readonly DetailId[] => {
    if (key === MATCHED) return matchedIds(value);
    const kind = DETAIL_NAMED_KINDS.get(key);
    return kind === undefined || typeof value !== "string" ? [] : [[key, kind, value]];
  });

/** The ids of one kind the rows name, as subject or in detail. */
const idsNamedAs = (rows: readonly AuditEventRow[], kind: NamedKind): readonly string[] => [
  ...new Set(
    rows.flatMap((row) => [
      ...(NAMED_KINDS.get(row.subjectKind) === kind ? [row.subjectId] : []),
      ...detailIds(row).flatMap(([, named, id]) => (named === kind ? [id] : [])),
    ]),
  ),
];

const namesIn = async (
  principal: UserPrincipal,
  tx: Tx,
  kind: keyof ThingNames,
  ids: readonly string[],
): Promise<Names> => {
  if (ids.length === 0) return new Map();
  const found = await tx.query<{ id: string; name: string }>(NAMES_IN[kind], [
    principal.workspaceId,
    ids,
  ]);
  return new Map(found.rows.map((row) => [row.id, row.name]));
};

const thingOf = (kind: keyof ThingNames, name: string | undefined): AuditEventSubject => {
  if (kind === "group") return name === undefined ? { kind: "deleted-group" } : { kind, name };
  if (kind === "invitation") {
    return name === undefined ? { kind: "erased-invitation" } : { kind, address: name };
  }
  return name === undefined ? { kind: "removed", of: kind } : { kind, name };
};

type AllNames = { readonly people: PeopleNames; readonly things: ThingNames };

const namedAs = (kind: NamedKind, id: string, names: AllNames): AuditEventSubject =>
  kind === "person" ? personNamed(id, names.people) : thingOf(kind, names.things[kind].get(id));

const subjectOf = (row: AuditEventRow, names: AllNames): AuditEventSubject | null => {
  const kind = NAMED_KINDS.get(row.subjectKind);
  return kind === undefined ? null : namedAs(kind, row.subjectId, names);
};

const namedDetail = (row: AuditEventRow, names: AllNames): ReadAuditEvent["named"] => {
  const ids = detailIds(row);
  const single = ids
    .filter(([key]) => key !== MATCHED)
    .map(([key, kind, id]) => [key, namedAs(kind, id, names)] as const);
  const matched = ids
    .filter(([key]) => key === MATCHED)
    .map(([, kind, id]) => namedAs(kind, id, names));
  return Object.fromEntries(matched.length === 0 ? single : [...single, [MATCHED, matched]]);
};

const eventOf = (
  row: AuditEventRow,
  names: AllNames,
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
  subject: subjectOf(row, names),
  detail: detail ?? {},
  named: namedDetail(row, names),
});

const thingNames = async (
  principal: UserPrincipal,
  tx: Tx,
  rows: readonly AuditEventRow[],
): Promise<ThingNames> => {
  const named = (kind: keyof ThingNames) => namesIn(principal, tx, kind, idsNamedAs(rows, kind));
  return {
    group: await named("group"),
    invitation: await named("invitation"),
    "connected-source": await named("connected-source"),
    document: await named("document"),
    concept: await named("concept"),
  };
};

/**
 * Each event of the principal's workspace with its actor, subject, detail ids and ended grants
 * named as they stand now, reading each table once for all the rows.
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
  const things = await thingNames(principal, tx, rows);
  const details = await detailsNamed(
    tx,
    rows.map((row) => row.detail ?? {}),
  );
  return rows.map((row, index) => eventOf(row, { people, things }, details[index]));
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
