---
status: accepted
date: 2026-08-25
---

# Better Auth, run in-process, is the identity provider for app login and the OAuth 2.1 MCP surface

The app tier (ADR 0006) embeds Better Auth as a library — its MCP, client-ID-metadata-document, email-OTP and organization plugins over our own Drizzle tables — and is itself the OAuth 2.1 authorization server that Claude Teams connectors register against (dynamic client registration or CIMD, PKCE, protected-resource metadata on a 401, RFC 8414 discovery, RFC 8707 audience binding) and the email-code login for the web app's three roles. We chose this over a separate identity-provider container (Keycloak, the runner-up) because the whole platform is one founder's Coolify deployment (ADR 0005) and every container is an operational cost paid forever: Better Auth adds no process, no memory budget, no second backup story and no second migration owner (ADR 0007) — its tables live in the app's schema under the app's migrations and are backed up with Postgres. It also gives us the per-user principal `{workspace, user, role}` inside the access token from the organization plugin, which is what `[SEC2]` needs at the MCP boundary, without a claim-mapper configuration living outside the repo. The MCP SDK's own OAuth helpers were not an option: they are Express-only and frozen in `server-legacy`; only `requireBearerAuth` is runtime-neutral, and it becomes the seam — the MCP server verifies a token and derives a Principal, and nothing behind that seam knows which library minted the token.

Better Auth was acquired by Vercel on 7 July 2026. The library stays MIT, keeps its name, its team and its open contribution model, and Vercel's stated direction for it — agents acting on users' behalf with scoped, revocable access — is the direction our later acting-credential class needs. We consume it only as an in-process library, never as a Vercel-hosted service, so the acquisition changes stewardship, not our deployment. Stewardship is a watch item for architecture review pass 2.

## Considered options

