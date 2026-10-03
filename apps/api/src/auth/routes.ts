import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Logger } from "pino";
import { z } from "zod";

import { attempt, type Claims, type Clock, type Result } from "@better-answers/core/kernel";
import {
  consumeIngress,
  withPrincipal,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";
import { hasNoDisplayName } from "@better-answers/core/workspaces";

import type { EmailSender } from "../email.ts";
import { limitByIp, tooManyRequests } from "../ingress/limits.ts";
import { judged, pendingOr, SECOND_FACTOR_PENDING } from "../second-factor-gate.ts";
import type { Auth } from "./auth.ts";
import { mountTheAuthenticator } from "./authenticator.ts";
import { mountTheConfirm } from "./confirm.ts";
import {
  BETTER_AUTH_RATE_LIMIT,
  EMAIL_CODE_EMAIL_RULE,
  EMAIL_CODE_LIFETIME_SECONDS,
  MCP_SCOPES,
  OAUTH_IP_RULE,
  PAGE_IP_RULE,
  SEND_EMAIL_CODE_PATH,
  SIGN_IN_LINK_COOKIE,
  SIGN_IN_LINK_DESCRIBE_IP_RULE,
  SIGN_IN_LINK_DESCRIBE_PATH,
  SIGN_IN_LINK_PAGE,
  SIGN_IN_LINK_SIGN_IN_IP_RULE,
  SIGN_IN_LINK_SIGN_IN_PATH,
  SIGN_IN_LINK_TOKEN_RULE,
} from "./constants.ts";
import {
  DEAD_LINK,
  hashOf,
  isBound,
  linkSeen,
  type LinkUse,
  type SeenLink,
  mintNonce,
  unseal,
} from "./link-token.ts";
import { consentPage, refusedPage, REFUSAL_PAGES, signInPage } from "./pages.ts";
import { mountThePasskeys } from "./passkeys.ts";
import { sameOriginOnly } from "./same-origin.ts";
import { askingWithALink, dropALink, readALink, signingInByLink } from "./sign-in-link.ts";
import { sessionClaims } from "./verify.ts";

export type AuthRoutesDependencies = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly logger: Logger;

  readonly clock: Clock;

  /** The auth secret, which seals what a sign-in link carries. */
  readonly secret: string;

  readonly sendEmail: EmailSender;
};

const carry = (url: string): string => new URL(url).search;

const PENDING = "pending";

const sessionNamed = z.object({ session: z.object({ id: z.string() }) });

type Pending = typeof PENDING;
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

type FlowBody =
  | { readonly postLogin: true; readonly oauth_query: string }
  | { readonly accept: boolean; readonly oauth_query: string }
  | { readonly email: string; readonly otp: string; readonly oauth_query?: string };

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

/** A path on this origin alone: anything else would be an open redirect once the link signs in. */
const returnPath = z
  .string()
  .max(512)
  .regex(/^\/(?![/\\])[^\\]*$/)
  .optional()
  .catch(undefined);

const codeAsk = z
  .object({ type: z.string().optional(), oauth_query: z.string().optional(), redirect: returnPath })
  .catch({});

const secureOrigin = (publicUrl: string): boolean => publicUrl.startsWith("https:");

/** Better Auth drops its own secure prefix on plain http, as the browser suite's loopback is. */
const bindingCookieName = (publicUrl: string): string =>
  secureOrigin(publicUrl) ? `__Host-${SIGN_IN_LINK_COOKIE}` : SIGN_IN_LINK_COOKIE;

/** The nonce goes to the email's link and, once the request has gone through, to this browser. */
const bindTheLink =
  (publicUrl: string): MiddlewareHandler =>
  async (context, next) => {
    const read = await attempt(() => context.req.raw.clone().json());
    const asked = codeAsk.parse(read.ok ? read.value : {});
    if (asked.type !== "sign-in") {
      await next();
      return;
    }
    const nonce = mintNonce();
    await askingWithALink(
      { nonce, carried: asked.oauth_query ?? "", returnTo: asked.redirect ?? "" },
      next,
    );
    if (!context.res.ok) return;
    setCookie(context, bindingCookieName(publicUrl), nonce, {
      maxAge: EMAIL_CODE_LIFETIME_SECONDS,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: secureOrigin(publicUrl),
    });
  };

