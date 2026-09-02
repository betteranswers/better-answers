/**
 * The identity module's interface (`[DESIGN5]`): everything the rest of the tier may
 * know about how a credential becomes `Claims`. `better-auth` and `@better-auth/*`
 * are imported under `apps/api/src/auth/` and the CIMD lift alone; the lint override
 * in `.oxlintrc.json` refuses them anywhere else, and
 * `apps/api/tests/lint-rules.test.ts` runs it.
 */
export {
  createAuth,
  type Auth,
  type AuthDependencies,
  type EmailMessage,
  type EmailSender,
} from "./auth.ts";
export { mountedPaths } from "./endpoints.ts";
export { createAuthRoutes } from "./routes.ts";
export { bearerOf, createTokenVerifier, sessionClaims } from "./verify.ts";
export * from "./constants.ts";
