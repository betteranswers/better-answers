import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { z } from "zod";

export const HOSTNAME_ROLES = ["app", "agent", "apex", "loopback"] as const;
type HostnameRole = (typeof HOSTNAME_ROLES)[number];

export type PublicHostnames = {
  readonly app: string;
  readonly agent: string;
  readonly apex: string;
};

export const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1"] as const;

export type HostnameSurface = {
  readonly paths: readonly string[];
  readonly hosts: readonly HostnameRole[];
  readonly reason: string;
};

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

export const HOSTNAME_REFUSAL = "This address does not serve that path.";

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

const withoutRootDot = (hostname: string): string => hostname.replace(/\.$/, "");

const bareForm = (hostname: string): string => withoutRootDot(hostname.replace(/^\[|\]$/g, ""));

export const hostnameOfUrl = (url: string): string => bareForm(new URL(url).hostname);

export const originOfUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.hostname = withoutRootDot(parsed.hostname);
  return parsed.origin;
};

export const hostIsAsWritten = (url: string): boolean => {
  const authority = url.slice(url.indexOf("://") + 3).split(/[/?#]/)[0] ?? "";

  const written = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : (authority.split(":")[0] ?? "");
  return bareForm(written.toLowerCase()) === hostnameOfUrl(url);
};

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
    (value) => URL.parse(`https://${value}`)?.hostname === value.toLowerCase(),
    "must already be written the way a URL parser reads a Host — an address spelling the parser rewrites (`127.000.000.001`, `0x7f.1`) would name a hostname no request can match",
  )

  .transform((value) => value.toLowerCase());

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

export const routeByHostname = (hostnames: PublicHostnames, logger: Logger): MiddlewareHandler => {
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

    const path = context.req.path;

    if (role !== undefined && carries(role, path)) {
      await next();
      return;
    }

    log.warn(
      { event: "ingress.hostname_refused", role: role ?? "unknown", host, path },
      "this hostname does not carry this path",
    );

    return context.json({ error: "not_found", error_description: HOSTNAME_REFUSAL }, 404);
  };
};
