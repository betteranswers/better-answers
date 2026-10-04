---
title: "Better Auth runs in-process as the api's own authorization server, behind a seam"
date: 2026-09-27
module: apps/api
problem_type: architecture_pattern
component: identity
severity: high
applies_when:
  - "Importing better-auth, or reading a Better Auth table, anywhere outside the auth modules"
  - "Adding a People act, an invitation step or anything that writes a membership"
  - "Giving the operator a new read or write, or recording a sign-in, consent or token event"
  - "Adding a table that carries no workspace_id or has no row-level security"
  - "Registering a Better Auth plugin, or calling an endpoint that disabledPaths closes"
tags:
  - adr-0009
  - better-auth
  - identity-set
  - operator
  - principal
  - cimd
  - identity-seam
---

# Better Auth runs in-process as the api's own authorization server, behind a seam

## The decision

Better Auth runs in-process as a library. The api is its own OAuth 2.1 authorization server for the MCP surface and the email-code sign-in for the SPA.

- Its tables are the identity set, keyed not scoped, with the platform's own rows about a person's sign-in: recovery codes and a passkey's last use. They are read by key before any workspace is known, so they carry no RLS policy, and a `workspace_id` only where their exemption says why. A person's last activity in a workspace is that workspace's own row, under RLS. The set is named in `packages/schema/src/identity-tables.ts`, and `packages/schema/test/rls.test.ts` holds the exemption both ways.
- It shares one origin, `app.<apex>`, with the SPA's sign-in and the workspace picker.
- CIMD only, allow-listed to `claude.ai`. Dynamic client registration stays off.
- A person has one platform-minted id (ADR 0035). Revocation has two scopes: a workspace Admin's, in that workspace, and the operator's, everywhere.
- A token's workspace is fixed at consent, as Better Auth's `referenceId`. A person who wants another workspace consents again.

The seam, which `packages/core` never crosses:

- No Better Auth type crosses into `packages/core`. A transport verifies a bearer and builds a `Principal`.
- `better-auth` and `@better-auth/*` are imported only in `apps/api/src/auth/`, `apps/web/src/features/auth/` and the CIMD lift, `apps/api/lifts/better-auth-cimd-node/`. `.oxlintrc.json` enforces it, with rule tests in `apps/api/tests/lint-rules.test.ts` and `apps/web/test/lint-rules.test.ts`.
- The CIMD lift runs on upstream 1.7.5's transport and carries two guards (better-auth/better-auth#11422, #11423). It goes when a release fixes both.

The `organization` plugin:

- It keeps its tables, its reads and the picker's `/organization/set-active`.
- Its other writes and `/organization/check-slug` are in `disabledPaths`, each proven refused for every role.
- Every People act, accepting an invitation included, is the members slice's over tRPC, keyed by workspace and person id, with its audit event in its own transaction.

The passkey and authenticator plugins:

- Every path they mount is in `disabledPaths`, and so are `/update-session`, `/list-sessions`, the three `/revoke-*` paths and `/unlink-account`. `apps/api/tests/second-factor-foundation.test.ts` holds each refused to a signed-in person.
- `disabledPaths` refuses over HTTP only. The api's own routes call a closed endpoint as a server function, which also skips the library's rate limiter and origin check, so each such route carries its own (`docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md`).
- A passkey is added and used through the api's routes under `/passkeys/` (`apps/api/src/auth/passkeys.ts`). The plugin's verification hooks refuse a passkey made or used without user verification, before it is kept or a session made. A passkey sign-in's session is confirmed as the library creates it, and that passkey's last use is kept. Renaming and removing a passkey are core's own acts, never the plugin's.
- A session confirms its second factor through the api's routes under `/second-factor/` (`apps/api/src/auth/confirm.ts`), which stamp it and mint none:
  - **Passkey:** our own challenge and `@simplewebauthn/server` verification, because the plugin's verify always mints a session and never checks the credential is this person's.
  - **Authenticator:** the plugin's `verifyTOTP`, which with a full session only verifies.
