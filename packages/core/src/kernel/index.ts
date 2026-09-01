/**
 * The kernel: types and pure functions every other module may depend on.
 *
 * ADR 0029 rule 1 — `kernel` imports nothing else in `core`, and everything else may
 * import `kernel`. That is what makes it safe to put the vocabulary here.
 *
 * The surface, each arriving with the ticket that needs it:
 * - `Principal` — `workspaceId`, `userId`, `role`, and its two kinds, deferred and
 *   platform (`CONTEXT.md`). Built by a transport, first parameter of every function
 *   in `core` that touches tenant data (`[SEC2]`).
 * - branded ids — one per entity the glossary names, so a concept id cannot be passed
 *   where a source id belongs.
 * - the error vocabulary — the typed failures a transport maps to its own protocol.
 *   No status codes live here: four of `core`'s five callers have no notion of one.
 * - `Result` — folded in from `packages/contracts` when that package was retired
 *   (T-020, ADR 0031).
 */
export { attempt, err, normalizeError, ok } from "./result.ts";
export type { Result } from "./result.ts";
