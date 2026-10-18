import { z } from "zod";

import { boundarySchemas, FAMILIES } from "@better-answers/schema";

import {
  type DetailNaming,
  eventsNewestFirst,
  eventsSoughtNewestFirst,
  type EventsSought,
  ACTION_HEADLINES,
  STORED_ACT_NAMES,
  STORED_DETAIL_KEYS,
  matchedList,
  type AuditEventPage,
  type AuditEventRow,
} from "../audit/index.ts";
import {
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
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

const auditSearch = z.string().trim().max(100);

export const readAuditLogInput = z.object({
  family: z.enum(FAMILIES).optional(),
  search: auditSearch.optional(),
  /** The last event of the page before; absent for the newest page. */
  cursor: boundarySchemas.auditEvent.select.shape.id.nullish(),
  limit: z.int().min(1).max(AUDIT_LOG_PAGE).default(AUDIT_LOG_PAGE),
});

export type ReadAuditLogInput = z.output<typeof readAuditLogInput>;

const readAuditLogAction = declareAction({
  admits: ADMIN_ALONE,
  input: readAuditLogInput,
  refuses: ["role-forbids"],
});

export type ReadAuditLogRefusal = MemberRefusal<RefusalOf<typeof readAuditLogAction>> | Error;

type ThingKind = "connected-source" | "document" | "concept";

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
  "id" | "action" | "family" | "subjectKind" | "subjectId" | "actor"
> & {
  readonly at: string;
  readonly by: AuditEventActor;
  readonly subject: AuditEventSubject | null;
  readonly detail: NonNullable<AuditEventRow["detail"]>;
  readonly named: Readonly<Record<string, AuditEventSubject | readonly AuditEventSubject[]>>;
};

export type AuditLogPage = Omit<AuditEventPage, "rows"> & {
  readonly events: readonly ReadAuditEvent[];
};

export type SearchedAuditLogPage = AuditLogPage & {
  readonly searchTooBroad: boolean;
};

type NamedKind = "person" | "group" | "invitation" | ThingKind;

export const PERSON_SUBJECT_KINDS = ["member", "person"] as const;

export const PERSON_NAMED_IN = [
  {
    key: "userId",
    subjectKinds: ["group", "member"],
    actions: ["people.group.member_added", "people.group.member_removed", "people.member.added"],
  },
  {
    key: "requesterId",
    subjectKinds: ["request"],
    actions: ["people.request.asked", "people.request.approved", "people.request.declined"],
  },
  {
    key: "adminUserId",
    subjectKinds: ["workspace"],
    actions: ["platform.workspace.provisioned"],
  },
] as const satisfies readonly DetailNaming[];

type Found = {
  readonly people: readonly UserId[];
  readonly groups: readonly string[];
  readonly actions: readonly string[];
  readonly tooBroad: boolean;
};

export const soughtFor = (found: Omit<Found, "tooBroad">): EventsSought => ({
  people: found.people,
  subjects: [
    { kinds: PERSON_SUBJECT_KINDS, ids: found.people },
    { kinds: ["group"], ids: found.groups },
  ],
  actions: found.actions,
  detail: PERSON_NAMED_IN,
});

const IDS_SOUGHT = 100;

const wordsOfAction = (name: string): string =>
  name.split(".").slice(1).join(" ").replaceAll("_", " ");

const actionsWorded = (search: string): readonly string[] => {
  const words = search.toLowerCase().split(/\s+/).join(" ");
  return STORED_ACT_NAMES.filter(
    (name) =>
      wordsOfAction(name).includes(words) || ACTION_HEADLINES[name].toLowerCase().includes(words),
  );
};

const namedInDetail = (scope: number, bind: Bind): string =>
  PERSON_NAMED_IN.map(
    ({ key, subjectKinds, actions }) =>
      `OR EXISTS (SELECT 1 FROM audit_event e
                   WHERE e.workspace_id = $${scope}
                     AND e.subject_kind = ANY($${bind(subjectKinds)}::text[])
                     AND e.action = ANY($${bind(actions)}::text[])
                     AND e.detail ->> $${bind(key)}::text = u.id)`,
  ).join("\n");

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

const foundBy = async (principal: UserPrincipal, tx: Tx, search: string): Promise<Found> => {
  const pattern = containing(search);
  const people = await peopleNamed(principal, tx, pattern);
  const groups = await groupsNamed(principal, tx, pattern);
  return {
    people: people.slice(0, IDS_SOUGHT),
    groups: groups.slice(0, IDS_SOUGHT),
    actions: actionsWorded(search),
    tooBroad: people.length > IDS_SOUGHT || groups.length > IDS_SOUGHT,
  };
};

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

const NAMES_IN = {
  group: 'SELECT id, name FROM "group" WHERE workspace_id = $1 AND id = ANY($2::text[])',
  invitation:
    "SELECT id, email AS name FROM invitation WHERE workspace_id = $1 AND id = ANY($2::text[])",
  "connected-source":
    "SELECT id, name FROM connected_source WHERE workspace_id = $1 AND id = ANY($2::text[])",
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

type Scanned = { readonly row: AuditEventRow; readonly ids: readonly DetailId[] };

const idsNamedAs = (scanned: readonly Scanned[], kind: NamedKind): readonly string[] => [
  ...new Set(
    scanned.flatMap(({ row, ids }) => [
      ...(NAMED_KINDS.get(row.subjectKind) === kind ? [row.subjectId] : []),
      ...ids.flatMap(([, named, id]) => (named === kind ? [id] : [])),
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

const namedDetail = (ids: readonly DetailId[], names: AllNames): ReadAuditEvent["named"] => {
  const single = ids
    .filter(([key]) => key !== MATCHED)
    .map(([key, kind, id]) => [key, namedAs(kind, id, names)] as const);
  const matched = ids
    .filter(([key]) => key === MATCHED)
    .map(([, kind, id]) => namedAs(kind, id, names));
  return Object.fromEntries(matched.length === 0 ? single : [...single, [MATCHED, matched]]);
};

const eventOf = (
  { row, ids }: Scanned,
  names: AllNames,
  detail: ReadAuditEvent["detail"] | undefined,
): ReadAuditEvent => ({
  id: row.id,
  action: row.action,
  family: row.family,
  subjectKind: row.subjectKind,
  subjectId: row.subjectId,
  actor: row.actor,
  at: row.at.toISOString(),
  by: actorOf(row.actor, names.people),
  subject: subjectOf(row, names),
  detail: detail ?? {},
  named: namedDetail(ids, names),
});

const thingNames = async (
  principal: UserPrincipal,
  tx: Tx,
  scanned: readonly Scanned[],
): Promise<ThingNames> => {
  const named = (kind: keyof ThingNames) => namesIn(principal, tx, kind, idsNamedAs(scanned, kind));
  return {
    group: await named("group"),
    invitation: await named("invitation"),
    "connected-source": await named("connected-source"),
    document: await named("document"),
    concept: await named("concept"),
  };
};

export const eventsNamed = async (
  principal: UserPrincipal,
  tx: Tx,
  rows: readonly AuditEventRow[],
): Promise<readonly ReadAuditEvent[]> => {
  const scanned = rows.map((row) => ({ row, ids: detailIds(row) }));
  const people = await namesOfPeople(tx, [
    ...peopleAmong(rows.map((row) => row.actor)),
    ...idsNamedAs(scanned, "person"),
  ]);
  const things = await thingNames(principal, tx, scanned);
  const details = await detailsNamed(
    tx,
    rows.map((row) => row.detail ?? {}),
  );
  return scanned.map((one, index) => eventOf(one, { people, things }, details[index]));
};

/**
 * The workspace's own audit log, newest first. A grant an action ended is named from its assistant
 * and workspace as they stand now.
 */
export const readAuditLog = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReadAuditLogInput,
): Promise<Result<SearchedAuditLogPage, ReadAuditLogRefusal>> => {
  const admitted = admit(readAuditLogAction, principal, input);
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
