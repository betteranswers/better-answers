import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/client";

/**
 * The product's one identity client. This feature is the only place in `apps/web` that
 * names `better-auth` at all — the shape `apps/api/src/auth/` has on the other side
 * (ADR 0009), and the reason `.oxlintrc.json` opens the ban for this directory and no
 * other. Everything above it speaks screens and memberships, never endpoints.
 *
 * No `baseURL`, so every call goes to the origin this build was served from — `app.`,
 * which the api answers with Better Auth's own handler (ADR 0006, amended 2026-09-02).
 * That origin is also the authorization server's and the MCP surface's (ADR 0034), so the
 * host-only session cookie the answers set is the one the OAuth flow reads, and the
 * api's one trusted origin is this one.
 *
 * Three plugins, and no fourth: the email code a person signs in with, the workspaces
 * they are a member of, and the resume the picker performs when the person arrived here
 * from a host's OAuth flow. Passwords, sign-up and social sign-in are not the product's.
 */
export const authClient = createAuthClient({
  // The api mounts Better Auth at the root, because RFC 8414's discovery document sits at
  // the apex where a host looks for it (`apps/api/src/auth/auth.ts`). The client's own
  // default is `/api/auth`, and left alone it posts sign-in to an address that does not
  // exist — a 404 the person reads as "we could not send a code".
  basePath: "/",
  plugins: [emailOTPClient(), organizationClient(), oauthProviderClient()],
});

export type AuthClient = typeof authClient;
