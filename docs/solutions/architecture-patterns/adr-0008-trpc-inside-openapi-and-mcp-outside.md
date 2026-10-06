---
title: "The SPA calls tRPC; callers outside get generated OpenAPI, MCP or /agent/v1"
date: 2026-09-05
module: apps/api
problem_type: architecture_pattern
component: transports
severity: medium
applies_when:
  - "Adding a way for a caller to reach the api"
  - "Adding a hostname or a path to the ingress"
  - "Testing a capability that more than one transport exposes"
  - "Mounting the OAuth pages, discovery or the MCP surface somewhere new"
tags:
  - adr-0008
  - trpc
  - mcp-surface
  - openapi
  - agent-v1
  - hostnames
  - oauth2
---

# The SPA calls tRPC; callers outside get generated OpenAPI, MCP or /agent/v1

## The decision

Each class of caller gets its own contract, all from the api's one process.

- The SPA calls the api over tRPC (`@hono/trpc-server`), so a field changed in the api fails the SPA's type-check until fixed.
- A customer integration, a script or a partner gets an OpenAPI document generated from the same router, never hand-edited. Breaking a route in it is a versioned change. The tree does not mount it yet.
- Agents get the tools-only MCP surface: MCP SDK v2 over Streamable HTTP, at `app.<domain>/mcp`. Every MCP entry is a named, described, zod-typed function, and none reaches the database directly.
- The share agent gets `/agent/v1`: hand-written Hono routes over `packages/core`, on the `agent.` hostname, under a connected-source-scoped agent token, with a 100 MB per-file cap, a per-agent rate limit, streaming to the object store, and agent versions N and N-1 accepted. The host router already reserves `/agent/v1/*` on `agent.`; the routes themselves are not in the tree yet.
- The worker uses none of these. It shares the stores (ADR 0005).
- zod v4 is the one validation library at every boundary.

The authorization server's pages are `/oauth2/*`, the path `@better-auth/oauth-provider` mounts, never `/oauth/*`.

- The MCP surface and `/oauth2/*` answer on the product's origin, `app.<domain>`, beside `/.well-known/*` and `/jwks`, never on `mcp.` (ADR 0034).
- The host router, `apps/api/src/ingress/hostnames.ts`, holds paths per hostname across three hostnames: `app.`, `agent.` and the apex. It is mounted ahead of every other route and refuses `agent.` anything but `/agent/v1/*` before a body is read.

Business logic lives in `packages/core`. The same function serves every transport because it takes a `Principal` first, as `CODING_STANDARDS.md` requires, and nothing transport-shaped.

- A transport is proven by its own tests: its verifier, its refusals, its mounted routes.
- A capability's functional test goes through the interface a caller crosses in its tier.
- No rule asks for one test per capability through every mounted transport.

## Why

- Each class of caller wants a different contract. The SPA wants types, third parties want a document, agents want tools with descriptions and schemas. REST for all three loses the first; tRPC for all three loses the other two.
- One validation library at every boundary is what lets one router feed all three.
- Claude connects to an MCP surface over OAuth 2.1 only, so the MCP surface signs in through the api's own authorization server (ADR 0009). A personal token stays a second credential path for scripts and Claude Code.
- A machine client cannot complete an interactive sign-in, so `agent.` is fenced by path and by its token instead. The 100 MB cap is the edge's body limit, enforced before the origin whatever the streaming.
- One origin lets one session serve the OAuth flow with no cookie scoped to the apex.

## Rejected

- REST and OpenAPI for everything: the SPA loses end-to-end types, and MCP tools would wrap REST calls twice.
- tRPC only: no API for anyone outside our own TypeScript, and none for agents.
- GraphQL: a second schema language beside zod and OKF frontmatter, which nothing on the roster speaks.

## History

The full record, with its six amendments (tickets 47, 53 and 41, then T-030, T-045 and T-078): `docs/archive/adr/0008-trpc-inside-openapi-and-mcp-outside.md`.
