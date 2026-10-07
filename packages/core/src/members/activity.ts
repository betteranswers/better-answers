import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { eventsSoughtNewestFirst } from "../audit/index.ts";
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
import {
  eventsNamed,
  PERSON_NAMED_IN,
  PERSON_SUBJECT_KINDS,
  soughtFor,
  type AuditLogPage,
} from "./audit-log.ts";
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

type ReadEvent = AuditLogPage["events"][number];

/** Whether the person took the act, it was done to them, or both, as a self-demotion is. */
type Direction = "by" | "to" | "both";

export type ActivityPage = Omit<AuditLogPage, "events"> & {
  readonly events: readonly (ReadEvent & { readonly direction: Direction })[];
};

const isTakenBy = (event: ReadEvent, personId: UserId): boolean =>
  event.actor === actorIdOfPerson(personId);

const isDoneTo = (event: ReadEvent, personId: UserId): boolean =>
  (PERSON_SUBJECT_KINDS.some((kind) => kind === event.subjectKind) &&
    event.subjectId === personId) ||
  PERSON_NAMED_IN.some(
    ({ key, acts }) =>
      acts.some((act) => act === event.act) &&
      Object.hasOwn(event.detail, key) &&
      event.detail[key] === personId,
  );

/** An event naming the person neither way means the read and `PERSON_NAMED_IN` have drifted. */
const directionOf = (event: ReadEvent, personId: UserId): Direction => {
  const by = isTakenBy(event, personId);
  const to = isDoneTo(event, personId);
  if (by && to) return "both";
  if (by) return "by";
  if (to) return "to";
  throw new Error(`activity: event ${event.id} names the person neither by nor to`);
};

/**
 * The events of the principal's workspace the person took or that were done to them, newest
 * first, across every time they have been a member here. The identity-set audit log is never read.
 */
export const readActivity = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReadActivityInput,
): Promise<Result<ActivityPage, ReadActivityRefusal>> => {
  const admitted = admit(readActivityAct, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const read = await attempt(async () => {
    const page = await eventsSoughtNewestFirst(admitted.value, tx, {
      sought: soughtFor({ people: [input.personId], groups: [], acts: [] }),
      cursor: input.cursor,
      limit: ACTIVITY_PAGE,
    });
    const events = await eventsNamed(admitted.value, tx, page.rows);
    return {
      events: events.map((event) => ({ ...event, direction: directionOf(event, input.personId) })),
      nextCursor: page.nextCursor,
    };
  });
  return read.ok ? ok(read.value) : err(read.error);
};
