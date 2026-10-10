---
title: Log a count's first refusal, and count every Better Auth endpoint in the api - Plan
type: fix
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Log a count's first refusal, and count every Better Auth endpoint in the api - Plan

## Goal Capsule

- **Objective:** the owner can see in the api's logs when a count by client address refuses, and whether the address was Anthropic's, without the log holding anyone's address. A person, or an office behind one address, is no longer refused a page or a session read by a count that never forgets.
- **Means:** the Postgres door's counter answers its count, so the api logs a window's first refusal only (KTD1, KTD2). Better Auth's limiter is off, and the api counts every endpoint Better Auth mounts in a fixed window, outside discovery (KTD4, KTD5).
- **Authority:** the owner's rulings of 10/10/2026 on Linear BA-136 and BA-137, the second of which on BA-137 moved the email-code paths to the api's count, then this plan. The plan of the change this follows is `docs/plans/2026-10-10-1409-fix-ingress-counts-per-route-group-plan.md`.
- **Stop conditions:** stop and tell the lead before writing a migration. Stop and report if the client address cannot be kept out of the logged line.
- **Finishes and ships:** one pull request for both issues, open with its own CI green, `Related to BA-136` and `Fixes BA-137`. The lead queues the merge after the owner has read the per-path table.

---

## Product Contract

### Summary

A count by client address writes one log line when it first refuses in a window, naming the route group and whether the address is in Anthropic's published range. Better Auth's limiter is off. A code's send and a sign-in by code are counted by the api in a fixed ten minutes, at the numbers they had, each under a route group of its own. Better Auth's other endpoints, outside the `oauth` group and discovery, are counted in a fixed minute under one more. A page of the application is counted by no limiter. The decision docs say all of this in the same commit.

### Problem Frame

BA-136's revisit trigger is "the first 429 logged on the `oauth` count from an address in `160.79.104.0/21`". The api logs nothing when a count by address refuses, so the trigger cannot fire. A line per refused request would turn a flood into log volume, and no log line in the api names a client address today.

Better Auth 1.7.5's limiter raises its count on every allowed request and moves its window's start to that request. The count resets only when a request arrives a whole window after the last allowed one. So a rule of "100 in 60 seconds" allows 100 requests in any unbroken run, however slow, and then refuses for a window.

The limiter also runs for every request the api's catch-all hands to Better Auth's handler, whether an endpoint answers it or not, keyed by address and path. A probe on this branch's base showed two results. The application's `/sign-in` page answers Better Auth's 429 on the fourth load in ten seconds from one address, by the library's own rule for `/sign-in*`. Any other page answers it on the 101st load of a run. Each load also writes a `rate_limit` row.

A signed-in person's browser calls `/get-session` on every page load, so an office behind one address reaches 100 in a run within an ordinary morning and is then refused its session read for a minute.

### Key Decisions

