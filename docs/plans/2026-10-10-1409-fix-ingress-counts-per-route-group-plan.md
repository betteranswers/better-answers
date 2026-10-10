---
title: Count each route group apart, and let the api's limit govern the OAuth paths - Plan
type: fix
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Count each route group apart, and let the api's limit govern the OAuth paths - Plan

## Goal Capsule

- **Objective:** a request is refused for too many requests only by its own route group's count, a read of a discovery document is never refused by the api, and on every `/oauth2/*` path the refusal a client meets is the api's own, at the rate the api states.
- **Means:** each count by client address names its route group (KTD1), the discovery documents leave both limiters and are served cacheable (KTD2, KTD3), and Better Auth counts no path the api's `oauth` group counts (KTD4, KTD7).
- **Authority:** the owner's ruling of 10/10/2026 on Linear BA-113 and BA-75, whose acceptance criteria replace each issue's own, then this plan. The staff review the ruling adopts is the evidence.
- **Stop conditions:** stop and report if a discovery document cannot be served with the cache header without also stamping an answer that is not a discovery document.
- **Finishes and ships:** one pull request for both issues, open with its own CI green. The lead queues the merge.

---

## Product Contract

### Summary

Every count the api keeps per client address gets a route group's name, so a burst on one group spends none of another's. The three discovery documents under `/.well-known/` are counted by neither the api nor Better Auth and carry `Cache-Control: public, max-age=300`. Better Auth counts nothing under `/oauth2/*` or `/jwks`, so `OAUTH_IP_RULE` at 60 a minute is the one limit a client meets there, answered as `{ error: "too_many_requests" }` with `Retry-After`. The decision docs say so in the same commit.

### Problem Frame

`limitByIp` counts every route left without a scope in one row per client address and minute, and each route applies its own ceiling to that shared count. The MCP surface's no-bearer check writes to the same row. So the smallest ceiling governs: ten requests of any kind from one address refuse a sign-in by link, thirty refuse consent, sixty refuse discovery, every OAuth path and the MCP challenge. BA-100's release journeys met the sixty line from one address, and an office behind one address can meet the thirty line by loading the product and then opening consent.

Claude's servers fetch discovery and call `/oauth2/token` for every customer from Anthropic's shared egress range, so a per-address count on discovery bounds the one party that reads it most, at the cost of a Postgres write per read of a constant document.

On `/oauth2/authorize` and `/oauth2/token` a client meets Better Auth's limit first (30 and 20), answered as `{ message }` with a non-standard `X-Retry-After`, and never the api's at 60. Better Auth's count is also no fixed minute: it grows with every request until a full window passes with none, so a steady caller is refused after that many requests however slowly they arrive.

### Requirements

**Counts by client address**

- R1. Every route the api counts by client address names the count it spends, so each route group counts apart. The groups are `oauth` (`/oauth2/*` and `/jwks`), `consent`, `sign-in-link`, `trpc`, `mcp` (the surface reached without a usable bearer) and `passkey-sign-in`, which already counts apart.
- R2. The MCP surface's no-bearer check builds its key the same way as every other count by address.

**Discovery**

- R3. The api never refuses a read of `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp` or `/.well-known/oauth-authorization-server` for too many requests, and Better Auth's limiter does not count its two `/.well-known/` paths.
- R4. Each of those three documents carries `Cache-Control: public, max-age=300` when it answers 200. No other answer gains the header.
- R5. `/.well-known/openid-configuration` answers as it does today. The installed provider serves it only when `openid` is a scope, which this api does not grant, so a client is answered not-found and a browser the application's shell.

**The OAuth paths**

- R6. Better Auth counts no request under `/oauth2/*` or to `/jwks`: its six per-endpoint OAuth limits are off and its global rule does not apply there. `OAUTH_IP_RULE` governs those paths.
- R7. `/oauth2/register` is held refused by something other than a rate limit, proven by a test.
- R8. The email-code paths keep Better Auth's limiter, and their flood test asserts the refusal is Better Auth's.

**Record**

