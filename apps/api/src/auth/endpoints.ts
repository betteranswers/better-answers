import type { Auth } from "./auth.ts";

/**
 * Every path the configured Better Auth instance mounts, read from the instance's own
 * endpoint table rather than typed out here — sorted, and each path once.
 *
 * This exists for the hostname fence's catch-all (`ingress/hostnames.ts`, T-030). That
 * entry hands `/*` to `app.` — the one origin since T-045 (ADR 0034) — without
 * enumerating it, because the set is the
 * plugin list's and a Better Auth upgrade adds to it — so the fence cannot say what it
 * is admitting. `apps/api/tests/better-auth-endpoints.txt` is that set as last
 * reviewed and `better-auth-endpoints.test.ts` fails when the two differ, which turns
 * a widened public surface into a diff somebody reads (T-039).
 *
 * **The table, not the router.** `auth.api` is what `getEndpoints` builds and what
 * `router()` then registers, so it is the widest true reading of what this
 * configuration carries. It is wider than what answers over HTTP today, in two ways
 * that are deliberately *not* filtered out here, because each filter is the library's
 * to keep and a snapshot that trusted one would go quiet the day it stopped:
 *
 * - better-call skips an endpoint whose `options.metadata.SERVER_ONLY` is set
 *   (`better-call/dist/router.mjs`), which is how `@better-auth/oauth-provider`'s
 *   `/admin/oauth2/*` endpoints stay in-process. The flag is no proof a path is
 *   private, though: `/.well-known/oauth-authorization-server` carries it and answers
 *   anyway, served by that plugin's `onRequest` hook rather than by the router. So
 *   filtering on it would drop a path that is genuinely public.
 * - a path in `disabledPaths` (`/token`, which `auth.ts` turns off because the JWT
 *   plugin's own token endpoint must be closed under an OAuth provider) is answered
 *   404 before it routes. Listing it means putting it back would show up here.
 *
 * So a path here is a path to *check*, not a path that answers. Two do not today:
 * `/token`, and `/.well-known/openid-configuration`, which that same hook serves only
 * when the configured scopes include `openid` and ours do not (`constants.ts`).
 *
 * Endpoints with no path of their own — `auth.api`'s in-process helpers, such as the
 * JWT plugin's `signJWT` — reach no hostname and are not paths to review.
 */
export const mountedPaths = (auth: Auth): readonly string[] => {
  const paths = new Set<string>();
  for (const endpoint of Object.values<MountedEndpoint>(auth.api)) {
    if (typeof endpoint.path === "string") paths.add(endpoint.path);
  }
  return [...paths].sort();
};

/**
 * One row of the table: the callable endpoint with the path it is mounted at hung off
 * it (`better-auth/dist/api/to-auth-endpoints.mjs`). `path` is read as optional
 * because the same table carries in-process helpers that have none.
 */
type MountedEndpoint = { readonly path?: string };
