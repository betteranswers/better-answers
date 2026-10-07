---
title: "The MCP surface is MCP SDK v2 in apps/api, behind one fetch-shaped seam"
date: 2026-09-21
module: apps/api
problem_type: architecture_pattern
component: transports
severity: medium
applies_when:
  - "Changing the MCP surface, its entries or the library under it"
  - "Proposing FastMCP, a Python MCP server or an MCP App framework"
  - "Proposing an outbound connector, a sync or a write into a customer's other systems"
  - "Giving the acting credential class a use"
tags:
  - adr-0030
  - mcp-surface
  - mcp-sdk
  - mcp-app
  - fastmcp
  - acting
  - open
---

# The MCP surface is MCP SDK v2 in apps/api, behind one fetch-shaped seam

## The decision

The MCP surface is built on MCP SDK v2, `@modelcontextprotocol/server`, in `apps/api`. It stays in the TypeScript tier.

- It is reached through one fetch-shaped seam. `createMcpSurface` in `apps/api/src/mcp/surface.ts` returns a `(Request) => Response` function that Hono mounts. It verifies the bearer before the SDK's handler sees the request, hands the handler `{ authInfo }`, and runs each entry under the Principal built from the bearer.
- No MCP library type crosses into `packages/core`. The import-direction lint refuses `@modelcontextprotocol` there.
- The MCP surface has four entries: `find`, `ask`, `open` and `give_feedback`.
- `open` returns structured content: frontmatter, body, relations, trust state and evidence as fields. The human rendering is derived from it.
- An MCP App, when built, adds views over three of the entries and no further entry. It uses `@modelcontextprotocol/ext-apps` directly, with `apps/web`'s Vite React toolchain. `okf://` identifies a concept and `ui://` a view; both live on the wire and never in a file.
- No concept is served as an MCP resource in v0.1. A `ui://` view resource is not a concept.

The **acting** credential class is for actions on our own estate and for the ingestion side. It is never a credential for writing into a customer's other systems. The list of classes it belongs to is ADR 0041's. `docs/operations/SECRETS.md` glosses *acting* incompatibly, as writing back into a connected system as the user, and ADR 0041 records that conflict unsettled.

The platform builds no outbound connectors to third-party SaaS, no outbound OAuth client, no field mapping or sync engine, no outbound scheduler or webhook fan-out, no per-destination rendering and no connector directory of its own. A person who wants our knowledge in Notion or Asana reaches those systems through their own MCP servers, under their own consent. A nightly sync with no person in the loop would be a new ADR and a new deployable.

## Why

- FastMCP TypeScript exposes the same fetch shape, so the choice between it and the plain SDK sits behind one seam and can be reversed in an afternoon.
- Dual-era serving is not a differentiator. The SDK's `createMcpHandler` defaults to `legacy: "stateless"`, so one handler answers both protocol eras.
- FastMCP's real advantage is authentication, and it is Python-only. Its identity assertion (SEP-990) hangs off an OAuth proxy, where someone else owns the accounts. ADR 0009 makes the platform its own authorization server.
- SEP-990 is about a week's work when a customer asks for it: the RFC 7523 `jwt-bearer` grant on Better Auth's token endpoint, behind ADR 0009's identity seam. Moving the transport into the worker would add a permanent second identity boundary instead.
- An MCP App turns `open` into the thing a person looks at. Without structured content, the views would be a rewrite of `open` rather than an addition beside it.
- The Claude platform is the integrator, reaching a customer's other systems with credentials we never hold.

## Rejected

- FastMCP TypeScript: rejected for now, not on principle. Its 1.x line was weeks old, its authors label its authentication interim, and it pulls Express 5 into an all-Hono tier. The seam keeps it a live option.
- FastMCP Python, with the MCP surface moved to the worker: its SEP-990 attaches to an OAuth proxy, and it would put a transport across the tier boundary from the Principal and the predicate.
- `punkpeye/fastmcp`, the unscoped npm `fastmcp`: it implements only legacy MCP revisions.
- Vercel's `mcp-handler`: a thinner version of what the SDK already gives, with no MCP App support.
- `mcp-use` as the MCP App framework: the named runner-up, if hand-rolling the bridge over `ext-apps` proves fiddly.
- Deciding later: an implementation was already named, so later means unpicking it.

## History

The full record, with its two amendments (the same-day correction to four entries, and T-184): `docs/archive/adr/0030-mcp-surface-stays-mcp-sdk-v2.md`.
