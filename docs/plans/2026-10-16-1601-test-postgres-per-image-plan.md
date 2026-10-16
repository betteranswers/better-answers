---
title: One Shared Test Postgres per Pinned Image, Kept Current by Renovate - Plan
type: test
date: 2026-10-16
topic: test-postgres-per-image
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# One Shared Test Postgres per Pinned Image, Kept Current by Renovate - Plan

## Goal Capsule

- **Objective:** Local test runs that share a Postgres always run against the exact image their checkout pins, even when worktrees on different pins run at once. The pin also stops going stale: routine image rebuilds arrive as reviewed pull requests, and Postgres majors wait for a deliberate decision.
- **Means:** Each pinned image gets its own shared server, whose compose project and port come from the image digest (KTD2, KTD3). `TEST_POSTGRES_URI=shared` makes the harnesses derive that address from the pin (KTD1). A custom Renovate manager reads the pin (KTD5).
- **Authority:** The owner's "go" on 16/10/2026. Option 2 (one server per image) was chosen over refusing on a mismatch, and over comparing versions, after a first-principles analysis. Related to BA-187 (PRs #763 and #765).
- **Stop conditions:** Stop and report if the change needs a CI workflow change, a migration, a `contracts/` change, or touches production's Postgres.
- **Execution profile:** One pull request. It changes test infrastructure, a local deploy script, `renovate.json` and docs.
- **Who finishes:** `ce-work` builds it, reviews it, opens the pull request and merges it through the queue; the owner authorised merging.

---

## Product Contract

### Summary

`deploy/test-postgres.sh up` starts the shared server for the image this checkout pins, on a port derived from that image, and prints `export TEST_POSTGRES_URI=shared`. With that set, both test tiers find the right server on their own, so a worktree on a newer pin uses a second server and never wipes or borrows the first. `down --all` clears every such server. Renovate proposes the pin's rebuilds each weekend, and holds a Postgres major in the Dependency Dashboard for approval.

### Problem Frame

The shared server from BA-187 runs whatever image it was started with. Only `up` compared images, and recreating the server wipes every other worktree's live run. So a worktree whose pin differs from the running server, with the variable already exported, ran its suites against the wrong Postgres and went green locally. Meanwhile the pin itself never moved: no Renovate manager reads `packages/schema/src/postgres-image.ts`, so it has missed every upstream rebuild since 01/09/2026, and `pgvector 0.8.7-pg18-trixie` is already out. The existing `postgres` major-hold rule in `renovate.json` matches no dependency anywhere. Once Renovate does move the pin, image changes become routine, which makes a single shared server per machine the wrong unit.

### Requirements

**Per-image servers**

- R1. `up` starts, or reuses, the server for the checkout's pinned image only. A server for another image keeps running untouched.
- R2. With `TEST_POSTGRES_URI=shared`, both tiers connect to the server for their checkout's pin without a per-branch address.
- R3. With `TEST_POSTGRES_URI` set to a `postgresql://` URI, both tiers use that address as today. With it unset or empty, they start their own container as today, so CI is unchanged.
- R4. Under `shared`, a run whose derived port answers with a different image's server, or with a server that carries no image stamp, stops at once with one line naming the cause and `deploy/test-postgres.sh up`.
- R5. `down` stops this checkout's image's server. `down --all` stops every per-image server, plus the single server PR #763 started, and nothing else.
- R6. `up` says which other per-image servers are still running, so forgotten ones get cleared.

**Renovate**

- R7. Renovate reads the pin and proposes same-Postgres-major tag and digest updates in its weekend runs, like every other image.
- R8. A Postgres major bump (pg18 to pg19) is held in the Dependency Dashboard until approved, never opened as an ordinary pull request.
- R9. Every consumer of the pin's string keeps working with a Renovate-written value.

**Docs**

- R10. `docs/operations/local-gates.md` says how to start, point at, list and stop the per-image servers, and what merging a pin bump leaves to do for production.

### Scope Boundaries

