---
title: Shard the Browser Suite - Plan
type: ci
date: 2026-10-12
topic: shard-the-browser-suite
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Shard the Browser Suite - Plan

## Goal Capsule

- **Objective:** A pull request that enters the merge queue merges in about 5 to 6 minutes, not 17 to 21, with every test that runs today still running on the tree that lands.
- **Means:** Split `full-web` into a unit job and a three-shard browser matrix, and give Playwright three workers on CI (KTD1 to KTD4).
- **Authority:** The Key Decisions below, then `CODING_STANDARDS.md`, `AGENTS.md` and `docs/operations/CI.md`, then this plan's units.
- **Stop conditions:** Stop and report when the required context `check` could pass with a web job missing or skipped, when a shard would run a different set of tests than the whole suite runs today, or when the change needs a new GitHub permission or secret.
- **Execution profile:** One branch from `origin/main`, cut after PR #707 has merged, and one pull request. It changes CI config, root scripts, the Playwright config, tests of those, and docs.
- **Who finishes:** `ce-work` implements. The calling pipeline reviews, opens the pull request, arms its merge and watches CI. The merge queue's run is the first full run of the new jobs.

---

## Product Contract

### Summary

`check.yml`'s `full-web` job becomes two jobs: one runs the web workspace's typecheck and vitest suite, and one runs the Playwright suite as three shards. Playwright runs three workers on CI. The nightly mutation matrix runs six shards at a time, down from nine, so a merge group's extra jobs still fit the plan's 20.

### Problem Frame

The merge queue is the only full run, and its wall-clock is its slowest job. In run 38244048806 `full-web` took 1,222 seconds and the next slowest job, `full-worker`, took 302. Inside `full-web`, Playwright ran 536 tests in 16.7 minutes on two workers and vitest took 168 seconds. Nothing waits serially: the two workers are saturated, and the test-seconds sum to 1,954.

The suite is not sharded, and `apps/web/playwright.config.ts` sets no `workers`, so Playwright takes its default of half the runner's four cores.

### Key Decisions

