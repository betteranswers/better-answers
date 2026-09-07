# T-009 — Stryker under a real Postgres: research findings

Research only. Nothing in this document has been applied to the tree. Written
07/09/2026 against the Stryker docs at stryker-mutator.io, the StrykerJS source
on `master`, the Vitest source on `main`, and the GitHub Actions docs. Source-code
claims carry the file path in the owning repo. The workspaces pin
`@stryker-mutator/core` and its Vitest runner at **10.0.0** and `vitest` at
**4.1.11** (both `package.json`s, read 07/09/2026); the source branches read were
the moving heads of those repos on the day, so a claim acted on in code should be
confirmed against the `v10.0.0` / `v4.1.11` tags at that moment (`[DEPS1]`). The situation researched: two
weekly StrykerJS legs in `.github/workflows/mutation.yml` (`timeout-minutes: 120`,
Vitest 4 runner, `concurrency: 2`, `inPlace: true`, `incremental: true` on api),
where `packages/core` (1,951 mutants) finishes in 1h29m52s at 76.37% and
`apps/api` (1,812 mutants, a Testcontainers Postgres per test file's `beforeAll`)
overruns the 120 minutes against a ~3h Stryker estimate.

---

## Answers for T-009

Mapped to the five levers on the table, strongest first.

**(2) One Postgres per suite instead of per test file — the lever that changes the
economics, and the source supports it precisely.** The Vitest runner keeps **one
warm Vitest instance per Stryker worker for the whole run** and re-runs tests
inside it per mutant; mutants are switched by a global flag, never by
re-instrumentation (§ 1.2). A per-file `beforeAll` re-executes on **every mutant
run**, so today each *executed* mutant with covering tests pays a container start
(a NoCoverage mutant, or one reused from the incremental file, runs no tests and
pays nothing). A Vitest
`globalSetup` is guarded to initialise **once per worker process** and tear down
only when the instance closes (§ 1.3) — a Postgres started there and handed to
tests via `provide`/`inject` stays warm across all ~900 mutants a worker runs.
Two caveats: a **timed-out mutant disposes and recreates the whole worker
process** (container restart, § 1.4), and each of the 2 workers would own its own
container — two live at once, matching today's steady-state count (each worker's
active test file currently holds one), but held for the whole run instead of
recreated per file.

**(3) Raise the timeout — cheap, and half of the fix is a workflow bug we already
have.** `timeout-minutes` may rise to the runner's 6-hour job execution limit
(§ 2.4). More importantly: when GitHub cancels a timed-out job it sends SIGINT,
and **StrykerJS traps SIGINT/SIGTERM and writes a partial incremental file**
before exiting (§ 2.2) — the workflow header's claim that a timed-out leg
"carries nothing forward" is wrong about Stryker. What loses the file is
`actions/cache`'s save step, which is `post-if: "success()"` and skips a
cancelled job (§ 2.3). Switching to explicit `actions/cache/restore` +
`actions/cache/save` with `if: always()` lets an overrunning api leg checkpoint
and **converge over successive weeks even at 120 minutes**.

**(1) Narrow `mutate` to decision-dense modules — safe with incremental.** The
incremental differ **keeps out-of-scope old results in the report it writes**, so
a run with a narrowed `mutate` does not discard entries for files outside its
scope (§ 2.5). Globs with `!`, and per-file line ranges, are both supported
(§ 1.5). Note `ignorePatterns` is inert under `inPlace: true` (§ 1.6).

**(5) Shard the run — no first-party support; the supported composition is
narrowed `mutate` + a shared incremental file.** StrykerJS has no shard flag; the
feature request is closed stale (§ 4.1). Because of the differ behaviour above,
splitting the weekly run into several dispatches with disjoint `mutate` globs
against the same incremental file merges correctly (§ 4.2). Parallel matrix
shards need per-shard incremental files and either the dashboard's per-module
aggregation or a custom report merge (§ 4.3).