- **The line carries the route group and whether the address is in Anthropic's range, and no client address.** (session-settled: user-directed — chosen over logging the client address, or the group alone: the group and the range are enough for the trigger and keep a person's address out of the logs.) Governs R1, R2.
- **The api's own fixed-window count governs every path, the email-code paths among them, and Better Auth's limiter governs none.** (session-settled: user-directed — chosen over leaving the email-code paths to Better Auth's limiter, as the owner first ruled: five sends from one office with no ten-minute pause between any two refused the sixth.) Governs R5, R6, R7.

### Requirements

**The refusal's log line**

- R1. A count by client address writes one log line when it first refuses a route group and address in a window. Every later refusal of that group and address in that window writes none.
- R2. The line carries the route group's name and whether the address is in `160.79.104.0/21`. No client address reaches the logger, a test's snapshot or an error message.
- R3. Every count by client address writes the line the same way, the MCP surface's no-bearer check included.

**Better Auth's limiter**

- R5. Better Auth's limiter counts no path. A code's send counts 5 in ten minutes by client address, behind the count for each email, and a sign-in by code counts 10 in ten minutes, by the form and by the link alike. Each has a route group of its own, and each window is fixed. The email-code endpoints no browser calls spend the send's count.
- R6. Every other endpoint Better Auth mounts, outside the `oauth` group and discovery, is counted by the api per client address in a fixed minute, under the route group `identity`, at 120 a minute.
- R7. A request to a path Better Auth does not mount, which the api answers with the application's page, is counted by no limiter. A mounted path that Better Auth has closed is still counted under `identity`.
- R8. Each path Better Auth mounts is counted by exactly one route group of the api, and a discovery document by none. A test fails when an upgrade mounts an email-code endpoint nobody has named.
- R11. A request that a page on another site can make a person's browser send, by any method, spends nothing from the send's count or the sign-in's. A post from the product's own origin still counts.

**Record**

- R9. The decision doc on one origin, the decision doc on Better Auth and `docs/operations/coolify.md` say what the code now does, in the same commit as the code.
- R10. The build's report opens with the per-path table, and says what newer Better Auth releases changed and what is already reported upstream.

### Acceptance Examples

- AE1. **Covers R1, R3.** Given one address sends a route group one request past its ceiling, then the logs hold one line for it. After ten more refused requests in the same window they still hold one. After the first refusal of the next window they hold two. The same holds for `/mcp` without a bearer.
- AE2. **Covers R2.** Given a flood from `160.79.104.1`, the line says the address is in the range. Given one from `160.79.112.1`, the line says it is not. No captured log line contains either address.
- AE4. **Covers R6.** Given one address reads `/get-session` 110 times in one of the api's minutes and 110 in the next, then none is refused. The 121st read in one minute answers 429 with `error: "too_many_requests"` and `Retry-After`.
- AE5. **Covers R7.** Given one address loads `/sign-in` five times in a row, then none answers 429 and no limiter holds a count for it.
- AE6. **Covers R5, R8.** Given one request to each path Better Auth mounts, each from an address of its own, then the sign-in by code has a count in its own group, every other email-code path in the send's, each discovery path in none, and Better Auth's table holds no row.
- AE7. **Covers R5.** Given one address asks for six codes three minutes apart, each for another email, then all six are answered. Given it asks for six in one window, the sixth answers 429 with `error: "too_many_requests"` and `Retry-After`.
- AE8. **Covers R5.** Given one address has tried ten codes at the form in one window, then its sign-in by a good link answers 429.
- AE9. **Covers R11.** Given another site's page has an address ask an email-code endpoint eleven times with a GET and eleven times with a post, then the api holds no count for the address. Its own page's five sends are then answered and the sixth refused.

### Scope Boundaries

- BA-136's third criterion is not built: whether `/oauth2/token` and `/mcp` count only refused requests waits on the trigger firing.
- No existing ceiling's number changes. The one new number is the `identity` group's 120.
- The email-code paths keep their numbers: 5 sends and 10 sign-ins in ten minutes for an address. Only the window changes, from a run to a fixed one.
- Considered and not kept: a test of Better Auth's own count. It was written while the limiter still kept the email-code paths and passed, with only the date faked: ten tries nine minutes apart were answered and the eleventh refused. BA-137's first criterion rests on that run. With the limiter off the api relies on nothing the test would hold.
- The `rate_limit` table stays, unused. Dropping it is a migration, which runs alone.
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
- KTD4. **Better Auth's limiter is switched off whole.** Every endpoint it mounts has a count in the api, so no rule of the library's is left to write, and one switch says so where a reader looks.
- KTD5. **Each count for a Better Auth endpoint is registered from its own endpoint list.** `mountedPaths` reads the list off the built instance, so an endpoint a plugin adds on an upgrade is counted without an edit. The sign-in by code takes its own group, every other endpoint under `/email-otp/` or `/forget-password/` takes the send's, and the rest take `identity`. The `oauth` group's own lines count its paths, and discovery takes none. The registration sits after the count by email, so that count refuses a send first.
- KTD6. **The `identity` ceiling is 120 a minute, tRPC's.** A page load reads `/get-session` once beside its tRPC calls, so a lower ceiling would refuse the session read of an office that tRPC's own ceiling still serves.
- KTD8. **The line is logged at `info` as `ingress.address_ceiling_met`.** A ceiling met is the limiter working, as `trpc.throttled` is, not a fault. The name sits beside `ingress.hostname_refused`.
- KTD9. **A sign-in by link spends the sign-in by code's count before it calls the library.** The link's route calls the library's sign-in itself, past the api's router, so the route counts it. Under Better Auth the form and the link spent one count for an address, and the refusal keeps the words it had.
- KTD11. **The two email-code counts sit behind the same-origin fence and count a post alone.** The fence already stood on the send. It now stands on every email-code endpoint, so a post from another site is refused before it is counted and never reaches the library. A GET is what an image or a link sends, and no email-code endpoint answers one, so it passes uncounted to the library's not-found. (session-settled: user-directed — chosen over leaving it as it was under Better Auth, whose limiter was spendable the same way: the count is now the api's own, and five asks from another site would cost an office its codes for a window.)
- KTD10. **The email-code endpoints no browser calls share the send's count.** It is the tighter of the two, they send or take the same codes, and a group for endpoints nobody uses would be a third number to keep.

### Assumptions

- With its limiter disabled the library counts nothing and writes no row. AE6's test reads its table empty.
- A request to a mounted path with a `:name` segment is matched by the api's router when the segment is any value.
- The browser suite gives each test's browser an address of its own, so a shared count of 120 a minute per address is not met by the suite. The web check proves it or fails.

### Risks

- Switching Better Auth's limiter off on a path that guards a credential would weaken it. The paths that take or send a code keep their numbers under the api's count, or a tighter one (R5, KTD10). The password, sign-up and social paths are refused by configuration, and the `identity` count still bounds them.
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

### U3. Switch Better Auth's limiter off, and count its endpoints in the api

