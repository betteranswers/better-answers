---
title: Log a count's first refusal, and leave Better Auth's limiter the email-code paths alone - Plan
type: fix
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Log a count's first refusal, and leave Better Auth's limiter the email-code paths alone - Plan

## Goal Capsule

- **Objective:** the owner can see in the api's logs when a count by client address refuses, and whether the address was Anthropic's, without the log holding anyone's address. A person, or an office behind one address, is no longer refused a page or a session read by a count that never forgets.
- **Means:** the Postgres door's counter answers its count, so the api logs a window's first refusal only (KTD1, KTD2). Better Auth's limiter keeps the email-code paths, and the api counts Better Auth's other endpoints in a fixed minute, outside the `oauth` group and discovery (KTD4, KTD5).
- **Authority:** the owner's rulings of 10/10/2026 on Linear BA-136 and BA-137, then this plan. The plan of the change this follows is `docs/plans/2026-10-10-1409-fix-ingress-counts-per-route-group-plan.md`.
- **Stop conditions:** stop and tell the lead before writing a migration. Stop and report if the client address cannot be kept out of the logged line.
- **Finishes and ships:** one pull request for both issues, open with its own CI green, `Related to BA-136` and `Fixes BA-137`. The lead queues the merge after the owner has read the per-path table.

---

## Product Contract

### Summary

A count by client address writes one log line when it first refuses in a window, naming the route group and whether the address is in Anthropic's published range. Better Auth's limiter counts only the email-code paths. Every other endpoint Better Auth mounts, outside the `oauth` group and discovery, is counted by the api in a fixed minute under a route group of its own. A page of the application is counted by no limiter. A test holds what Better Auth's limiter does on the paths it keeps, and the decision docs say all of this in the same commit.

### Problem Frame

BA-136's revisit trigger is "the first 429 logged on the `oauth` count from an address in `160.79.104.0/21`". The api logs nothing when a count by address refuses, so the trigger cannot fire. A line per refused request would turn a flood into log volume, and no log line in the api names a client address today.

Better Auth 1.7.5's limiter raises its count on every allowed request and moves its window's start to that request. The count resets only when a request arrives a whole window after the last allowed one. So a rule of "100 in 60 seconds" allows 100 requests in any unbroken run, however slow, and then refuses for a window.

The limiter also runs for every request the api's catch-all hands to Better Auth's handler, whether an endpoint answers it or not, keyed by address and path. A probe on this branch's base showed two results. The application's `/sign-in` page answers Better Auth's 429 on the fourth load in ten seconds from one address, by the library's own rule for `/sign-in*`. Any other page answers it on the 101st load of a run. Each load also writes a `rate_limit` row.

A signed-in person's browser calls `/get-session` on every page load, so an office behind one address reaches 100 in a run within an ordinary morning and is then refused its session read for a minute.

### Key Decisions

- **The line carries the route group and whether the address is in Anthropic's range, and no client address.** (session-settled: user-directed — chosen over logging the client address, or the group alone: the group and the range are enough for the trigger and keep a person's address out of the logs.) Governs R1, R2.
- **The api's own fixed-minute count governs a path where the api can count it, and Better Auth's limiter keeps the email-code paths.** (session-settled: user-directed — chosen over raising Better Auth's rules or accepting them: this is the rule the owner set for the OAuth paths, applied as the default per path, and the owner may change a row of the report's table.) Governs R5, R6, R7.

### Requirements

**The refusal's log line**

- R1. A count by client address writes one log line when it first refuses a route group and address in a window. Every later refusal of that group and address in that window writes none.
- R2. The line carries the route group's name and whether the address is in `160.79.104.0/21`. No client address reaches the logger, a test's snapshot or an error message.
- R3. Every count by client address writes the line the same way, the MCP surface's no-bearer check included.

**Better Auth's limiter**

- R4. A test holds what the installed limiter does on a path it keeps: requests under the rule's stated rate, with no window's pause between any two, are refused once the count reaches the rule's max.
- R5. Better Auth's limiter counts only the email-code endpoints: each one it mounts under `/email-otp/` and `/forget-password/`, and `/sign-in/email-otp`. The three the api names rules for keep those rules, and the rest keep the library's own.
- R6. Every other endpoint Better Auth mounts, outside the `oauth` group and discovery, is counted by the api per client address in a fixed minute, under the route group `identity`, at 120 a minute.
- R7. A request to a path Better Auth does not mount, which the api answers with the application's page, is counted by no limiter. A mounted path that Better Auth has closed is still counted under `identity`.
- R8. Each path Better Auth mounts is counted by exactly one counter: Better Auth's limiter, or one route group of the api. A discovery document is counted by neither.

**Record**

- R9. The decision doc on one origin, the decision doc on Better Auth and `docs/operations/coolify.md` say what the code now does, in the same commit as the code.
- R10. The build's report opens with the per-path table, and says what newer Better Auth releases changed and what is already reported upstream.