**(4) Self-hosted runner — a multiplier, not a fix.** Stryker's default
concurrency is `cpuCoreCount - 1` above 4 cores (§ 1.7), so a 8-vCPU box runs
3.5× the workers of today's hand-pinned 2 — and the workflow header already
reserves nightly for it. It multiplies whatever per-mutant cost remains, which
is why lever (2) comes first.

Also on per-mutant cost: `ignoreStatic` (§ 1.8) and the runner's built-ins —
always-perTest coverage, bail on first failure, `vitest.related` (§ 1.1) — plus
`disableTypeChecks` already defaulting to `true` since v7 (§ 1.5).

---

## 1. Keeping a run under budget when every test hits a real DB

### 1.1 `coverageAnalysis: perTest` with the Vitest runner

The Vitest runner page says the config key is decoration: "Your
`coverageAnalysis` property is ignored. The vitest runner plugin will always use
`"perTest"` coverage analysis", which "yields the best performance anyway"
([vitest-runner docs](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)).
Under perTest, "Stryker will determine which tests cover which mutant during the
initial test run phase. Only the tests that cover a specific mutant are executed
for each mutant"; tests must "run independently of each other and in random
order", and a static mutant triggers all tests
([configuration docs](https://stryker-mutator.io/docs/stryker-js/configuration/)).

The runner adds two performance behaviours of its own: it "Will **bail** on the
first test failure" and, via `vitest.related` (default `true`), "Vitest will only
run tests that are related to the mutated files"
([vitest-runner docs](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)).
So per mutant, the work is: the covering tests, in the related files, stopping at
the first kill. The `coverageAnalysis: "perTest"` lines in both our configs are
harmless but dead.

### 1.2 One warm Vitest per worker; mutants switched by flag — read from source

`packages/vitest-runner/src/vitest-test-runner.ts` (StrykerJS repo) answers the
process-model question exactly:

- **One Vitest instance for the runner's lifetime.** `init()` calls
  `this.ctx = await vitestWrapper.createVitest('test', {...})` once and every
  `dryRun()`/`mutantRun()` goes through a shared `run()` that reuses it. There
  is **no fresh Vitest process per mutant**.
- **A mutant run is a re-run inside that instance:** the runner clears state
  (`this.ctx!.state.filesMap.clear()`) and calls
  `await this.ctx!.start(testFilesToRun)` with only the files containing the
  covering tests (`mutantRun()` receives `testIds: options.testFilter` from the
  perTest coverage).
- **The active mutant travels by value, not by re-instrumentation:**
  `this.ctx!.provide('activeMutant', options.activeMutant.id)` (with `mode` and
  `hitLimit` beside it). All mutants are instrumented into the code once, up
  front; switching is a flag read.
- **Vitest is pinned to one worker:** on Vitest ≥ 4.1 the runner forces
  `{ pool: 'threads', maxWorkers: 1 }` ("Will run your tests in a **single
  thread**" — "StrykerJS uses it's own parallel workers", per the
  [vitest-runner docs](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)).
  Stryker's `concurrency: 2` therefore means two child processes, each holding
  one warm Vitest.

`packages/vitest-runner/src/stryker-setup.ts` is the injected setup file that
receives the flag: it reads `inject('activeMutant')` and writes it to
`globalThis[globalNamespace].activeMutant` — in a `beforeAll` for runtime
mutants, or at module scope when `mutantActivation === 'static'` so the flag is
set before the mutated modules load.

**What resets module state between mutant runs:** Vitest's own isolation, not
Stryker. `isolate` defaults to `true` — "Run tests in an isolated environment"
([vitest.dev/config/isolate](https://vitest.dev/config/isolate)) — so each test
file gets a fresh module registry on every `ctx.start()`. That is what makes
static-mutant activation work at all, and it is also why **a per-file
`beforeAll` re-runs on every mutant**: file-scoped hooks live inside the
isolated environment. This is the precise mechanism behind the api leg's cost —
1,812 mutants, each re-paying the container start its covering file's
`beforeAll` performs.

### 1.3 The warm-container seam: `globalSetup` outlives every mutant run

Vitest's `globalSetup` "is called before the test workers are created and only
if there is at least one test queued, and teardown is called after all test
files have finished running"; it can "pass down serializable data to tests via
`provide`" ([vitest.dev/config/globalsetup](https://vitest.dev/config/globalsetup)).
The source is stronger than the docs for our case:

- `packages/vitest/src/node/project.ts` (Vitest repo) guards initialisation —
  `async _initializeGlobalSetup() { if (this._globalSetups) { return } ... }` —
  so although `runFiles` calls it per run, the setup **executes once per project
  instance**.
- `packages/vitest/src/node/core.ts` calls `_teardownGlobalSetup()` **only in
  `close()`**, never between runs.

Combined with § 1.2 (one persistent Vitest instance per Stryker worker), a
Testcontainers Postgres started in `globalSetup` and published via `provide`
(connection URI) starts **once per Stryker worker per leg** and survives every
mutant run until Stryker disposes the runner. Per-file work shrinks to
connecting and resetting state — for schema-per-file isolation, `CREATE
DATABASE ... TEMPLATE` from a migrated template database is the shape that keeps
file independence without a container start. This also collapses `timeoutMS`:
the 300s allowance exists to clear a container start, and every mutant that
*hangs* currently burns up to that allowance; a warm container lets it drop
toward real test time, making hung mutants an order of magnitude cheaper too.

The same seam helps the plain suite (the api leg's dry run pays it as well), so
it is not mutation-testing-specific plumbing.

### 1.4 Two lifecycle caveats on the warm worker

- **A timed-out mutant recreates the worker.** In
  `packages/core/src/test-runner/timeout-decorator.ts`, `ExpirableTask.TimeoutExpired`
  leads to `await this.handleTimeout()` → `await this.recover()`, which disposes
  and re-creates the underlying child process — taking the warm Vitest and its
  `globalSetup` container with it. Every `Timeout`-status mutant therefore costs
  a container restart even after lever (2). Keep `timeoutMS` honest rather than
  generous once the container start is out of the per-mutant path.
- **`maxTestRunnerReuse` must stay 0 (the default).** In
  `packages/core/src/test-runner/max-test-runner-reuse-decorator.ts`, a non-zero
  value recycles the worker after N runs (`if (this.restartAfter > 0 && this.runs
  > this.restartAfter) { await this.recover(); ... }`); 0 disables recycling. We
  don't set it; don't start.

### 1.5 The other per-mutant-cost options

From the [configuration docs](https://stryker-mutator.io/docs/stryker-js/configuration/):

- **`mutate`** takes globs with `!` exclusions (as our configs already use) and
  **mutation ranges**: "postfixing your file with
  `:startLine[:startColumn]-endLine[:endColumn]`", e.g. `"src/app.js:1-11"` —
  though "It is **not** possible to combine mutation range with a globbing
  expression in the same line".
- **`disableTypeChecks`** defaults to `true` since v7 — Stryker inserts
  `// @ts-nocheck` atop mutated files. Nothing to gain; we're already there.
- **`timeoutMS`/`timeoutFactor`**: the per-mutant budget is
  `netTimeMs * timeoutFactor + timeoutMS + overheadMs` (defaults 5000 / 1.5).
  Our `timeoutMS: 300_000` is the container-start allowance § 1.3 removes the
  need for.
- **`dryRunTimeoutMinutes`** (default 5): the api leg's dry run starts a
  container per test file within one worker; if the dry run ever times out the
  whole leg aborts (`Initial test run timed out!` and a throw, per
  `packages/core/src/process/3-dry-run-executor.ts`).

### 1.6 `ignorePatterns` is dead under `inPlace`

"`ignorePatterns` … no effect when using `--inPlace`", and `inPlace` means
"Stryker will override your files, but it will keep a copy of the originals in
the temp directory"
([configuration docs](https://stryker-mutator.io/docs/stryker-js/configuration/)).
Both legs run `inPlace: true` (the TypeScript 7 sandbox issue recorded in the
configs), so sandbox-copy trimming is not an available lever here; `mutate`
scoping is.

### 1.7 Concurrency

Default `cpuCoreCount <= 4 ? cpuCoreCount : cpuCoreCount - 1`, percentage
strings allowed
([configuration docs](https://stryker-mutator.io/docs/stryker-js/configuration/)).
Our 2 matches the 2-vCPU hosted runner; a self-hosted box raises it linearly in
workers — and, note, linearly in simultaneous Postgres containers.

### 1.8 `ignoreStatic` — what it skips and the risk

"A static mutant is a mutant that is executed once on startup instead of when
the tests are running" — module-scope expressions, mutable only by reloading the
module. Running one means "a fresh test environment", i.e. **all** tests for
that one mutant. With `ignoreStatic` (requires perTest), "The mutants will be
shown in your report with the 'Ignored' state and won't count towards your
mutation score"; hybrid mutants (startup *and* runtime coverage) are demoted to
their runtime tests
([static mutants doc](https://stryker-mutator.io/docs/mutation-testing-elements/static-mutants/)).
The risk is exactly that exclusion: a wrong module-scope constant (a default, a
regex, a threshold table) stops being tested at all, and the score silently
stops covering module-load behaviour. For this codebase — where kernel constants
and door configuration live at module scope — turn it on only if a run-length
breakdown shows static mutants dominating, and say so in the config comment.

---

## 2. Incremental with partial runs

### 2.1 Where the incremental file is written in the lifecycle

In `packages/core/src/reporters/mutation-test-report-helper.ts` (StrykerJS repo):
`reportAll(results)` — called once by `MutationTestExecutor.execute()` after all
mutant streams merge (`packages/core/src/process/4-mutation-test-executor.ts`) —
builds the report and, when `options.incremental` is set, calls
`writeIncrementalReport(report)`:

```js
await this.fs.writeFile(
  this.options.incrementalFile,
  JSON.stringify(report, null, 2),
  'utf-8',
);
```

then sets `reportCompleted = true`. On normal completion the file is written
exactly once, at the end.

### 2.2 It is *also* written on SIGINT/SIGTERM — the docs and source agree

The [incremental docs](https://stryker-mutator.io/docs/stryker-js/incremental/)
say an interrupted run (their example is CTRL+C) saves partial results so the
next run can "pick up where the interrupted run left off". The mechanism, from
source:

- `packages/core/src/unexpected-exit-handler.ts` registers handlers for
  `['SIGABRT', 'SIGINT', 'SIGHUP', 'SIGTERM']`; on the first signal it awaits
  all registered async handlers before `process.exit(128 + signalNumber)`. A
  **second** signal forces immediate exit ("Forced exit. Received signal again
  while shutting down.").
- `MutationTestReportHelper`'s constructor registers such a handler: when
  `this.options.incremental && !this.reportCompleted && this.partialResults.length > 0`
  it writes the incremental file from the results collected so far and logs
  `Saved a partial incremental report to "%s" after an unexpected interrupt.`
  (`packages/core/src/reporters/mutation-test-report-helper.ts`).

SIGKILL writes nothing — the checkpoint depends on a catchable signal arriving
and on ~a few seconds to serialise. GitHub's cancellation flow provides exactly
that window: "the runner machine sends `SIGINT/Ctrl-C` to the step's entry
process … If the process doesn't exit within 7500 ms, the runner will send
`SIGTERM/Ctrl-Break` …, then wait for 2500 ms …. If the process is still
running, the runner kills the process tree"
([workflow cancellation reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation)),
and `timeout-minutes` is defined as the minutes "before GitHub automatically
cancels it"
([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).
One thing the docs do **not** promise is that SIGINT sent to the step's entry
process (`bash`) reaches the `pnpm → stryker` descendants before the SIGTERM
follow-up; Stryker traps both, but this deserves one empirical
`workflow_dispatch` with a short `timeout-minutes` before we rely on it.

### 2.3 The workflow bug: the checkpoint is written and then thrown away

`mutation.yml`'s cache comment says the save "runs on success alone, and
Stryker writes the file only when a run finishes". The second half is wrong
(§ 2.2); the first half is what actually loses the checkpoint. `actions/cache`'s
`action.yml` sets

```yaml
post: 'dist/save/index.js'
post-if: "success()"
```

([actions/cache action.yml](https://github.com/actions/cache/blob/main/action.yml))
— an explicit override of the platform default, which is that "The `post:`
action always runs by default"
([metadata syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax)).
A cancelled (timed-out) job is not `success()`, so the partial file Stryker just
wrote is never uploaded. The action's own escape hatch is the split form:
"users now have the ability to use the `actions/cache/save` action to save the
cache by using an `always()` condition"
([actions/cache save README](https://github.com/actions/cache/blob/main/save/README.md)),
and `always()` "Causes the step to always execute, and returns `true`, even
when canceled"
([expressions reference](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)).
Cancelled-path steps still fit inside GitHub's five-minute cancellation budget
("After the 5 minute cancellation timeout period, the server will forcibly
terminate all jobs", same cancellation reference). Our run-id key scheme already
makes every save a fresh entry, so `restore` + `save if: always()` is a drop-in
change. Convergence across weeks then depends on one more condition: the
cancellation signal actually reaching Stryker (§ 2.2's caveat — and run
34128668967 showed it does *not* today: Stryker died as an orphan behind `sh`
with no partial-write log line). The cache split and the signal-delivery fix go
together, and the short-`timeout-minutes` dispatch in § 2.2 is the proof both
work before weekly convergence is promised.

### 2.4 Raising the timeout instead

`timeout-minutes` defaults to 360 and may not exceed the runner's job execution
limit ("if the timeout exceeds the job execution time limit for the runner, the
job will be canceled when the execution time limit is met instead" —
[workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).
A 3h estimate fits under 360 today; the cost is hosted minutes (the workflow
header's arithmetic: weekly-not-nightly exists because a nightly 2-vCPU run
burns ~1,800 of 2,000 free minutes), so raising to ~240 quadruples nothing —
the api leg already runs 120 wasted minutes; letting it finish makes those
minutes count. Combined with § 2.3 it becomes belt and braces.

### 2.5 `--force`, and disjoint `mutate` sets against one incremental file

`--force`: "Run all mutants, even if `incremental` is provided and an
incremental file exists" — the documented way to rebuild the file
([configuration docs](https://stryker-mutator.io/docs/stryker-js/configuration/)).
The incremental docs pair it with narrowed patterns
(`npx stryker run --incremental --force --mutate src/app.js`) and state the
merge property directly: "When combining `--incremental` with custom `--mutate`
patterns, StrykerJS will not remove mutants that are not in scope and still
report a full mutation report"
([incremental docs](https://stryker-mutator.io/docs/stryker-js/incremental/)).

Source confirms it (`packages/core/src/mutants/incremental-differ.ts`): mutants
are keyed by file name + location + mutator + replacement; old results whose
files are untouched are matched by a diff-match-patch text diff; and old results
that are **absent from the current mutant set and outside the current mutate
scope are pushed into the result anyway**:

```js
if (!currentMutantKeys.has(mutantKey) &&
    !this.isInMutatedScope(oldResult.relativeFileName, oldResult)) {
  ...
  mutants.push(reusedMutant);
}
```

So a run with a narrowed `mutate` **does not discard** incremental entries for
out-of-scope files: several sequential dispatches with disjoint `mutate` globs
sharing one incremental file each add their fresh results and carry everyone
else's forward, and each writes a full report. This is the supported
checkpoint-by-construction: beyond the interrupt write of § 2.2, there is no
other mid-run checkpoint mechanism in the source.

Reuse-validity rules worth keeping in view
([incremental docs](https://stryker-mutator.io/docs/stryker-js/incremental/)):
a killed mutant's result holds only while "the culprit test still exists, and it
didn't change"; a survivor's only while "no new test covers it, and no tests
changed". For **Vitest the diff granularity is "Tests per file"** (no
locations) — editing any test in a file invalidates results for all mutants that
file's tests killed. And the differ is blind to "non-test and non-mutant files",
environment and dependencies — a change to a migration or a fixture outside
`mutate` keeps stale results silently. An occasional `--force` run (say, first
Sunday of the month) is the honest corrective; it is also the recovery from any
merge-order accident in a sharded scheme.

---

## 3. Where a score trend lives

The constraint: `reports/` is git-ignored, the workflow keeps `mutation.json` as
a 14-day artifact, and the job summary shows one week's number with no history.

**Stryker dashboard.** Enabled "by … logging in with your GitHub account and
enabling it for your repository"; enabling generates a project API key
(supplied as `STRYKER_DASHBOARD_API_KEY`); reports are `PUT` to
`https://dashboard.stryker-mutator.io/api/reports/$PROJECT$/$VERSION$?module=$MODULE_NAME$`;
`dashboard.module` exists to "separate them logically, for example, in a
mono-repo setup"; and it provides "a mutation score badge to pimp your readme"
([dashboard docs](https://stryker-mutator.io/docs/General/dashboard/)). The fit
here is natural: one project (`github.com/betteranswers/better-answers`), one
module per leg (`api`, `core`), version `main`, badge in the README. **On
private repositories the docs are silent** — neither the docs page nor the
dashboard repo's [backend.md](https://github.com/stryker-mutator/stryker-dashboard/blob/master/docs/backend.md)
(which covers only OAuth login and hashed API keys for upload) documents read
access control, so treat a hosted report as public. This repository is public
(established in T-012 § 1), so that is a fact to note, not a blocker. Uploading
is one reporter (`"dashboard"`) plus one secret; on a partial week (§ 2) the
dashboard would show the partial-report score, so upload should stay on the
completed path, not `if: always()`.

**Committed report.** Would require un-ignoring some of `reports/` or a second
path, and commits a machine artifact into a tree whose configs explicitly chose
otherwise ("`reports/` is git-ignored" is written into both stryker configs).
Weakest option; only worth revisiting if the dashboard's terms change.

**Artifacts + job summaries (status quo).** Summaries give a per-run number,
artifacts a 14-day window, and neither gives a trend without a script that walks
old runs via the API. Fine as the floor; not a trend.

Recommendation: dashboard for the trend and badge, keep the job summary as the
at-a-glance number, keep the artifact for post-mortems.

---

## 4. Splitting long runs

### 4.1 First-party support: none

StrykerJS has no shard/split option — nothing in the
[configuration docs](https://stryker-mutator.io/docs/stryker-js/configuration/),
and the long-standing feature request for parallelised builds
([stryker-js#2707](https://github.com/stryker-mutator/stryker-js/issues/2707),
opened January 2021: a `stryker report` command combining JSON reports, plus a
skip-dry-run mode) was **closed stale**, with a newer ask about reusing Jest
sharding ([stryker-js#4806](https://github.com/stryker-mutator/stryker-js/issues/4806))
in the same territory. The reporter in #2707 documented the community shape:
CircleCI `tests split` across 10 containers, each mutating a subset, plus a
hand-rolled report merger. "stryker-multi"-style tooling is that same pattern
packaged; nothing in the Stryker org owns it.

### 4.2 The supported composition: sequential dispatches, one incremental file

What primary sources *do* support (§ 2.5) composes into a split without any
third-party glue: several scheduled/dispatched runs, each with a narrowed
`mutate` (per capability slice for core, per module for api), all sharing
`reports/mutation/stryker-incremental.json` through the cache. Each run adds its
scope's fresh results, carries the rest forward, and writes a **full** report —
so the job-summary score stays whole-leg, not per-shard. Sequencing matters only
for the cache read-modify-write (a later run must restore the earlier run's
save, which our `restore-keys` prefix scheme already provides); Stryker itself
doesn't care about order. The dry run is paid once per dispatch — under lever
(2) that cost is small, but it is the reason not to slice thinner than a few
dispatches.

### 4.3 Parallel matrix shards

Possible, but each shard needs its **own** incremental file and cache key
(parallel writers to one cache entry race; GitHub cache entries are immutable
once written), and there is no first-party report merge: either each shard
uploads to the dashboard as its own `module` (the dashboard's documented
mono-repo mechanism, § 3) and the aggregate lives there, or a merge script joins
the `mutation.json` files (the #2707 approach). Given the weekly cadence and
that levers (2) + (2.3) likely pull the api leg back inside a single job, the
sequential form in § 4.2 is the one worth reaching for first, and only if
needed.

---

## Sources

Docs:

- <https://stryker-mutator.io/docs/stryker-js/configuration/> — coverageAnalysis, mutate/ranges, ignorePatterns, ignoreStatic, disableTypeChecks, incremental/force, concurrency, timeouts, inPlace
- <https://stryker-mutator.io/docs/stryker-js/vitest-runner/> — forced perTest, single thread, bail, `vitest.related`, browser mode unsupported
- <https://stryker-mutator.io/docs/stryker-js/incremental/> — reuse rules, diffing, interrupted runs, per-runner test-diff granularity, `--force` + `--mutate`
- <https://stryker-mutator.io/docs/mutation-testing-elements/static-mutants/> — static mutants and `ignoreStatic`
- <https://stryker-mutator.io/docs/General/dashboard/> — dashboard auth, upload API, modules, badge
- <https://vitest.dev/config/isolate> and <https://vitest.dev/config/globalsetup> — isolation default, globalSetup lifecycle and `provide`
- <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation> — SIGINT/7500ms/SIGTERM/2500ms/kill, 5-minute cancellation budget
- <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax> — `timeout-minutes` default 360, cancel-on-exceed
- <https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax> — `post-if` defaults to `always()`
- <https://docs.github.com/en/actions/reference/workflows-and-actions/expressions> — `always()`, `cancelled()`

Source code (StrykerJS repo `stryker-mutator/stryker-js@master` unless stated):

- `packages/vitest-runner/src/vitest-test-runner.ts` — persistent ctx, `provide('activeMutant', …)`, `state.filesMap.clear()` + `ctx.start(files)`, forced `maxWorkers: 1`
- `packages/vitest-runner/src/stryker-setup.ts` — flag into `globalThis[ns]`, static vs runtime activation, per-test coverage ids
- `packages/core/src/reporters/mutation-test-report-helper.ts` — `reportAll` → `writeIncrementalReport`; partial write on interrupt
- `packages/core/src/unexpected-exit-handler.ts` — SIGABRT/SIGINT/SIGHUP/SIGTERM handling, forced second-signal exit
- `packages/core/src/mutants/incremental-differ.ts` — mutant keys, text diff, out-of-scope results carried into the written report
- `packages/core/src/process/4-mutation-test-executor.ts` and `3-dry-run-executor.ts` — where `reportAll` sits; dry-run timeout abort
- `packages/core/src/test-runner/timeout-decorator.ts` — timed-out mutant → `recover()` (worker recreated)
- `packages/core/src/test-runner/max-test-runner-reuse-decorator.ts` — 0 = never recycle
- Vitest repo `vitest-dev/vitest@main`: `packages/vitest/src/node/project.ts` (`_initializeGlobalSetup` once-guard), `packages/vitest/src/node/core.ts` (teardown only in `close()`)
- `actions/cache@main`: `action.yml` (`post-if: "success()"`), `save/README.md` (`save` with `always()`)
- <https://github.com/stryker-mutator/stryker-js/issues/2707>, <https://github.com/stryker-mutator/stryker-js/issues/4806> — sharding feature requests
- <https://github.com/stryker-mutator/stryker-dashboard/blob/master/docs/backend.md> — dashboard auth model

Repository files read: `.github/workflows/mutation.yml`,
`apps/api/stryker.config.mjs`, `packages/core/stryker.config.mjs`,
`docs/research/t-012-cubic.md` (format reference).
