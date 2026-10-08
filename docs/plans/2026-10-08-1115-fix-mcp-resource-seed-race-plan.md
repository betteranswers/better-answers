---
title: MCP Resource Seed Race - Plan
type: fix
date: 2026-10-08
topic: mcp-resource-seed-race
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# MCP Resource Seed Race - Plan

## Goal Capsule

- **Objective:** two api processes that start together over a fresh database both come up healthy, so neither answers `/health` with 503 until someone restarts it.
- **Means:** the api's Better Auth adapter hands an insert that breaks a unique constraint back as the store's own error, not Drizzle's wrapper, so the oauth-provider plugin recognises the other process's insert and carries on (KTD1, KTD2).
- **Product authority:** the owner, through Linear BA-70.
- **Open blockers:** none.
- **Stop conditions:** stop and report if the U1 test passes before the adapter change, because then it does not reproduce the race; or if any api suite moves that does not itself provoke a unique violation on an insert, because then the change reaches past the cases KTD1 names.
- **Execution profile:** Lightweight. One unit in one pull request, `Fixes BA-70`. No migration and no `contracts/` edit.
- **Finishes and ships:** `/ce-work`, then `/ce-code-review` and `ce-commit-push-pr`.

## Product Contract

### Summary

The api wraps `drizzleAdapter` so that an insert that breaks a unique constraint rejects with the store's own error. The oauth-provider plugin then reads `duplicate key value violates unique constraint` in the message, as it expects, and treats the loser of a concurrent seed as a no-op. A new health test holds two servers' seed inserts behind a table lock until both wait, then checks that both start healthy.

The same change brings three other plugin branches to life, each as its authors meant: a duplicate admin resource create answers 400 rather than 500, a duplicate link between an assistant and a resource answers `alreadyLinked`, and a CIMD registration of an assistant that collides with a concurrent one reads the other row back and retries rather than failing. No api test provokes any of the three.

### Problem Frame

At init, `@better-auth/oauth-provider` 1.7.5 seeds the MCP resource row (`seedResources`, `dist/introspect-*.mjs:805-870`). It looks the row up and inserts it when it is missing. If two processes both find it missing, both insert. One wins and the other gets a unique violation. The plugin is meant to skip that case, but it only checks whether `err.message` matches `/unique|duplicate|UNIQUE/i` (`:848`).

Drizzle 0.45 wraps every failed query in a `DrizzleQueryError` (`drizzle-orm/errors.js:10-20`). Its message is `Failed query: <sql>\nparams: <values>`, and the pg error sits on `cause`. So the pattern never matches and the plugin rethrows. The init rejects, `auth.$context` rejects (`apps/api/src/server.ts:64-73`), identity reads `failed`, and `/health` answers 503 for the life of the process.

Only `apps/api/src/server.ts` builds Better Auth outside the tests. Production and staging each hold one api container, and `pnpm ops` builds no auth instance. So the race needs two api processes over a fresh database, or a new `mcpUrl`. No release so far has met it. #612 found it through the test harness and fixed only the harness.

### Requirements

- R1. Two api processes that both find the MCP resource row missing and both insert it come up with `identity: "ready"` and `/health` 200.
- R2. An unmigrated database still fails the identity init, so `/health` still answers 503 with `identity: "failed"`.
- R3. Better Auth's schema check and its transactions still see the adapter they saw before, and every path that hits no unique violation behaves as it did.

### Scope Boundaries

- No patch to `@better-auth/oauth-provider`. A `pnpm patch` that also reads `err.cause` would have to be re-applied on every bump. The adapter edge fixes the same sites without one.
- No upstream issue or pull request on better-auth. Filing one is outward-facing and the owner's call, so it is named as follow-up.
- Reads, updates and other refusals are not changed. Their errors keep Drizzle's wrapper, because no code reads them for a unique violation (KTD3).
- No new retry of a failed identity init.

#### Deferred to Follow-Up Work

- An upstream report that `seedResources`, the admin resource create and the link between an assistant and a resource read only `err.message` for a unique violation, which misses Drizzle's wrapped errors.

### Sources / Research