### Acceptance Examples

- AE1. **Covers R1, R3.** Given one address sends a route group one request past its ceiling, then the logs hold one line for it. After ten more refused requests in the same window they still hold one. After the first refusal of the next window they hold two. The same holds for `/mcp` without a bearer.
- AE2. **Covers R2.** Given a flood from `160.79.104.1`, the line says the address is in the range. Given one from `160.79.112.1`, the line says it is not. No captured log line contains either address.
- AE3. **Covers R4.** Given one address posts to `/sign-in/email-otp` ten times, nine minutes apart, then all ten are answered by the endpoint. The eleventh, nine minutes later, answers 429 with Better Auth's `{ message }` and `X-Retry-After`.
- AE4. **Covers R6.** Given one address reads `/get-session` 110 times in one of the api's minutes and 110 in the next, then none is refused. The 121st read in one minute answers 429 with `error: "too_many_requests"` and `Retry-After`.
- AE5. **Covers R7.** Given one address loads `/sign-in` five times in a row, then none answers 429 and Better Auth holds no count for it.
- AE6. **Covers R5, R8.** Given one request to each path Better Auth mounts, each from an address of its own, then each email-code path has a count in Better Auth and none in the api, each discovery path has neither, and every other path has a count in the api and none in Better Auth.

### Scope Boundaries

- BA-136's third criterion is not built: whether `/oauth2/token` and `/mcp` count only refused requests waits on the trigger firing.
- No existing ceiling's number changes. The one new number is the `identity` group's 120.
- The email-code paths keep Better Auth's count, run-not-window included. Five sends from one office address with no ten-minute pause between any two still refuse the sixth. The report's table says so, for the owner to change.
- Nothing is posted outside this repository and Linear. The report carries any text for the owner to file upstream.
- No upgrade of Better Auth. Releases 1.7.6 and 1.7.7 do not change the limiter's window.
- Considered and not built: a count of the application's pages by the api. A page is a constant, like an asset or a discovery document, and Cloudflare's rules sit ahead of it. What would change the call: a flood of page loads that reaches the api and costs it more than the file read.
- Considered and not built: more fields on the log line, such as the ceiling or the wait. The ruling names two fields, and both others are read off the group's rule.

#### Deferred to Follow-Up Work

- Counting only refused requests on `/oauth2/token` and `/mcp`: BA-136, once its trigger fires.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The counter's outcome carries the window's count.** `consumeIngress` already reads the count back from its upsert and keeps only allowed or not. The outcome gains the count, so a caller can tell the window's first refusal: the request whose count is one past the rule's max. The upsert is one statement on one row, so exactly one request in a window sees that count. No table changes.
- KTD2. **One function counts by client address, and it writes the line.** `limitByIp` and the MCP surface's no-bearer check both call it, so R3 holds by construction. It takes the logger, which `limitByIp`'s callers already hold.
- KTD3. **In the range or not is decided from the keyed address, before the logger is called.** `clientIpOf` already folds an IPv4-mapped address to its IPv4, and answers a `/64` for IPv6 and `unknown` for a request naming none. Only an IPv4 key is checked against the range, with `node:net`'s `BlockList`, which answers false for anything that is no address. The logger receives the group and a boolean.
- KTD4. **Better Auth's custom rules end with one that switches the limiter off for every path, behind entries that keep the email-code paths.** The installed limiter takes the first custom rule whose key matches, in the order the keys were written, and `false` skips the count. The three paths with rules of the api's own come first, then each other email-code endpoint by its exact path with a rule that answers the library's own, then `/**` as `false`. A prefix would keep the limiter counting paths under it that no endpoint answers. The entries for `/oauth2/*`, `/jwks`, the two discovery paths and `/sign-in/link` go, since the last rule covers them.
- KTD5. **The `identity` group is registered from Better Auth's own endpoint list.** `mountedPaths` reads the list off the built instance, so an endpoint a plugin adds on an upgrade is counted without an edit. The group takes every mounted path except the email-code paths, the `oauth` group's and discovery's. The paths Better Auth keeps are read off the custom rules themselves, and AE6's test fails if a mounted email-code path is left out of them.
- KTD6. **The `identity` ceiling is 120 a minute, tRPC's.** A page load reads `/get-session` once beside its tRPC calls, so a lower ceiling would refuse the session read of an office that tRPC's own ceiling still serves.
- KTD7. **The test of Better Auth's own count fakes the date and nothing else, in a file of its own.** The limiter reads `Date.now()`, not the api's clock, so the api's stoppable clock cannot move it. Faking only `Date` leaves the Postgres client's timers real, and a file of its own keeps the moved date away from the OAuth suite's token lifetimes.
- KTD8. **The line is logged at `info` as `ingress.address_ceiling_met`.** A ceiling met is the limiter working, as `trpc.throttled` is, not a fault. The name sits beside `ingress.hostname_refused`.