const linkToken = z.object({ token: z.string().regex(/^[A-Za-z0-9]{1,128}$/) });

const tokenOf = async (request: Request): Promise<string | undefined> => {
  const read = await attempt(() => request.json());
  return read.ok ? linkToken.safeParse(read.value).data?.token : undefined;
};

/** The sign-in route's refusal bodies; a read answers every dead link with its state alone. */
const LINK_REFUSALS = {
  dead: { error: "link-dead" },
  notThisBrowser: { error: "not-this-browser" },
  unanswered: { error: "unanswered" },
} as const;

const SIGN_IN_WINDOW_SECONDS = BETTER_AUTH_RATE_LIMIT.customRules["/sign-in/email-otp"].window;

/** The library answers its own failure as a 500 response rather than throwing it. */
const SERVER_FAILED = 500;

const linkSignInBody = (use: LinkUse): FlowBody =>
  use.oauthQuery === ""
    ? { email: use.email, otp: use.code }
    : { email: use.email, otp: use.code, oauth_query: use.oauthQuery };

const nameGiven = z.object({ user: z.object({ name: z.string() }) });

/** The library answers a carried flow's next step rather than the person; the next screen reads the name. */
const displayNameGivenIn = async (answered: Response): Promise<boolean> => {
  const named = nameGiven.safeParse(
    await answered
      .clone()
      .json()
      .catch(() => undefined),
  );
  return named.success && !hasNoDisplayName(named.data.user.name);
};

const mountTheSignInLink = (routes: Hono, deps: AuthRoutesDependencies): void => {
  const { auth, door, publicUrl, clock } = deps;

  /** Reads and sign-ins count apart, so re-reading a link never spends the sign-in it offers. */
  const ceilingOf = async (
    route: "describe" | "sign-in",
    token: string,
  ): Promise<Response | undefined> => {
    const counted = await consumeIngress(
      door,
      "link",
      `${route}:${hashOf(token)}`,
      SIGN_IN_LINK_TOKEN_RULE,
      clock.now(),
    );
    if (counted.allowed) return undefined;
    return tooManyRequests(
      counted.retryAfterSeconds,
      "Too many tries of this link; try again later.",
    );
  };

  const seen = async (token: string, cookie: string | undefined): Promise<SeenLink> => {
    const read = await readALink(door, token);
    const contents =
      read === undefined ? undefined : unseal(token, deps.secret, hashOf(token), read.sealed);
    return linkSeen(read, contents, read !== undefined && isBound(cookie, read.nonceHash));
  };

  /** The link may still stand, so the page offers Sign in again rather than the dead page. */
  const unanswered = (context: Context, reason: string): Response => {
    deps.logger.warn(
      { event: "auth.link_sign_in_failed", reason },
      "a sign-in through a link went unanswered",
    );
    return context.json(LINK_REFUSALS.unanswered, 502);
  };

  const answerTheSignIn = async (
    context: Context,
    token: string,
    use: LinkUse,
    answered: Response,
  ): Promise<Response> => {
    if (answered.status === 429) {
      const wait = Number(answered.headers.get("x-retry-after") ?? SIGN_IN_WINDOW_SECONDS);
      return tooManyRequests(wait, "Too many sign-ins from this address; try again later.");
    }
    if (answered.status >= SERVER_FAILED)
      return unanswered(context, `library ${String(answered.status)}`);
    if (!answered.ok) return context.json(LINK_REFUSALS.dead, 410);
    forwardCookies(answered, context.res.headers);
    // The spent code already makes the link dead, so a failed delete must not cost the session.
    const dropped = await attempt(() => dropALink(door, token));
    if (!dropped.ok) {
      deps.logger.warn(
        { event: "auth.link_drop_failed", reason: dropped.error.message },
        "a used sign-in link was not deleted",
      );
    }
    return context.json({
      displayNameGiven: await displayNameGivenIn(answered),
      carried: use.carried,
    });
  };

  const signInBy = async (context: Context, token: string, use: LinkUse): Promise<Response> => {
    const flowed = await attempt(() =>
      signingInByLink(() =>
        callFlow(
          auth,
          publicUrl,
          "/sign-in/email-otp",
          flowHeaders(context.req.raw, publicUrl),
          linkSignInBody(use),
        ),
      ),
    );
    if (!flowed.ok) return unanswered(context, flowed.error.message);
    return answerTheSignIn(context, token, use, flowed.value);
  };

  routes.use(SIGN_IN_LINK_PAGE, async (context, next) => {
    await next();
    context.res.headers.set("referrer-policy", "no-referrer");
    context.res.headers.set("cache-control", "no-store");
  });
  routes.use(SIGN_IN_LINK_DESCRIBE_PATH, limitByIp(door, SIGN_IN_LINK_DESCRIBE_IP_RULE, clock));
  routes.use(SIGN_IN_LINK_SIGN_IN_PATH, limitByIp(door, SIGN_IN_LINK_SIGN_IN_IP_RULE, clock));
  routes.use("/sign-in-link/*", sameOriginOnly(publicUrl));
  routes.use("/sign-in-link/*", async (context, next) => {
    await next();
    context.res.headers.set("cache-control", "no-store");
  });

  routes.post(SIGN_IN_LINK_DESCRIBE_PATH, async (context) => {
    const token = await tokenOf(context.req.raw);
    if (token === undefined) return context.json(DEAD_LINK);
    const limited = await ceilingOf("describe", token);
    if (limited !== undefined) return limited;
    const link = await seen(token, getCookie(context, bindingCookieName(publicUrl)));
    return context.json(link.state);
  });

  routes.post(SIGN_IN_LINK_SIGN_IN_PATH, async (context) => {
    const token = await tokenOf(context.req.raw);
    if (token === undefined) return context.json(LINK_REFUSALS.dead, 410);
    const limited = await ceilingOf("sign-in", token);
    if (limited !== undefined) return limited;
    const link = await seen(token, getCookie(context, bindingCookieName(publicUrl)));
    if (link.state.state === "dead") return context.json(LINK_REFUSALS.dead, 410);
    if (link.use === undefined) return context.json(LINK_REFUSALS.notThisBrowser, 403);
    return signInBy(context, token, link.use);
  });
};

