---
title: "The api is a long-running Hono process on Node serving a Vite SPA, not Next.js"
date: 2026-09-22
module: apps/api
problem_type: architecture_pattern
component: transports
severity: medium
applies_when:
  - "Importing anything from apps/api into apps/web"
  - "Adding a way for the SPA to reach the api other than tRPC"
  - "Uploading or downloading a file between the browser and the api"
  - "Proposing server-rendered pages or a public site"
tags:
  - adr-0006
  - hono
  - vite
  - spa
  - approuter
  - trpc
  - octet-stream
---

# The api is a long-running Hono process on Node serving a Vite SPA, not Next.js

## The decision

The api is a plain long-running Node process on Hono, Node 24. One process carries tRPC, the MCP surface and the authorization server. The interface is a separate Vite-built React SPA, `apps/web`.

- The api serves the SPA's static build on the `app.` hostname, so the SPA and the api are one origin.
- `apps/web` imports only `AppRouter` from `apps/api`. That import is an `import type`, in `apps/web/src/shared/api/trpc.ts` and no other file. A lint override in `.oxlintrc.json` holds it. Runtime coupling stays zero.
- Otherwise `apps/web` and `apps/api` share types only through `packages/`. `apps/api` imports nothing from `apps/web`. It serves the SPA's built files and never its code.
- "Talk only over tRPC" means the compiler checks, through that one type, everything with a shape that crosses between `apps/web` and `apps/api` (a field, an output, a refusal word). A change on one side fails the other's type-check until fixed.
- Two things sit beside tRPC: identity and bytes. The Better Auth client carries identity with its own typed client: the session, sign-in, sign-out, the workspace, OAuth. Bytes have no shape a compiler checks.
- Bytes in: the upload is a tRPC mutation over `application/octet-stream`, with the connected source's descriptor beside the bytes (ADR 0043). It needs no exception here.
- Bytes out: tRPC answers JSON and cannot stream a file. So a download is a route beside tRPC on the same origin. It resolves the principal the same way and uses the same crossing table. The ADR of the block that lands a download opens that route.
- A route beside tRPC for a shape tRPC carries is refused.
- Public pages, when they arrive, are a separate site in their own package, never a mode of the api.
- Node's LTS calendar sets the runtime upgrade cadence. The api moves from Node 24 to Node 26, the next LTS line, from October 2026.

## Why

- The api is a service first and a website second. It holds MCP sessions, runs per-workspace model routing and owns every policy decision. A process that starts once and stays up fits that better than a request-shaped framework.
- The lifted contracts arrive Hono-shaped. Dust made this same move in 2026: its api on Hono, its SPA on Vite.
- The MCP SDK v2 answers a web-standard request with a response, which Hono mounts as it stands, and tRPC ships `@hono/trpc-server`. So every transport shares one process with no adapters of our own.
- Server-rendered pages help only public pages: search indexing, link previews, first paint on a cold connection. Every page of this product sits behind sign-in.
- One origin means Better Auth's session cookie needs no cross-origin arrangement.
- `AppRouter` is inferred from the procedures, which compose `packages/core` slices. It cannot live in `packages/` without moving the procedures there.
- The upload spike found that tRPC streams an octet body and buffers only a multipart one.

## Rejected

- Next.js 16: couples interface and API in one request-shaped runtime, brings Vercel-shaped conventions to a self-hosted estate, and makes the MCP surface a guest inside a page framework.
- Hono with server-rendered React: solves a problem no page has and adds build complexity.
- Bun as the runtime: Node LTS is what the lifted contracts pin and what the MCP SDK, Vitest and Testcontainers target. Bun stays available for scripts.
- A generated declaration file for `AppRouter`: a build step that exists to satisfy a sentence.
- A multipart upload body: tRPC buffers it, where it streams an octet body.

## History

The full record, with its two amendments (T-022, T-230): `docs/archive/adr/0006-hono-and-vite-not-nextjs.md`.

The record had the api's one process also serve the worker's control plane. ADR 0005's amendment of 25/08/2026 (ticket 38) made the control plane rows, with no HTTP between the api and the worker. The record named the MCP SDK's official Hono adapter. T-004 left the Hono package untaken, and the api mounts the SDK's own request handler (ADR 0030). The one-way imports and the Node 26 date were missing from this doc until 20/10/2026 (BA-215).