### Assumptions

- `/**` matches every path under Better Auth's wildcard matcher. Its source builds a pattern that does, and AE5 and AE6 prove it or fail.
- A custom rule written as a function that answers the rule it was handed leaves the library's own rule in force. The installed source reads it so, and a test refuses the fourth try in a minute on one such path.
- A request to a mounted path with a `:name` segment is matched by the api's router when the segment is any value.
- The browser suite gives each test's browser an address of its own, so a shared count of 120 a minute per address is not met by the suite. The web check proves it or fails.

### Risks

- Switching Better Auth's limiter off on a path that guards a credential would weaken it. The paths that take or send a code keep the limiter (R5). The password, sign-up and social paths are refused by configuration, and the `identity` count still bounds them.
- The release journeys run from one address. Their page loads no longer spend any count, and their session reads spend the `identity` group's 120 a minute, which the journeys' handful of reads do not approach.
- One count per address covers every `identity` path, where Better Auth counted each path apart. One client behind an office's address can spend the office's session reads for the rest of a minute. That follows from counting by address, as tRPC's count already does, and the report's table says so.
- The social sign-in paths are closed today and open for Microsoft in a task of their own. That task decides their ceiling, since the library's rule for `/sign-in*` no longer applies to them.

### Sources

- `better-auth` 1.7.5 as installed, `dist/api/rate-limiter/index.mjs`: the database storage's `consume`, the order custom rules resolve in, and the default rule for `/sign-in*`. `dist/api/index.mjs`: the limiter runs in the router's `onRequest`, before any endpoint is matched. `dist/utils/wildcard.mjs`: what `*` and `**` match.
- `better-auth` 1.7.6 and 1.7.7 tarballs, read on 10/10/2026: the window's logic is unchanged. Upstream issue 11660 reports the count and pull request 11671 proposes a fix, both open.
- `apps/api/src/ingress/limits.ts`, `apps/api/src/mcp/surface.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/passkeys.ts`, `apps/api/src/trpc/mount.ts`: every count by client address.
- `apps/api/src/auth/endpoints.ts`: `mountedPaths`.
- `apps/web/src/features/auth/auth-hooks.ts`: the Better Auth paths the browser calls.
- `docs/solutions/best-practices/a-ceiling-test-on-the-wall-clock-splits-its-count-across-two-windows.md`: a ceiling test stops the clock and counts exactly.
- `docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md`: the limiter lives in the router.

---

## Implementation Units

### U1. Answer the window's count from the Postgres door

- **Goal:** a caller of the counter can tell a window's first refusal from a later one.
- **Requirements:** R1, KTD1.
- **Dependencies:** none.
- **Files:** `packages/core/src/store/postgres/index.ts`, `packages/core/test/identity-housekeeping.test.ts` or the core test that already counts through `consumeIngress`.
- **Approach:** the outcome type gains the count. Every counter built on the same helper answers it too.
- **Test scenarios:**
  - Three attempts against a rule of two answer counts of one, two and three, with the third not allowed.
  - The first attempt of the next window answers a count of one.
- **Verification:** the core check passes, and the first scenario fails with the count left off the outcome.

### U2. Log a count's first refusal in a window

- **Goal:** one line per route group, address and window, carrying the group and whether the address is Anthropic's.
- **Requirements:** R1, R2, R3, AE1, AE2, KTD2, KTD3, KTD8.
- **Dependencies:** U1.
- **Files:** `apps/api/src/ingress/limits.ts`, `apps/api/src/mcp/surface.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/passkeys.ts`, `apps/api/src/trpc/mount.ts`, `apps/api/tests/limits.test.ts`, `apps/api/tests/oauth-flow.test.ts`.
- **Approach:** the range is a constant beside the client-address header's name. The surface keeps its own refusal words and takes the outcome from the shared function.
- **Patterns to follow:** `auth.consent_failed` in `apps/api/src/auth/routes.ts` for the logger call, and the harness's captured logs (`app.logs`) for reading a line.
- **Test scenarios:**
  - Covers AE1. One address sends `/consent` one request past its ceiling on a stopped clock: one line, with the group `consent`. Ten more refused requests: still one line. The clock moves to the next window and the address is refused again: two lines.
  - Covers AE1. The same count of lines for `/mcp` without a bearer, with the group `mcp`.
  - Covers AE2. A flood from `160.79.104.1` logs the range as true, and one from `160.79.112.1` logs it as false.
  - Covers AE2. The whole captured log, serialised, contains neither address, and the line's keys are the logger's own plus the event, the group and the range.
  - An address at each edge of the range answers true (`160.79.104.0`, `160.79.111.255`), and the address either side answers false. A `/64` key and `unknown` answer false.
  - An address under its ceiling logs nothing.
