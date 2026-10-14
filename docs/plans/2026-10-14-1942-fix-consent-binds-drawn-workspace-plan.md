---
title: A consent grant bound to the workspace its page drew - Plan
type: fix
date: 2026-10-14
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# A consent grant bound to the workspace its page drew - Plan

## Goal Capsule

- **Objective:** An assistant is connected only to the workspace the consent page showed, and only through the api's own `POST /consent`.
- **Means:** The api calls Better Auth's consent endpoint as a server function and closes its HTTP path (KTD1). The grant carries the drawn workspace to `consentReferenceId`, which refuses when the session read there names another (KTD2).
- **Authority:** This plan, then BA-172 and BA-173 in Linear, then `CODING_STANDARDS.md` with `apps/api/CODING_STANDARDS.md`.
- **Stop conditions:** Stop and report if a migration, a `contracts/` change or a change to a page a journey walks turns out to be needed.
- **Owner decisions:** The owner chose to build both issues on 14/10/2026. No user-visible words change.
- **Finishes and ships:** The auth follow-up worker, in one pull request. The orchestrator arms the merge.

---

## Product Contract

### Summary

The consent page's grant reaches Better Auth only from the api's own route, and the library binds it to the workspace the page drew. A post straight to the library's `/oauth2/consent` answers 404, and a workspace switch that lands while a grant is under way refuses that grant rather than connecting the assistant to the new workspace.

### Problem Frame

PR #731 (BA-149) put the drawn workspace on the consent page and refused a grant in `grantRefused` (`apps/api/src/auth/routes.ts`) when the session had moved. Its review left two gaps:

- **BA-172.** The api reached the library's consent endpoint over HTTP, through `auth.handler`, so `/oauth2/consent` stayed open on app. A session holder could post to it directly and skip `grantRefused`.
- **BA-173.** `grantRefused` reads the session, then the library reads it again inside `/oauth2/consent`, and `consentReferenceId` (`apps/api/src/auth/auth.ts`) fixes the token's workspace from that second read. A switch between the two reads granted to the new workspace.

### Requirements

- R1. A post to `/oauth2/consent` over HTTP answers 404 to a signed-in person, as the other closed paths do.
- R2. Connect and Cancel from the consent page work as before.
- R3. A grant whose session, read by the library, names a workspace other than the one the page drew records no consent and mints no code. The person sees the existing "workspace moved" refusal page.
- R4. A grant that reaches the library by any path other than the consent page (none today) keeps today's workspace choice.

### Scope Boundaries

- No new words on any page: R3 reuses `REFUSAL_PAGES.workspaceMoved`, which the owner ruled on 14/10/2026.
- `/oauth2/continue` and the sign-in link's flow keep calling the library over HTTP; they are not consent.

---

## Key Technical Decisions

- **KTD1. The consent endpoint as a server function.** `auth.api.oauth2Consent` with `asResponse: true` returns the same response the HTTP path did, so the redirect and cookies are handled as before. A server-function call skips the router, so `disabledPaths` can close `/oauth2/consent` without closing the api's own call (`docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md`). The library's before-hook that verifies the signed query, and our audit hook, still run.
- **KTD2. The drawn workspace in async-local storage.** `consentReferenceId` is handed only the user, session and scopes, and the endpoint's body schema drops unknown fields. The route therefore runs the call inside an `AsyncLocalStorage` holding the drawn workspace, the shape `sign-in-link.ts` already uses. When the store is set and the consented workspace differs, the hook marks the store and throws, and the route answers the refusal page from the mark rather than parsing the library's error.

---

## Implementation Units

### U1. Close `/oauth2/consent` and call it as a server function

- **Requirements:** R1, R2.
- **Files:** `apps/api/src/auth/routes.ts`, `apps/api/src/auth/auth.ts`, `apps/api/tests/better-auth-endpoints.test.ts` and its snapshot, `apps/api/tests/oauth-flow.test.ts`.
- **Test scenarios:**
  - Refuses a consent posted straight to the library: a signed-in person's JSON post to `/oauth2/consent` answers 404.
  - The existing Connect, Cancel and refusal tests still pass.

### U2. Bind the grant to the drawn workspace

- **Requirements:** R3, R4.
- **Files:** `apps/api/src/auth/consent-grant.ts` (new), `apps/api/src/auth/auth.ts`, `apps/api/src/auth/routes.ts`, `apps/api/tests/oauth-flow.test.ts`.
- **Test scenarios:**
  - Refuses a grant when the switch lands after the page's check: the session moves to Zenith, then the library's consent is called for the Acme page; no consent row is written and no code minted.
  - Grants the drawn workspace when the session still holds it: the existing connect tests.
- **Known gap:** no test drives the route's own answer to a moved grant (the refusal page after the library's 409), because nothing in the suite can land a switch between `grantRefused` and the library's read. The library-level test above proves the binding; the route maps the mark to the page `grantRefused` already answers.
