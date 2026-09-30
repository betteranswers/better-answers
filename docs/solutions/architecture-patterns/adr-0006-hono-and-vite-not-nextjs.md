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
- `apps/web` imports nothing from `apps/api` but `AppRouter`, as an `import type`, in `apps/web/src/shared/api/trpc.ts` and no second file. A lint override in `.oxlintrc.json` holds it. Runtime coupling stays zero.
- "Talk only over tRPC" means everything with a shape that crosses between `apps/web` and `apps/api` (a field, an output, a refusal word) is checked by the compiler through that one type. A change on one side fails the other's type-check until fixed.
- Two things sit beside tRPC. The Better Auth client carries identity with its own typed client: the session, sign-in, sign-out, the workspace, OAuth. Bytes have no shape a compiler checks.
- Bytes in: the upload is a tRPC mutation over `application/octet-stream`, with the binding's descriptor beside the bytes (ADR 0043). It needs no exception here.
- Bytes out: tRPC answers JSON and cannot stream a file, so a download is a route beside tRPC on the same origin, under the same principal resolution and the same crossing table. The ADR of the block that lands it opens it.
- A route beside tRPC for a shape tRPC carries is refused.
- A public surface, when one arrives, is a separate site in its own package, never a mode of the api.
- Node's LTS calendar sets the runtime upgrade cadence.

## Why

- The api is a service first and a website second. It holds MCP sessions, runs per-workspace model routing and owns every policy decision. A process that starts once and stays up fits that better than a request-shaped framework.
- The lifted contracts arrive Hono-shaped. Dust made this same move in 2026: its api on Hono, its SPA on Vite.
- The MCP SDK v2 ships an official Hono adapter and tRPC ships `@hono/trpc-server`, so every surface shares one process with no adapters of our own.
- Server-rendered pages help only public pages: search indexing, link previews, first paint on a cold connection. Every screen of this product sits behind sign-in.
- One origin means Better Auth's session cookie needs no cross-origin arrangement.
- `AppRouter` is inferred from the procedures, which compose `packages/core` slices. It cannot live in `packages/` without moving the procedures there.
- The upload spike found tRPC streams an octet body and buffers only multipart.

## Rejected

- Next.js 16: couples interface and API in one request-shaped runtime, brings Vercel-shaped conventions to a self-hosted estate, and makes the MCP surface a guest inside a page framework.
- Hono with server-rendered React: solves a problem no screen has and adds build complexity.
- Bun as the runtime: Node LTS is what the lifted contracts pin and what the MCP SDK, Vitest and Testcontainers target. Bun stays available for scripts.
- A generated declaration file for `AppRouter`: a build step that exists to satisfy a sentence.

## History

The full record, with its two amendments (T-022, T-230): `docs/archive/adr/0006-hono-and-vite-not-nextjs.md`.