- R9. The rule is recorded in the decision doc on one origin, with a line in the decision doc on Better Auth and the matching sentence in `docs/operations/coolify.md`, in the same commit as the code.
- R10. A Linear issue holds the ceilings that still bound Anthropic's shared range, the token endpoint's first, and the revisit trigger.
- R11. The release journeys check Ask's address against the protected-resource document again, with a refusal of that read ending the run could-not-run.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given one address has spent one route group's count past its ceiling, when it then reads a discovery document, calls `/oauth2/authorize`, calls `/mcp` without a bearer and sends a tRPC query, then none of the four answers 429.
- AE2. **Covers R3, R4.** Given one address reads each of the three discovery documents 101 times in one minute, then every read answers 200 with `Cache-Control: public, max-age=300`.
- AE3. **Covers R6.** Given one address calls `/oauth2/authorize` 61 times in one minute, then none of the first 60 answers 429 and the 61st answers 429 with `error: "too_many_requests"` and a `Retry-After` header. The same holds for `/oauth2/token`.
- AE4. **Covers R8.** Given one address floods the email-code send, then the refusal's body is Better Auth's `{ message }`, not the api's `{ error }`.
- AE5. **Covers R6.** Given one address has called `/oauth2/token` and `/jwks`, then Better Auth holds no count for either path.

### Scope Boundaries

- No ceiling's number changes. `OAUTH_IP_RULE` stays at 60 a minute.
- The key stays the client address. Discovery is an anonymous read, and under CIMD the `client_id` is claude.ai's for every customer.
- Cloudflare's rules are not touched: the edge still counts `/.well-known/*` in its own rule.
- Whether `/.well-known/openid-configuration` should be served is not decided here.
- Better Auth's limiter stays on for every path the api does not count, the email-code paths among them. That its count is no fixed minute on those paths is a finding for its own issue.
- Considered and not built: a log line when a count by address refuses. R10's trigger reads such a line, and the api writes none today. A line per refused request turns a flood into log volume, and writing one only at a window's first refusal needs the count, which the Postgres door's `consumeIngress` does not return. No log line in the api names a client address either, so what this one carries is the owner's to decide. R10's issue names the line as its first step. What would change the call: a refusal on the `oauth` group reported by a customer before that issue is built.

#### Deferred to Follow-Up Work

