import { createHash } from "node:crypto";

import { Hono, type MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { z } from "zod";

import { attempt } from "@better-answers/core/kernel";
import {
  consumeIngress,
  withPrincipal,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";

import { limitByIp, tooManyRequests } from "../ingress/limits.ts";
import type { Auth } from "./auth.ts";
import { EMAIL_CODE_EMAIL_RULE, MCP_SCOPES, OAUTH_IP_RULE, PAGE_IP_RULE } from "./constants.ts";
import { chooseWorkspacePage, codePage, consentPage, refusedPage, signInPage } from "./pages.ts";
import { sessionClaims } from "./verify.ts";

/**
 * The identity routes this tier serves itself: the three pages (grilling Q5), the
 * protected-resource metadata (research 80 F6: hand-written, `resource` exactly the
 * URL a person types), `/me` (the cookie-session path through the one resolver), and
 * the per-IP counter in front of `/oauth2/*` and the discovery documents. Better
 * Auth's own handler is mounted after these by `server.ts`.
 */

export type AuthRoutesDependencies = {
  readonly auth: Auth;
  readonly door: PostgresDoor;
  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly logger: Logger;
};

/**
 * Better Auth carries the authorization state as a signed query (`ba_param` naming
 * the covered parameters, `sig` over them) and resumes from it only when it is posted
 * as `oauth_query` in the body — the same string on the URL answers `missing oauth
 * query` (prototype 61, bug 2).
 */
const carry = (url: string): string => new URL(url).search;
const oauthQuery = (url: string): string => new URL(url).search.replace(/^\?/, "");

const redirectOf = z.object({ url: z.string().url().optional(), redirect: z.boolean().optional() });

/** Where a Better Auth flow endpoint sends the person next: a 3xx's Location, or the JSON's `url`. */
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

/** The headers an in-process Better Auth call needs: the person's cookies, our origin, JSON back. */
const flowHeaders = (request: Request, publicUrl: string): Headers => {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie !== null) headers.set("cookie", cookie);
  for (const name of ["cf-connecting-ip", "user-agent"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Better Auth's CSRF check compares Origin against baseURL: the browser's own Origin is
  // carried through when it sent one; a same-origin navigation (a GET) sends none, and
  // the in-process call then speaks as this origin.
  headers.set("origin", request.headers.get("origin") ?? publicUrl);
  headers.set("accept", "application/json");
  return headers;
};

/**
 * The three pages' forms are same-origin only. A cross-site form post — from a page an
 * attacker controls, carrying the person's cookie — could otherwise accept consent for
 * a client the attacker started the flow for (a signed query is not bound to the person
 * who will answer it), pick a workspace, or sign the person into another account.
 * Browsers send `Origin` on every cross-site POST and `Sec-Fetch-Site` on every fetch
 * they make; a form posted from this origin carries this origin.
 */
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
      return context.html(
        refusedPage("Refused", "This form can only be sent from Better Answers."),
        403,
      );
    }
    await next();
  };
};

const emailKey = (email: string): string =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/**
 * The two flow endpoints — consent and continue — resume the authorization by
 * re-entering `/oauth2/authorize`, which reads `ctx.request` and refuses an `auth.api`
 * call that has none ("request not found"). So they are reached the way a browser
 * reaches them, through Better Auth's own handler with a real Request, in process.
 */
/** What the two flow endpoints take: the signed query, and the step's own answer. */
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

const memberships = z.array(z.object({ id: z.string(), name: z.string() }));
const clientShape = z.object({ client_name: z.string().nullish(), name: z.string().nullish() });

