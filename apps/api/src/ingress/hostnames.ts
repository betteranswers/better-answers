import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { z } from "zod";

/**
 * The in-process hostname fence (T-030; PR #7's deferral D1, Cubic `987e5743`).
 *
 * ADR 0022 as amended by ADR 0034 gives the estate three hostnames behind one Cloudflare
 * tunnel and says what each carries — `agent.` "open and routed only to `/agent/v1/*`,
 * refused before any body is read", `app.` the product *and* the authorization server
 * (`/mcp`, discovery, `/jwks`, `/oauth2/*`, consent; open at the edge since the
 * 2026-09-02 amendment), the apex answering 404. The tunnel's ingress rules are the
 * first fence and stay so (ADR 0022; recorded in `deploy/coolify.md` § Ingress when
 * T-005 writes that file). This is the second, and it is in the app because Better
 * Auth's handler is mounted at the wildcard: every one of its endpoints answers on every
 * hostname the process is given, so a tunnel rule that is one console edit from being
 * wrong is otherwise the only thing between `agent.` and the authorization server.
 *
 * Since T-045 the fence is mostly a fence *between* hostnames rather than one that
 * splits the product's paths across them: everything a browser or a host reaches is on
 * `app.`, and the list below says which paths are `app.`'s by name so that a builder
 * reads where the issuer's surface is rather than inferring it from the catch-all.
 *
 * The whole fence is the one list below — a surface per entry, the hostnames that
 * carry it, and why — in the shape of `IDENTITY_SET` in
 * `packages/schema/src/identity-tables.ts`: one place to read what is true, and a test
 * that checks the pair both ways (`[TEST7]`).
 */

/** The three hostnames the deploy unit names, plus the loopback the container probes itself on. */
export const HOSTNAME_ROLES = ["app", "agent", "apex", "loopback"] as const;
export type HostnameRole = (typeof HOSTNAME_ROLES)[number];

/**
 * The three of ADR 0022 (ADR 0034), as bare hostnames. `agent` and `apex` are bootstrap
 * env; `app` is `PUBLIC_URL`'s host, derived (T-039, T-045).
 */
export type PublicHostnames = {
  readonly app: string;
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
    paths: ["/mcp", "/.well-known/*", "/jwks", "/oauth2/*"],
    hosts: ["app"],
    reason:
      "The MCP endpoint, discovery, the signing keys and the authorization server itself, on the product's own origin (ADR 0034). The protected-resource document's `resource` is `${PUBLIC_URL}/mcp` exactly and every access token's audience equals that string, so the endpoint answers on the origin the authorization server issues from and nowhere else (ADR 0018, T-004) — and since T-045 that origin is `app.`, because the split onto `mcp.` cost an apex-scoped session cookie sent to every subdomain of the estate for the sake of a separation Cloudflare Access no longer needed. These paths are the catch-all's already; they are named here so a builder reads where the issuer's surface is, and so the day a second hostname carries any of them the change is a diff on this line rather than a silence.",
  },
  {
    paths: ["/consent"],
    hosts: ["app"],
    reason:
      "Consent, the one page of the OAuth flow this tier still renders itself (T-004 grilling Q5), on the product's origin but outside its shell. It keeps a name in this list rather than falling to the catch-all because it is the one path here with a fence of its own beside the hostname fence: its POST answers a redirect, so it can be reached only by a document navigation, and `auth/routes.ts` refuses a POST whose `Sec-Fetch-Dest` is not `document` on top of the same-origin check. What makes consent acceptable on the same origin as the product is the closed client list plus PKCE (ADR 0034): the CIMD allow-list admits only `claude.ai`, so a code any script in the shell could obtain lands only at Claude's own redirect, bound to a verifier only the host holds.",
  },
  {
    paths: ["/health"],
    hosts: ["app", "loopback"],
    reason:
      "`app.` because the uptime check T-005 sets up reaches the estate from outside on `app.`'s health and on its protected-resource document — two paths on the one open hostname that serves people and hosts. The loopback because the container's own healthcheck is `wget http://127.0.0.1:3000/health` from inside the container, and a fence that refused it would hold `worker` back for ever. Never on `agent.`, whose one line in ADR 0022 admits no second path.",
  },
  {
    paths: [],
    hosts: ["apex"],
    reason:
      "The apex carries nothing. ADR 0022 answers it `http_status:404` at the edge and names only `/c/`; the origin agrees rather than leaving the edge as the only fence. The empty path set is the entry, so the apex is named in this list rather than missing from it.",
  },
  {
    paths: ["/*"],
    hosts: ["app"],
    reason:
      "Everything else this process answers is Better Auth's own handler at the wildcard with `basePath: '/'` — the session, sign-out, email-code and workspace (`/organization/*`) endpoints — plus `/me`, the tier's cookie-session probe, the SPA's static build and its screens' addresses (`/sign-in`, `/choose-workspace`, everything the shell answers after the authorization server declines; T-037, T-022), and the tRPC mount. The set cannot be enumerated here: it is the plugin list's, and a Better Auth upgrade adds to it, so an enumerated entry would refuse a path the flow needs the day the library grows one. It is reviewed instead of enumerated: `apps/api/tests/better-auth-endpoints.txt` is what this entry admitted when a human last looked, read from the instance's own endpoint table, and `better-auth-endpoints.test.ts` fails with the added and removed paths named when an upgrade moves it (T-039). One hostname carries it because there is one origin and one session (ADR 0034): the SPA signs in, picks and resumes the OAuth flow on the origin it was served from. That `agent.` and the apex are absent from it is the whole point of the entry.",
  },
];

