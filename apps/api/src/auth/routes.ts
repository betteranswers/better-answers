import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { attempt, type Claims, type Clock, type Result } from "@better-answers/core/kernel";
import {
  consumeIngress,
  withPrincipalRead,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";

import { countingPostsAlone, limitByIp, tooManyRequests } from "../ingress/limits.ts";
import { judged, pendingOr, SECOND_FACTOR_PENDING } from "../second-factor-gate.ts";
import type { Auth } from "./auth.ts";
import { grantingFor } from "./consent-grant.ts";
import {
  DISCOVERY_CACHE_CONTROL,
  DISCOVERY_PATHS,
  EMAIL_CODE_EMAIL_RULE,
  EMAIL_CODE_SEND_IP_RULE,
  EMAIL_CODE_SIGN_IN_IP_RULE,
  IDENTITY_IP_RULE,
  MCP_SCOPES,
  OAUTH_IP_RULE,
  PAGE_IP_RULE,
  SEND_EMAIL_CODE_PATH,
  SIGN_IN_BY_EMAIL_CODE_PATH,
} from "./constants.ts";
import { mountedPaths } from "./endpoints.ts";
import {
  CONSENT_WORKSPACE_FIELD,
  consentPage,
  refusedPage,
  REFUSAL_PAGES,
  signInPage,
} from "./pages.ts";
import { sameOriginOnly } from "./same-origin.ts";
import { mountTheAuthenticator } from "./second-factor/authenticator.ts";
import { mountTheConfirm } from "./second-factor/confirm.ts";
import { mountThePasskeys } from "./second-factor/passkeys.ts";
import {
  flowHeaders,
  oauthQuery,
  forwardCookies,
  type AuthRoutesDependencies,
} from "./sign-in/library-flow.ts";
import { hashOf } from "./sign-in/link-token.ts";
import { bindTheLink, mountTheSignInLink } from "./sign-in/sign-in-link-routes.ts";
import { sessionClaims } from "./verify.ts";

const PENDING = "pending";

type Pending = typeof PENDING;

const sessionNamed = z.object({ session: z.object({ id: z.string() }) });

const carry = (url: string): string => new URL(url).search;

const hostnameOf = (url: string): string => URL.parse(url)?.hostname ?? "an unknown address";

const redirectOf = z.object({
  url: z.string().min(1).optional(),
  redirect: z.boolean().optional(),
});

const nextLocation = async (response: Response): Promise<string | undefined> => {
  const location = response.headers.get("location");
  if (location !== null) return location;
  const parsed = redirectOf.safeParse(
    await response
      .clone()
      .json()
      .catch(() => undefined),
  );
  return parsed.success ? parsed.data.url : undefined;
};

const navigationOnly: MiddlewareHandler = async (context, next) => {
  if (context.req.method === "POST" && context.req.header("sec-fetch-dest") !== "document") {
    return context.html(refusedPage(REFUSAL_PAGES.notNavigated), 403);
  }
  await next();
};

const emailKey = (email: string): string => hashOf(email.trim().toLowerCase());

const codeRequest = z.object({ email: z.string().trim().min(1) });

const limitCodesByEmail = (door: PostgresDoor, clock: Clock): MiddlewareHandler => {
  return async (context, next) => {
    const read = await attempt(() => context.req.raw.clone().json());
    const asked = read.ok ? codeRequest.safeParse(read.value) : undefined;

    if (asked === undefined || !asked.success) {
      await next();
      return;
    }
    const throttle = await consumeIngress(
      door,
      "email",
      emailKey(asked.data.email),
      EMAIL_CODE_EMAIL_RULE,
      clock.now(),
    );
    if (!throttle.allowed) {
      return tooManyRequests(
        throttle.retryAfterSeconds,
        "Too many codes requested for this address; try again later.",
      );
    }
    await next();
  };
};

const LIBRARY_CONSENT_PATH = "/oauth2/consent";

const clientShape = z.object({ client_name: z.string().nullish(), name: z.string().nullish() });

const UNNAMED_WORKSPACE = "your workspace";

const consentQueryOf = (url: string) => {
  const query = new URL(url).searchParams;
  return {
    clientId: query.get("client_id") ?? "",
    scopes: (query.get("scope") ?? "").split(" ").filter((scope) => scope !== ""),
    redirectUri: query.get("redirect_uri") ?? "",
  };
};

const clientNameOf = async (auth: Auth, clientId: string, headers: Headers): Promise<string> => {
  const assistant = await attempt(() =>
    auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers }),
  );
  const named = assistant.ok ? clientShape.safeParse(assistant.value) : undefined;
  return (named?.success ? (named.data.client_name ?? named.data.name) : undefined) ?? "This app";
};

