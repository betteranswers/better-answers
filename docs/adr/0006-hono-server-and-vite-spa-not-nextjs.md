---
status: accepted
date: 2026-08-25
---

# The app tier is a Hono server on Node 24 with a Vite React single-page app, not Next.js

The TypeScript app tier (ADR 0005) is built as a plain long-running Node server on Hono — one process serving the tRPC API, the MCP server, the OpenAPI surface and the worker control plane — with the user interface a separate Vite-built React single-page app served as static files. We chose this over Next.js 16, which the predecessor project used and which Onyx still uses for its web tier, because the app tier is a server first and a website second: it holds MCP sessions, executes per-workspace LLM routing, runs a scheduler control plane and owns every policy decision, and a request-shaped framework fits that worse than a process that starts once and stays up. The lifted contracts arrive Hono-shaped — Dust completed exactly this move in 2026 (`front-api` on Hono, `front-spa` on Vite, `front` as a library) — and the MCP SDK v2 ships an official Hono adapter while tRPC ships `@hono/trpc-server`, so API, MCP and OpenAPI share one server without adapters we would have to maintain. Server-rendered pages, the thing Next.js does that this stack does not, matter only for public pages (search indexing, link previews, first paint on a cold connection); every screen of this product sits behind a login, and any public surface — documentation, marketing, a public portal — is a separate site (the Astro docs site already carried into this repo).

## Considered options

- **Next.js 16** — familiar from the predecessor and the largest React ecosystem, but couples UI and API into one request-shaped runtime, brings Vercel-shaped conventions to a self-hosted deployment, and would make the MCP server and control plane guests inside a page framework.
- **Hono + server-rendered React (SSR without Next)** — solves a problem no screen has; adds build complexity for nothing.
- **Bun as runtime** — runs the same code, but Node 24 LTS is what every lifted contract pins and what the MCP SDK, Vitest 4 and Testcontainers target; Bun stays available for scripts.

## Consequences

- `app/` is a server package; `web/` is a browser package; they share types through `packages/` and talk only over tRPC. Neither imports the other.
- A public surface, when one arrives, is a new site under its own workspace, never a mode of the app.
- Node's LTS calendar sets the runtime upgrade cadence (24 until October 2026, then 26).
