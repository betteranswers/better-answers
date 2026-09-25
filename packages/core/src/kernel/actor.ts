import { ACTOR_ID, boundarySchemas } from "@better-answers/schema";

import type { OperatorPrincipal, Principal, UserId } from "./principal.ts";

export const PERSON_PREFIX = "human:";

export const PROCESS_PREFIX = "process:better-answers-";

export type ProcessActorId = `${typeof PROCESS_PREFIX}${string}`;

export type ActorId = `human:${string}` | ProcessActorId | `better-answers-${string}/${string}`;

export const actorIdOfPerson = (personId: UserId): ActorId => `${PERSON_PREFIX}${personId}`;

export const actorIdOf = (principal: Principal | OperatorPrincipal): ActorId =>
  principal.kind === "platform" ? principal.actorId : actorIdOfPerson(principal.userId);

export const isActorId = (value: string): value is ActorId => ACTOR_ID.test(value);

export const isPersonActor = (actor: ActorId): boolean => actor.startsWith(PERSON_PREFIX);

/** The person an actor id names; undefined for another actor or a person id that fails to parse. */
export const personOfActor = (actor: ActorId): UserId | undefined => {
  if (!isPersonActor(actor)) return undefined;
  const parsed = boundarySchemas.user.select.shape.id.safeParse(actor.slice(PERSON_PREFIX.length));
  return parsed.success ? parsed.data : undefined;
};