- **Keycloak 26.7.2** — one container, Apache-2.0, an official MCP guide, anonymous DCR whitelisted to Anthropic's egress range, audience via mapper; the right answer if the authorization server should live out of process. Costs ~1.25 GB, a third-party extension for email-code login, and configuration outside the repo. Kept as the runner-up behind the same seam.
- **SuperTokens** — the original candidate; its OAuth2 provider is managed-only and paid, and its MCP plugin is beta on MCP SDK v1 with no CIMD.
- **Supabase Auth** — would move the database home (ADR 0007's fallback), has no audience binding, and would be a second migration owner.
- **Hosted (Auth0 UK region)** — the fallback if self-hosting auth fails in practice; puts every login on a third party's uptime and terms.
- **Zitadel, Authentik, Ory, WorkOS, Clerk, Stytch** — rejected in research 40 for missing RFC 8414, closed DCR, container count, or US-only data.

## Consequences

- The authorization server is part of the app: `apps/api/` serves `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` and the registration, authorize and token endpoints; `mcp.` stays a separate hostname with no Access policy (ticket 38).
- Auth tables are ordinary tables in the app's schema; workspace isolation applies to them like every other table (ADR 0005).
- Two things are unverified and are proved by the prototype on the read-only MCP ticket before any build: that a Claude Teams connector completes DCR or CIMD against this server with its real registration body, and that the access token carries the active organisation as the workspace claim. If either fails, Keycloak replaces the authorization-server half behind the `requireBearerAuth` seam; the login half stays.
- The library's version is read from Context7 in the PR that installs it (`[DEPS1]`), not from research 40.
- A bearer token for scripts and Claude Code stays as a second credential path, minted and revoked by the app, never org-shared.

## Amendment — 2026-08-27, the prototype named and the token's shape fixed (ticket 21, ADR 0018)

The two unverified things are proved by prototype ticket 61 against Liam's Claude Teams workspace. The access token carries `{workspace, user, role}` and the MCP audience, lives one hour with rotating refresh; groups never enter it — role and groups are re-read per call with a `credentials_revoked_at` check, since a JWT cannot be revoked server-side. `customAccessTokenClaims` receives no role, so the claim is a `member` lookup at issue time and a cross-check thereafter. A single-organisation user gets `activeOrganizationId` at session creation; a multi-organisation user picks before consent (`postLogin.page` + `shouldRedirect`).

## Amendment — 2026-08-30, Better Auth is a stay, with the exit written as a test (ticket 79, the pre-build gate; applied by T-001)

This ADR left stewardship under Vercel as "a watch item for architecture review pass 2". Pass 2 has run. The answer is **stay** — and the reasons, the triggers and the true cost of the fallback are written down here rather than carried as a feeling.

**Why stay, and what is now proved.** Prototype 61 drove the real claude.ai connector through Better Auth 1.7.2 against this server: CIMD chosen over DCR, the workspace claim carried, a two-organisation picker round-tripping in under a second, every entry answered. **The two things this ADR named as unverified are proved.** It still costs one container fewer than every alternative, adds no second migration owner and no second backup story.

**The risk is narrower than "Vercel might close it."** Vercel needs the library — it is the foundation of Connect. The real risk is the ordinary shape of an open-source project with a commercial parent: the core stays healthy because the hosted product depends on it, and the edges only self-hosters use get less attention. There is direct evidence of that edge from our own prototype: `@better-auth/cimd/node` 1.7.2 is broken on every supported Node and throws before a packet leaves the machine, with **no upstream issue filed by anyone**; `@better-auth/cli` 1.4.21 lags core and its generated migration misses `account.issuer`; and prototype 61 hit three further silent configuration traps, each fatal to the whole connection and each absent from the documentation. **The entire MCP path runs through exactly one of those edges.** The watch item is therefore not abandonment — it is *whether the self-hosted OAuth-provider path stays maintained while Connect becomes where agent identity ships.*

**Three leave-triggers. Any one starts a migration; none of them is a feeling.**

1. **A licence or distribution change** on `better-auth` core or `@better-auth/oauth-provider` — MIT becomes anything else, or the OAuth provider moves behind a paid or hosted-only tier.
2. **The self-hosted OAuth path stops being supported** — `oauth-provider` or `cimd` deprecated, folded into Connect, or twelve months without a release while core keeps shipping.
3. **A security defect we report goes unfixed for one release cycle** on a plugin in our auth path.

Reviewed at the first client's renewal, or the moment a trigger fires. **Ticket 83 is the first live test of trigger 3**: a reported bug with a known, small fix on exactly the plugin the MCP path depends on. How long it takes to land is the first real datum, and collecting it costs nothing.

**The Keycloak fallback is real, and it is not a drop-in.** This ADR's consequence — "Keycloak replaces the authorization-server half behind the `requireBearerAuth` seam; the login half stays" — understated the work. Two things it did not account for. First, we are **CIMD-only** (research 80, fork F2) and Keycloak does DCR, not CIMD, so swapping providers reopens DCR and re-proves the whole claude.ai connector path prototype 61 measured. Second, Better Auth is not only the authorization server: it is also the app's email-code login **and its organisation model, which is where the `workspace` claim comes from**. Call it **two to three weeks, not two days.** That is still worth having — it means no trigger above is an existential event — but the true number is what belongs in an ADR.

**The seam becomes a rule.** `requireBearerAuth` was named here as the seam; it is now `[DESIGN5]` in `CODING_RULES.md` and **lint-enforced**: no Better Auth type crosses into `packages/core`, and no `better-auth` or `@better-auth/*` import appears outside the auth module. The seam is what makes two to three weeks two to three weeks rather than a rewrite.

**An SSRF policy on the CIMD fetcher, applied here.** The fetcher retrieves a URL the caller supplies, so it resolves the address before connecting, refuses private and link-local ranges, caps redirects and body size, and re-checks after every redirect. The policy is owned by this ADR and carried with the `@better-auth/cimd/node` fix as a `lifts/` snapshot with its `THIRD_PARTY_NOTICES.md` and a removal condition — the upstream release that fixes it (`[LIFT1]`, ADR 0027).
