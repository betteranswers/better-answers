import type { Principal } from "./principal.ts";

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
 * The type is a template-literal union rather than a brand so that a hand-composed
 * string cannot pass for one and the three forms are readable at the call site.
 */
export type ActorId =
  | `human:${string}`
  | `process:better-answers-${string}`
  | `better-answers-${string}/${string}`;

/**
 * The one derivation, so no slice composes the string by hand. A user
 * principal names the person it carries; the platform principal names itself — its
 * acts are audited under that identity and never under a person's.
 */
export const actorIdOf = (principal: Principal): ActorId =>
  principal.kind === "platform" ? principal.actorId : `human:${principal.userId}`;
