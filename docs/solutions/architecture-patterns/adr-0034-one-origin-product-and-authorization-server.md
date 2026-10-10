---
title: "One origin carries the product, the authorization server and the MCP surface"
date: 2026-09-10
module: apps/api
problem_type: architecture_pattern
component: transports
severity: high
applies_when:
  - "Adding an HTTP route, a path or a hostname to the ingress"
  - "Changing the session cookie, the trusted origins or the consent page"
  - "Adding or changing a sign-in method"
  - "Changing Cloudflare's rate-limit rules or plan"
  - "Adding a route counted by client address, or changing what the api or Better Auth counts"
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
- `apps/api/src/ingress/hostnames.ts` is a path fence on the app hostname. It is one ordered list of paths, hostnames and reason, with a catch-all last, tested both ways. `/consent` keeps an entry of its own, because it carries the navigation-only fence.
- The session cookie is Better Auth's own `__Secure-`-prefixed, host-only cookie, and the trusted origins are one entry. `__Host-` is a written trigger: the cookie moves to it the day any subdomain of the apex is served by anything but this process.
- Consent is server-rendered by the api on that origin, outside the SPA's shell. It is safe there because the assistant list is closed and PKCE binds each code. `CIMD_ALLOWED_CLIENT_HOSTS` in `apps/api/src/auth/constants.ts` admits only `claude.ai`.
- The consent POST is refused unless its `Sec-Fetch-Dest` is `document`, beside the existing same-origin fence.
- A request with `prompt=consent`, which claude.ai always sends, shows consent on every authorization. `apps/web/e2e/consent.spec.ts` holds this.
- Sign-in is an email code or Microsoft, never a password. The email also carries a sign-in link, a second secret that unlocks the same code. It signs in only the browser that asked, through two routes of the api's own that the hostname list names beside consent. No password or sign-up plugin is enabled, and `apps/api/tests/better-auth-endpoints.txt` snapshots the endpoints. Microsoft signs in through Better Auth's `microsoft` provider on one multi-tenant Entra registration the platform owns, and links only on an exact verified-email match.
- The per-customer `sso` shape is a written trigger: the day a customer's IT asks to sign in against its own tenant.
- Cloudflare meters rate-limit rules, not paths: Free 1, Pro 2, Business 5. The path groups are combined to fit. The zone moves to Pro before the first assistant credential exists. Until then the Cloudflare stage of `deploy/wizard-41.sh` passes on Free.
- Behind Cloudflare's rules the api keeps its own counts, one per route group and client address: the OAuth paths with `/jwks`, consent, a sign-in link's read, a sign-in by link, tRPC, the MCP surface reached without a usable bearer, the passkey sign-in, a code's send, a sign-in by code, and `identity`, which is Better Auth's other endpoints: the session read, the workspace picker's two, sign-out and the rest, at 120 a minute. A burst on one group spends none of another's count.
- A code's send counts 5 in ten minutes by client address, behind the 5 in ten minutes for each email. A sign-in by code counts 10 in ten minutes, by the form and by the link alike. Each is a fixed window. The email-code endpoints no browser calls spend the send's count.
- Only a post spends either of those two counts, and a post from another site is refused before any count, behind the same fence as the sign-in link's routes and consent. A client that is no browser names no origin and is counted.
- The discovery documents under `/.well-known/` are counted by no limiter in the api, and each is served `Cache-Control: public, max-age=300`. A page of the application is counted by no limiter either.
- Better Auth's limiter is off. On every path a client meets one refusal, the api's: `too_many_requests` with `Retry-After`, at 60 a minute on `/oauth2/*` and `/jwks`.
- A count by client address logs its first refusal in a window, and no later one: `ingress.address_ceiling_met`, with the route group and whether the address is in Anthropic's published range, `160.79.104.0/21`. The line never holds the address. The token endpoint's ceiling has a written trigger: the first such line for the `oauth` group from that range.
- There is no public documentation site. The ops documents live in `docs/operations/`, unrendered.

## Why

- Two hosts sharing one session needed a cookie scoped to the apex. That sent the product's own bearer to every subdomain, including any a third party might one day serve.
- The reason for the split, Cloudflare Access in front of the product, was removed on 2 September 2026. Without it the split was pure cost, and consent could not be proved in the browser suite.
- The issuer an assistant such as Claude registers against is the authorization server's origin. With no assistant credential yet, moving it cost nothing; later it would cost an assistant's connection.
- A script running in the product's shell gains nothing by reading the consent page. A code lands only at Claude's redirect URI, and PKCE binds it to a verifier no script holds.
- `__Host-` is undocumented in Better Auth and defends against cookie-tossing, which needs a subdomain that does not exist.
- One count shared by every route made the smallest ceiling govern them all: ten requests of any kind from an address refused its sign-in by link, and sixty refused discovery and every OAuth path.
- A count on a discovery read costs a Postgres write to protect a constant, and bounds the party that reads it most: Claude's servers, from Anthropic's shared range. RFC 9728 expects the document to be kept, and Cloudflare still counts the path.
- Better Auth's count is no fixed window. It grows until a whole window passes with no request, so a steady caller under the api's ceiling met it first, in words no OAuth client reads and without `Retry-After`. On the email-code paths, five sends from one office with no ten-minute pause between any two refused the sixth, however long that took.
- Better Auth also counts every request its handler is given, whether an endpoint answers it or not. The application's sign-in page was refused on its fourth load in ten seconds from one address, and an office's session read after a hundred in a run.
- A count that any request spends can be spent for someone else. A page on another site can make a person's browser ask an endpoint with an image, a link or a form, and five such asks would have cost their whole office its codes for ten minutes. An email-code endpoint answers a post alone, so nothing else needs counting.
- So the api counts every endpoint itself, in a fixed window, and the limiter is off. The owner first left the email-code paths to it and reversed that on 10/10/2026, once the office case was plain.
- A line for every refused request would turn a flood into log volume, and a client address in a log is a person's. One line a window, with the range and no address, is enough for the trigger to fire.
- Claude and Notion were refused as sign-in methods, because neither is where a company's IT creates and removes people.

## Rejected

- `mcp.` kept as a bearer-only resource host: a second document-serving host and a four-hostname fence for one path.
- Two hosts, with `docs.` moved off the apex: the subdomain exposure stays a promise rather than a mechanism, and consent stays unprovable in the browser suite.

## History

The full record, with its two amendments (T-005, T-119): `docs/archive/adr/0034-one-origin-product-and-authorization-server.md`.