/** The one sentence a refused caller reads; the reason is the log's (ADR 0018, `[SEC]`). */
export const HOSTNAME_REFUSAL = "This address does not serve that path.";

/** One DNS label: letters, digits and inner hyphens. */
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/**
 * DNS's trailing root dot names the same host — and nothing that compares an origin as
 * a string agrees: a browser sends `Origin` without it, and Better Auth's CSRF check,
 * the token audience and the protected-resource document are all exact strings.
 */
const withoutRootDot = (hostname: string): string => hostname.replace(/\.$/, "");

/**
 * One reading of a host string, for the configured value and the arriving request
 * alike: an IPv6 literal without its brackets and without the root dot, so neither
 * slips past a fence that knows only the bare form. The URL parser has already
 * lower-cased what it gives us.
 */
const bareForm = (hostname: string): string => withoutRootDot(hostname.replace(/^\[|\]$/g, ""));

/**
 * The host of a URL as the fence reads it. `@hono/node-server` builds the request URL
 * from the `Host` header, which is what the tunnel forwards, so a URL's host *is* the
 * `Host`; `X-Forwarded-Host` is never read, in the shape of the per-IP counter's
 * `CF-Connecting-IP`-only rule (T-004 grilling Q8) — a forwarding header is the
 * caller's to write. `config.ts` reads `PUBLIC_URL`'s host through this too, so "the
 * same host" means one thing on both sides of the fence.
 */
export const hostnameOfUrl = (url: string): string => bareForm(new URL(url).hostname);

/**
 * A URL's origin on the host the fence reads. `config.ts` normalises `PUBLIC_URL`
 * through this, so every string derived from it — the issuer, the token audience, the
 * protected-resource document, Better Auth's trusted origin and its CSRF comparison —
 * is on the bare host an arriving browser actually sends.
 */
export const originOfUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.hostname = withoutRootDot(parsed.hostname);
  return parsed.origin;
};

/**
 * Whether a URL's host is already written the way a URL parser reads it — the reading
 * `bareHostname` makes of a declared hostname, made of the one that is derived from a
 * URL (`PUBLIC_URL`'s, which is `app.`; T-039, T-045).
 *
 * The parser canonicalises an address spelling — `127.000.000.001` and `0x7f.1` both
 * come back as `127.0.0.1`, `%61pp.example.test` as `app.example.test` — so a value
 * written that way names a host no arriving request can match and no operator can find
 * in their DNS. Case and DNS's trailing root dot are the two rewritings that name the
 * *same* host, so both sides are read through `bareForm` and neither stops a process.
 * A port is not part of a hostname, and the parser drops it when it is the scheme's
 * default, so it is taken off the written side rather than compared.
 */
export const hostIsAsWritten = (url: string): boolean => {
  // The authority exactly as the operator typed it: after the scheme, before the path.
  const authority = url.slice(url.indexOf("://") + 3).split(/[/?#]/)[0] ?? "";
  // An IPv6 literal keeps its brackets and carries its own colons; for a name, the
  // first colon after the host starts the port.
  const written = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : (authority.split(":")[0] ?? "");
  return bareForm(written.toLowerCase()) === hostnameOfUrl(url);
};

/**
 * A bare hostname: DNS labels and nothing else. A value with a scheme, a port, a path
 * or credentials is a configuration mistake that would silently match no request and
 * hand that hostname's surface to nobody, so it stops the process instead.
 */
export const bareHostname = z
  .string()
  .max(253)
  .refine(
    (value) =>
      value.length > 0 &&
      value.split(".").every((label) => label.length <= 63 && HOSTNAME_LABEL.test(label)),
    "must be a bare hostname — DNS labels only, with no scheme, port, path or credentials",
  )
  .refine(
    // The parser rewrites an address spelling — `127.000.000.001` and `0x7f.1` both
    // read as `127.0.0.1` — so a value it does not return unchanged would name a
    // hostname no arriving request can ever match. Refused rather than silently
    // rewritten: a hostname an operator cannot find in their DNS is a mistake to stop for.
    (value) => URL.parse(`https://${value}`)?.hostname === value.toLowerCase(),
    "must already be written the way a URL parser reads a Host — an address spelling the parser rewrites (`127.000.000.001`, `0x7f.1`) would name a hostname no request can match",
  )
  // DNS is case-insensitive and a `Host` may arrive in any case, so the fence compares
  // one form.
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
 * The fence, mounted ahead of every other mount in `server.ts`. It returns before
 * `next()`, so a refused request never reaches a counter, a session read or a body.
 */
export const routeByHostname = (hostnames: PublicHostnames, logger: Logger): MiddlewareHandler => {
  // The loopback first, so an estate that names one of its three `localhost` still gets
  // that hostname's full surface rather than the probe's one path.
  const roles = new Map<string, HostnameRole>([
    ...LOOPBACK_HOSTNAMES.map((hostname): [string, HostnameRole] => [hostname, "loopback"]),
    [hostnames.app, "app"],
    [hostnames.agent, "agent"],
    [hostnames.apex, "apex"],
  ]);
  const log = logger.child({ module: "ingress" });

  return async (context, next) => {
    const host = hostnameOfUrl(context.req.url);
    const role = roles.get(host);
    // The URL parser has already resolved every dot segment, in either spelling — the
    // URL standard reads `%2e` as `.`, so `/agent/v1/%2e%2e/%2e%2e/mcp` arrives as
    // `/mcp` — so this is the same string the mounts behind the fence route on and no
    // spelling can mean one path here and another there.
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
