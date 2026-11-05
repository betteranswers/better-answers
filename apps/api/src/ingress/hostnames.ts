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
      "Only the share agent's paths. The edge routes `agent.` only to /agent/v1/* and refuses anything else before reading a body, and CONCEPTS.md's *share agent token* requires the api to check this as well. Nothing is mounted here yet. The fence is written before the mount so that no one has to remember to add it later.",
  },
  {
    paths: ["/mcp", "/.well-known/*", "/jwks", "/oauth2/*"],
    hosts: ["app"],
    reason:
      "The MCP endpoint, OAuth discovery, the signing keys and the authorization server, on the product's own origin. The protected-resource document's `resource` is exactly `${PUBLIC_URL}/mcp`, and every access token's audience equals that string, so the endpoint answers only on the origin the authorization server issues from. That origin is `app.`: a separate `mcp.` hostname needed a session cookie scoped to the apex and sent to every subdomain, for a separation Cloudflare Access no longer needs. The catch-all already admits these paths. They are listed so that a reader can see where the issuer is served, and so that serving any of them on a second hostname is a visible change to this entry.",
  },
  {
    paths: ["/consent"],
    hosts: ["app"],
    reason:
      "Consent, the one OAuth page this tier still renders itself, on the product's origin but outside the SPA shell. It is listed, rather than left to the catch-all, because it has a fence of its own besides the hostname fence. Its POST answers with a redirect, so only a document navigation can reach it, and `auth/routes.ts` refuses a POST whose `Sec-Fetch-Dest` is not `document`, on top of the same-origin check. Consent is safe on the product's origin because of the closed assistant list and PKCE. The CIMD allow-list admits only `claude.ai`, so a code that any script in the shell obtains can go only to Claude's own redirect, bound to a verifier that only the host holds.",
  },
  {
    paths: ["/sign-in-link/*"],
    hosts: ["app"],
    reason:
      "The sign-in link's two reads: what the link is, and the sign-in that uses it up. They are on the product's origin because the binding cookie that the code request set is host-only there. They are listed for the same reason as consent: each has a fence of its own besides the hostname fence. Both are POSTs behind the same-origin check, each limited per client address and per link, and the sign-in uses a link only for the browser that holds the cookie from its code request. The page the link opens belongs to the SPA, under the catch-all, with no referrer and no caching. Its token is in the URL fragment, which never reaches a server.",
  },
  {
    paths: ["/health"],
    hosts: ["app", "loopback"],
    reason:
      "On `app.` because the external uptime check reads `app.`'s health and its protected-resource document, two paths on the one public hostname that serves people and hosts. On the loopback because the container's own healthcheck runs `wget http://127.0.0.1:3000/health` inside the container, and refusing it would keep `worker` waiting for ever. Never on `agent.`, which is open only for the share agent's one path.",
  },
  {
    paths: [],
    hosts: ["apex"],
    reason:
      "The apex serves nothing. The edge answers it with `http_status:404` and names only `/c/`, and the origin refuses it as well, so the edge is not the only fence. The empty path list is the entry: it names the apex here instead of leaving it out.",
  },
  {
    paths: ["/*"],
    hosts: ["app"],
    reason:
      "Everything else this process serves: Better Auth's handler at the wildcard with `basePath: '/'` (the session, sign-out, email-code and workspace `/organization/*` endpoints), `/me` (the tier's cookie-session probe), the SPA's static build and its page addresses (`/sign-in`, `/choose-workspace`, and every page the shell serves after the authorization server declines), and the tRPC mount. The set cannot be listed here, because it comes from the plugin list and a Better Auth upgrade adds to it. A listed set would refuse a path the flow needs as soon as the library adds one. A review replaces the list: `apps/api/tests/auth/better-auth-endpoints.txt` records what this entry admitted at the last human review, read from the instance's own endpoint table, and `better-auth-endpoints.test.ts` fails and names the added and removed paths when an upgrade changes it. One hostname serves all of it because there is one origin and one session: the SPA signs in, picks a workspace and resumes the OAuth flow on the origin that served it. The entry exists to keep `agent.` and the apex out.",
  },
];

export const HOSTNAME_REFUSAL = "This address does not serve that path.";

const HOSTNAME_LABEL = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/u;

const withoutRootDot = (hostname: string): string => hostname.replace(/\.$/u, "");

const bareForm = (hostname: string): string => withoutRootDot(hostname.replace(/^\[|\]$/gu, ""));

export const hostnameOfUrl = (url: string): string => bareForm(new URL(url).hostname);

export const originOfUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.hostname = withoutRootDot(parsed.hostname);
  return parsed.origin;
};

export const hostIsAsWritten = (url: string): boolean => {
  const authority = url.slice(url.indexOf("://") + 3).split(/[/?#]/u)[0] ?? "";

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
      "this hostname does not serve this path",
    );

    return context.json({ error: "not_found", error_description: HOSTNAME_REFUSAL }, 404);
  };
};
