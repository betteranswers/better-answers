# Components — `apps/api`

Level 3. The one TypeScript deployable is transports only (ADR 0029): every request passes the hostname fence first, then reaches one of five mounts, and every mount calls `packages/core` through a slice's `index.ts`. The order of mounts in `createServer` is the order below.

```mermaid
C4Component
  title Component diagram — apps/api, the transports over packages/core

  Container(web, "Single-page app", "Vite, React", "Control Centre; tRPC only")
  System_Ext(claude, "Claude and Claude Code", "MCP client")
  System_Ext(email, "SMTP", "Sign-in codes, alerts")
  ContainerDb(postgres, "Postgres", "RLS", "The identity set and every tenant table")
  ContainerDb(git, "Git store", "bare repositories", "The bundle per workspace")

  Container_Boundary(api, "apps/api") {
    Component(main, "main.ts and config.ts", "bootstrap", "Reads the bootstrap env once, builds the Pool, the SMTP transport and one systemClock; starts the server and the reconciler")
    Component(fence, "ingress/hostnames.ts", "Hono middleware", "One list of surface to hostnames to reason; refuses a path outside its hostname's surface before any counter, session or body")
    Component(limits, "ingress/limits.ts", "per-IP counters", "The flood limits on /mcp, /oauth2/*, discovery and /jwks, as rows")
    Component(health, "/health", "Hono route", "Database reachable and the authorization server initialised, or 503; Docker holds the worker on it")
    Component(auth, "auth/", "Better Auth in-process", "The identity provider and authorization server: email code, the organisation plugin as the workspace, /oauth2/*, discovery, /jwks, the consent page, CIMD fetch; Microsoft at P1")
    Component(mcp, "mcp/surface.ts and entries/", "MCP SDK v2 behind one fetch-shaped seam", "The token verifier over the JWKS, then four entries: find, ask, open, give_feedback; structured content with a human rendering")
    Component(trpc, "trpc/", "tRPC on Hono", "app-router, mount, base with workspaceProcedure; the SPA's transport, event streams for answers, splitLink for uploads at S1")
    Component(spa, "ingress/spa.ts", "static files", "The SPA's hashed bundles and the shell on app., answered after every route this process owns and after Better Auth declines")
    Component(ops, "ops/", "runOps", "pnpm ops: replay-erasures, smoke, dump-grep, graph-rebuild, graph-counts, graph-sweep, reconcile-watermark; answers done, refused, usage or not built")
    Component(reconciler, "reconciler.ts", "setInterval, 30 s", "Every workspace's head against its watermark; replays missed commits through the live handler; reports a stop, never skips")
    Component(migrate, "migrate.ts", "Drizzle", "The one-shot the platform stack runs ahead of api, as the owner role")
    Component(core, "packages/core", "library", "The slices and the four doors; see c4-components-core.md")
  }

  Rel(web, fence, "Every request enters through", "HTTPS")
  Rel(claude, fence, "Every request enters through", "HTTPS")
  Rel(fence, limits, "Counts per IP on the limited paths")
  Rel(fence, health, "Routes /health on the loopback")
  Rel(fence, auth, "Routes sign-in, consent, /oauth2/*, discovery, /jwks on app.")
  Rel(fence, mcp, "Routes /mcp on app.")
  Rel(fence, trpc, "Routes the procedures on app.")
  Rel(fence, spa, "Routes the shell and assets on app.")

  Rel(mcp, auth, "Verifies bearers against the JWKS of")
  Rel(mcp, core, "Calls answering and sources")
  Rel(trpc, auth, "Reads the session and membership from")
  Rel(trpc, core, "Calls every slice")
  Rel(ops, core, "Calls erasure, runs, concepts")
  Rel(reconciler, core, "Calls the concepts slice's reconcile")
  Rel(main, reconciler, "Starts")
  Rel(main, ops, "Dispatches pnpm ops to")

  Rel(auth, postgres, "Owns the identity set in", "Drizzle adapter")
  Rel(auth, email, "Sends codes and invitations through", "SMTP")
  Rel(core, postgres, "Reads and writes through the doors", "pg")
  Rel(core, git, "Commits through the git door", "git")
  Rel(migrate, postgres, "Runs the journal against", "owner DSN")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## What the diagram claims

- **The fence is first and the SPA shell is last.** `routeByHostname` runs ahead of every mount; the tunnel's ingress rules are the first fence and this list the second, because Better Auth's handler answers the wildcard on every hostname the process is given (ADR 0022, amended 2026-09-03). The shell answers only after Better Auth has declined a path, so no endpoint of the library can be shadowed by the SPA.
- **Three principals, one id.** A person's id is the `user` row's, minted by the platform's ULID minter Better Auth is handed (ADR 0035); the MCP token carries `{workspace, user}` fixed at consent; the operator is a third principal kind and the platform principal a fourth for provisioning (ADR 0009). Revocation is an instant on the membership row or on the person, checked on every claim.
- **`runOps` is a tested seam.** Every command answers *done · refused · usage · not built*; a command whose slice has not landed says so rather than guessing. S0 fills `replay-erasures` and `erasure-rehearsal`, S5 adds the stuck-ref command, P2 adds `provision-workspace`.
- **The reconciler is the api's, not the worker's.** It runs in the api process every thirty seconds with the git and Postgres doors, replaying under `process:better-answers-reconciler`, idempotent on the `Audit:` trailer id; a commit the index refuses stops that workspace's replay, reported for the operator (ADR 0012).

## The skills that bind a change here

A seam sketch touching `apps/api/` names the skill under `apps/api/.claude/skills/` it follows — router, validators, links, non-JSON content types, error handling, subscriptions — and `[APP5]` binds the build the same way. No second HTTP route is opened beside tRPC for a shape a skill already covers; S1's upload goes over `splitLink` on `isNonJsonSerializable`, and S2's answer stream is a tRPC subscription whose iterable closes over no transaction (probe 2).