- **Goal:** a session read, a workspace pick and a sign-out are refused only at a rate the api states, in the api's words, and a page is refused by no limiter.
- **Requirements:** R6, R7, R8, AE4, AE5, AE6, KTD4, KTD5, KTD6.
- **Dependencies:** U2, for the logger parameter on `limitByIp`.
- **Files:** `apps/api/src/auth/constants.ts`, `apps/api/src/auth/auth.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/ingress/limits.ts`, `apps/api/tests/oauth-flow.test.ts`.
- **Approach:** the comment on the switch says in words why the library's count is not kept. The `identity` row joins the suite's table of counts, which the scope union already forces.
- **Execution note:** write AE4's and AE5's tests first and see them refused by Better Auth before the limiter goes.
- **Patterns to follow:** `counts $name apart from every other` and `countedByBetterAuth` in `apps/api/tests/oauth-flow.test.ts`.
- **Test scenarios:**
  - Covers AE4. `/get-session` 110 times on a stopped clock, the clock moved a minute, 120 more: none is 429. The next in that minute is 429 with `too_many_requests` and `Retry-After`.
  - Covers AE5. Five loads of `/sign-in`, 101 of another page path and one of a path under each email-code prefix that no endpoint answers, from one address: none is 429, and no limiter holds a count for the address.
  - Covers AE6. One request to each mounted path, each from an address of its own, and each has the one count R8 names. Better Auth's table holds no row afterwards.
  - A spelling of a counted path that the api's router does not match, such as a trailing slash, reaches no endpoint.
  - The `identity` group counts apart from every other group, by its row in the table of counts.
- **Verification:** AE4's and AE5's tests fail with the limiter on, and AE6's fails with the `identity` registration removed or with an email-code endpoint left off the test's list.

### U6. Count the email-code endpoints in the api

- **Goal:** an office behind one address is refused a code only for more than the rule's count in one fixed window.
- **Requirements:** R5, R8, R11, AE6, AE7, AE8, AE9, KTD5, KTD9, KTD10, KTD11.
- **Dependencies:** U3.
- **Files:** `apps/api/src/auth/constants.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/ingress/limits.ts`, `apps/api/tests/oauth-flow.test.ts`, `apps/api/tests/sign-in-link.test.ts`.
- **Approach:** the two groups join the suite's table of counts, each with its ten-minute window, so the tests that count apart and that read the logged line cover them.
- **Patterns to follow:** the stopped and moved clock in `apps/api/tests/suite-app.ts`.
- **Test scenarios:**
  - Covers AE7. Six codes asked from one address three minutes apart on a moved clock, each for another email: all six answer 200.
  - Covers AE7. Six codes asked from one address on a stopped clock: five answer 200 and the sixth is the api's 429, with no count held by Better Auth. This replaces the test that expected Better Auth's words.
  - Covers AE8. Ten wrong codes tried at the form from the address that asked for a link, then a sign-in by that link: 429 with the words a refused sign-in by link already had.
  - The two groups count apart from every other, and each logs its first refusal in a window once.
  - Covers AE9. For each of the nine email-code endpoints: eleven GETs and eleven posts as another site sends them answer 404 and 403, and the address has no count. After such a flood of the send and of the sign-in, the address's own five sends are answered and its sixth refused, and its ten tries are answered and its eleventh refused.
- **Verification:** AE7's first scenario fails with the two paths put back on Better Auth's limiter, where the sixth is refused. AE8's fails with the link's count removed. AE9's fails with every method counted, and again with the fence left on the send alone.

### U5. Record the rule

- **Goal:** the decision docs and the operations doc say what the code now does.
- **Requirements:** R9.
- **Dependencies:** U2, U3, U6. Same commit as their code.
- **Files:** `docs/solutions/architecture-patterns/adr-0034-one-origin-product-and-authorization-server.md`, `docs/solutions/architecture-patterns/adr-0009-better-auth-in-process-identity-provider.md`, `docs/operations/coolify.md`, `.claude/skills/browser-suite/SKILL.md`.
- **Approach:** the one-origin doc's bullets on counts gain the `identity` group, the two email-code groups, the uncounted pages, the limiter switched off and the log line. The Better Auth doc's line on its limiter is rewritten. `coolify.md` says where BA-136's trigger now shows. The browser suite's skill names the limiter in its list of ceilings, so that list changes with it.
- **Test scenarios:** Test expectation: none -- prose; the words gate and the docs check read it.
- **Verification:** `pnpm check:docs` passes.

---

## Verification Contract

| Gate | Command | Applies to |
| --- | --- | --- |
| Core's types and tests | the core workspace's `check` | U1 |
| The api's types and tests | `pnpm check:api` | U2, U3, U6 |
| The repository's gates, lint included | `pnpm check:gates` | all |
| Docs and the words gate | `pnpm check:docs` | U5, this plan |
| The web workspace | `pnpm check:web` | U3 and U6: every page reads `/get-session`, and the sign-in specs ask for codes |

A latency-budget or timeout failure is rerun alone on untouched code before it counts as real.

## Definition of Done

- Every acceptance example has a test, and each new or changed test was seen to fail with its change removed.
- The five gates pass on the exact head pushed, rebased on `origin/main`.
- The decision docs changed in the commit that changed the code, and the pull request body says the decision moved.
- The report opens with the per-path table and carries the upstream finding.
- BA-137 is In Review with the pull request linked, and BA-136 has a comment saying which criteria the pull request meets.
- No code from an abandoned attempt is left in the diff.
