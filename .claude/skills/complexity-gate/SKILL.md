---
name: complexity-gate
description: Enforce the cyclomatic-complexity cap (≤ 8 per function) on all code generation, and set up per-project lint tooling for it. Use when writing or modifying any function, when setting up a new project's lint config, or when the user mentions complexity, CRAP score, or over-nested code.
---

# Complexity Gate

Every function written or modified must have cyclomatic complexity ≤ 8.
Decompose into named helpers instead of nesting further. When a function
you must touch already exceeds 8, don't grow it — extract as you go.
Legacy functions you aren't touching are not your problem that day.

## CRAP, for orientation

CRAP (Change Risk Anti-Patterns) = `comp² × (1 − coverage)³ + comp`;
alarm threshold ≈ 30. It says complex-AND-untested is where change risk
lives. This gate holds the `comp` factor at ≤ 8 (CRAP ≤ 72 even with zero
coverage, ≤ 8 with full coverage); the `mutation-testing` skill is what
makes the coverage factor honest.

ESLint is the right tool for the per-function COMPLEXITY gate (fast,
changed-files scoping, CI-friendly) but computes no coverage, so it can't
produce CRAP itself. For the CRAP report use `crap-score` (npm, from
ahilke/js-crap-score — validated working against Vitest v8 coverage);
alternatives `crap4ts` (Rust CLI) and crap4js exist but are younger. Use
it as a periodic AUDIT ranking the riskiest functions — not a per-PR
gate; the ESLint cap + scoped mutation runs are the gates.

Working invocation (package script `crap`):

```
vitest run --project node --coverage --coverage.reporter=json \
  --coverage.reportsDirectory=reports/coverage
crap-score reports/coverage/coverage-final.json \
  --json reports/crap/crap-report.json --html reports/crap/html
```

Reading the JSON: per-file → per-function objects; the score is
`statements.crap` (NOT top-level), complexity is `complexity`. Rank
descending, alarm at > 30. Run it from a `workflow_dispatch`-only GitHub
Actions job alongside the full mutation audit, uploading `reports/` as an
artifact.

## Tooling per ecosystem

| Ecosystem | Tool | Config |
|---|---|---|
| JS/TS | ESLint `complexity` rule | `references/eslint.config.mjs` — copy as the reference implementation |
| Python | ruff `C901` | `[tool.ruff.lint] select += ["C901"]`, `[tool.ruff.lint.mccabe] max-complexity = 8` |
| Go | `gocyclo -over 8 .` | |
| Rust | clippy `cognitive_complexity` (nightly-ish; threshold via `clippy.toml`) | |

## JS/TS setup (reference implementation)

```bash
pnpm add -D eslint typescript-eslint
```

Copy `references/eslint.config.mjs` into the repo root and adapt the
`ignores` list (generated code, build artifacts, worktrees, tool
sandboxes). Keep it a **complexity-only** config — do not let it grow
into a style linter; that's a separate, deliberate decision.

Two entry points (this split is the load-bearing design — reviewers WILL
flag a "gate" that legacy code fails and CI never runs):

```jsonc
"lint:complexity": "eslint .",
"lint:complexity:changed": "bash scripts/lint-complexity-changed.sh"
```

- `lint:complexity` — whole repo, ADVISORY inventory. On a legacy repo it
  fails (record the baseline count when adopting); never wire it to CI
  until the baseline is near zero.
- `lint:complexity:changed` — `references/lint-complexity-changed.sh`
  (copy into `scripts/`): lints only files changed vs the base ref. THIS
  is the gate; wire it into PR CI. Bash-3.2-safe (no mapfile), shellcheck
  clean, `--no-warn-ignored` so changed generated files stay silent.

CI step (GitHub Actions): run it on `pull_request` only, with the base
ref passed through an `env:` variable (never interpolate `${{ github.* }}`
into `run:` text — shell injection) and `fetch-depth: 0` on checkout (a
shallow PR-merge checkout can't compute the merge-base diff):

```yaml
- name: Complexity gate (changed files)
  if: github.event_name == 'pull_request'
  env:
    BASE_REF: ${{ github.base_ref }}
  run: bash scripts/lint-complexity-changed.sh "origin/${BASE_REF}"
```

## Lifecycle

- **During codegen**: the ≤ 8 cap applies to every function you write or
  modify, enforced by you as you write — the linter is the backstop.
- **Before committing**: run `pnpm lint:complexity:changed`; a violation
  in a function you modified is a must-fix.
- **When the gate fires on a function you did NOT modify** (the gate is
  file-scoped, so touching any line of a file surfaces its legacy
  offenders): the DEFAULT is to decompose that function now — the firing
  gate IS the sweep arriving there, and the fix is usually minutes. Never
  add an `eslint-disable` to get green without the user's explicit OK;
  present it as a decision with the fix cost attached. A suppression
  hides the debt from the only mechanism that surfaces it.
- **Legacy repos**: over-cap functions the gate hasn't surfaced yet are
  out of scope until touched; the changed-files gate enforces exactly
  that without blocking on the backlog.

## Decomposition playbook

What actually brings a CC-30 handler under the cap without changing its
output. Measured on a real route-file decomposition (7 functions, CC
37/27/16/15/14/10/9 → all ≤ 8, byte-identical responses).

- **Probe what the installed rule counts before designing.** ESLint's
  `complexity` counts every `?.` link, `??`, `&&`/`||`, ternary, `catch`,
  and loop as +1 — `x?.a?.b ?? "z"` alone is CC 4. Thirty-second check:
  `npx eslint --rule 'complexity: ["error", 0]' probe.ts` on a scratch
  file prints the count of each construct you're unsure about.
- **Narrow once with a type guard, then pass non-null values down.** A
  single `isScored(meta)` guard at the top of the handler lets every
  helper take the narrowed type and drop its `meta?.x` / `meta ? … : …`
  defensiveness — often ten CC points across a file for one guard.
- **Delete dead branches before extracting them.** A guard that cannot
  fail after an earlier return, or a ternary whose arms are mutually
  exclusive by construction, is pure CC cost with zero behavior. Delete,
  don't relocate.
- **Split handlers into load → render.** The handler keeps I/O and
  guards; `renderXPage(input)` is pure string assembly. Each side lands
  ≤ 8 naturally, and the pure side becomes unit-testable and
  mutation-visible.
- **Same-shape `if/else` chains → a table + `filter`/`map`.** Three pill
  branches become `[["Tight: ", tight], ["Wide: ", wide], ["", proceed]]`
  filtered for presence: byte-identical output, CC 1.
- **Move template literals verbatim.** Carry the backtick body, not its
  content — leading whitespace inside a multi-line template is output.
  Hoist CSS/JS blocks to module constants; keep interpolations in a
  function that takes only the variables it needs.
- **Byte-identity needs a harness, not the existing tests.** Write a
  throwaway test that renders every route × branch-covering fixtures and
  dumps status + headers + body to disk; `diff -r` before vs after.
  Substring-thin suites (the kind a 40% mutation score reveals) will not
  catch a swapped pill or a dropped separator. Never commit the harness.
- **Stryker after a split is attribution, not regression.** Survivors
  that lived inside one 200-line handler now show up per helper. Group
  them by enclosing function and add tests only where a helper holds
  logic — thresholds, `>=` vs `>` boundaries, both arms of each `if` — not
  for CSS or copy literals. Delete the incremental cache before each run
  (`mutation-testing` skill).
