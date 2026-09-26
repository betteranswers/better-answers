import { createHash } from "node:crypto";

import { Hono, type MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { z } from "zod";

import { attempt, type Claims, type Clock, type Result } from "@better-answers/core/kernel";
import {
  consumeIngress,
  withPrincipal,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";

import { limitByIp, tooManyRequests } from "../ingress/limits.ts";
import type { Auth } from "./auth.ts";
import {
  EMAIL_CODE_EMAIL_RULE,
  MCP_SCOPES,
  OAUTH_IP_RULE,
  PAGE_IP_RULE,
  SEND_EMAIL_CODE_PATH,
} from "./constants.ts";
import { consentPage, refusedPage, REFUSAL_PAGES, signInPage } from "./pages.ts";
import { sessionClaims } from "./verify.ts";

export type AuthRoutesDependencies = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly logger: Logger;

  readonly clock: Clock;
};

const carry = (url: string): string => new URL(url).search;
const oauthQuery = (url: string): string => new URL(url).search.replace(/^\?/, "");

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

const forwardCookies = (from: Response, to: Headers): void => {
  for (const cookie of from.headers.getSetCookie()) to.append("set-cookie", cookie);
};

const flowHeaders = (request: Request, publicUrl: string): Headers => {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie !== null) headers.set("cookie", cookie);
  for (const name of ["cf-connecting-ip", "user-agent"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  headers.set("origin", request.headers.get("origin") ?? publicUrl);
  headers.set("accept", "application/json");
  return headers;
};

const sameOriginOnly = (publicUrl: string): MiddlewareHandler => {
  return async (context, next) => {
    if (context.req.method !== "POST") {
      await next();
      return;
    }
    const origin = context.req.header("origin");
    const site = context.req.header("sec-fetch-site");
    const sameOrigin =
      origin === publicUrl ||
      (origin === undefined && (site === undefined || site === "same-origin" || site === "none"));
    if (!sameOrigin) {
      return context.html(refusedPage(REFUSAL_PAGES.crossSite), 403);
    }
    await next();
  };
};

/**
 * Consent shares the product's origin, so a script's fetch passes the same-origin check; only a
 * document navigation follows the redirect.
 */
const navigationOnly: MiddlewareHandler = async (context, next) => {
  if (context.req.method === "POST" && context.req.header("sec-fetch-dest") !== "document") {
    return context.html(refusedPage(REFUSAL_PAGES.notNavigated), 403);
  }
  await next();
};

const emailKey = (email: string): string =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

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

type FlowBody =
  | { readonly postLogin: true; readonly oauth_query: string }
  | { readonly accept: boolean; readonly oauth_query: string };

const callFlow = (
  auth: Auth,
  publicUrl: string,
  path: string,
  headers: Headers,
  body: FlowBody,
): Promise<Response> => {
  const withJson = new Headers(headers);
  withJson.set("content-type", "application/json");
  return auth.handler(
    new Request(`${publicUrl}${path}`, {
      method: "POST",
      headers: withJson,
      body: JSON.stringify(body),
    }),
  );
};

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
  const client = await attempt(() =>
    auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers }),
  );
  const named = client.ok ? clientShape.safeParse(client.value) : undefined;
  return (named?.success ? (named.data.client_name ?? named.data.name) : undefined) ?? "This app";
};

const workspaceNameOf = async (door: PostgresDoor, claims: Claims): Promise<string> => {
  const named = await withPrincipal(door, claims, async (_principal, tx) => {
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

export const createAuthRoutes = (deps: AuthRoutesDependencies): Hono => {
  const routes = new Hono();
  const { auth, door, publicUrl, clock } = deps;

  const claimsFrom = (headers: Headers): Promise<Claims | undefined> =>
    sessionClaims((sent) => auth.api.getSession({ headers: sent }), headers);

  const sessionHolds = async (headers: Headers): Promise<boolean> => {
    const claims = await claimsFrom(headers);
    if (claims === undefined) return false;
    return (await withPrincipal(door, claims, async () => true)).ok;
  };

  const prm = {
    resource: deps.mcpUrl,
    authorization_servers: [publicUrl],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${publicUrl}/`,
  };
  routes.use("/.well-known/*", limitByIp(door, OAUTH_IP_RULE, clock));
  routes.use("/oauth2/*", limitByIp(door, OAUTH_IP_RULE, clock));
  routes.use("/jwks", limitByIp(door, OAUTH_IP_RULE, clock));
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    routes.get(path, (context) => context.json(prm));
  }

  routes.use(SEND_EMAIL_CODE_PATH, limitCodesByEmail(door, clock));

  routes.use("/consent", limitByIp(door, PAGE_IP_RULE, clock));
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
    const clientName = await clientNameOf(auth, asked.clientId, headers);
    const workspace = await workspaceNameOf(door, claims);

    return context.html(
      consentPage(carry(context.req.url), {
        clientName,
        hostedAt: hostnameOf(asked.clientId),
        sendsCodeTo: hostnameOf(asked.redirectUri),
        workspace,
        scopes: asked.scopes,
      }),
    );
  });

  routes.post("/consent", async (context) => {
    const form = await context.req.formData();

    const accept = form.get("accept") === "true";

    if (accept && !(await sessionHolds(flowHeaders(context.req.raw, publicUrl)))) {
      return context.html(signInPage(REFUSAL_PAGES.sessionEnded, carry(context.req.url)), 401);
    }
    const decided = await attempt(() =>
      callFlow(auth, publicUrl, "/oauth2/consent", flowHeaders(context.req.raw, publicUrl), {
        accept,
        oauth_query: oauthQuery(context.req.url),
      }),
    );
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
    const resolved = await withPrincipal(door, claims, async (principal) => ({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      role: principal.role,
    }));
    if (!resolved.ok) return context.json({ error: resolved.error }, 401);
    return context.json(resolved.value);
  });

  return routes;
};
