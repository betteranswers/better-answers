import type { Principal, UserId } from "./principal.ts";

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
export const actorIdOfPerson = (personId: UserId): ActorId => `human:${personId}`;

/**
 * The one derivation from a Principal, so no slice composes the string by hand. A user
 * principal names the person it carries; the platform principal names itself — its
 * acts are audited under that identity and never under a person's.
 */
export const actorIdOf = (principal: Principal): ActorId =>
  principal.kind === "platform" ? principal.actorId : actorIdOfPerson(principal.userId);