- The plugin at `apps/api/node_modules/@better-auth/oauth-provider/dist/`, version 1.7.5: `introspect-*.mjs:757` (`MISSING_TABLE_PATTERN`), `:805-870` (`seedResources`, the message match at `:848`), `authorize-*.mjs:4407` (the seed runs in plugin `init`), and two more message matches on `create` at `authorize-*.mjs:3181` and `:3329`. `isUniqueConstraintError` (`authorize-*.mjs:2151-2165`) reads `code` and `message` too, and never `cause`.
- The adapter at `@better-auth/drizzle-adapter` 1.7.5 `dist/index.mjs:569-576`: the factory registers a schema check keyed on the instance it returns.
- `@better-auth/core` 1.7.5: `db/schema-check.mjs:10-27` (a `WeakMap` keyed on the adapter instance), `db/adapter/factory.mjs:18,416-417` (with no `transaction` option, a transaction calls back with the same instance), and `:424-847` (the instance's methods).
- #612's body: the chain and the evidence from the harness.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Fix at the adapter edge, not in the plugin.** The plugin's guard is right for an unwrapped driver error. What breaks it is Drizzle's wrapper. If the adapter hands back the store's own error, the seed, the plugin's other two message matches and its CIMD collision check (`isUniqueConstraintError`) all work as written, and there is no patch to re-apply on a bump. All four read the error of a `create`.
- KTD2. **Patch the instance in place.** `database:` takes a function of Better Auth's options. It calls `drizzleAdapter(db, …)`'s factory, then replaces `create` on the instance it got back, and returns that same object. A new object or a Proxy would lose the schema check keyed on the instance (R3). Transactions need no extra handling, because with no `transaction` option the factory calls back with that same instance.
- KTD3. **`create` only.** Every plugin site that tests for a unique violation tests the error of a `create`; the seed's `update` and the plugin's other writes sit outside any such test. A read must stay wrapped in any case, because `seedResources` checks a failed lookup against `MISSING_TABLE_PATTERN` and would quietly defer on an unmigrated database if it saw the pg message. That would break R2. Widening to other writes later is a local change.
- KTD4. **The rule: an insert that breaks a unique constraint rejects with the store's error.** When the rejection's `cause` is pg's `DatabaseError` with SQLSTATE `23505`, the wrapper rethrows the `cause`. Anything else passes through unchanged. This works for the seed's message match and for `isUniqueConstraintError` (which reads `code`). It also leaves Drizzle's `params:` tail, which can hold row values, out of that log line.
- KTD5. **The regression test is deterministic.** A superuser transaction holds `LOCK TABLE oauth_resource IN SHARE MODE`, which lets each server's lookup through and holds back its insert. The test waits until `pg_locks` shows both inserts waiting, then commits. Without that wait it would only prove that two sequential seeds work.

### Assumptions

- No api code reads a `DrizzleQueryError` that came back from a Better Auth write. A repo search for `DrizzleQueryError`, `.query`/`.params` on caught errors, and `23505` finds none.
- A future adapter that sets `transaction: true` would call back with a new instance, which this wrapper would not reach. The api does not set it today, and the U1 test only covers the plugin's init path, which never runs in a transaction.

---

## Implementation Units

### U1. Hand a unique violation back as the store's own error

**Goal:** the loser of a concurrent MCP resource seed starts healthy.

**Requirements:** R1, R2, R3. KTD1 to KTD5.

**Dependencies:** none.

**Files:**
- `apps/api/src/auth/auth.ts` (`database:` builds the wrapped adapter)
- new `apps/api/src/auth/store-errors.ts` (the wrapper), if keeping it out of `auth.ts` reads better; otherwise a local function in `auth.ts`
- `apps/api/tests/health.test.ts` (the regression test)
- new `apps/api/tests/unique-violations.test.ts` (the wrapper's two outcomes, through the real adapter)

**Approach:**
1. Write the wrapper (KTD2 to KTD4): it takes the adapter factory, and returns a factory that replaces `create` on each instance with one that rethrows a unique violation's store error.
2. Pass `drizzleAdapter(db, …)` through it in `createAuth`.

**Execution note:** the regression test is already written, as an uncommitted change to `apps/api/tests/health.test.ts` in this branch, and ships in the same pull request. It answers 503 for one server against the unwrapped adapter. If it is absent, build it from the race scenario below and see it fail before the wrapper lands.

**Patterns to follow:** `apps/api/tests/health.test.ts`'s unmigrated-database test for the shape; `serverFor` in `apps/api/tests/harness.ts` for a server with no TestApp around it.

**Test scenarios:**
- Integration, the race (R1). Over a fresh database from `startTestDatabase()`, hold a SHARE lock on `oauth_resource`, build two servers with `serverFor`, wait until two inserts wait on the lock, commit, and ask both for `/health`. Both answer `status: "healthy"`, `identity: "ready"`.
- Integration, the narrowing (R3). Through the real adapter, a duplicate insert rejects with pg's `DatabaseError` (code `23505`), and a foreign-key refusal still rejects with Drizzle's wrapper (its `cause` code `23503`).
- Integration, unmigrated (R2). The existing "reports unhealthy when the identity provider could not start" test still passes.
- Integration, the rest (R3). The full api suite still passes, so the schema check, transactions and every path that hits no unique violation are unchanged.

**Verification:** the race test fails before the wrapper and passes after it, five runs in a row; `pnpm --filter @better-answers/api run check` passes.

---

## Verification Contract

| Proves | Command | Unit |
| --- | --- | --- |
| The race and the unmigrated case | `pnpm --filter @better-answers/api run test tests/health.test.ts` | U1 |
| Nothing else in the api moved | `pnpm --filter @better-answers/api run check` | U1 |
| Lint and the root gates | `pnpm run check:gates` | U1 |

Run the api suites with `IMAGE_PROBE_DEFERRED=true`. CI's merge group is the arbiter (`docs/agents/workflow.md`).

## Definition of Done

- The race test was seen failing without the wrapper and passes with it.
- Every Verification Contract row passes locally.
- The pull request body names the three plugin branches the change brings to life (Summary) as reachable and untested, ends with `Merge risk:` and `Fixes BA-70`, and names the upstream report as follow-up.
