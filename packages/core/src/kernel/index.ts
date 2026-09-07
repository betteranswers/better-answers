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
 *   where a source id belongs. `WorkspaceId`, `UserId`, `AuditEventId` and
 *   `AccessRequestId` today, from the boundary.
 * - the error vocabulary — the typed failures a transport maps to its own protocol.
 *   No status codes live here: four of `core`'s five callers have no notion of one.
 *   `PrincipalRefusal` today.
 * - `Result` — folded in from `packages/contracts` when that package was retired
 *   (T-020, ADR 0031).
 * - `ActorId`, `actorIdOf` and `actorIdOfPerson` — the three forms a record the platform
 *   keeps names an actor in, the one derivation from a Principal and the one from a person
 *   id alone, for the act whose maker holds no Principal, so none is composed by hand
 *   (ADRs 0019, 0035 and 0038). T-076, T-061.
 * - `RoleRefusal` and `requireAdmin` — the one word for an act a role may not perform
 *   and the guard that narrows a `UserPrincipal` to Admin or returns it. T-076.
 * - the result convention — what a slice act returns and that it never throws across
 *   its seam, stated once in `result.ts`'s docblock. T-076.
 * - `refusalFor` — Postgres's constraint names read into a slice's own refusal words,
 *   the store's Error back for every violation the slice does not name. T-076.
 * - `ulid` — the platform's one minter, re-exported from the boundary package where its
 *   body sits beside the pattern it mints to. Every id the platform writes for itself
 *   comes from here, and Better Auth is handed the same function. T-074, ADR 0035.
 */
export { ulid } from "@better-answers/schema";
export { refusalFor } from "./constraint.ts";
export { attempt, err, normalizeError, ok } from "./result.ts";
export type { Result } from "./result.ts";
export { actorIdOf, actorIdOfPerson, isActorId, isPersonActor } from "./actor.ts";
export type { ActorId, ProcessActorId } from "./actor.ts";
export { requireAdmin } from "./role.ts";
export type { AdminUserPrincipal, RoleRefusal } from "./role.ts";
export type {
  AccessRequestId,
  AuditEventId,
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