- **Verification:** the line-count scenario fails when the line is written on every refusal, and the no-address scenario fails when the key is added to the line.

### U3. Leave Better Auth's limiter the email-code paths, and count its other endpoints in the api

- **Goal:** a session read, a workspace pick and a sign-out are refused only at a rate the api states, in the api's words, and a page is refused by no limiter.
- **Requirements:** R5, R6, R7, R8, AE4, AE5, AE6, KTD4, KTD5, KTD6.
- **Dependencies:** U2, for the logger parameter on `limitByIp`.
- **Files:** `apps/api/src/auth/constants.ts`, `apps/api/src/auth/auth.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/ingress/limits.ts`, `apps/api/tests/oauth-flow.test.ts`.
- **Approach:** the comment on the custom rules says in words why their order matters and why the last one is there. The `identity` row joins the suite's table of counts, which the scope union already forces.
- **Execution note:** write AE4's and AE5's tests first and see them refused by Better Auth before the rules change.
- **Patterns to follow:** `counts $name apart from every other`, `leaves Better Auth no count where the api counts` and `countedByBetterAuth` in `apps/api/tests/oauth-flow.test.ts`.
- **Test scenarios:**
  - Covers AE4. `/get-session` 110 times on a stopped clock, the clock moved a minute, 110 more: none is 429. Then eleven more in that minute: the last is 429 with `too_many_requests` and `Retry-After`.
  - Covers AE5. Five loads of `/sign-in` and 101 of another page path from one address: none is 429, and Better Auth holds no count for the address.
  - Covers AE6. One request to each mounted path, each from an address of its own. The email-code paths have a Better Auth count and no count by address in the api, discovery has neither, and every other path has a count by address in the api and none in Better Auth.
  - The `identity` group counts apart from every other group, by its row in the table of counts.
  - The existing email-code flood test still answers Better Auth's words.
- **Verification:** AE4's and AE5's tests fail with the last custom rule removed, and AE6's fails with either the `identity` registration or the email-code entries removed.

### U4. Hold what Better Auth's limiter does where it stays

- **Goal:** the run-not-window count is a tested fact, so an upgrade that fixes it turns a test red.
- **Requirements:** R4, AE3, KTD7.
- **Dependencies:** U3, so the test runs on the rules that ship.
- **Files:** `apps/api/tests/better-auth-limiter.test.ts`.
- **Approach:** the test's opening comment says the count it holds is the library's defect, names the upstream issue in words, and says the test is to be turned round when an upgrade fixes it.
- **Test scenarios:**
  - Covers AE3. Ten posts to `/sign-in/email-otp` nine minutes apart are each answered by the endpoint, and the eleventh is 429 with `{ message }` and `X-Retry-After`.
  - A control: the same ten posts, then a pause of ten minutes, and the next post is answered.
- **Verification:** the first scenario fails when the posts are eleven minutes apart, which is how the test is seen to hold the run and not a window.

### U5. Record the rule

- **Goal:** the decision docs and the operations doc say what the code now does.
- **Requirements:** R9.
- **Dependencies:** U2, U3. Same commit as their code.
- **Files:** `docs/solutions/architecture-patterns/adr-0034-one-origin-product-and-authorization-server.md`, `docs/solutions/architecture-patterns/adr-0009-better-auth-in-process-identity-provider.md`, `docs/operations/coolify.md`.
- **Approach:** the one-origin doc's bullets on counts gain the `identity` group, the uncounted pages, the limiter left to the email-code paths and the log line. The Better Auth doc's line on its limiter is rewritten. `coolify.md` says where BA-136's trigger now shows.
- **Test scenarios:** Test expectation: none -- prose; the words gate and the docs check read it.
- **Verification:** `pnpm check:docs` passes.

---

## Verification Contract

| Gate | Command | Applies to |
| --- | --- | --- |
| Core's types and tests | the core workspace's `check` | U1 |
| The api's types and tests | `pnpm check:api` | U2, U3, U4 |
| The repository's gates, lint included | `pnpm check:gates` | all |
| Docs and the words gate | `pnpm check:docs` | U5, this plan |
| The web workspace | `pnpm check:web` | U3: every page reads `/get-session` |

A latency-budget or timeout failure is rerun alone on untouched code before it counts as real.

## Definition of Done

- Every acceptance example has a test, and each new or changed test was seen to fail with its change removed.
- The five gates pass on the exact head pushed, rebased on `origin/main`.
- The decision docs changed in the commit that changed the code, and the pull request body says the decision moved.
- The report opens with the per-path table and carries the upstream finding.
- BA-137 is In Review with the pull request linked, and BA-136 has a comment saying which criteria the pull request meets.
- No code from an abandoned attempt is left in the diff.