const workspaceNameOf = async (door: PostgresDoor, claims: Claims): Promise<string> => {
  const named = await withPrincipalRead(door, claims, async (_principal, tx) => {
    const row = await tx.query<{ name: string }>("SELECT name FROM workspace WHERE id = $1", [
      claims.workspaceId,
    ]);
    return row.rows[0]?.name ?? UNNAMED_WORKSPACE;
  });
  return named.ok ? named.value : UNNAMED_WORKSPACE;
};

const failureOf = async (decided: Result<Response>) =>
  decided.ok
    ? { status: decided.value.status, detail: await decided.value.clone().text() }
    : { status: null, detail: decided.error.message };

const takesOrSendsACode = (path: string): boolean =>
  path === SIGN_IN_BY_EMAIL_CODE_PATH ||
  path.startsWith("/email-otp/") ||
  path.startsWith("/forget-password/");

const countedByItsOwnGroup = (path: string): boolean =>
  !path.startsWith("/oauth2/") && path !== "/jwks" && !path.startsWith("/.well-known/");

export const createAuthRoutes = (deps: AuthRoutesDependencies): Hono => {
  const routes = new Hono();
  const { auth, door, publicUrl, clock } = deps;

  const claimsFrom = async (headers: Headers): Promise<Claims | Pending | undefined> => {
    const read = await auth.api.getSession({ headers });
    const sessionId = sessionNamed.safeParse(read).data?.session.id;
    if (sessionId === undefined) return undefined;
    const standing = await judged({ door, clock }, { id: sessionId });
    if (!standing.ok && standing.error === "session-gone") return undefined;
    if (pendingOr(standing)) return PENDING;
    return sessionClaims(async () => read, headers);
  };

  const holds = async (claims: Claims | undefined): Promise<boolean> =>
    claims !== undefined && (await withPrincipalRead(door, claims, async () => true)).ok;

  const grantRefused = async (
    context: Context,
    form: FormData,
    claims: Claims | undefined,
  ): Promise<Response | undefined> => {
    if (!(await holds(claims))) {
      return context.html(signInPage(REFUSAL_PAGES.sessionEnded, carry(context.req.url)), 401);
    }
    if (form.get(CONSENT_WORKSPACE_FIELD) !== claims?.workspaceId) {
      return context.html(refusedPage(REFUSAL_PAGES.workspaceMoved), 409);
    }
    return undefined;
  };

  const grantInTheLibrary = (context: Context, accept: boolean, claims: Claims | undefined) => {
    const headers = flowHeaders(context.req.raw, publicUrl);
    return grantingFor(claims?.workspaceId ?? "", () =>
      attempt(() =>
        auth.api.oauth2Consent({
          headers,
          // The provider's authorize step reads the request itself, so a server call names one.
          request: new Request(`${publicUrl}${LIBRARY_CONSENT_PATH}`, { method: "POST", headers }),
          body: { accept, oauth_query: oauthQuery(context.req.url) },
          asResponse: true,
        }),
      ),
    );
  };

  const confirmFirst = (context: Context): Response =>
    context.redirect(`/confirm${carry(context.req.url)}`, 302);

  const prm = {
    resource: deps.mcpUrl,
    authorization_servers: [publicUrl],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${publicUrl}/`,
  };
  for (const path of DISCOVERY_PATHS) {
    routes.use(path, async (context, next) => {
      await next();
      if (context.res.status === 200) {
        context.res.headers.set("cache-control", DISCOVERY_CACHE_CONTROL);
      }
    });
  }
  routes.use("/oauth2/*", limitByIp(deps, OAUTH_IP_RULE, "oauth"));
  routes.use("/jwks", limitByIp(deps, OAUTH_IP_RULE, "oauth"));
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    routes.get(path, (context) => context.json(prm));
  }

  const mounted = mountedPaths(auth);
  for (const path of mounted.filter(takesOrSendsACode)) {
    routes.use(path, sameOriginOnly(publicUrl));
  }
  routes.use(SEND_EMAIL_CODE_PATH, limitCodesByEmail(door, clock));
  const limitSignIns = countingPostsAlone(
    limitByIp(deps, EMAIL_CODE_SIGN_IN_IP_RULE, "email-code-sign-in"),
  );
  const limitSends = countingPostsAlone(
    limitByIp(deps, EMAIL_CODE_SEND_IP_RULE, "email-code-send"),
  );
  const limitIdentity = limitByIp(deps, IDENTITY_IP_RULE, "identity");
  const limitOf = (path: string): MiddlewareHandler => {
    if (path === SIGN_IN_BY_EMAIL_CODE_PATH) return limitSignIns;
    return takesOrSendsACode(path) ? limitSends : limitIdentity;
  };
  for (const path of mounted.filter(countedByItsOwnGroup)) {
    routes.use(path, limitOf(path));
  }
  routes.use(SEND_EMAIL_CODE_PATH, bindTheLink(publicUrl));
  mountTheSignInLink(routes, deps);
  mountTheAuthenticator(routes, deps);
  mountThePasskeys(routes, deps);
  mountTheConfirm(routes, deps);

  routes.use("/consent", limitByIp(deps, PAGE_IP_RULE, "consent"));
  routes.use("/consent", sameOriginOnly(publicUrl));
  routes.use("/consent", navigationOnly);

  routes.use("/consent", async (context, next) => {
    await next();
    context.res.headers.set("content-security-policy", "frame-ancestors 'none'");
    context.res.headers.set("x-frame-options", "DENY");
  });

  routes.get("/consent", async (context) => {
    const asked = consentQueryOf(context.req.url);
    const headers = flowHeaders(context.req.raw, publicUrl);
    const claims = await claimsFrom(headers);
    if (claims === undefined) {
      return context.html(signInPage(REFUSAL_PAGES.signInFirst, carry(context.req.url)), 401);
    }
    if (claims === PENDING) return confirmFirst(context);
    const clientName = await clientNameOf(auth, asked.clientId, headers);
    const workspace = await workspaceNameOf(door, claims);

    return context.html(
      consentPage(carry(context.req.url), {
        clientName,
        hostedAt: hostnameOf(asked.clientId),
        sendsCodeTo: hostnameOf(asked.redirectUri),
        workspace,
        workspaceId: claims.workspaceId,
        scopes: asked.scopes,
      }),
    );
  });

  routes.post("/consent", async (context) => {
    const form = await context.req.formData();

    const accept = form.get("accept") === "true";

    const claims = await claimsFrom(flowHeaders(context.req.raw, publicUrl));
    if (claims === PENDING) return confirmFirst(context);
    const refusal = accept ? await grantRefused(context, form, claims) : undefined;
    if (refusal !== undefined) return refusal;
    const grant = await grantInTheLibrary(context, accept, claims);
    if (grant.moved) return context.html(refusedPage(REFUSAL_PAGES.workspaceMoved), 409);
    const decided = grant.answered;
    if (decided.ok) {
      forwardCookies(decided.value, context.res.headers);
      const next = await nextLocation(decided.value);
      if (next !== undefined) return context.redirect(next, 302);
    }
    deps.logger.warn(
      { event: "auth.consent_failed", ...(await failureOf(decided)) },
      "consent could not be completed",
    );
    return context.html(refusedPage(REFUSAL_PAGES.notCompleted), 400);
  });

  routes.get("/me", async (context) => {
    const claims = await claimsFrom(flowHeaders(context.req.raw, publicUrl));
    if (claims === undefined) return context.json({ error: "not_signed_in" }, 401);
    if (claims === PENDING) return context.json({ error: SECOND_FACTOR_PENDING }, 403);
    const resolved = await withPrincipalRead(door, claims, async (principal) => ({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      role: principal.role,
    }));
    if (!resolved.ok) return context.json({ error: resolved.error }, 401);
    return context.json(resolved.value);
  });

  return routes;
};