- The plugin's own second-factor check covers password sign-in alone, so the gate is ours (ADR 0048). A before-hook refuses a pending session every endpoint it reaches over HTTP, outside the pending set and the paths that act on no session, and answers its `/get-session` without renewing it. The OAuth post-login rule sends a pending session's authorize to the post-login page, so no code is issued before it confirms.
- Replacing an authenticator after a recovery or restore code is the one setup outside the plugin, decided by the owner on 03/10/2026:
  - **Why:** the plugin refuses a second enrol while a verified authenticator stands, and keeps one per person.
  - **How:** the route makes and encrypts the secret as the plugin does, parks it until its code verifies, then swaps it in within the transaction that removes the old factors.
  - **Unchanged:** a first authenticator still enrols through the plugin.

The operator:

- `admin()` is refused for good.
- The operator is a third principal kind, beside a user and the platform: a mark on the person's `user` row that only an ops command sets or clears, and that erasure clears.
- It is built only from a signed-in session, never from an OAuth or personal token. Revoke everywhere and a display-name correction need a session created within the hour.
- It has one cross-workspace read: people, with the workspaces and role each holds, and workspaces with their member counts, over the identity set alone.
- A person who has lost every factor and every recovery code is restored by `pnpm ops restore-sign-in`, never from a page, once the operator has checked who they are by a route other than their email. Under the person's lock it ends their factors, codes and sessions, keeps a one-time restore code's hash for 24 hours, records the act and sends the notice. It prints the code, which the operator hands over by that same route.

A person exists from their first email-code sign-in, or earlier when `pnpm ops add-person` adds them by name. That act writes the `user` row itself, past the library's create hook, which would blank the name.

The identity-set audit log holds:

- a person's own display-name act, and the platform's adding of a person or restoring their sign-in;
- a person's own second-factor acts: a passkey added, renamed or removed, an authenticator added or removed, recovery codes issued or used, each confirm, a restore code accepted, and their factors replaced after a recovery or restore code;
- with the console, each sign-in, every operator write and an Admin's act that ends a person's grants.

A token's issue, refusal and refresh, and the workspace pick, stay log lines.

Better Auth is a stay. Any one of three triggers starts a migration: a licence or distribution change on core or the OAuth provider; the self-hosted OAuth path deprecated, or twelve months without a release while core ships; a security defect we report left unfixed for one release cycle.

## Why

- Every container is an operational cost paid for good. Better Auth adds no process, no memory budget, no second backup story and no second migration owner (ADR 0007).
- The identity set's reads come before authentication: a session by its token, a user by id or email, a client by its `client_id` URL. None lists across principals. The membership read then validates the token's workspace in the same transaction, before any tenant row.
- The seam keeps `packages/core` testable without the library, since a `Principal` is a plain value. Two of the four kinds of caller never hold a Better Auth session: the worker and the platform's scheduled routines. No swap to Keycloak is planned.
- The library runs `afterAcceptInvitation` after its own member write and outside any transaction, so the row and its event could not land or fail together. Accepting is not signing in.
- `check-slug` answers *taken* or *free* for any slug to any signed-in person: an oracle over the workspace list.
- `admin()` writes no audit event, and its session revoke leaves OAuth tokens alive. A role value threaded through the user principal would make the tenant guarantee depend on reading a role field correctly at every call site.

## Rejected

- Keycloak: about 1.25 GB, a third-party extension for email-code sign-in, and configuration outside the repository. It does DCR, not CIMD.
- SuperTokens: its OAuth provider is managed-only and paid, and its MCP plugin has no CIMD.
- Supabase Auth: would move the database's home, lacks audience binding, and adds a second migration owner.
- Hosted Auth0 in the UK: every sign-in on a third party's uptime and terms.
- Zitadel, Authentik, Ory, WorkOS, Clerk and Stytch: missing RFC 8414, closed DCR, container count or US-only data.
- The MCP SDK's own OAuth helpers: Express-only and frozen.

## History

The full record, with its fourteen amendments (tickets 21 and 79, then T-004, T-022, T-045, T-044, T-073, T-078, T-328 and T-329, T-355, the T-027 and T-028 grill, T-420, T-460 and T-474): `docs/archive/adr/0009-better-auth-in-process-identity-provider.md`.