export const createAuthRoutes = (deps: AuthRoutesDependencies): Hono => {
  const routes = new Hono();
  const { auth, door, publicUrl, clock } = deps;

  /** A pending session holds no claims to act on, and a session ended meanwhile none at all. */
  const claimsFrom = async (headers: Headers): Promise<Claims | Pending | undefined> => {
    const read = await auth.api.getSession({ headers });
    const sessionId = sessionNamed.safeParse(read).data?.session.id;
    if (sessionId === undefined) return undefined;
    const standing = await judged({ door, clock }, { id: sessionId });
    if (!standing.ok && standing.error === "session-gone") return undefined;
    if (pendingOr(standing)) return PENDING;
    return sessionClaims(async () => read, headers);
  };

  const sessionHolds = async (headers: Headers): Promise<boolean> => {
    const claims = await claimsFrom(headers);
    if (claims === undefined || claims === PENDING) return false;
    return (await withPrincipal(door, claims, async () => true)).ok;
  };

  /** Confirming first carries the signed query, so the flow resumes once the session is confirmed. */
  const confirmFirst = (context: Context): Response =>
    context.redirect(`/confirm${carry(context.req.url)}`, 302);

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

  routes.use(SEND_EMAIL_CODE_PATH, sameOriginOnly(publicUrl));
  routes.use(SEND_EMAIL_CODE_PATH, limitCodesByEmail(door, clock));
  routes.use(SEND_EMAIL_CODE_PATH, bindTheLink(publicUrl));
  mountTheSignInLink(routes, deps);
  mountTheAuthenticator(routes, deps);
  mountThePasskeys(routes, deps);
  mountTheConfirm(routes, deps);

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
    if (claims === PENDING) return confirmFirst(context);
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

    if ((await claimsFrom(flowHeaders(context.req.raw, publicUrl))) === PENDING) {
      return confirmFirst(context);
    }
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
    if (claims === PENDING) return context.json({ error: SECOND_FACTOR_PENDING }, 403);
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
