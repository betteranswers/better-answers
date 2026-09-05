/**
 * The identity module's interface (ADR 0009): everything the rest of the tier may
 * know about how a credential becomes `Claims`. `better-auth` and `@better-auth/*`
 * are imported under `apps/api/src/auth/` and the CIMD lift alone; the lint override
 * in `.oxlintrc.json` refuses them anywhere else, and
 * `apps/api/tests/lint-rules.test.ts` runs it.
 *
 * It is exactly what the bootstrap and the mounts ask for and no wider. Two names it once
 * carried are reached at their own module instead, for a reason each file states: `bearerOf`
 * by the MCP surface, beside the constants it already reads there, and `sessionClaims` with
 * `SessionReader` by `trpc/base.ts`, which must not pull `createAuth` — and with it Better
 * Auth's inferred instance type — into the program `apps/web` compiles behind `AppRouter`.
 */
export { createAuth, type Auth, type EmailMessage, type EmailSender } from "./auth.ts";
export { mountedPaths } from "./endpoints.ts";
export { createAuthRoutes } from "./routes.ts";
export { createTokenVerifier } from "./verify.ts";
export * from "./constants.ts";
