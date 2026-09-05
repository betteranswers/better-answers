---
status: accepted
date: 2026-08-25
---

# The internal API is tRPC; external callers get generated OpenAPI; agents get MCP — all on one server

The web app talks to the app server over tRPC 11 (`@hono/trpc-server`), so a field changed on the server fails the UI's type-check until fixed. Anything outside our own TypeScript — a customer integration, a script, a partner — gets an OpenAPI surface generated from the same router (`trpc-to-openapi`, moving to `@trpc/openapi` when it leaves alpha). Agents get neither: they use the platform's own tools-only MCP server (MCP SDK v2 on the official Hono adapter, Streamable HTTP; bearer auth in v0.1, OAuth 2.1 through a dedicated identity provider once the identity decision lands). The Python worker uses none of the three — it shares the database and object store (ADR 0005). We chose this split, which none of Onyx (FastAPI), Dust (Hono + zod + Swagger) or the predecessor (Next route handlers) uses, because each caller class has a different contract: our UI wants types, third parties want a document, agents want tools with descriptions and schemas; forcing all three through REST loses the first, and forcing them through tRPC loses the other two. zod v4 is the single validation library at every boundary, which is what lets one router feed all three.

## Considered options

- **REST + OpenAPI for everything** — one surface, but the UI loses end-to-end types and the MCP tools would wrap REST calls twice (Onyx's 891-line MCP shell over its API is that shape).
- **tRPC only** — no external surface, no agent surface.
- **GraphQL** — a second schema language beside zod and the OKF frontmatter; nothing on the roster speaks it.

## Consequences

- Handlers stay thin: business logic lives in `packages/core/*` and is called by the tRPC router, the OpenAPI adapter and the MCP tools alike (Dust BACK16).
- Every MCP tool is a named, described, zod-typed function; nothing in the MCP layer reaches the database directly.
- The OpenAPI document is generated, never hand-edited; breaking an external route is a versioned change (Dust BACK12).

## Amendment — 2026-08-26, alignment (ticket 47)

"Bearer auth in v0.1, OAuth 2.1 through a dedicated identity provider once the identity decision lands" no longer holds. Ticket 38 (D2) found Claude Teams connectors accept OAuth 2.1 only, so OAuth 2.1 with dynamic client registration is a v0.1 requirement; ticket 40 / ADR 0009 chose Better Auth **in-process** — the app is its own authorization server, not a dedicated provider. A bearer token remains a second credential path for scripts and Claude Code only. Everything else in this ADR stands.

## Amendment — 2026-08-27, a machine-client route family for the share agent (ticket 53)

Pass 1 kept the generated OpenAPI surface unmounted in v0.1. The share agent needs a live, credentialled ingress, so the app gains a **dedicated `/agent/v1` route family** — hand-written Hono routes over the same `packages/core/*` logic, not the generated adapter — with its own credential class (an **agent token**, scoped to one binding and a path prefix, revocable in Control Centre), a per-file size cap, a per-agent rate limit, streaming to the object store without buffering, and a version-skew rule (the server supports agent versions N and N-1). A machine client cannot complete an interactive Access login, so its hostname or an Access service token is ticket 41's. The generated OpenAPI document stays unmounted.

## Amendment — 2026-08-28, the machine client's hostname and cap (ticket 41, ADR 0022)

The `/agent/v1` route family is served on its own hostname, **`agent.better-answers.com`**, open on the tunnel with no Access policy — a machine client cannot complete an interactive login — and the app's host router routes that hostname to `/agent/v1/*` only, refusing any other path or host before reading a body. The per-file cap is **100 MB**, Cloudflare's edge body limit on the Free and Pro plans, enforced before the origin regardless of streaming. The OAuth 2.1 pages of the MCP surface (`/oauth/*`) are served on `mcp.`, outside Access, or a connector's redirect would meet the OTP wall.

## Amendment — 2026-09-03, the path is `/oauth2/*` and the host router exists (T-030, PR #10)

"`/oauth/*`" above reads **`/oauth2/*`**, the path `@better-auth/oauth-provider` mounts (T-004). "The app's host router" is now built: `apps/api/src/ingress/hostnames.ts`, one list of surface → hostnames → reason, mounted ahead of every other route, refusing `agent.` anything but `/agent/v1/*` before a body is read (ADR 0022 amended the same day). Nothing else changes.

## Amendment — 2026-09-03 (later, T-045), the MCP surface and `/oauth2/*` are on the app origin

The 2026-08-28 amendment's "the OAuth 2.1 pages of the MCP surface … are served on `mcp.`" is struck. The MCP surface answers at `app.<domain>/mcp` and `/oauth2/*`, `/.well-known/*` and `/jwks` answer beside it on the same origin as the product, so one session serves the flow without a cookie scoped to the apex (ADR 0034). The host router now holds paths per hostname across **three** hostnames — `app.`, `agent.` and the apex — and `agent.` is unchanged. Everything else stands.

## Amendment — 2026-09-05, the one-test-per-capability-through-every-transport clause is retired (T-078; retired by the owner on 2026-08-31)

`[SEC2]` once ended with a clause this ADR's transports implied: one functional test per capability runs through every mounted transport — tRPC, MCP and `/agent/v1`, OpenAPI the day it mounts. The owner removed that clause from the constitution on 31 August 2026 (`64c1e78`), deliberately, and it is not restored; this amendment records the retirement where the repository's convention says a contradiction of an ADR is recorded (owner, 5 September 2026). What holds instead is what the rules already say: a capability's functional test crosses the interface `[TEST1]` names for its tier, a transport is proven by its own tests (its verifier, its refusals, its mounted routes), and the same `packages/core` function serves every transport because it takes a `Principal` and nothing transport-shaped. Everything else in this ADR stands.
