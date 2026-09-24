---
name: mutation-testing
description: Verify the test suite actually constrains behavior by running scoped mutation testing (StrykerJS, mutmut, cargo-mutants, PIT). Use after any refactor, before merging a PR that touches pure logic / validation / parsing, or whenever test coverage is in doubt.
---

# Mutation Testing

Line coverage proves code *ran* under test; mutation testing proves tests
*constrain* it. The tool injects small behavioral changes (mutants) —
flipped conditions, deleted statements, changed literals — and re-runs the
tests. A mutant that survives marks code whose behavior no test pins down.
This matters most on refactors: a behavior-preserving change can keep every
test green while silently changing behavior nobody asserted.

## When in the lifecycle

Run it in the same slot as code review: **after tests are green, before
requesting review/merge** — never in the TDD inner loop (too slow).

Fires on:
- Any refactor (DRY sweeps, extractions, rewrites claiming "no behavior change").
- PRs touching validation, parsing, sanitization, auth checks, or other
  security-relevant pure logic.
- Whenever coverage is in doubt ("do our tests actually check this?").

Skip: UI/copy/style-only diffs, config changes, prototypes, generated code.

Two modes:
- **PR-scoped (the default)**: mutate only the changed logic files. Minutes,
  not hours. This is the practice.
- **Full-repo baseline**: occasional audit (manually-dispatched workflow or
  background run) to track the overall mutation score. Never block a PR on
  it. Reference setup: a `mutation:full` package script (`stryker run
  --incrementalFile reports/stryker-incremental-full.json --mutate
  'src/**/*.ts,!src/**/*.test.ts,!<generated>,!<test-utils>'` — separate
  incremental file so audit and scoped runs don't poison each other's
  cache) plus a `workflow_dispatch`-only GitHub Actions job that runs it
  and uploads `reports/` as an artifact (pair it with the CRAP report from
  the `complexity-gate` skill — one artifact answers both "what's untested"
  and "what's risky").

## Tools (use the ecosystem's standard — no custom mutators)

| Ecosystem | Tool | Notes |
|---|---|---|
| JS/TS | StrykerJS (`@stryker-mutator/core` + runner) | Official vitest/jest/karma runners; `coverageAnalysis: "perTest"` runs only the tests covering each mutant |
| Python | `mutmut` | In a venv; `mutmut run --paths-to-mutate <files>` |
| Rust | `cargo-mutants` | `cargo mutants -f <file>` |
| Go | `gremlins` | |
| JVM | PIT (pitest) | |

## JS/TS recipe (StrykerJS + Vitest)

Reference implementations in `references/` (working configs, battle-tested):
- `references/stryker.config.json` — copy and update `mutate` per PR
- `references/vitest.stryker.config.mts` — the isolated unit-only runner config

```bash
pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner
```

Scope `mutate` to the PR's changed logic files
(`git diff --name-only origin/main... -- 'src/**/*.ts' | grep -v test`).
Skip files that are mostly HTML/CSS template strings — string mutants
there are noise; use Stryker's `"file.ts:120-160"` line-range syntax to
target just the logic (it works, and it's how to mutate one function
inside a big route file).

Run `npx stryker run`; the HTML report lands in `reports/mutation/`.
`incremental` caches verdicts so re-runs after adding tests only re-test
affected mutants — but static mutants (top-level `const` initializers) can
stay stale in the cache; do a fresh run (delete
`reports/stryker-incremental.json`) before quoting final numbers.

Known sharp edges (hit in practice):
- **pnpm**: Stryker core can't auto-discover runner plugins; add
  `"plugins": ["@stryker-mutator/vitest-runner"]` explicitly.
- **Parsing results**: read `reports/mutation/mutation.json` (add the
  `json` reporter) — the HTML report's embedded data is NOT valid JSON
  (`<` sequences are split into JS string concatenations).
- **Sandbox recursion**: Stryker copies the repo into `.stryker-tmp/`
  sandboxes; exclude `.stryker-tmp/**` from the test runner's discovery
  and add bulky gitignored dirs (worktrees, reports) to Stryker's
  `ignorePatterns`, or sandboxes balloon and tests double-run.
- Add package scripts so runs/cleanup are one approvable command, e.g.
  `"mutation": "stryker run"`, `"clean:mutation": "rm -rf .stryker-tmp
  reports/mutation reports/stryker-incremental.json"`.

**Multi-project / heavyweight test-runner gotcha.** If the repo's Vitest
config defines multiple projects, point Stryker at a dedicated config that
includes ONLY the fast unit project (`"vitest": {"configFile":
"vitest.stryker.config.mts"}`). Never let Stryker drive a test project that
boots a heavy runtime or loads live secrets (e.g. Cloudflare's
`vitest-pool-workers` reading `.dev.vars`) — mutation testing spawns
hundreds of runs. If the runner integration fights the repo's config, fall
back to `"testRunner": "command"` with the exact unit-test command — slower
(no perTest filtering) but always compatible.

## Triage — what to do with survived mutants

Work the survived list; the score is secondary.

1. **Real gap (the common case)**: no test asserts that behavior. Add or
   strengthen a test that kills the mutant. Prefer asserting the contract
   (exact key string, returned value, rejection) over implementation detail.
   For mutated string CONSTANTS, pick the assertion by what the string is:
   - **Contract with external state** (storage key layouts, wire event
     names, cookie names — something already stored or deployed depends on
     the exact bytes): pin the EXACT string.
   - **Config validated downstream at runtime** (model ids, endpoint
     names): assert the SHAPE only (non-empty, expected pattern). An exact
     pin is the config hardcoded twice — every legitimate change edits two
     files for zero information.
2. **Equivalent / don't-care mutant**: the mutation genuinely doesn't change
   observable behavior (log wording, defensive redundancy). "No test
   distinguishes them" is NOT "no input does" — before ruling a mutant
   equivalent, actively try to construct the distinguishing input, thinking
   adversarially for security guards (a guard on parsed-URL parts was once
   ruled equivalent this way and the "redundant" check turned out to block a
   path-embedded payload). Do NOT suppress these unilaterally — present each
   candidate to the user with the reasoning and get agreement first (the
   user calibrates the triage rule this way; they may later delegate it). Once agreed, suppress with a reasoned
   annotation rather than a contrived test:
   `// Stryker disable next-line <MutatorName>: <why this is untestable/don't-care>`
3. **Timeouts count as killed** (the mutant broke termination — tests caught it).

Don't chase a 100% score; a handful of annotated equivalents is normal.
Gate CI (`thresholds.break`) only after a suite has a stable baseline, and
only on the scoped files, or the gate becomes noise.

## Repo hygiene

- Keep `stryker.config.json` in the repo after first use (update `mutate`
  per PR, or drive it from the git diff); gitignore `reports/` and
  `.stryker-tmp/`.
- Record the first run's survived-mutant triage in the PR description —
  it's the evidence the refactor's tests mean something.