- **`full-web` splits into a unit job and a three-shard browser matrix** (session-settled: user-approved — chosen over keeping one job: the browser suite is 14 to 17.5 of the job's 17 to 20 minutes and its tests are independent). Governs R1, R2, R3.
- **Playwright runs more than two workers on CI** (session-settled: user-approved — chosen over leaving the default: the default is half the cores, and the workers are saturated). Governs R4.
- **The accessibility audit stays after every test in this change** (session-settled: user-approved as a change to make, sequenced here as follow-up). Conflict found in planning: once the suite is sharded, `full-worker` sets the wait, so auditing once per page and theme would buy about a minute, and it would stop auditing the states a test leaves that share a URL, such as an open menu or dialog. The evidence and the open design questions are under Deferred to Follow-Up Work; whether to build it is the owner's call. Governs R6.

### Requirements

**The split**

- R1. The web workspace's typecheck and vitest suite run in one merge-queue job, and its Playwright suite runs in another, as three shards.
- R2. Every Playwright test that runs today runs in exactly one shard, and a red or missing shard turns `check` red.
- R3. Each shard's traces upload under a name that carries its shard, and the flaky report prints that same name.

**Workers**

- R4. Playwright runs three workers on CI and its default elsewhere.

**The budget for concurrent jobs**

- R5. A merge group, a pull request and the nightly mutation matrix still fit the plan's 20 concurrent jobs, and the test that holds that arithmetic passes.

**What stays**

- R6. The accessibility audit, the retry and the trace settings are unchanged, and a local `pnpm check` runs the web workspace as it does today.
- R7. Live docs describe the legs, their count and the budget as they are after the change.
- R8. The root `check` passes locally, and the pull-request lane's `check` passes.

### Success Criteria

- The first merge-queue run after this lands reports each web job under about 7 minutes, and no shard reports a flake that the same test did not show before.

### Scope Boundaries

- `full-worker`, `full-api`, `full-core` and `full-root` are unchanged.
- No test is moved between vitest and Playwright, and none is deleted.
- Four workers are not used. Twenty-six assertions hold an action to 100 ms, and four workers would leave no core for the api, Postgres and the browser's own processes.

#### Deferred to Follow-Up Work

- **Auditing accessibility once per page and theme.** Measured: the lightest page's audit costs about 1.2 seconds of a 3.6-second mean test, and 96 explicit calls mean some tests audit twice. A design must answer four things before it is built:
  - Playwright's workers and shards are separate processes, so "once per run" needs a store they share or becomes "once per worker".
  - The gate's own proof, `apps/web/e2e/accessibility-gate.spec.ts`, lands eleven `test.fail()` cases on `/sign-in` and needs the audit every time.
  - The journeys reuse the fixture against production and call it on every page they leave.
  - The written rule holds "every state a test leaves", and a key of URL and theme drops an open menu, dialog or sheet.
- **A fourth shard or a fourth worker**, if the first week's runs show the browser shards still set the wait.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The two jobs are `full-web-unit` and `full-web-browser`.** Both names start `full-`, so the verdict's shell requires them on the full lane with no edit, and both are added to the fan-in's `needs` in file order. The branch ruleset requires only `check`.
- KTD2. **Web gets root scripts in core's exact form.** `scripts/check.mjs` forwards no argument, so `--shard` cannot pass through `check:web`. Three scripts, `check:web:typecheck`, `check:web:test` and `check:web:e2e`, are each `pnpm --filter @better-answers/web run <step>`. A fourth, `check:web:unit`, is a runner call over the first two, so one run names both failures. `check:web` stays for local use and leaves the list of narrowings that `docs-lane.test.ts` holds.
- KTD3. **The shard reaches Playwright as core's reaches vitest.** The browser job runs `pnpm check:web:e2e --shard="${SHARD}"` with `SHARD: ${{ matrix.shard }}/${{ strategy.job-total }}`. pnpm appends the argument to the end of the `e2e` script, which ends in `playwright test`. Each shard rebuilds the SPA, which takes about a second, and starts its own api and Postgres.
- KTD4. **`workers` is `3` on CI and unset elsewhere**, read off the same `CI` flag the config already uses for `retries`.
- KTD5. **The trace artifact's name moves to the job's `env` and carries the shard.** `browser-traces-shard-<n>-attempt-<attempt>` is set once as `TRACE_ARTIFACT` at job level and read by both the test step and the upload step. `docs-lane.test.ts` allows a sharded leg's step one env entry, `SHARD`, and that rule stays.
- KTD6. **The unit job installs Chromium too.** The journeys' vitest suites drive a real browser through Playwright.
- KTD7. **The nightly mutation matrix drops to six at a time.** A merge group runs a lane job and nine leg jobs after the change, and a pull request four, so those 14 of the plan's 20 concurrent jobs leave six for the nightly mutation matrix. `mutation-baseline.test.ts` counts the `full-` jobs from `check.yml` and holds `max-parallel` to the remainder. A night's 25 shards take more rounds; nobody waits on that run.
- KTD8. **`docs-lane.test.ts` holds two sharded legs by the same rules it holds one.** Its `SHARDED_LEG`, `RUN_BY_STEP`, `NARROWED` and `FULL_LEGS` gain the web entries, and the tests that read one sharded leg read each.

### Assumptions

- pnpm forwards `--shard` through `check:web:e2e` to the end of the `e2e` script as it does for core. U2 proves it with `playwright test --list`.
- A matrix job's result in `needs` is `success` only when every shard succeeded, as `docs/operations/CI.md` says of `full-core`.
- GitHub allows the `matrix` context in a job-level `env`.

### Risks

- **The first full run is in the merge queue.** The pull-request lane does not run the web jobs, so a wrong job shows as a red `check` on the queue entry. The fix is a second push; nothing lands red.
- **More workers can raise flakes.** Three workers share four cores with the api, Postgres and Chromium. The retry hides a first miss and the flaky report names it, so the job summary is where a rise shows.
- **Two merge groups building together reach the plan's 20 jobs**, where it took three before. They also finish sooner.

### Sources

- `.github/workflows/check.yml`: `full-web` and `full-core` in full, and the `check` fan-in's `needs` and verdict shell.
- `package.json`: `check:web`, `check:core:typecheck`, `check:core:suite`, `check:root`.
- `scripts/check.mjs`: each step runs as `pnpm run <step>` with no trailing argument.
- `packages/devtools/test/ci/docs-lane.test.ts`: `NARROWED`, `RUN_BY_STEP`, `SHARDED_LEG`, `FULL_LEGS`, and the tests under "the sharded leg of check.yml" and "the one verdict check.yml reports".
- `packages/devtools/test/ci/mutation-baseline.test.ts`: `mergeGroupLegJobs` and the bound on `max-parallel`.
- `.github/workflows/mutation.yml`: `max-parallel: 9` and the comment above it.
- `apps/web/playwright.config.ts` and `apps/web/test/playwright-config.test.ts`, which holds `forbidOnly` and `retries` both ways.
- `apps/web/e2e/flaky-report.ts`: `traceOf` reads `TRACE_ARTIFACT`.
- `docs/operations/CI.md`: the lanes table, the legs' bullets and the mutation section's arithmetic.
- The research dossier from the planning session, with CI run 38244048806's timings.

---

## Implementation Units

### U1. Web's root scripts and the Playwright workers

- **Goal:** The root manifest can run the web workspace's three gates one at a time, and Playwright takes three workers on CI.
- **Requirements:** R4, R6. Carries KTD2 and KTD4.
- **Dependencies:** none.
- **Files:**
  - `package.json`
  - `apps/web/playwright.config.ts`
  - `apps/web/test/playwright-config.test.ts`
- **Approach:**
  1. Add the four root scripts under KTD2.
  2. Add `workers` to the Playwright config under KTD4.
  3. Add the two cases to the config's test, in the form its `retries` cases have.
- **Execution note:** Write the two `workers` cases first and see the CI one fail.
- **Test scenarios:**
  - On CI the suite runs three workers: with `CI` set, the config's `workers` is 3.
  - Off CI the suite keeps Playwright's default: with `CI` unset, the config's `workers` is undefined.
- **Verification:** The web workspace's typecheck and `playwright-config.test.ts` pass, and `pnpm check:web:unit` runs typecheck and then vitest.

### U2. Two web jobs in `check.yml`

- **Goal:** The full lane runs `full-web-unit` and a three-shard `full-web-browser`, and `check` waits on both.
- **Requirements:** R1, R2, R3. Carries KTD1, KTD3, KTD5, KTD6 and KTD8.
- **Dependencies:** U1.
- **Files:**
  - `.github/workflows/check.yml`
  - `packages/devtools/test/ci/docs-lane.test.ts`
- **Approach:**
  1. Replace `full-web` with `full-web-unit`, which keeps the checkout, pnpm, node, install and Chromium steps and runs `pnpm check:web:unit`.
  2. Add `full-web-browser` with `fail-fast: false` and `matrix.shard: [1, 2, 3]`, the same set-up steps plus the Docker Hub login, the test step under KTD3, and the upload step, with the artifact's name under KTD5.
  3. Add both to the fan-in's `needs` where they sit in the file.
  4. Widen `docs-lane.test.ts` under KTD8.
- **Execution note:** Change `docs-lane.test.ts` first and see it fail against the current workflow.
- **Test scenarios:**
  - The full lane's legs run exactly the root check's gates: "runs exactly the root check's gates across its legs" and "runs each gate on one leg only" pass with the web scripts narrowed.
  - Every gated workspace is selected once: "selects, between the narrowings of check:workspaces, every workspace it gates" passes with `apps/web` in `RUN_BY_STEP`.
  - A sharded workspace's root scripts match its own check: "runs every step a sharded workspace's check names" passes for `apps/web` with `typecheck`, `test` and `e2e` in that order.
  - Each sharded leg numbers its shards 1 to N with `SHARD` as its only step env: the test passes for `full-core` and for `full-web-browser`.
  - Only the sharded legs shard: "runs its sharded script alone, and no other leg shards" names both legs and each one's script.
  - `check` hangs off every leg in file order: "hangs the required context off every leg, whatever they did" passes with the two new names.
  - The verdict refuses a full lane missing a web leg: the `VERDICTS` cases name `full-web-unit` and `full-web-browser`.
  - The three shards cover the suite once: `playwright test --list --shard=1/3`, `2/3` and `3/3` through `pnpm check:web:e2e` list 536 tests between them.
- **Verification:** `docs-lane.test.ts` and `pnpm lint:workflows` pass. The devtools workspace's `check` stays red on `mutation-baseline.test.ts` until U3.

### U3. The mutation matrix's share of the budget

- **Goal:** The nightly mutation matrix leaves room for a merge group's ten jobs and a pull request's four.
- **Requirements:** R5. Carries KTD7.
- **Dependencies:** U2.
- **Files:**
  - `.github/workflows/mutation.yml`
- **Approach:** Set `max-parallel` to 6 and correct the comment above it.
- **Test scenarios:**
  - The mutation matrix fits beside a merge group and a pull request: the bound in `mutation-baseline.test.ts` fails at 9 after U2 and passes at 6.
- **Verification:** `mutation-baseline.test.ts` passes.

### U4. The docs

- **Goal:** Live docs name the two web jobs, the shard count, the workers and the budget.
- **Requirements:** R7.
- **Dependencies:** U2, U3.
- **Files:**
  - `docs/operations/CI.md`
  - `docs/agents/workflow.md`
  - `.claude/skills/browser-suite/SKILL.md`
  - `packages/devtools/test/ci/release-job.test.ts`
- **Approach:**
  1. `CI.md`: the lanes table's row, the count of legs, the `full-web` bullet (two jobs, Chromium on both, the artifact's name per shard), the sentence that calls `full-worker` the longest leg, the reasoning against more shards, and the mutation section's arithmetic (14 taken by a merge group and a pull request, six left for the matrix).
  2. `docs/agents/workflow.md`: the row that lists the full lane's legs and says the shards are CI's alone.
  3. `.claude/skills/browser-suite/SKILL.md`, through `ce-skill-work`: the line on what `check:web` runs stays true locally; add that CI runs the suite in three shards with three workers, and correct the workers row of its table.
  4. `release-job.test.ts`: the comment that names `full-web` names `full-web-browser`.
