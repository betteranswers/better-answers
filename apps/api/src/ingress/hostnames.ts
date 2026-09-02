import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { z } from "zod";

/**
 * The in-process hostname fence (T-030; PR #7's deferral D1, Cubic `987e5743`).
 *
 * ADR 0022 gives the estate four hostnames behind one Cloudflare tunnel and says what
 * each carries — `agent.` "open and routed only to `/agent/v1/*`, refused before any
 * body is read", `mcp.` carrying `/mcp`, discovery and `/oauth2/*`, `app.` the product
 * (open at the edge since the 2026-09-02 amendment), the apex answering 404. The
 * tunnel's ingress rules are the first fence and stay so (ADR 0022; recorded in
 * `deploy/coolify.md` § Ingress when T-005 writes that file). This is the second, and
 * it is in the app because Better Auth's handler is mounted at the wildcard: every one
 * of its endpoints answers on every hostname the process is given, so a tunnel rule
 * that is one console edit from being wrong is otherwise the only thing between
 * `agent.` and the authorization server.
 *
 * The whole fence is the one list below — a surface per entry, the hostnames that
 * carry it, and why — in the shape of `IDENTITY_SET` in
 * `packages/schema/src/identity-tables.ts`: one place to read what is true, and a test
 * that checks the pair both ways (`[TEST7]`).
 */

/** The four hostnames the deploy unit names, plus the loopback the container probes itself on. */
export const HOSTNAME_ROLES = ["app", "mcp", "agent", "apex", "loopback"] as const;
export type HostnameRole = (typeof HOSTNAME_ROLES)[number];

/** The four of ADR 0022, as bare hostnames — bootstrap env, read beside `PUBLIC_URL`. */
export type PublicHostnames = {
  readonly app: string;
  readonly mcp: string;
  readonly agent: string;
  readonly apex: string;
};

/**
 * The loopback is fixed rather than configured: it is the same address in every
 * estate, and it is how the container reaches itself — `deploy/platform.compose.yaml`
 * runs `wget http://127.0.0.1:3000/health`, which crosses no tunnel and carries no
 * public hostname. A named hostname that happens to equal one of these wins over it.
 */
export const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1"] as const;

/** One surface: the paths it is, the hostnames that carry it, and why those. */
export type HostnameSurface = {
  /** Exact paths, or a `/prefix/*` that also matches the prefix itself. */
  readonly paths: readonly string[];
  readonly hosts: readonly HostnameRole[];
  readonly reason: string;
};

/**
 * The list. Read in order: the first surface whose paths match decides, and it answers
 * only the hostnames it names. The last entry is the catch-all, so every path is
 * decided by exactly one entry and nothing falls through undecided.
 */
export const HOSTNAME_SURFACES: readonly HostnameSurface[] = [
  {
    paths: ["/agent/v1/*"],
    hosts: ["agent"],
    reason:
      "The share agent's surface and nothing else. ADR 0022 says it exactly — `agent.` is 'open and routed only to /agent/v1/*, refused before any body is read' — and CONTEXT.md's *agent token* puts that check in the app rather than only at the edge. Nothing is mounted under it yet (ADR 0008's share agent is a later task): the fence is written before the mount so it is never a thing to remember to add.",
  },
  {
    paths: ["/mcp"],
    hosts: ["mcp"],
    reason:
      "The MCP endpoint. The protected-resource document's `resource` is `${PUBLIC_URL}/mcp` exactly and every access token's audience equals that string, so the endpoint answers on the origin the authorization server issues from and nowhere else (ADR 0022, ADR 0018, T-004).",
  },
  {
    paths: ["/.well-known/*", "/jwks", "/oauth2/*"],
    hosts: ["mcp"],
    reason:
      "Discovery, the signing keys and the authorization server itself. ADR 0022 gives `mcp.` '/mcp, discovery and /oauth2/*'. PR #7 refused splitting the authorization server onto a hostname of its own (Cubic `a1179be0`, rejected with this ADR as the citation); the separation that matters is from `app.`, and this entry is where it is made.",
  },
  {
    paths: ["/sign-in", "/choose-workspace", "/consent"],
    hosts: ["mcp"],
    reason:
      "The three server-rendered pages of the OAuth flow (T-004 grilling Q5). They sit on the authorization server's own origin because Better Auth's CSRF check compares the browser's `Origin` against its base URL, which is `PUBLIC_URL`. T-022 moves sign-in and the workspace picker into the SPA on `app.` and keeps consent server-rendered here, because consent must never sit behind the product's own shell (ADR 0009, 2026-09-02): that ticket splits this entry, adding `app.` to the first two paths and leaving `/consent` as it is.",
  },
  {
    paths: ["/health"],
    hosts: ["app", "loopback"],
    reason:
      "`app.` because the uptime check T-005 sets up reaches the estate from outside on `app.`'s health and on `mcp.`'s protected-resource document — one check per open hostname, each on a path that hostname owns. The loopback because the container's own healthcheck is `wget http://127.0.0.1:3000/health` from inside the container, and a fence that refused it would hold `worker` back for ever. Not on `mcp.`, which the same check reaches through a document it must serve anyway, and never on `agent.`, whose one line in ADR 0022 admits no second path.",
  },
  {
    paths: [],
    hosts: ["apex"],
    reason:
      "The apex carries nothing. ADR 0022 answers it `http_status:404` at the edge and names only `/c/`; the origin agrees rather than leaving the edge as the only fence. The empty path set is the entry, so the apex is named in this list rather than missing from it.",
  },
  {
    paths: ["/*"],
    hosts: ["app", "mcp"],
    reason:
      "Everything else this process answers is Better Auth's own handler at the wildcard with `basePath: '/'` — the session, sign-out, email-code and organisation endpoints — plus `/me`, the tier's cookie-session probe, and, with T-022, the SPA's static build and the tRPC mount on `app.`. The set cannot be enumerated here: it is the plugin list's, and a Better Auth upgrade adds to it, so an enumerated entry would refuse a path the flow needs the day the library grows one. Both hostnames carry it because there is one session across `app.` and `mcp.` (ADR 0009, 2026-09-02): the SPA signs in on `app.` and the OAuth flow resumes on `mcp.` under the same cookie. That `agent.` and the apex are absent from it is the whole point of the entry.",
  },
];

