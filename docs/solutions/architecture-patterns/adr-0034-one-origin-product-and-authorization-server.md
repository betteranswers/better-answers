---
title: "One origin carries the product, the authorization server and the MCP surface"
date: 2026-09-10
module: apps/api
problem_type: architecture_pattern
component: transports
severity: high
applies_when:
  - "Adding a route, a path or a hostname to the ingress"
  - "Changing the session cookie, the trusted origins or the consent page"
  - "Adding or changing a sign-in method"
  - "Changing Cloudflare's rate-limit rules or plan"
tags:
  - adr-0034
  - origin
  - hostnames
  - session-cookie
  - consent
  - sign-in
  - oauth2
---

# One origin carries the product, the authorization server and the MCP surface

## The decision

One origin, `app.<apex>`, carries the SPA, sign-in, the workspace picker, consent, `/oauth2/*`, `/.well-known/*`, `/jwks` and `/mcp`. The MCP surface's address is `app.<domain>/mcp`, which is also the protected-resource document's `resource` and every access token's audience.

- There are three hostnames, and all of them must differ: the app hostname, `agent` for the share agent's machine route, and the apex, which answers nothing. `PUBLIC_URL` is the product's origin, and `APP_HOSTNAME` is derived from its host. `AGENT_HOSTNAME` and `APEX_HOSTNAME` are bootstrap settings. The api refuses to start unless all three differ.
- `apps/api/src/ingress/hostnames.ts` is a path fence on the app hostname. It is one ordered list of surface, hostnames and reason, with a catch-all last, tested both ways. `/consent` keeps an entry of its own, because it carries the navigation-only fence.
- The session cookie is Better Auth's own `__Secure-`-prefixed, host-only cookie, and the trusted origins are one entry. `__Host-` is a written trigger: the cookie moves to it the day any subdomain of the apex is served by anything but this process.
- Consent is server-rendered by the api on that origin, outside the SPA's shell. It is safe there because the client list is closed and PKCE binds each code. `CIMD_ALLOWED_CLIENT_HOSTS` in `apps/api/src/auth/constants.ts` admits only `claude.ai`.
- The consent POST is refused unless its `Sec-Fetch-Dest` is `document`, beside the existing same-origin fence.
- A request with `prompt=consent`, which claude.ai always sends, shows consent on every authorization. `apps/web/e2e/consent.spec.ts` holds this.
- Sign-in is an email code or Microsoft, never a password. No password or sign-up plugin is enabled, and `apps/api/tests/better-auth-endpoints.txt` snapshots the endpoints. Microsoft signs in through Better Auth's `microsoft` provider on one multi-tenant Entra registration the platform owns, and links only on an exact verified-email match.
- The per-client `sso` shape is a written trigger: the day a client's IT asks to sign in against its own tenant.
- Cloudflare meters rate-limit rules, not paths: Free 1, Pro 2, Business 5. The path groups are combined to fit. The zone moves to Pro before the first client credential exists. Until then the Cloudflare stage of `deploy/wizard-41.sh` passes on Free.
- There is no public documentation site. The ops documents live in `docs/operations/`, unrendered.

## Why

- Two hosts sharing one session needed a cookie scoped to the apex. That sent the product's own bearer to every subdomain, including any a third party might one day serve.
- The reason for the split, Cloudflare Access in front of the product, was removed on 2 September 2026. Without it the split was pure cost, and consent could not be proved in the browser suite.
- The issuer a Claude client registers against is the authorization server's origin. With no client credential yet, moving it cost nothing; later it would cost a client's connection.
- A script running in the product's shell gains nothing by reading the consent page. A code lands only at Claude's redirect URI, and PKCE binds it to a verifier no script holds.
- `__Host-` is undocumented in Better Auth and defends against cookie-tossing, which needs a subdomain that does not exist.
- Claude and Notion were refused as sign-in methods, because neither is where a company's IT creates and removes people.

## Rejected

- `mcp.` kept as a bearer-only resource host: a second document-serving host and a four-hostname fence for one path.
- Two hosts, with `docs.` moved off the apex: the subdomain exposure stays a promise rather than a mechanism, and consent stays unprovable in the browser suite.

## History

The full record, with its two amendments (T-005, T-119): `docs/archive/adr/0034-one-origin-product-and-authorization-server.md`.