- **Test scenarios:** Test expectation: none, docs and a comment.
- **Verification:** `check:docs` passes, and a search for `full-web` finds only the two new names outside dated plans and `docs/archive/`.

---

## Verification Contract

| Command | Proves | Applies to |
| --- | --- | --- |
| `pnpm --filter @better-answers/web run test test/playwright-config.test.ts` | the workers setting both ways | U1 |
| `pnpm --filter @better-answers/devtools run check` | the workflow's legs, shards, fan-in and the mutation budget | U2, U3 |
| `pnpm run check:gates` | lint, `lint:workflows` (actionlint and zizmor) and the other gates | all |
| `pnpm check:web:e2e --shard=1/3 --list`, then `2/3` and `3/3` | the argument reaches Playwright and the shards cover 536 tests once | U2 |
| `pnpm run check:docs` | the docs lane | U4 |
| The pull request's `check`, then the merge queue's | the pull-request lane, then the first full run of the new jobs | all |

## Definition of Done

- Every command in the Verification Contract passes locally, and the pull request's `check` is green.
- `check.yml` has no job named `full-web`, and its `check` job's `needs` names every other job in file order.
- No test file under `apps/web/e2e/` or `apps/web/test/` is changed except `playwright-config.test.ts`.
- The pull request body states that the merge queue is the first full run, names the mutation matrix's new `max-parallel`, records the deferred accessibility change with its evidence, and carries `Merge risk: reversible, CI config and tests; a wrong job shows as a red check in the merge queue`.