export const createAuthRoutes = (deps: AuthRoutesDependencies): Hono => {
  const routes = new Hono();
  const { auth, door, publicUrl } = deps;

  // ---------------------------------------------------------------- discovery
  // The MCP server is the protected resource; Better Auth is the authorization server.
  // `resource` equals the URL the person typed, exactly, and only
  // `authorization_servers[0]` is ever read (Anthropic's connector docs).
  const prm = {
    resource: deps.mcpUrl,
    authorization_servers: [publicUrl],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${publicUrl}/`,
  };
  routes.use("/.well-known/*", limitByIp(door, OAUTH_IP_RULE));
  routes.use("/oauth2/*", limitByIp(door, OAUTH_IP_RULE));
  routes.use("/jwks", limitByIp(door, OAUTH_IP_RULE));
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    routes.get(path, (context) => context.json(prm));
  }

  // ------------------------------------------------------------------ pages
  for (const page of ["/sign-in", "/choose-workspace", "/consent"]) {
    routes.use(page, limitByIp(door, PAGE_IP_RULE));
    routes.use(page, sameOriginOnly(publicUrl));
  }

  routes.get("/sign-in", (context) => context.html(signInPage(carry(context.req.url))));

  routes.post("/sign-in", async (context) => {
    const query = carry(context.req.url);
    const form = await context.req.formData();
    const step = String(form.get("step") ?? "email");
    const email = String(form.get("email") ?? "").trim();
    if (email === "") return context.html(signInPage(query, "Enter your email address."), 400);

    if (step === "email") {
      // Per-email throttle (grilling round 2–3: Better Auth's limiter is per IP only).
      const throttle = await consumeIngress(door, "email", emailKey(email), EMAIL_CODE_EMAIL_RULE);
      if (!throttle.allowed) {
        return tooManyRequests(
          throttle.retryAfterSeconds,
          "Too many codes requested for this address; try again later.",
        );
      }
      const sent = await attempt(() =>
        auth.api.sendVerificationOTP({
          body: { email, type: "sign-in" },
          headers: flowHeaders(context.req.raw, publicUrl),
        }),
      );
      if (!sent.ok)
        return context.html(signInPage(query, "We could not send a code. Try again."), 502);
      return context.html(codePage(query, email));
    }

    const code = String(form.get("code") ?? "").trim();
    const signedIn = await attempt(() =>
      auth.api.signInEmailOTP({
        body: { email, otp: code },
        headers: flowHeaders(context.req.raw, publicUrl),
        asResponse: true,
      }),
    );
    if (!signedIn.ok || !signedIn.value.ok) {
      return context.html(
        codePage(query, email, "That code did not work. Check it and try again."),
        401,
      );
    }
    forwardCookies(signedIn.value, context.res.headers);
    // A session now exists; the authorization flow resumes at /oauth2/authorize.
    if (query === "") return context.redirect("/me", 302);
    return context.redirect(`/oauth2/authorize${query}`, 302);
  });

  routes.get("/choose-workspace", async (context) => {
    const headers = flowHeaders(context.req.raw, publicUrl);
    const listed = await attempt(() => auth.api.listOrganizations({ headers }));
    const parsed = listed.ok ? memberships.safeParse(listed.value) : undefined;
    if (parsed === undefined || !parsed.success) {
      return context.html(
        refusedPage("Sign in first", "Your session has ended. Sign in again."),
        401,
      );
    }
    if (parsed.data.length === 0) {
      // A person in no workspace has nothing to pick and no token to be minted
      // (workspaces are platform-provisioned, grilling Q11).
      return context.html(
        refusedPage(
          "No workspace",
          "You are not a member of any workspace yet. Ask your Admin to add you.",
        ),
        403,
      );
    }
    return context.html(chooseWorkspacePage(carry(context.req.url), parsed.data));
  });

  routes.post("/choose-workspace", async (context) => {
    const form = await context.req.formData();
    const workspaceId = String(form.get("workspaceId") ?? "");
    const headers = flowHeaders(context.req.raw, publicUrl);
    const chosen = await attempt(() =>
      auth.api.setActiveOrganization({
        body: { organizationId: workspaceId },
        headers,
        asResponse: true,
      }),
    );
    if (!chosen.ok || !chosen.value.ok) {
      return context.html(
        refusedPage("Not your workspace", "You are not a member of that workspace."),
        403,
      );
    }
    forwardCookies(chosen.value, context.res.headers);
    const continued = await attempt(() =>
      callFlow(auth, publicUrl, "/oauth2/continue", withForwardedCookies(headers, chosen.value), {
        postLogin: true,
        oauth_query: oauthQuery(context.req.url),
      }),
    );
    if (continued.ok) forwardCookies(continued.value, context.res.headers);
    const next = continued.ok ? await nextLocation(continued.value) : undefined;
    return context.redirect(next ?? `/oauth2/authorize${carry(context.req.url)}`, 302);
  });

  routes.get("/consent", async (context) => {
    const query = new URL(context.req.url).searchParams;
    const clientId = query.get("client_id") ?? "";
    const scopes = (query.get("scope") ?? "").split(" ").filter((scope) => scope !== "");
    const headers = flowHeaders(context.req.raw, publicUrl);
    const claims = await sessionClaims((h) => auth.api.getSession({ headers: h }), headers);
    if (claims === undefined) {
      return context.html(
        refusedPage("Sign in first", "Choose a workspace before connecting."),
        401,
      );
    }
    const client = await attempt(() =>
      auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers }),
    );
    const clientName = client.ok ? clientShape.safeParse(client.value) : undefined;
    const workspaceName = await withPrincipal(door, claims, async (_principal, tx) => {
      const row = await tx.query<{ name: string }>("SELECT name FROM workspace WHERE id = $1", [
        claims.workspaceId,
      ]);
      return row.rows[0]?.name ?? "your workspace";
    });
    return context.html(
      consentPage(carry(context.req.url), {
        clientName:
          (clientName?.success
            ? (clientName.data.client_name ?? clientName.data.name)
            : undefined) ?? "This app",
        workspace: workspaceName.ok ? workspaceName.value : "your workspace",
        scopes,
      }),
    );
  });

  routes.post("/consent", async (context) => {
    const form = await context.req.formData();
    const accept = String(form.get("accept")) === "true";
    const decided = await attempt(() =>
      callFlow(auth, publicUrl, "/oauth2/consent", flowHeaders(context.req.raw, publicUrl), {
        accept,
        oauth_query: oauthQuery(context.req.url),
      }),
    );
    if (decided.ok) forwardCookies(decided.value, context.res.headers);
    const next = decided.ok ? await nextLocation(decided.value) : undefined;
    if (next !== undefined) return context.redirect(next, 302);
    deps.logger.warn(
      {
        event: "auth.consent_failed",
        status: decided.ok ? decided.value.status : null,
        detail: decided.ok ? await decided.value.clone().text() : decided.error.message,
      },
      "consent could not be completed",
    );
    return context.html(
      refusedPage("Something went wrong", "The connection could not be completed."),
      400,
    );
  });

  // ---------------------------------------------------------------------- /me
  // The cookie-session path through the one resolver: who am I, where, at what role.
  routes.get("/me", async (context) => {
    const claims = await sessionClaims(
      (headers) => auth.api.getSession({ headers }),
      flowHeaders(context.req.raw, publicUrl),
    );
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

/** The cookies a flow step just set, carried into the next in-process call. */
const withForwardedCookies = (headers: Headers, from: Response): Headers => {
  const next = new Headers(headers);
  const fresh = from.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter((pair) => pair !== "");
  if (fresh.length > 0) {
    const existing = headers.get("cookie");
    next.set("cookie", [existing, ...fresh].filter((c) => c !== null && c !== "").join("; "));
  }
  return next;
};
