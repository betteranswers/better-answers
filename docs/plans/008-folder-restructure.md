---
title: Restructure Crowded Folders - Plan
type: refactor
date: 2026-10-27
topic: folder-restructure
artifact_contract: ce-unified-plan/v1
product_contract_source: linear:BA-255
execution: code
---

# Restructure Crowded Folders - Plan

This plan is not on the v0.1 route. It serves the owner's request of 27/10/2026 to restructure the folders that hold dozens of loose files, so that an agent finds a file and its test without searching.

## Goal Capsule

- **Objective:** An agent names the file from the capability, and the test from the file. No folder in a source or test tree holds more than 15 loose files, except where a path is pinned.
- **Means:** Files move and imports are rewritten by a codemod. The five largest product files are split by concern. Behaviour does not change.
- **Authority:** Linear BA-255 and the owner's answers of 27/10/2026: restructure the named folders and others where it makes sense, and split `ops/index.ts`, `boundary-schemas.ts`, `concepts/index.ts`, `store/postgres/index.ts` and `links.py`.
- **Stop conditions:** Stop and report if a move needs a `contracts/` edit, a migration, a changed package `exports` key, or a test assertion edit.
- **Execution profile:** Twelve pull requests, one at a time, each cut from fresh `main` after the previous one lands.
- **Who finishes:** Each session lands its own pull request once an independent review passes.

## The layout

1. **Source groups by capability.** `src/<capability>/`, named with the glossary's words. A slice or feature over 15 loose files gets subfolders by sub-capability. A file that something other than an import pins by path stays where it is.
2. **Tests mirror source.** The test for `src/a/b/x.ts` is `test/a/b/x.test.ts` (`tests/a/b/test_x.py` in Python, `e2e/<feature>/x.spec.ts` in web). Mirroring wins over avoiding a one-file folder. Tests that check the repository itself stay at the test root.
3. **Shared test helpers live in `support/`.** Web tests reach it through a `@test/*` alias. Worker tests reach it through `pythonpath = ["tests"]` and a `support` package.
4. **At most 15 loose files per folder** in every `src`, `test`, `tests` and `e2e` tree. The `loose-files` gate holds the cap. Its table starts at today's counts, and each PR deletes the entries of the folders it fixes.
5. **The five largest product files are split by concern**, export names unchanged. The other files with a `max-lines` override keep it.

## Constraints found by the maps

- `apps/worker/.../pipeline/detected.py`'s module path is part of the stored-detection cache key, so `pipeline/` does not move. `redaction/` is pinned by the image's early COPY and CI cache keys.
- Any edit under `contracts/` changes the contract digest, which both tiers compare before work runs. Prose there that names a moved path is left for a follow-up.
- `packages/devtools/src/paths.ts` finds the repository root from its own depth, so it does not move.
- A new folder directly under `packages/core/src/` is a new slice to `import-direction` and `table-ownership-scan`. Core groups inside its existing slices only.
- Folder names to avoid: `test`, `tests`, `e2e`, `build`, `dist`, `lifts`, `reports`, `coverage`, `skills`.
- The web lint forbids sibling-subfolder imports inside a feature, so a file two subfolders share stays at the feature root.
- Each split api ops test file calls `objectStoreForSuite()` itself, or the object store never starts.
- jCodeMunch indexes the main checkout, not a worktree. Path checks use `git grep` and the real tools.

## Delivery

The PRs share files: `insert-scan.ts`'s factory list, `.oxlintrc.json`, a worker port check naming a core path, and an api test walking core's `src/`. So they land one at a time, in this order.

| # | Issue | PR | Map |
| --- | --- | --- | --- |
| 1 | BA-256 | devtools moves, the `loose-files` gate, the move codemod | [devtools](008-folder-restructure/devtools.md) |
| 2 | BA-257 | schema moves | [schema-core](008-folder-restructure/schema-core.md) |
| 3 | BA-258 | schema split: `boundary-schemas.ts` | [schema-core](008-folder-restructure/schema-core.md) section 6 |
| 4 | BA-259 | core moves | [schema-core](008-folder-restructure/schema-core.md) |
| 5 | BA-260 | core split: `concepts/index.ts` | [schema-core](008-folder-restructure/schema-core.md) section 6 |
| 6 | BA-261 | core split: `store/postgres/index.ts` | to be mapped |
| 7 | BA-262 | worker moves | [worker](008-folder-restructure/worker.md) |
| 8 | BA-263 | worker split: `links.py` | [worker](008-folder-restructure/worker.md) section 6 |
| 9 | BA-264 | api moves | [api](008-folder-restructure/api.md) |
| 10 | BA-265 | api split: `ops/index.ts` and `ops.test.ts` | [api](008-folder-restructure/api.md) section 6 |
| 11 | BA-266 | web moves and the `@test/*` alias | [web](008-folder-restructure/web.md) |
| 12 | BA-267 | AGENTS.md convention and layout table, stale docs | none |

Each map holds the move table, every path named outside an import with `file:line`, and the risks. The maps were drawn against `main` at d6fc08ee6, so each PR re-checks its table against the tree it starts from.

Each PR moves the `max-lines` override of any capped file it moves. If a capped file's cap breaks only because longer import paths wrap, the PR raises the cap by that many lines and says so.

## How each PR runs

1. Write the move table as a TSV of `<old>\t<new>` repo-relative paths.
2. Run `node scripts/move-files.mjs <table> --dry-run`, then without `--dry-run`. It rewrites relative and alias imports, `import.meta.dirname` joins, package.json targets and repo-relative mentions, then runs `git mv`. It reports what it could not resolve and any workspace-relative mention left behind.
3. Make the hand edits the map lists, which the codemod reports but does not make.
4. Run `pnpm format`, the workspace's `check` and `pnpm check:gates`.
5. Run `scripts/test-inventory.sh <dir>` before and after the move and `diff` the two directories: every test file name and title must match. A split test file compares by title.
6. Web runs the full Playwright suite on the served build, with no assertion edits.
