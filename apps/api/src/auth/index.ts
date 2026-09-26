export type { EmailMessage, EmailSender } from "../email.ts";
export { createAuth, type Auth } from "./auth.ts";
export { mountedPaths } from "./endpoints.ts";
export { createAuthRoutes } from "./routes.ts";
export { createTokenVerifier } from "./verify.ts";
export * from "./constants.ts";
export { CONSENT_WORDS, REFUSAL_PAGES } from "./pages.ts";