- Production's Postgres stays a Coolify resource set by hand (`docs/operations/coolify.md`, `deploy/wizard-41.sh`). Automating it is out of scope. The docs name the hand step that follows a merged pin bump.
- The backup image's `postgresql-client-18` (`deploy/backup.Dockerfile`) moves with a Postgres major. This plan does not move it; the held major's own pull request will.
- Not built: a memory cap across servers. Two loaded servers could exhaust the 5.78 GiB Docker VM, but only during a pin transition. `up` lists the other servers (R6), and `down --all` clears them. Revisit if an out-of-memory server is seen.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`TEST_POSTGRES_URI` takes three forms.** Unset or empty starts a container. The literal `shared` derives the address from the pin. A `postgresql://` URI is used as given. One variable keeps PR #763's interface working, and the explicit form is what the harness tests use to point at the run's own container. (session-settled: user-approved — chosen over making the variable an address only: a per-branch address breaks when pins differ.)
- KTD2. **The project and port derive from the pinned digest.** The project is `<stem>-<first 12 hex of the digest>`, where the stem is `TEST_POSTGRES_PROJECT` or `better-answers-test-postgres`. The port is `55434 + (first 4 hex of the digest as a number) % 1000`, which skips 55432 (the dev database) and 55433 (PR #763's server). The current pin gives 56345. `TEST_POSTGRES_PORT` still overrides the port, in the script and in the harnesses' `shared` path, which is how tests point it elsewhere. Bash 3.2 does the arithmetic with `$((16#xxxx))`, and TS and Python mirror it.
- KTD3. **Each server is stamped with its image, and every locator form checks the stamp.** The compose command adds `-c better_answers.image=${TEST_POSTGRES_IMAGE}`. Each harness reads `current_setting('better_answers.image', true)` alongside the superuser check. Under `shared` it refuses unless the stamp equals its pin. Under an explicit URI it refuses only when a stamp is present and differs, because the run's own testcontainer carries none (R4). The stamp catches what derivation alone cannot: two pins whose digests map to one port, PR #763's unstamped server reached by an override, and a shell still holding an explicit URI after its worktree moved to a new pin.
- KTD4. **The script gains `address`, `down --all`, and an "also running" note.** `address` prints the derived project and `postgresql://` URI without touching Docker, and the harness tests compare their own derivation against it, so the three languages cannot drift. `down --all` lists compose projects and stops those named the stem exactly or `<stem>-<12 hex>`. Docker label filters match exactly, so the selection happens in bash, and the stem never matches the dev database's `better-answers-local`. `up` ends by naming any other running project under the stem. A caller-set `TEST_POSTGRES_IMAGE` replaces the file's pin, so tests can derive under made-up digests; nothing else sets it.
- KTD5. **A regex manager reads the pin, with regex versioning that makes the Postgres major the major.** In `renovate.json`'s `customManagers`, after the four existing entries, add a manager on `packages/schema/src/postgres-image.ts`. `deploy-tree.test.ts` takes the first regex manager to be the Dockerfile one. It captures `depName`, `currentValue` and `currentDigest` from `"<image>:<tag>@sha256:<digest>"`, with `datasourceTemplate: docker` and versioning `regex:^(?<minor>\d+)\.(?<patch>\d+)\.(?<build>\d+)-pg(?<major>\d+)-(?<compatibility>[a-z]+)$`. Docker's default versioning would treat `pg18-trixie` as a fixed suffix and never offer pg19. Under this scheme a pgvector major counts as a minor. That is acceptable: every update is reviewed (`automerge: false`).
- KTD6. **The dead `postgres` major rule becomes the pin's hold, and every pin PR names the production step.** The rule matching `apache/age` and `postgres` matches nothing today. Replace it with one rule for `pgvector/pgvector`, `matchUpdateTypes: ["major"]`, `dependencyDashboardApproval: true`, keeping its reason in `description`: a major is an upgrade drill. The Dashboard (issue #3) is live, so the update waits there visibly rather than being disabled. A second rule for every `pgvector/pgvector` update sets `prBodyNotes`. The note says that merging leaves production's Coolify resource to be re-pointed by hand, with `ALTER EXTENSION vector UPDATE` when pgvector's version moved. Whoever merges, including a `/renovate-prs` session, reads it in the pull request itself.

### Assumptions

- Renovate's update-type classification under KTD5's regex versioning comes from its docs. No pg19 tag exists yet, so U1 checks the major axis offline against the versioning pattern's named groups, and checks the real `0.8.7-pg18-trixie` candidate with a lookup dry run where the run can authenticate.
- One idle per-image server costs about 86 MiB. A retired one costs nothing much until `down --all`.

---

## Implementation Units

### U1. Renovate reads the pin

- **Goal:** Renovate proposes the pin's same-major updates and holds its majors.
- **Requirements:** R7, R8, R9 (KTD5, KTD6)
- **Dependencies:** none
- **Files:** modify `renovate.json`; modify `packages/devtools/test/ci/deploy-tree.test.ts` only if its manager assertions need the new entry named.
- **Approach:**
  1. Add the regex manager last in `customManagers`, with a `description` in the file's style naming why the pin needs it.
  2. Replace the dead `apache/age`/`postgres` rule with the `pgvector/pgvector` major hold, and add the `prBodyNotes` rule (KTD6).
  3. Check every consumer of the pin's format still parses a Renovate-written value: `deploy/test-postgres.sh`, `deploy/local-database.sh`, `deploy/wizard-41.sh`, and `pinned_postgres_image` in `apps/worker/tests/pg_harness.py`.
- **Test scenarios:**
  - A `deploy-tree.test.ts`-style case reads the new manager's versioning string from `renovate.json` and, compiling its pattern as Renovate's regex versioning does (named groups, no `renovate` dependency added), parses `0.8.6-pg18-trixie` with major 18 and compatibility `trixie`, and `0.8.6-pg19-trixie` as compatible with major 19. It rejects the floating `pg18` and a `-bookworm` tag as incompatible.
- **Verification:** `npx --yes --package renovate -- renovate-config-validator renovate.json` passes, and `deploy-tree.test.ts` still passes. Where a token is available, `renovate --platform=local --dry-run=lookup` offers `0.8.7-pg18-trixie` as a non-major update.

### U2. The script runs one server per image

- **Goal:** `up`, `down`, `down --all` and `address` act on per-image servers, each stamped with its image.
- **Requirements:** R1, R5, R6 (KTD2, KTD3, KTD4)
- **Dependencies:** none
- **Files:**
  - modify `deploy/test-postgres.sh`
  - modify `deploy/test-postgres.compose.yaml`
  - modify `apps/api/tests/test-postgres.test.ts`
  - modify `apps/api/tests/compose-project.ts` if helpers are needed
- **Approach:**
  1. Derive the project and port from the pin (KTD2). `TEST_POSTGRES_PROJECT` is now the stem, so the test's exact-label lookups and its other-image case move to the derived `<stem>-<12 hex>` name.
  2. Add the stamp to the compose command.
  3. Add `address`, which prints the URI with no Docker call.
  4. Add `down --all`, selecting projects by stem in bash.
  5. End `up` by naming other running projects under the stem.
  6. Keep the existing image refusal and port refusal.
- **Patterns to follow:** the existing script and its test's per-pid project override. Bash 3.2 and shellcheck rules.
- **Test scenarios:**
  - `address` prints the derived project and URI, and starts nothing.
  - `address` under two made-up `TEST_POSTGRES_IMAGE` digests prints two different projects and ports.
  - The started server reports `better_answers.image` equal to the pin.
  - `down --all` with a test stem stops every project under that stem and leaves a project outside the stem running.
  - `up` names another running project under the stem.
  - The existing scenarios (pinned digest, flags, refusals, no volume, no testcontainers label) still pass with per-pid overrides.
- **Verification:** `test-postgres.test.ts` and `local-database.test.ts` pass with real Docker, and shellcheck passes.

### U3. The vitest harness derives the address under `shared`

- **Goal:** `TEST_POSTGRES_URI=shared` reaches the checkout's image server and refuses a mismatched or unstamped one.
- **Requirements:** R2, R3, R4 (KTD1 to KTD3)
- **Dependencies:** U2 (the `address` command its test compares against)
- **Files:**
  - modify `packages/schema/test/warm-postgres.ts`
  - modify `packages/schema/test/warm-postgres.test.ts`
  - modify `packages/schema/src/postgres-image.ts` only if the digest helper belongs beside the pin
- **Approach:**
  1. `locatorUri` maps `shared` to `postgresql://postgres:postgres@127.0.0.1:<port>/postgres`, deriving the port from `POSTGRES_IMAGE` unless `TEST_POSTGRES_PORT` is set.
  2. The superuser check also reads the stamp and refuses per KTD3.
- **Test scenarios:**
  - The derived `shared` address equals `deploy/test-postgres.sh address`'s output for the same pin.
  - Under `shared`, with `TEST_POSTGRES_PORT` pointed at a throwaway pinned-image container signed in as `postgres`/`postgres` and started without a stamp, the child start fails with one line naming the missing stamp and the `up` command.
  - The same with a container started with `-c better_answers.image=<another image>` fails naming the mismatch.
  - An explicit URI to that other-image container fails the same way.
  - An explicit URI to this run's own unstamped container still starts with `source: "shared"`.
- **Verification:** The schema suite passes with the variable unset, and the new cases pass.

### U4. The pytest harness derives the address under `shared`

- **Goal:** The same behaviour as U3 in the worker tier.
- **Requirements:** R2, R3, R4 (KTD1 to KTD3)
- **Dependencies:** U2
- **Files:**
  - modify `apps/worker/tests/pg_harness.py`
  - modify `apps/worker/tests/test_pg_harness.py`
- **Approach:** `_migrated_cluster` maps `shared` to the derived address, and `_refuse_unless_superuser` gains the stamp check per KTD3. The digest comes from `pinned_postgres_image()`.
- **Test scenarios:**
  - The derived address equals the script's `address` output.
  - Under `shared`, with the port pointed at a throwaway pinned-image container signed in as `postgres`/`postgres` and unstamped, the refusal names the missing stamp and `up`.
  - A container stamped with another image is refused under `shared` and under an explicit URI.
  - An explicit URI to this process's own unstamped container still works.
- **Verification:** `uv run --frozen check` passes in `apps/worker`, and the new cases pass under `-n 4`.

### U5. Docs

- **Goal:** A developer can run, point at, list and clear per-image servers, and knows the production step after a pin bump.
- **Requirements:** R10
- **Dependencies:** U1 to U4
- **Files:** modify `docs/operations/local-gates.md`; modify `docs/agents/workflow.md` if its pointer's wording changes.
- **Approach:** Rewrite "The shared test Postgres":
  - `export TEST_POSTGRES_URI=shared`;
  - one server per pinned image, on a derived port;
  - `down` and `down --all`;
  - the one-time `down --all` after upgrading, which clears PR #763's server;
  - a merged pin bump leaves production's Coolify resource to be re-pointed by hand, with `ALTER EXTENSION vector UPDATE` when pgvector moved.
- **Test expectation:** none. Docs only.
- **Verification:** The comment gates pass, and the section matches the merged behaviour.

---

## Verification Contract

| Check | Proves |
| --- | --- |
| `pnpm check` with `TEST_POSTGRES_URI` unset | R3: CI behaviour unchanged |
| `npx --yes --package renovate -- renovate-config-validator renovate.json` and the versioning test | U1 config is valid and pg19 is a major |
| `apps/api/tests/test-postgres.test.ts` | R1, R5, R6 |
| New cases in `packages/schema/test/warm-postgres.test.ts` and `apps/worker/tests/test_pg_harness.py` | R2, R4, R3 explicit-URI path |
| Manual: `up` on main's pin and on a worktree with a different pin, run the core and worker suites against each with `TEST_POSTGRES_URI=shared` at once, then `down --all` | R1, R2, R5 end to end |

---

## Definition of Done

- Every unit's verification holds, and `pnpm check` passes with the variable unset.
- The manual per-image check was run, and its outcome is recorded in the pull request.
- No abandoned code remains (knip and jscpd pass).
- The pull request body says `Merge risk: reversible` and `Related to BA-187`.
