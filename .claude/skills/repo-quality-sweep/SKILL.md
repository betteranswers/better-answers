---
name: repo-quality-sweep
description: Applies the quality skills (DRY, complexity-gate, code-comments, mutation-testing) across an entire repo as a series of small behavior-preserving PRs. Use when asked to clean up / tidy / harden a codebase, execute a documentation-or-refactor sweep issue, or bring legacy code in line with current standards.
---

# Repo Quality Sweep

Composes the atomic skills — load them, don't restate them:
`complexity-gate`, `code-comments`, `mutation-testing`. The project's own
rules file sets their specifics (the complexity cap, which packages are
in scope), and its workflow sets the branch, PR and merge mechanics. This
skill only adds the repo-level loop and the per-file pass order.

## Phase 0 — Inventory (read-only, one sitting)

Build a ranked worklist before touching anything:

1. **Risk ranking**: CRAP report (`complexity-gate` skill) — functions
   over ~30 lead the list; full mutation run if the repo has it wired
   (`mutation-testing` skill) for survived-mutant density.
2. **Complexity inventory**: full-repo complexity lint; record the
   violation count as the baseline.
3. **Duplication**: `npx jscpd src/ --min-tokens 50` (library, not a
   hand-rolled grep) for DRY targets; `npx knip` for dead exports.
4. **Comment smells**: provenance narration and TODOs, both of which the
   `code-comments` skill removes
   (`grep -rnE "found by|per PR #|caught by #|review round|TODO|FIXME" src/`).

Output: a worklist grouped by directory/module, ordered by risk (CRAP
rank first, duplication clusters second, comment-only files last). File
it in the project's issue tracker, one checkbox or ticket per group — the
sweep survives sessions.

## Phase 1 — The loop: one small PR per area

For each worklist group, one branch, one PR, reviewable in minutes,
through the project's own workflow. NEVER mix behavior changes into a
sweep PR — if a real bug surfaces, file it in the tracker and fix it
separately.

Per-file pass, in this order (refactor before documenting — never
polish comments on code about to move):

1. **DRY**: extract duplicated literal families/logic per the inventory.
   Single-edit-should-be-single-edit is the test for what deserves
   extraction; don't create constants for values used once.
2. **Complexity**: decompose any function over the cap — the project's
   configured cap, `complexity-gate`'s where it sets none — into named
   helpers (`complexity-gate` skill). Extract at natural seams (a
   try/catch block, a mode branch) — each helper should have a contract
   its name can carry, not be an arbitrary half.
3. **Comments**: apply the `code-comments` skill.
4. **Verify**: typecheck + full tests green; complexity lint clean on the
   touched files; if step 1 or 2 touched logic, a scoped mutation run
   (`mutation-testing` skill) proving no new survivors in the region —
   quote the before/after in the PR description.

## Phase 2 — Close the loop

- Re-run the Phase 0 inventory after the last PR; report baseline deltas
  (complexity violations, CRAP>30 count, mutation score, jscpd clones).
- Fold anything learned (a new smell, a better tool invocation) back into
  the atomic skill it belongs to — this skill stays a thin orchestrator.

## Scope guards

- Skip generated code, vendored code, and files slated for deletion.
- A sweep PR that grows past ~400 changed lines gets split.
- Legacy code not on the worklist is out of scope — the standing
  touched-files gates handle it organically.