/** The one sentence a refused caller reads; the reason is the log's (ADR 0018, `[SEC]`). */
export const HOSTNAME_REFUSAL = "This address does not serve that path.";

/**
 * A bare hostname: DNS labels and nothing else. A value with a scheme, a port, a path
 * or credentials is a configuration mistake that would silently match no request and
 * hand that hostname's surface to nobody, so it stops the process instead.
 */
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

export const bareHostname = z
  .string()
  .max(253)
  .refine(
    (value) =>
      value.length > 0 &&
      value.split(".").every((label) => label.length <= 63 && HOSTNAME_LABEL.test(label)),
    "must be a bare hostname — DNS labels only, with no scheme, port, path or credentials",
  )
  // DNS is case-insensitive and a `Host` header may arrive in any case, so the fence
  // compares one form.
  .transform((value) => value.toLowerCase());

/** `/prefix/*` matches the prefix and anything under it; anything else is exact. */
const matchesPath = (pattern: string, path: string): boolean => {
  if (!pattern.endsWith("/*")) return path === pattern;
  const prefix = pattern.slice(0, -2);
  return path === prefix || path.startsWith(`${prefix}/`);
};

const carries = (role: HostnameRole, path: string): boolean => {
  const surface = HOSTNAME_SURFACES.find((candidate) =>
    candidate.paths.some((pattern) => matchesPath(pattern, path)),
  );
  return surface !== undefined && surface.hosts.includes(role);
};

/**
 * The hostname a request arrived on. `@hono/node-server` builds the request URL from
 * the `Host` header, which is what the tunnel forwards, so the URL's hostname *is* the
 * `Host`; `X-Forwarded-Host` is never read, in the shape of the per-IP counter's
 * `CF-Connecting-IP`-only rule (T-004 grilling Q8) — a forwarding header is the
 * caller's to write.
 */
const hostnameOf = (url: string): string => {
  // The URL parser lower-cases the hostname and keeps an IPv6 literal in brackets.
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  // A trailing dot is the DNS root: `mcp.example.test.` names the same host and must
  // not slip past a fence that knows only `mcp.example.test`.
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
};

/**
 * The fence, mounted ahead of every other mount in `server.ts`. It returns before
 * `next()`, so a refused request never reaches a counter, a session read or a body.
 */
export const routeByHostname = (hostnames: PublicHostnames, logger: Logger): MiddlewareHandler => {
  // The loopback first, so an estate that names one of its four `localhost` still gets
  // that hostname's full surface rather than the probe's one path.
  const roles = new Map<string, HostnameRole>([
    ...LOOPBACK_HOSTNAMES.map((hostname): [string, HostnameRole] => [hostname, "loopback"]),
    [hostnames.app, "app"],
    [hostnames.mcp, "mcp"],
    [hostnames.agent, "agent"],
    [hostnames.apex, "apex"],
  ]);
  const log = logger.child({ module: "ingress" });

  return async (context, next) => {
    const host = hostnameOf(context.req.url);
    const role = roles.get(host);
    // The same string the mounts behind this match on: Hono and Better Auth both route
    // on the undecoded path, so a percent-encoded traversal cannot mean one thing here
    // and another there, and the URL parser has already resolved any `..` segment.
    const path = context.req.path;

    if (role !== undefined && carries(role, path)) {
      await next();
      return;
    }

    log.warn(
      { event: "ingress.hostname_refused", role: role ?? "unknown", host, path },
      "this hostname does not carry this path",
    );
    // 404, not 403: the same answer the edge gives the apex, and it tells a caller
    // nothing about which hostname carries the path it asked for.
    return context.json({ error: "not_found", error_description: HOSTNAME_REFUSAL }, 404);
  };
};