- Counting only refused token requests, and the refusal log line, are R10's issue.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The scope is a required, closed name.** `limitByIp` takes a scope from one union of the group names, and one exported builder makes the key from scope and request headers, which the MCP surface's check also calls. A closed union keeps a mistyped name from opening another count, and puts the list of groups in one place. The counter kind handed to `consumeIngress` stays `"ip"`: it is the table's kind of key, not the route group. (session-settled: user-directed — chosen over a scope for the OAuth and discovery routes alone: the shared count governs consent and the sign-in link by the same defect.)
- KTD2. **The discovery documents are named, not matched by prefix.** The api stops counting `/.well-known/*`, and the cache header is set on the three document paths only, after the handler, when the answer is 200. A prefix match would also stamp whatever else answers under `/.well-known/`: `/.well-known/openid-configuration` answers a browser the application's shell with a 200. A document Better Auth adds in an upgrade then arrives without the header, which is the safe direction. (session-settled: user-directed — chosen over a scope of their own for discovery: the count costs a Postgres write to protect a constant, and bounds the vendor's shared range.)
- KTD3. **The api's header replaces Better Auth's.** Better Auth 1.7.5 serves its authorization-server document with `public, max-age=15, stale-while-revalidate=15, stale-if-error=86400`. All three documents carry the one value R4 names, so a client sees one cache lifetime for the pair it fetches together.
- KTD4. **All six of Better Auth's OAuth rules are off, register included.** The installed provider refuses `/oauth2/register` with 403 as the first thing its handler does while `allowDynamicClientRegistration` is false, its default, which this api never sets. Only the body's schema runs earlier, and it answers 400. A test pins the 403 on a body the schema accepts (R7), so the endpoint is closed by configuration and its 5-a-minute rule protects nothing. If the test finds the endpoint open, that one rule stays on and the pull request says so. (session-settled: user-directed — chosen over lowering `OAUTH_IP_RULE` to 30: Better Auth's 20 on `/oauth2/token` would still refuse first, in its own words.)
- KTD5. **The two sign-in-link routes share the `sign-in-link` scope**, as the ruling names it. Their ceilings differ (30 reads, 10 sign-ins) and both apply to the one count, so reads spend the sign-ins' ten. Splitting the pair is the owner's call and a one-line change; the pull request's report raises it.
- KTD6. **The journey's address check reads through the same gate as the journeys' other reads.** A 429 or an edge challenge on the discovery read ends the run could-not-run. After this change the api cannot refuse the read, and the edge's rule already counts the journeys' sign-ins in the same group, so the check adds two reads to a count the journeys already spend.
- KTD7. **Better Auth's global rule is off on the `oauth` group's paths.** The staff review kept it as a backstop the api's 60 always meets first. It does not: the installed limiter raises its count on every allowed request and resets only after a full window with none, so 60 calls in one of the api's minutes and 41 in the next are refused by Better Auth at the 101st, in its own words. `customRules` entries of `false` for every path under `/oauth2/`, at either depth the provider mounts, and for `/jwks` make R6 true. The provider's six rules are still switched off at the provider (KTD4), so the ruling's own words hold where a reader looks for them.

### Assumptions

- Better Auth's limiter honours `customRules: { path: false }`, wildcard keys included, for every method. The installed source returns before counting when the matched rule is `false`; AE2 and AE5 prove it or fail.
- A bodyless `POST /oauth2/token` and a parameterless `GET /oauth2/authorize` answer a 4xx that is not 429, which is all AE3 needs.

### Sources

- `.scratch/agents/ba-113-review.md` (machine-local): the staff review, with the RFC and Better Auth references.
- `apps/api/src/ingress/limits.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/mcp/surface.ts`, `apps/api/src/trpc/mount.ts`, `apps/api/src/auth/passkeys.ts`: every count by client address.
- `apps/api/tests/mcp-surface.test.ts`, "spends the one budget its address has on the pages": the existing test that pins today's shared count.
- `docs/solutions/best-practices/a-ceiling-test-on-the-wall-clock-splits-its-count-across-two-windows.md`: a ceiling test stops the clock and counts exactly.
- `better-auth` 1.7.5 as installed, `dist/api/rate-limiter/index.mjs`: the window that slides, and `customRules` matching.
- `@better-auth/oauth-provider` 1.7.5 as installed: the `rateLimit` option's six keys, the `allowDynamicClientRegistration` refusal, the `openid` condition on the OpenID document, the metadata cache header.

---

## Implementation Units

### U1. Count each route group apart

- **Goal:** every count by client address spends a named group's count.
- **Requirements:** R1, R2, AE1, KTD1, KTD5.
- **Dependencies:** none.
- **Files:** `apps/api/src/ingress/limits.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/passkeys.ts`, `apps/api/src/trpc/mount.ts`, `apps/api/src/mcp/surface.ts`, `apps/api/tests/oauth-flow.test.ts`, `apps/api/tests/mcp-surface.test.ts`, `apps/api/tests/limits.test.ts`.
- **Approach:** the edit in `surface.ts` is the no-bearer check's key alone; another branch is changing the rest of that file. The doc comment on `limitByIp` is rewritten, since its premise goes.
- **Execution note:** write the test that fails on today's shared count first and see it fail before changing the limiter. Exhausting a small group does not refuse a larger one today, so the failing direction is the largest group spent first.
- **Patterns to follow:** the stopped clock and `onePast` in `apps/api/tests/oauth-flow.test.ts`, "the limits".
- **Test scenarios:**
  - Covers AE1. One address spends `/consent` past its ceiling and sees the 429. `/oauth2/authorize`, `/mcp` without a bearer and a tRPC query from that address then each answer something other than 429. U2 adds the discovery read.
  - One address spends `/trpc` past its ceiling of 120. `/consent`, the sign-in link's read, `/oauth2/authorize` and `/mcp` without a bearer then each answer something other than 429. This one fails on today's code.
  - The key builder joins the scope and the client key: an IPv6 address keys by its /64 under the scope, and a request naming no address keys as the scope's unknown.
  - The existing test that 29 no-bearer `/mcp` calls leave `/consent` one request is removed: it asserts the defect.
- **Verification:** the second scenario fails before the limiter changes and passes after, and every other ceiling test in the api suite still passes.

### U2. Serve the discovery documents uncounted and cacheable

- **Goal:** no limiter counts a discovery read, and each document says how long it may be kept.
- **Requirements:** R3, R4, R5, AE1, AE2, KTD2, KTD3.
- **Dependencies:** U1.
- **Files:** `apps/api/src/auth/routes.ts`, `apps/api/src/auth/constants.ts`, `apps/api/tests/oauth-flow.test.ts`.
- **Approach:** the `/.well-known/*` limiter goes. Better Auth's `customRules` gain its two `/.well-known/` paths as `false`, with the reason in a comment.
- **Patterns to follow:** the after-handler header on the sign-in link's page in `apps/api/src/auth/routes.ts`.
- **Test scenarios:**
  - Covers AE2. On a stopped clock, 101 reads of each of the three documents from one address all answer 200 with the header. 101 is past Better Auth's 100 as well as the api's former 60.
  - Covers AE1. The address that spent `/consent` in U1's first scenario reads a discovery document and is answered 200.
  - Covers R5. A read of `/.well-known/openid-configuration` as a client answers 404, and as a browser navigates answers without `public, max-age=300`.
- **Verification:** AE2's test fails with either limiter still counting.

### U3. Let the api's limit govern the OAuth paths

- **Goal:** the refusal on `/oauth2/*` and `/jwks` is the api's, at 60 a minute, and no other.
- **Requirements:** R6, R7, R8, AE3, AE4, AE5, KTD4, KTD7.
- **Dependencies:** U1.
- **Files:** `apps/api/src/auth/auth.ts`, `apps/api/src/auth/constants.ts`, `apps/api/tests/oauth-flow.test.ts`.
- **Approach:** the provider's `rateLimit` option turns each of its six rules off, and `customRules` turn Better Auth's count off for `/oauth2/*` and `/jwks`, each with its reason in a comment in words.
- **Test scenarios:**
  - Covers AE3. For `/oauth2/authorize`, `/oauth2/token` (a POST) and `/jwks`, on a stopped clock from one address: none of the first 60 answers 429, and the 61st answers 429 with `error: "too_many_requests"` and a `Retry-After` header. This replaces the test whose predicate counted only the api's refusals and so hid Better Auth's at 31.
  - Covers AE5. After the 61 calls to `/oauth2/token` and to `/jwks`, Better Auth's `rate_limit` table holds no row for either path. One request to every path Better Auth mounts under `/oauth2/` leaves none either, so an upgrade that adds a path is caught.
  - Covers R7. A POST to `/oauth2/register` carrying a body the provider's schema accepts answers 403 with the provider's refusal, and not 429.
  - Covers AE4. The email-code flood's 429 carries `message` and no `error`.
- **Verification:** AE5's test fails with Better Auth's global rule on, and AE3's for `/oauth2/token` fails at request 21 with the provider's rules back on as well. The provider's six switches alone are covered by no test while the `customRules` entries stand.

### U4. Record the rule

- **Goal:** the decision docs and the operations doc say what the code now does.
- **Requirements:** R9.
- **Dependencies:** U1, U2, U3. Same commit as their code.
- **Files:** `docs/solutions/architecture-patterns/adr-0034-one-origin-product-and-authorization-server.md`, `docs/solutions/architecture-patterns/adr-0009-better-auth-in-process-identity-provider.md`, `docs/operations/coolify.md`.
- **Approach:** the one-origin doc gains a bullet on the api's own counters: one count per route group and client address, discovery uncounted and served cacheable, and Better Auth counting no path the api counts. The Better Auth doc gains one line. In `coolify.md` the rate-limiting paragraph says the api's counters are the second line for every group but discovery.
- **Test scenarios:** Test expectation: none -- prose; the words gate and the docs check read it.
- **Verification:** `pnpm check:docs` passes.

### U5. Put the address check back in the release journeys

- **Goal:** a release whose page and published resource differ fails its journeys.
- **Requirements:** R11, KTD6.
- **Dependencies:** U2.
- **Files:** `apps/web/journeys/reads.ts`, `apps/web/journeys/member-journey.ts`.
- **Approach:** an Editor's and a Viewer's Home step reads the protected-resource document through the journeys' refusal gate and expects Ask to show its `resource` exactly.
- **Patterns to follow:** `asked` and `refusedTheRun` in the journeys, and `askShowsTheServedAddress` in `apps/web/e2e/locators.ts`.
- **Test scenarios:** Test expectation: none of its own -- the journeys are the test, and they run against a deployed release. The web workspace's `check` covers their types and any unit test over the journeys' modules.
- **Verification:** the web check passes. If the journeys cannot be run from here, the report says so.

---

## Verification Contract

| Gate | Command | Applies to |
| --- | --- | --- |
| The api's types and tests | `pnpm check:api` | U1, U2, U3 |
| The repository's gates, lint included | `pnpm check:gates` | all |
| Docs and the words gate | `pnpm check:docs` | U4, this plan |
| The web workspace | the web `check` | U5 |

A latency-budget or timeout failure is rerun alone on untouched code before it counts as real.

## Definition of Done

- Every acceptance example has a test that fails without its change.
- The four gates pass on the exact head pushed, rebased on `origin/main`.
- The decision docs changed in the commit that changed the code, and the pull request body says the decision moved.
- R10's issue is filed in Linear Triage, and BA-113 and BA-75 are In Review with the pull request linked.
- No code from an abandoned attempt is left in the diff.
