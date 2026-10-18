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
- **Full-repo baseline**: the nightly `mutation` workflow
  (`.github/workflows/mutation.yml`, also dispatchable by hand) runs each
  workspace's `stryker.config.mjs` in shards that `scripts/mutation-shards.mjs`
  cuts from its `mutate` glob, and tracks the overall score. Never block a PR
  on it.

## Tools (use the ecosystem's standard — no custom mutators)

| Ecosystem | Tool | Notes |
|---|---|---|
| JS/TS | StrykerJS (`@stryker-mutator/core` + runner) | Official vitest/jest/karma runners; `coverageAnalysis: "perTest"` runs only the tests covering each mutant |
| Python | `mutmut` | In a venv; `mutmut run --paths-to-mutate <files>` |
| Rust | `cargo-mutants` | `cargo mutants -f <file>` |
| Go | `gremlins` | |
| JVM | PIT (pitest) | |

## JS/TS recipe (StrykerJS + Vitest)

Start a workspace that has no config from `apps/api/stryker.config.mjs` and
its `vitest.stryker.config.ts`, which carry this repository's settings
(`inPlace`, the JSON report, no `break`). `references/` holds the upstream
samples, which predate them.

```bash
pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner
```

Scope a run to the PR's changed logic files with `--mutate` after the script
(`pnpm --filter <workspace> run mutation --mutate '<files>'`; candidates from
`git diff --name-only origin/main... -- 'src/**/*.ts' | grep -v test`), never by
editing the config's `mutate`, which the nightly shards read.
Skip files that are mostly HTML/CSS template strings — string mutants
there are noise; use Stryker's `"file.ts:120-160"` line-range syntax to
target just the logic (it works, and it's how to mutate one function
inside a big route file).

Run the workspace's `mutation` script, `pnpm --filter <workspace> run
mutation` (flags after it reach Stryker); the JSON report lands in
`reports/mutation/mutation.json`.
`incremental` caches verdicts so re-runs after adding tests only re-test
affected mutants — but static mutants (top-level `const` initializers) can
stay stale in the cache; do a fresh run (delete
`reports/mutation/stryker-incremental.json`) before quoting final numbers.

Known sharp edges (hit in practice):
- **pnpm**: Stryker core can't auto-discover runner plugins; add
  `"plugins": ["@stryker-mutator/vitest-runner"]` explicitly.
- **Parsing results**: read `reports/mutation/mutation.json` (add the
  `json` reporter) — the HTML report's embedded data is NOT valid JSON
  (`<` sequences are split into JS string concatenations).
- **In place**: this repository's configs set `inPlace: true`, because
  Stryker's sandbox cannot resolve the shared tsconfig, so a run instruments
  `src` itself. Edit nothing under `src` while it runs, and recover an
  interrupted run as `docs/agents/mutation-triage.md` says.
- Add package scripts so runs/cleanup are one approvable command, e.g.
  `"mutation": "node ./node_modules/@stryker-mutator/core/bin/stryker.js
  run"`, `"clean:mutation": "rm -rf reports/mutation"` (this repository's temp dir
  and incremental file both live there). Start Stryker and vitest through
  `node <entry>`, never `npx`, `pnpm exec` or a bare `stryker`: on macOS a
  process tree rooted in a `.bin` shim pays a policy check on every spawn.

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
3. **Timeout**: Stryker's score counts a timed-out mutant as killed, and triage
   does not until a probe says so. A run's clock stops a slow mutant as
   readily as one that loops, so a `Timeout` row is a hypothesis, probed like
   a survivor (`docs/agents/mutation-triage.md`, *Controls*).

Don't chase a 100% score; a handful of annotated equivalents is normal.
Never gate CI on the score (`thresholds.break` stays `null`): a survivor the
nightly summary newly names is a task, and a falling score is not a failed build.

## Repo hygiene

- Leave each workspace's `stryker.config.mjs` `mutate` as it is
  (`scripts/mutation-shards.mjs` slices the nightly run from it) and scope a
  PR's run with `--mutate`. `reports/` is git-ignored.
- Record the first run's survived-mutant triage in the PR description —
  it's the evidence the refactor's tests mean something.
