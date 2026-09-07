import { ACTOR_ID, boundarySchemas } from "@better-answers/schema";

import type { Principal, UserId } from "./principal.ts";

/** The one prefix a person's actor id carries, written once and read back once. */
const PERSON_PREFIX = "human:";

/**
 * The **actor id** (`CONTEXT.md`): who a record the platform keeps names — the ledger's
 * row, a commit trailer, a suggestion's proposer. One of three forms and no fourth:
 *
 * - a person, `human:<person id>` — the platform's one id for them (ADR 0035), never
 *   an email, a display name or a session;
 * - a process the platform runs as itself, `process:better-answers-<purpose>` — the
 *   platform principal's own id;
 * - an agent, `better-answers-<purpose>/<version>` as ADR 0019 shapes it, so that
 *   *verifier ≠ generator* is visible on the string alone.
 *
 * A **file** names a person differently: a concept's `generated.by` and `verified[].by`
 * keep `human:<email>` (ADR 0019, which stands). The two forms differ by decision, and
 * that is why the erasure routine rewrites files and never the ledger.
 *
 * A template-literal union rather than a brand, so the three forms are readable at the
 * call site and a bare `string` cannot pass for one. It is a shape, not a promise about
 * what fills it: `actorIdOf` is what makes the person's part a *person id* rather than
 * an email, and it is the only thing that should ever produce one.
 */
export type ProcessActorId = `process:better-answers-${string}`;

export type ActorId = `human:${string}` | ProcessActorId | `better-answers-${string}/${string}`;

/**
 * A person's actor id from their person id alone — the derivation for the one act a person
 * performs while holding no Principal: the *access request* (ADR 0038), made by somebody who
 * is not a member of the workspace they name and so cannot hold one. The platform principal
 * makes that write and names this actor through the audit slice's second door, so the row is
 * the requester's act and not the platform's.
 *
 * It takes a person id and nothing else, which is the whole guard: an email or a display
 * name reaching an actor id would be a ledger row an erasure had to rewrite (ADR 0035; ADR
 * 0038). The parameter is the boundary's own `UserId` rather than a string, so a caller has
 * to have parsed one before it can call this at all; the shape is held a second time by the
 * ledger's actor refinement, which admits `human:` only over the minter's characters.
 */
export const actorIdOfPerson = (personId: UserId): ActorId => `${PERSON_PREFIX}${personId}`;

/**
 * The one derivation from a Principal, so no slice composes the string by hand. A user
 * principal names the person it carries; the platform principal names itself — its
 * acts are audited under that identity and never under a person's.
 */
export const actorIdOf = (principal: Principal): ActorId =>
  principal.kind === "platform" ? principal.actorId : actorIdOfPerson(principal.userId);

/**
 * Whether a string the platform wrote is one of the three forms — the parse a record's actor
 * column needs on the way back out, against the boundary's own pattern (ADR 0028) rather than
 * a second one written here. A column that fails it is a broken database, and a reader that
 * narrowed without asking would carry the breakage into a type that promises otherwise.
 */
export const isActorId = (value: string): value is ActorId => ACTOR_ID.test(value);

/**
 * Whether an actor is a person. The one place the `human:` form is read, so a caller deriving
 * something from it — trust's tier, which a person's check earns and a machine's does not
 * (ADR 0019) — never tests the prefix itself and never disagrees with `actorIdOfPerson`.
 */
export const isPersonActor = (actor: ActorId): boolean => actor.startsWith(PERSON_PREFIX);

/**
 * The person an actor names, or nothing when it names a process or an agent — the
 * read-back of `actorIdOfPerson`, so a caller that needs the person behind a record never
 * takes the prefix off itself and never disagrees with the one derivation.
 *
 * The tail is **parsed at the boundary rather than asserted** (ADR 0028): a `human:` string
 * over anything but the minter's characters is a record no person id was ever written into,
 * and answering `undefined` for it is the fail-closed reading — the caller falls back to
 * whoever is acting, rather than looking up a person nobody minted.
 */
export const personOfActor = (actor: ActorId): UserId | undefined => {
  if (!isPersonActor(actor)) return undefined;
  const parsed = boundarySchemas.user.select.shape.id.safeParse(actor.slice(PERSON_PREFIX.length));
  return parsed.success ? parsed.data : undefined;
};
