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
