import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { eventsNamingNewestFirst, type PersonNamedIn } from "../audit/index.ts";
import {
  actorIdOfPerson,
  admit,
  attempt,
  declareAct,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { eventsNamed, type AuditLogPage } from "./audit-log.ts";
import type { MemberRefusal } from "./vocabulary.ts";

const ACTIVITY_PAGE = 50;

export const readActivityInput = z.object({
  personId: boundarySchemas.user.select.shape.id,
  /** The last event of the page before; absent for the newest page. */
  cursor: boundarySchemas.auditEvent.select.shape.id.nullish(),
});

export type ReadActivityInput = z.output<typeof readActivityInput>;

const readActivityAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: readActivityInput,
  refuses: ["role-forbids"],
  effect: "read",
});

export type ReadActivityRefusal = MemberRefusal<RefusalOf<typeof readActivityAct>> | Error;

/**
 * The only places a person's id is read beyond the actor. An invitation names an address, so it
 * reaches its inviter's stream alone.
 */
const NAMED_IN = {
  subjectKinds: ["member", "person"],
  detail: [
    {
      key: "userId",
      acts: ["people.group.member_added", "people.group.member_removed", "people.member.added"],
    },
    {
      key: "requesterId",
      acts: ["people.request.asked", "people.request.approved", "people.request.declined"],
    },
  ],
} as const satisfies PersonNamedIn;

type ReadEvent = AuditLogPage["events"][number];

/** Whether the person took the act, it was done to them, or both, as a self-demotion is. */
type Relation = "by" | "to" | "both";

export type ActivityPage = Omit<AuditLogPage, "events"> & {
  readonly events: readonly (ReadEvent & { readonly relation: Relation })[];
};

const isDoneTo = (event: ReadEvent, personId: UserId): boolean =>
  (NAMED_IN.subjectKinds.some((kind) => kind === event.subjectKind) &&
    event.subjectId === personId) ||
  NAMED_IN.detail.some(
    ({ key, acts }) =>
      acts.some((act) => act === event.act) &&
      Object.hasOwn(event.detail, key) &&
      event.detail[key] === personId,
  );

/** An event the read answered names the person somewhere, so one not done to them is theirs. */
const relationOf = (event: ReadEvent, personId: UserId): Relation => {
  if (!isDoneTo(event, personId)) return "by";
  return event.actor === actorIdOfPerson(personId) ? "both" : "to";
};

/**
 * The events of the principal's workspace the person took or that were done to them, newest
 * first, across every membership they have held here. The identity-set audit log is never read.
 */
export const readActivity = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReadActivityInput,
): Promise<Result<ActivityPage, ReadActivityRefusal>> => {
  const admitted = admit(readActivityAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const read = await attempt(async () => {
    const page = await eventsNamingNewestFirst(admitted.value, tx, {
      personId: input.personId,
      namedIn: NAMED_IN,
      cursor: input.cursor,
      limit: ACTIVITY_PAGE,
    });
    const events = await eventsNamed(admitted.value, tx, page.rows);
    return {
      events: events.map((event) => ({ ...event, relation: relationOf(event, input.personId) })),
      nextCursor: page.nextCursor,
    };
  });
  return read.ok ? ok(read.value) : err(read.error);
};
