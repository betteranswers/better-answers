/**
 * The kernel: types and pure functions every other module may depend on.
 *
 * ADR 0029 rule 1 — `kernel` imports nothing else in `core`, and everything else may
 * import `kernel`. That is what makes it safe to put the vocabulary here.
 *
 * The surface, each arriving with the ticket that needs it:
 * - `Principal` — `workspaceId`, `userId`, `role`, and its two kinds, user and
 *   platform (`CONTEXT.md`; the deferred kind arrives with the first background job).
 *   Built by a transport, first parameter of every function in `core` that touches
 *   tenant data. T-004.
 * - branded ids — one per entity the glossary names, so a concept id cannot be passed
 *   where a source id belongs. `WorkspaceId` and `UserId` today, from the boundary.
 * - the error vocabulary — the typed failures a transport maps to its own protocol.
 *   No status codes live here: four of `core`'s five callers have no notion of one.
 *   `PrincipalRefusal` today.
 * - `Result` — folded in from `packages/contracts` when that package was retired
 *   (T-020, ADR 0031).
 * - `ActorId` and `actorIdOf` — the three forms a record the platform keeps names an
 *   actor in, and the one derivation from a Principal, so none is composed by hand
 *   (`[AUDIT3]`, ADRs 0019 and 0035). T-076.
 * - `RoleRefusal` and `requireAdmin` — the one word for an act a role may not perform
 *   and the guard that narrows a `UserPrincipal` to Admin or returns it. T-076.
 * - the result convention — what a slice act returns and that it never throws across
 *   its seam, stated once in `result.ts`'s docblock. T-076.
 * - `refusalFor` — Postgres's constraint names read into a slice's own refusal words,
 *   the store's Error back for every violation the slice does not name. T-076.
 */
export { refusalFor } from "./constraint.ts";
export { attempt, err, normalizeError, ok } from "./result.ts";
export type { Result } from "./result.ts";
export { actorIdOf } from "./actor.ts";
export type { ActorId } from "./actor.ts";
export { requireAdmin } from "./role.ts";
export type { AdminPrincipal, RoleRefusal } from "./role.ts";
export type {
  Claims,
  GroupId,
  PlatformPrincipal,
  Principal,
  PrincipalRefusal,
  Role,
  UserId,
  UserPrincipal,
  WorkspaceId,
} from "./principal.ts";
