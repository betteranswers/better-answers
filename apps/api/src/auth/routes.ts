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
import {
  EMAIL_CODE_EMAIL_RULE,
  MCP_SCOPES,
  OAUTH_IP_RULE,
  PAGE_IP_RULE,
  SEND_EMAIL_CODE_PATH,
} from "./constants.ts";
import { consentPage, refusedPage } from "./pages.ts";
import { sessionClaims } from "./verify.ts";

/**
 * The identity routes this tier serves itself: the consent page (grilling Q5; sign-in and
 * the workspace picker are the SPA's screens since T-037), the
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
// Better Auth has already refused a client_id or redirect_uri that is not an https URL by
// the time consent renders; the fallback is the page's honest answer to a malformed carry.
const hostnameOf = (url: string): string => URL.parse(url)?.hostname ?? "an unknown address";

/**
 * Where a flow endpoint says the person goes next. `url` is a string rather than a URL
 * because Better Auth writes whichever it was configured with, verbatim: `consentPage` is
 * absolute since T-037, so today's answer is a URL — but the same endpoint answers a
 * relative path the moment a page of the flow is configured relatively, and this reader
 * would then silently see nothing and fall back. The source is this process's own
 * authorization server, not a caller, so what is wanted here is "whatever it said", and
 * the string is passed to `context.redirect` unexamined either way.
 */
const redirectOf = z.object({
  url: z.string().min(1).optional(),
  redirect: z.boolean().optional(),
});

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
 * The consent form is same-origin only. A cross-site form post — from a page an attacker
 * controls, carrying the person's cookie — could otherwise accept consent for a client
 * the attacker started the flow for; a signed query is not bound to the person who will
 * answer it. Browsers send `Origin` on every cross-site POST and `Sec-Fetch-Site` on
 * every fetch they make; a form posted from this origin carries this origin. The SPA's
 * own screens are fenced the same way one layer down, by Better Auth's origin check
 * against the two trusted origins (`auth.ts`).
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

const codeRequest = z.object({ email: z.string().trim().min(1) });

/**
 * The per-email throttle, in front of Better Auth's own code-sending endpoint (grilling
 * rounds 2–3: Better Auth's limiter is per address per path, so a sender who moves
 * addresses can post codes at one person's inbox all day). It stands here rather than in
 * a page because the page moved to the SPA (T-037) and the endpoint is what the screen
 * posts to.
 *
 * The body is read from a clone, so the request Better Auth's handler receives further
 * down is still unread.
 */
const limitCodesByEmail = (door: PostgresDoor): MiddlewareHandler => {
  return async (context, next) => {
    const read = await attempt(() => context.req.raw.clone().json());
    const asked = read.ok ? codeRequest.safeParse(read.value) : undefined;
    // A request with no address in it asks for no code; what to do with it is Better
    // Auth's to say, and this counter is only about how often one address may be asked for.
    if (asked === undefined || !asked.success) {
      await next();
      return;
    }
    const throttle = await consumeIngress(
      door,
      "email",
      emailKey(asked.data.email),
      EMAIL_CODE_EMAIL_RULE,
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

  // ------------------------------------------------------------- sign-in code
  routes.use(SEND_EMAIL_CODE_PATH, limitCodesByEmail(door));

  // ---------------------------------------------------------------- consent
  routes.use("/consent", limitByIp(door, PAGE_IP_RULE));
  routes.use("/consent", sameOriginOnly(publicUrl));
  // No other site may frame it: a framed consent form still posts with this origin and
  // would pass the same-origin check, so clickjacking is refused at the frame, not the
  // post. `frame-ancestors 'none'` and the legacy header together.
  routes.use("/consent", async (context, next) => {
    await next();
    context.res.headers.set("content-security-policy", "frame-ancestors 'none'");
    context.res.headers.set("x-frame-options", "DENY");
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
    // A CIMD client names itself: `client_name` is whatever its metadata document says,
    // and any public https document can register. The identity a person can verify is
    // the two hostnames the document's author does not choose for them — where the
    // client id lives and where the code will be sent (MCP 2026-07-28 authorization,
    // "MUST clearly display the redirect URI hostname"; CIMD draft §6). Held by
    // oauth-flow.test.ts "shows the client's real address beside its self-declared name".
    return context.html(
      consentPage(carry(context.req.url), {
        clientName:
          (clientName?.success
            ? (clientName.data.client_name ?? clientName.data.name)
            : undefined) ?? "This app",
        hostedAt: hostnameOf(clientId),
        sendsCodeTo: hostnameOf(query.get("redirect_uri") ?? ""),
        workspace: workspaceName.ok ? workspaceName.value : "your workspace",
        scopes,
      }),
    );
  });

  routes.post("/consent", async (context) => {
    const form = await context.req.formData();
    const accept = String(form.get("accept")) === "true";
    // The person's credentials may have been revoked since this session was created;
    // consent mints a token, so the revocation check runs here too (`[SEC2]`, ADR 0018).
    // A refused resolve stops the grant before Better Auth issues a code.
    if (accept) {
      const claims = await sessionClaims(
        (headers) => auth.api.getSession({ headers }),
        flowHeaders(context.req.raw, publicUrl),
      );
      const resolved =
        claims === undefined ? undefined : await withPrincipal(door, claims, async () => true);
      if (claims === undefined || resolved === undefined || !resolved.ok) {
        return context.html(
          refusedPage("Sign in again", "Your session is no longer valid. Sign in again."),
          401,
        );
      }
    }
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
