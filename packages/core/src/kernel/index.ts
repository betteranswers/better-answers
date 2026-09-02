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
 *   tenant data (`[SEC2]`). T-004.
 * - branded ids — one per entity the glossary names, so a concept id cannot be passed
 *   where a source id belongs. `WorkspaceId` and `UserId` today, from the boundary.
 * - the error vocabulary — the typed failures a transport maps to its own protocol.
 *   No status codes live here: four of `core`'s five callers have no notion of one.
 *   `PrincipalRefusal` today.
 * - `Result` — folded in from `packages/contracts` when that package was retired
 *   (T-020, ADR 0031).
 */
export { attempt, err, normalizeError, ok } from "./result.ts";
export type { Result } from "./result.ts";
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
