# Explore: devtools (Job 1) and the repo-wide path-coupling map (Job 2)

> **Note, 28/10/2026.** This map records the tree at `d6fc08ee6`. PR #913 carried it out. Paths and line numbers here can differ from `main`.

Read-only. Worktree `refactor/folder-restructure` at `d6fc08ee6`. Every `file:line` below was read in this worktree. Counts come from `ls`.

---

# Job 1. `packages/devtools`

## 1. Inventory

| Folder | Loose files now | After |
| --- | --- | --- |
| `packages/devtools/src/` | 21 (the brief said 22; `ls src \| wc -l` gives 21) | 6 |
| `packages/devtools/test/` | 43 files plus the `ci/` folder | 6 |
| `packages/devtools/test/ci/` | 19 (18 `.ts`, 1 `.sh`) | 12 |
| new `src/comments/` | - | 3 |
| new `src/mutation/` | - | 3 |
| new `src/scans/` | - | 6 |
| new `src/root-config/` | - | 3 |
| new `test/comments/` | - | 4 |
| new `test/lint-rules/` | - | 6 |
| new `test/mutation/` | - | 4 |
| new `test/root-config/` | - | 8 |
| new `test/scans/` | - | 8 |
| new `test/support/` | - | 8 |
| new `test/worktrees/` | - | 6 |

Out of scope and left alone: `lint-rules/` (an index, 9 rules, 2 shared files), `lifts/anti-slop/` (a vendored snapshot), `python/` (6 files).

## 2. Target tree

```
packages/devtools/src/
  paths.ts              stays (repositoryRoot is "../../.." from here; see Risks R1)
  throwaway-tree.ts     stays (the shared runner every gate and suite uses)
  flags.ts              stays (shared argv parser: comment-inventory, mutation-*)
  parsed-source.ts      stays (shared oxc parse: comment-inventory, face-admission, refusal-unions, table-ownership-scan)
  reap-containers.ts    stays (its only neighbours are test helpers; a one-file folder is not allowed)
  worktree-hooks.ts     stays (a test-support library for the worktree hook suites and apps/api; same reason)
  comments/      citations.ts  comment-density.ts  comment-inventory.ts
  mutation/      mutant-probe.ts  mutation-shards.ts  mutation-summary.ts
  scans/         auth-seam-scan.ts  face-admission.ts  insert-scan.ts  jscpd.ts  refusal-unions.ts  table-ownership-scan.ts
  root-config/   oxlint-config.ts  root-commands.ts  workflows.ts

packages/devtools/test/
  contract-digest.test.ts  reap-containers.test.ts  solutions-docs.test.ts
  test-title-setup.test.ts  testcontainers-patch.test.ts  throwaway-tree.test.ts
  comments/      comment-density  comment-gate-python  comment-inventory  comment-lint   (.test.ts)
  lint-rules/    action-admits-before-await  comment-only-the-why  declaration-doc-block
                 import-statically  parameter-never-mutated  string-cites-nothing       (.test.ts)
  mutation/      mutant-probe  mutation-shards  mutation-summary  vitest-runner-patch   (.test.ts)
  root-config/   commit-msg-hook  complexity-cap  lefthook-config  lint-workflows
                 oxlint-config  restricted-syntax  root-commands  test-titles           (.test.ts)
  scans/         auth-seam-scan  face-admission  insert-scan  jscpd  knip  port-scan
                 refusal-unions  table-ownership-scan                                   (.test.ts)
  support/       caller-counts.ts  fixture-text.ts  held-containers.ts  holds-a-container.ts
                 oxlint-fix.ts  rule-baseline.ts  script-stand-ins.ts  stryker-workspace.ts
  worktrees/     jdocmunch-watch-cap  provision-skills  provision-worktree  sweep-worktrees
                 worktree-create-hook  worktree-remove-hook                             (.test.ts)
  ci/            check-scripts  dependency-versions  deploy-tree  docs-lane  ghcr-cleanup  image-job
                 mutation-baseline  prune-images  release-job  scan-job  workflow-permissions (.test.ts)
                 docker-stand-in.sh
```

### Why these groups

- **Grouping is by gate or concern** (brief rule 1 for tooling). `comments` is the comment gate: density, the inventory and the citation shape that the `comment-only-the-why` and `string-cites-nothing` rules read through `lint-rules/rules/*.ts:4`. `mutation` is the Stryker shard, summary and probe tooling, plus the vitest-runner patch suite. `scans` holds the root `pnpm run <gate>` scans and the two core-shape scanners (`face-admission`, `refusal-unions`). `knip` and `jscpd` sit here because each is a root gate run over the tree. `root-config` holds the readers of root config files (`.oxlintrc.json`, root `package.json` scripts, `.github/workflows/*`) and the suites that test those files (lefthook, commit-msg, lint:workflows, the oxlint rule caps).
- **Name choice.** `root-config` and not `config`. In this repository "the config module" means a tier's environment module (`AGENTS.md`, Coding), so `config/` would mislead.
- **Mirror rule (brief rule 3), adapted.** Every `src/<group>/x.ts` that has a suite gets `test/<group>/x.test.ts`. Most devtools suites have no `src/` file. The lint-rule suites exercise `lint-rules/rules/<rule>.ts`, so they go to `test/lint-rules/<rule>.test.ts`, which mirrors `lint-rules/rules/`. The ci suites exercise workflows and scripts. The knip, jscpd, lefthook and commit-msg suites exercise root configs. Those group by concern.
- **`test/support/`** takes every helper that more than one suite imports. `caller-counts.ts` (2 suites). `fixture-text.ts` (5). `oxlint-fix.ts` (2). `rule-baseline.ts` (2). `stryker-workspace.ts` (2). `ci/script-stand-ins.ts` (2). `held-containers.ts` (2) with `holds-a-container.ts`, which it spawns by sibling path, so the two move together. `docker-stand-in.sh` has one reader (`prune-images.test.ts:10`) and stays beside it in `ci/`.
- **`test/worktrees/`** takes the six suites that drive `.claude/hooks` worktree scripts through `src/worktree-hooks.ts`. None of them is CI. This gets `ci/` from 19 to 12.
- **Folder names avoided**: `test`, `tests`, `e2e`, `skills`, `build`, `dist`, `lifts`, `reports`, `coverage`. See Risks R6.

### Move table (every file that moves; `git mv`)

| old | new |
| --- | --- |
| `src/citations.ts` | `src/comments/citations.ts` |
| `src/comment-density.ts` | `src/comments/comment-density.ts` |
| `src/comment-inventory.ts` | `src/comments/comment-inventory.ts` |
| `src/mutant-probe.ts` | `src/mutation/mutant-probe.ts` |
| `src/mutation-shards.ts` | `src/mutation/mutation-shards.ts` |
| `src/mutation-summary.ts` | `src/mutation/mutation-summary.ts` |
| `src/auth-seam-scan.ts` | `src/scans/auth-seam-scan.ts` |
| `src/face-admission.ts` | `src/scans/face-admission.ts` |
| `src/insert-scan.ts` | `src/scans/insert-scan.ts` |
| `src/jscpd.ts` | `src/scans/jscpd.ts` |
| `src/refusal-unions.ts` | `src/scans/refusal-unions.ts` |
| `src/table-ownership-scan.ts` | `src/scans/table-ownership-scan.ts` |
| `src/oxlint-config.ts` | `src/root-config/oxlint-config.ts` |
| `src/root-commands.ts` | `src/root-config/root-commands.ts` |
| `src/workflows.ts` | `src/root-config/workflows.ts` |
| `test/comment-density.test.ts` | `test/comments/comment-density.test.ts` |
| `test/comment-gate-python.test.ts` | `test/comments/comment-gate-python.test.ts` |
| `test/comment-inventory.test.ts` | `test/comments/comment-inventory.test.ts` |
| `test/comment-lint.test.ts` | `test/comments/comment-lint.test.ts` |
| `test/action-admits-before-await.test.ts` | `test/lint-rules/action-admits-before-await.test.ts` |
| `test/comment-only-the-why.test.ts` | `test/lint-rules/comment-only-the-why.test.ts` |
| `test/declaration-doc-block.test.ts` | `test/lint-rules/declaration-doc-block.test.ts` |
| `test/import-statically.test.ts` | `test/lint-rules/import-statically.test.ts` |
| `test/parameter-never-mutated.test.ts` | `test/lint-rules/parameter-never-mutated.test.ts` |
| `test/string-cites-nothing.test.ts` | `test/lint-rules/string-cites-nothing.test.ts` |
| `test/mutant-probe.test.ts` | `test/mutation/mutant-probe.test.ts` |
| `test/mutation-shards.test.ts` | `test/mutation/mutation-shards.test.ts` |
| `test/mutation-summary.test.ts` | `test/mutation/mutation-summary.test.ts` |
| `test/vitest-runner-patch.test.ts` | `test/mutation/vitest-runner-patch.test.ts` |
| `test/commit-msg-hook.test.ts` | `test/root-config/commit-msg-hook.test.ts` |
| `test/complexity-cap.test.ts` | `test/root-config/complexity-cap.test.ts` |
| `test/lefthook-config.test.ts` | `test/root-config/lefthook-config.test.ts` |
| `test/lint-workflows.test.ts` | `test/root-config/lint-workflows.test.ts` |
| `test/oxlint-config.test.ts` | `test/root-config/oxlint-config.test.ts` |
| `test/restricted-syntax.test.ts` | `test/root-config/restricted-syntax.test.ts` |
| `test/root-commands.test.ts` | `test/root-config/root-commands.test.ts` |
| `test/test-titles.test.ts` | `test/root-config/test-titles.test.ts` |
| `test/auth-seam-scan.test.ts` | `test/scans/auth-seam-scan.test.ts` |
| `test/face-admission.test.ts` | `test/scans/face-admission.test.ts` |
| `test/insert-scan.test.ts` | `test/scans/insert-scan.test.ts` |
| `test/jscpd.test.ts` | `test/scans/jscpd.test.ts` |
| `test/knip.test.ts` | `test/scans/knip.test.ts` |
| `test/port-scan.test.ts` | `test/scans/port-scan.test.ts` |
| `test/refusal-unions.test.ts` | `test/scans/refusal-unions.test.ts` |
| `test/table-ownership-scan.test.ts` | `test/scans/table-ownership-scan.test.ts` |
| `test/caller-counts.ts` | `test/support/caller-counts.ts` |
| `test/fixture-text.ts` | `test/support/fixture-text.ts` |
| `test/held-containers.ts` | `test/support/held-containers.ts` |
| `test/holds-a-container.ts` | `test/support/holds-a-container.ts` |
| `test/oxlint-fix.ts` | `test/support/oxlint-fix.ts` |
| `test/rule-baseline.ts` | `test/support/rule-baseline.ts` |
| `test/stryker-workspace.ts` | `test/support/stryker-workspace.ts` |
| `test/ci/script-stand-ins.ts` | `test/support/script-stand-ins.ts` |
| `test/ci/jdocmunch-watch-cap.test.ts` | `test/worktrees/jdocmunch-watch-cap.test.ts` |
| `test/ci/provision-skills.test.ts` | `test/worktrees/provision-skills.test.ts` |
| `test/ci/provision-worktree.test.ts` | `test/worktrees/provision-worktree.test.ts` |
| `test/ci/sweep-worktrees.test.ts` | `test/worktrees/sweep-worktrees.test.ts` |
| `test/ci/worktree-create-hook.test.ts` | `test/worktrees/worktree-create-hook.test.ts` |
| `test/ci/worktree-remove-hook.test.ts` | `test/worktrees/worktree-remove-hook.test.ts` |

That is 15 src moves, 44 test moves (37 from the test root, 7 from `ci/`), and no renames.

## 3. Path coupling for the devtools moves

**The main fact.** Every devtools suite and every outside consumer (`apps/api/tests/*`, `apps/web/test/*`, `packages/core/test/*`, `jscpd.config.mjs:1`) imports devtools src through `@better-answers/devtools/<key>`. A src move therefore changes the 19 export **targets** and no key. The places that name src paths directly follow.

### src moves

| Where | What | Edit |
| --- | --- | --- |
| `packages/devtools/package.json:9-26` | 15 `exports` targets `./src/<x>.ts` | Point each target at its new path. Keys stay. |
| `scripts/auth-seam-scan.mjs:13` | `../packages/devtools/src/auth-seam-scan.ts` | `.../src/scans/auth-seam-scan.ts` |
| `scripts/auth-seam-scan.mjs:14` | `../packages/devtools/src/throwaway-tree.ts` | unchanged (stays) |
| `scripts/comment-density.mjs:11` | `.../src/comment-density.ts` | `.../src/comments/comment-density.ts` |
| `scripts/comment-inventory.mjs:1` | `.../src/comment-inventory.ts` | `.../src/comments/comment-inventory.ts` |
| `scripts/insert-scan.mjs:5` | `.../src/insert-scan.ts` | `.../src/scans/insert-scan.ts` |
| `scripts/jscpd.mjs:6` | `.../src/jscpd.ts` | `.../src/scans/jscpd.ts` |
| `scripts/mutant-probe.mjs:1` | `.../src/mutant-probe.ts` | `.../src/mutation/mutant-probe.ts` |
| `scripts/mutation-shards.mjs:5,8` | `.../src/mutation-shards.ts` (import and JSDoc `import()` type) | `.../src/mutation/mutation-shards.ts`, both lines |
| `scripts/mutation-shards.mjs:6` | `.../src/paths.ts` | unchanged |
| `scripts/mutation-summary.mjs:1` | `.../src/mutation-summary.ts` | `.../src/mutation/mutation-summary.ts` |
| `scripts/reap-containers.mjs:1` | `.../src/reap-containers.ts` | unchanged |
| `scripts/table-ownership-scan.mjs:14` | `.../src/table-ownership-scan.ts` | `.../src/scans/table-ownership-scan.ts` |
| `lint-rules/rules/comment-only-the-why.ts:4` | `../../src/citations.ts` | `../../src/comments/citations.ts`. Oxlint loads this plugin (`.oxlintrc.json:21`), so a miss breaks every lint run. |
| `lint-rules/rules/string-cites-nothing.ts:4` | `../../src/citations.ts` | same |
| `src/scans/insert-scan.ts:7` | `WHERE_THE_LIST_LIVES = "packages/devtools/src/insert-scan.ts"` | `.../src/scans/insert-scan.ts`. The failure is loud: `insert-scan.test.ts` asserts the file exists ("lives where the failure message says it does"). |
| `.oxlintrc.json:629` | `files: ["packages/devtools/src/comment-inventory.ts"]` max-lines 567 | `.../src/comments/comment-inventory.ts`. If you skip this, the file falls onto the global 500 cap and lint fails. Delete the override if section 6 is done. |
| `.oxlintrc.json:469` | `["scripts/**", "packages/devtools/src/**"]` (no-process-env off) | The glob still matches. `packages/core/test/environment-lint.test.ts:84` asserts this exact pair, so do not edit it. |
| `src/comments/citations.ts:10` | `import.meta.dirname` + `../../../contracts/citation/cases.json` | `../../../../contracts/...` |
| `src/comments/comment-inventory.ts:17-18` | `../lint-rules/shared/comment-blocks.ts` | `../../lint-rules/shared/comment-blocks.ts` |
| `src/comments/comment-inventory.ts:268` | `LOCATOR = path.join(import.meta.dirname, "../python/comment_locator.py")` | `"../../python/comment_locator.py"`. Nothing fails at import time. It breaks only when a Python file is inventoried. |
| relative imports inside moved src | `./paths.ts`, `./throwaway-tree.ts`, `./flags.ts`, `./parsed-source.ts` in comment-density:5-7, comment-inventory:19-22, insert-scan:1, face-admission:21, jscpd:1-2 (and the `export type { Tree } from "./throwaway-tree.ts"` at jscpd:4), mutation-summary:5, mutant-probe:8, mutation-shards:9, oxlint-config:7, refusal-unions:9, root-commands:6, table-ownership-scan:8-9, workflows:7 | `./x.ts` becomes `../x.ts`. Same-group pairs stay `./`. |
| `test/lint-rules/string-cites-nothing.test.ts:50` | `const gate = "packages/devtools/src/insert-scan.ts"` | A throwaway-tree fixture name, so the test passes either way. Update it to keep the fixture honest. |
| `contracts/citation/cases.json:2` | The description names `packages/devtools/src/citations.ts` | Prose only. Editing it changes the contract digest, and `packages/devtools/test/contract-digest.test.ts` then wants both tier stamps regenerated (`packages/schema/src/contract-stamp.ts`, `apps/worker/src/better_answers_worker/contract_stamp.py`). Recommendation: leave it, or budget the regenerate (`pnpm --filter @better-answers/schema run generate:contract-stamp` plus the worker's). |
| docs (prose, nothing checks them) | `docs/plans/002-one-holder-per-comment-rule.md:87,109,161`; `docs/plans/007-s3-concepts-and-guides.md:314`; `docs/solutions/integration-issues/cloc-counts-a-glob-in-a-config-string-as-a-block-comment.md:64`; `docs/solutions/best-practices/a-process-selector-is-proved-read-only-and-counted-before-anything-is-piped-to-kill.md:126` (worktree-hooks stays) | Update the paths of files that move. `docs/archive/**` is history; leave it. |
| `.cubic/wiki/07-s-devtools-testing/03-p-linting-tools.md` (14 mentions) | Generated | Do not hand-edit. |

Unaffected, checked: `SCAN_EXECUTABLE` / `WRAPPER_EXECUTABLE` paths (`["..","..","scripts",...]` in insert-scan:22-25, comment-density:133-136, table-ownership-scan:13-16, auth-seam-scan:12-16) resolve from the **package root** through `executableOf`/`packageRoot` (`throwaway-tree.ts:56-80`), not from the file. `createRequire(import.meta.url)` calls (throwaway-tree:78,231) resolve through node_modules from any depth. The knip `packages/devtools` workspace (`knip.config.ts:46-60`) picks up export targets as entries on its own. `tsconfig.json` includes `src` and `test` as directories. `vitest.config.ts` uses `test/**/*.test.ts`, which recurses.

### test moves

| Where | What | Edit |
| --- | --- | --- |
| `package.json:26` `check:docs:devtools` | `test/ci/deploy-tree.test.ts test/ci/docs-lane.test.ts test/ci/provision-skills.test.ts test/solutions-docs.test.ts` | `test/ci/provision-skills.test.ts` becomes `test/worktrees/provision-skills.test.ts`. The other three stay. If left stale, vitest runs the other three and passes (see R5). |
| `packages/devtools/test/ci/docs-lane.test.ts:415` (`PROSE_SUITES`) | `file: "packages/devtools/test/ci/provision-skills.test.ts"` | `.../test/worktrees/provision-skills.test.ts`. Edit it together with `package.json:26`. `:511` asserts every PROSE_SUITES file exists, and the suite holds the table against the lane's scripts. `lefthook.yml:132` names only the script `check:docs:devtools`, not paths. |
| `knip.config.ts:48` | `entry: ["test/holds-a-container.ts"]` | `test/support/holds-a-container.ts`. If stale, knip reports the file unused. |
| `test/support/held-containers.ts:5` | `path.join(import.meta.dirname, "holds-a-container.ts")` | Unchanged if both files move together. |
| `test/scans/knip.test.ts:6` | `import knipConfig from "../../../knip.config.ts"` | `../../../../knip.config.ts` |
| `test/scans/jscpd.test.ts:7` | `from "../../../jscpd.config.mjs"` | `../../../../jscpd.config.mjs` |
| `test/worktrees/jdocmunch-watch-cap.test.ts:16` | `../../../../scripts/jdocmunch-watch-cap.sh` | Unchanged. `worktrees/` is the same depth as `ci/`. |
| `test/worktrees/provision-worktree.test.ts:24` | `../../../../.gitignore` | Unchanged (same depth). |
| `test/ci/ghcr-cleanup.test.ts:15`, `test/ci/mutation-baseline.test.ts:18-20` | `../../../../scripts/...`, `../../../../apps/api/stryker.config.mjs`, `.../packages/core/stryker.config.mjs` | Unchanged (they stay in `ci/`). |
| `test/ci/prune-images.test.ts:10` | Sibling `docker-stand-in.sh` | Unchanged (both stay). |
| `test/ci/image-job.test.ts:22` | `thisSuite` derived from `import.meta.url` | Self-adjusting. |
| intra-test relative imports | `./caller-counts.ts` (comment-gate-python:6, comment-only-the-why:7), `./fixture-text.ts` (comment-gate-python:7, declaration-doc-block:6, comment-only-the-why:8, comment-lint:8, test-title-setup:13), `./oxlint-fix.ts` (declaration-doc-block:7, comment-only-the-why:9), `./rule-baseline.ts` (test-titles:3, complexity-cap:3), `./stryker-workspace.ts` (mutation-shards:27, vitest-runner-patch:10), `./held-containers.ts` (reap-containers:18, testcontainers-patch:8), `./script-stand-ins.ts` (ci/prune-images:6, ci/release-job:19) | `../support/x.ts`, or `./support/x.ts` from the test root. |
| `cubic.yaml:72` | `packages/devtools/test/**` | The glob still matches. |
| `.github/workflows/check.yml:18` | Comment naming `test/ci/image-job.test.ts` | Unchanged (stays). |
| `renovate.json:30,53,63,66,67`; `.claude/skills/renovate-prs/SKILL.md:49` | Name `test/ci/deploy-tree.test.ts` and `test/ci/dependency-versions.test.ts` | Unchanged (both stay in `ci/`). |
| `docs/operations/CI.md:34,99` | `test/lint-workflows.test.ts` | `test/root-config/lint-workflows.test.ts` |
| `docs/operations/CI.md:197` | `test/vitest-runner-patch.test.ts` | `test/mutation/vitest-runner-patch.test.ts` |
| `docs/operations/CI.md:48,54,64,68,72,113,142,146,181,183` | `test/ci/{docs-lane,workflow-permissions,release-job,mutation-baseline}` | Unchanged. |
| `docs/operations/local-gates.md:42,87,215` | `test/lefthook-config`, `test/commit-msg-hook`, `test/knip` | Into `root-config/`, `root-config/`, `scans/`. |
| `docs/solutions/integration-issues/munch-indexes-stale-across-worktrees.md:91` | `test/ci/sweep-worktrees`, `test/ci/worktree-remove-hook` | Into `test/worktrees/`. |
| `docs/plans/001-remove-vocabulary-gate.md:32,49,71,72,88,89,106,107,129,130`; `docs/plans/002-...md:36,50,63,85,108,125,130,140,162,181` | Many devtools test paths | Update the ones that move (`provision-skills`, `lefthook-config`, `comment-lint`, `comment-density`). `comment-gate-hook.test.ts` (002:50,125) does not exist today. |

## 4. Import rewrite mechanics

- Imports are relative with explicit `.ts` extensions inside the package (`./paths.ts`). They are package self-references through the `exports` map from every suite (`@better-answers/devtools/<key>`). Root `scripts/*.mjs` use plain relative paths into `packages/devtools/src`. No `#` subpath imports exist (`imports` is null in every workspace manifest). No tsconfig `paths` exist outside apps/web (`@/*`).
- **Lever.** A one-shot Node codemod in `.scratch/`, built on `oxc-parser` (a devtools devDependency already, `package.json`). Input is the move table as a TSV. For each file in the package plus `scripts/*.mjs` it parses `ImportDeclaration`, `ExportNamedDeclaration`/`ExportAllDeclaration` sources, `import()` and JSDoc `import("...")` types. It resolves each relative specifier against the file's **old** location, maps the target through the table, and re-relativises from the file's **new** location. It also handles string arguments to `path.join(import.meta.dirname, ...)` / `path.resolve(import.meta.dirname, ...)` / `new URL(..., import.meta.url)` for the R1-R3 list, then the literal table above (exports targets, `.oxlintrc.json:629`, `knip.config.ts:48`, `package.json:26`, `docs-lane.test.ts:415`, `insert-scan.ts:7`). The codemod plus its move TSV is the artifact a reviewer can rerun. Whether TypeScript 7.0.2 exposes a file-rename language-service API was not checked; a one-line probe against the installed package failed on module resolution.
- After the codemod: `pnpm format` (oxfmt `sortImports` puts parent and sibling in one group, but alphabetical order inside it can change), then `pnpm --filter @better-answers/devtools run check`, `pnpm run lint`, `pnpm run knip`, `pnpm run check:docs:devtools`, `pnpm run insert-scan`, `pnpm run comment-density`, `pnpm run table-ownership-scan`, `pnpm run auth-seam-scan`, `pnpm run jscpd`, and `pnpm --filter @better-answers/core run test test/environment-lint.test.ts test/import-direction.test.ts`.

## 5. Risks

- **R1. `src/paths.ts:6` `repositoryRoot = path.resolve(import.meta.dirname, "../../..")`.** Moving `paths.ts` one level deeper silently makes `repositoryRoot` resolve to `packages/`. That breaks every consumer: dozens of suites in api, web, core and devtools, `scripts/mutation-shards.mjs:6,10,14`, and `workspacePackages()`. The proposal keeps `paths.ts` at `src/`. Never move it without changing the literal.
- **R2. `__dirname`-relative reads in moved src.** `citations.ts:10` (contracts), `comment-inventory.ts:268` (Python locator), `comment-inventory.ts:17` (lint-rules shared). The Python locator miss is silent until an inventory run touches a `.py` file.
- **R3. Sibling-path spawns and reads.** `held-containers.ts:5` spawns `holds-a-container.ts` by path, so the two move together and `knip.config.ts:48` must follow. `prune-images.test.ts:10` reads `docker-stand-in.sh`.
- **R4. Loud literal lists.** `insert-scan.ts:7` (exists-asserted), `docs-lane.test.ts:415` with `:511` (exists-asserted), `.oxlintrc.json:629` (max-lines fails). The miss shows as a red test or lint, not a silent change.
- **R5. A filter that silently shrinks.** vitest treats the paths in `package.json:26` as OR filters. A stale path is skipped while the other three still run, so the script alone goes silent (inferred from vitest's filter behaviour, not run). `docs-lane.test.ts:415` and `:511` are what make the miss loud, so edit both in one commit.
- **R6. Segment-name classifiers.** `src/paths.ts:8,10` `isTestPath` treats any `test`/`tests`/`e2e` segment as a test. `src/paths.ts:12-24` `NEVER_WALKED` skips `build`, `coverage`, `dist`, `lifts`, `reports`, `node_modules`, `playwright-report`, `test-results`, `.venv`, `__pycache__`. `comment-density.ts:15-26` also skips `skills`. `python/comment_gate.py:75,90-97` skips `skills`, `build`, `dist`, `lifts`, `site-packages` and has its own test-path regex. `.oxlintrc.json:436,485,491` turn rules off under `**/test/**`, `**/tests/**`, `**/e2e/**`. A new folder with one of those names changes what a gate sees. None of the proposed names collides.
- **R7. No gate counts files per directory.** `comment-density` totals per workspace and arm (`measure`, comment-density.ts:85-116). jscpd and knip are folder-agnostic. A new subfolder in devtools fails nothing by existing.
- **R8. Fixture paths are not real paths.** `mutant-probe.test.ts:38-62` and `mutation-shards.test.ts:1004-1200` hold `../src/...` inside fixture strings written to throwaway trees. The codemod must parse imports, not regex every string.

## 6. Big-file split: `src/comments/comment-inventory.ts` (650 lines, override at 567)

Only `commentInventory` is exported (line 641), so the face stays one file and the `./comment-inventory` exports key and target can stay as `./src/comments/comment-inventory.ts`. Proposed `src/comments/inventory/` behind it:

| module | lines today | holds |
| --- | --- | --- |
| `inventory/rows.ts` | 24-133 | `KINDS`, `CLASSES`, `KEPT`, `NEEDS_A_HOLDER`, `COLUMNS`/`HEADER`, escaping, `rowSchema`, `Row`, `Outcome`, `rowAt`, `rowsIn`, `tsvOf` |
| `inventory/typescript-blocks.ts` | 134-267 | `Span`, `Cut`, `Found`, `grouped`, `emptyContainersIn`, `cutOf`, `kindOf`, `declaredAt`, `attachedTo`, `foundIn` |
| `inventory/python-blocks.ts` | 268-303 | `LOCATOR` (path becomes `../../../python/comment_locator.py` in the folder form, `../../python/...` in the flat form), `locatedBlocks`, `pythonFoundIn` |
| `inventory/sources.ts` | 305-367 | `Language`, `LANGUAGES`, `languageOf`, `sourceFilesUnder`, `sourceAt` |
| `inventory/refusals.ts` | 368-420 | `HOLDER`, `timesIn`, `survivorOf`, `holderRefusal`, `rowRefusals` |
| `inventory/plan.ts` | 421-530 | `located`, `planFor`, the joining and cutting helpers, `withCuts`, `reportOf` |
| `comment-inventory.ts` (face) | 532-650 | `USAGE`, `refuse`, `inventory`, `requestOf`, format failures, `apply`, `check`, `COMMANDS`, `commentInventory` |

This nests those modules two levels below `src/`, one more than brief rule 2 allows by default. The alternative is six flat siblings `src/comments/inventory-*.ts`, which puts `src/comments/` at 9 loose files, still under 15. Prefer the flat form unless the owner wants the folder. The split deletes `.oxlintrc.json:627-632`. The `inventory/` folder holds 6 files, and `src/comments/` stays at 3 loose files plus one folder. `mutation-shards.ts` (526 lines) has no override, so oxlint's skip-blank/skip-comment count already puts it under 500. Leave it.

---

# Job 2. Repo-wide path-coupling map

The columns. **Kind** is glob (G) or literal (L). **Trigger** is the move that forces an edit. **Fails** is loud (a test or gate goes red) or silent (a rule stops applying, a doc goes stale, or work is skipped).

## Lint and format

| Mechanism | Kind | Trigger | Fails |
| --- | --- | --- | --- |
| `.oxlintrc.json:17,21` jsPlugin specifiers `./packages/devtools/{lifts/anti-slop,lint-rules}/index.ts` | L | Moving either plugin index | Loud |
| `.oxlintrc.json:155` `**/*.ts, **/*.tsx` | G | none | - |
| `:181` `packages/schema/src/drizzle-zod.ts` (no-restricted-imports off) | L | Moving drizzle-zod.ts | Loud (the import gets refused) |
| `:187` `apps/api/src/auth/**`, `apps/api/lifts/better-auth-cimd-node/**`. It narrows `no-restricted-imports` to drizzle-zod alone, which lifts the base `better-auth` ban (`:166-173`) inside the auth module. | G | Renaming or moving the `auth/` dir, or moving a better-auth-importing file out of it | Loud (every `better-auth` import outside the glob is refused). `cubic.yaml:135` and `packages/schema/src/table-ownership.ts:1` also name `apps/api/src/auth`. |
| `:203,:222` `apps/web/**` | G | none | - |
| `:261` `apps/web/src/features/**` | G | Renaming `features/` | Silent |
| `:307` `apps/web/src/shared/**` | G | Renaming `shared/` | Silent |
| `:349` `apps/web/src/shared/api/trpc.ts` (the one `AppRouter` type import) | L | Moving trpc.ts | Loud (the import is refused elsewhere) |
| `:392-394` `apps/web/src/features/auth/auth-client.ts`, `auth-hooks.ts` | L | Moving either | Loud (better-auth import refused) |
| `:427` `apps/web/src/shared/ui/**` | G | Renaming `shared/ui/` | Silent |
| `:436,:485,:491` `**/*.test.ts(x)`, `**/test/**`, `**/tests/**`, `**/e2e/**` (+`scripts/**` at 491) | G | A src folder named test/tests/e2e | Silent (rules relaxed) |
| `:457` `apps/api/src/config.ts`, `apps/web/playwright.config.ts`; `:463,:605` `packages/core/src/store/git/index.ts` | L | Moving those | Loud (no-process-env, max-lines 633). Also `core/test/environment-lint.test.ts:44-50,80-86` asserts these exact arrays. Loud. |
| `:469` `scripts/**`, `packages/devtools/src/**`; `:475` `scripts/**` | G | none for subfolders | - |
| `:504-654` single-file max-lines / max-lines-per-function caps: `apps/api/src/auth/{auth,confirm,routes}.ts`, `apps/api/src/ops/index.ts`, `apps/web/src/app/router.tsx`, `apps/web/src/features/people/groups-page.tsx`, `apps/web/src/features/sources/connect-action.tsx`, `apps/web/src/shared/navigation.ts`, `packages/core/src/{answering/index,concepts/edit,concepts/index,erasure/routine,sources/connected-source,sources/review,store/git/index,store/map/index,store/postgres/index,workspaces/index}.ts`, `packages/devtools/src/comment-inventory.ts`, `packages/schema/scripts/roles-surface.ts`, `packages/schema/src/{boundary-schemas,table-ownership}.ts` | L | Moving any capped file | Loud (it falls onto the global 500/150 cap). A stale entry left behind is silent dead config. Nothing checks that an override matches a file. |
| `:230,276,318,365,410` `no-restricted-imports` `group: ["../*/**", "../../**"]` under `apps/web/**` | G (on specifiers) | Any web move that makes a relative import cross a directory | Loud. The web codemod must write `@/<zone>/...` (alias `@/*` to `./src/*`, `apps/web/tsconfig.json:9`, `vite.config.ts:92`, `vitest.config.ts:10`) instead of `../dir/x`. |
| `:268,272,314,361,402,406` groups `@/features/**`, `@/app/**` (no feature imports another feature) | G (on specifiers) | Moving a file across zones | Loud |
| `:252,298,340,383` `**/auth-client(.ts)` | G (by name) | Renaming auth-client | Silent |
| `:656-668` ignorePatterns (`reports`, `dist`, `coverage`, `packages/devtools/lifts/anti-slop/**`, `.claude/skills/**`, `apps/api/.claude/skills/**`, `**/stryker-setup-*.js`) | G | A folder named reports/dist/coverage | Silent (unlinted) |
| `lint-rules/rules/import-direction.ts:119-137` zone = first segment under `packages/core/src` (kernel, access, store/<door> at depth > 3, llm/audit layers, refusals catalogue, erasure top slice, else slice). Face = `src/<slice>/index.ts`, which must be in core's exports (`:200-221`). A file directly in `src/` is unplaced (`:135`). | structural | A **new top-level folder** under `packages/core/src` becomes a slice needing `index.ts` and an exports key (`unexported`). A cross-slice import into a non-face file gets `internal`. Nesting inside an existing slice is free. | Loud. `core/test/import-direction.test.ts:304` asserts `src/{llm,audit,erasure}/index.ts` exist. |
| `lint-rules/rules/string-cites-nothing.ts:8` test-path regex `(tests?|e2e)/` or `.test.` | G | Folder names | Silent |
| `.oxfmtrc.json:15-28` ignorePatterns (`deploy/**`, `packages/devtools/lifts/anti-slop/**`, `apps/api/.claude/skills/**`, `packages/schema/migrations/**`, `packages/schema/roles-surface.json`) | L/G | Moving those | Silent |

## Dead code, duplication, mutation

| Mechanism | Kind | Trigger | Fails |
| --- | --- | --- | --- |
| `knip.config.ts:15` `.claude/skills/*/references/**`; `:22-27` api `lifts/**`, `tests/fixtures/web-build/**`, `.claude/skills/**`; `:34` web entry `src/shared/ui/**`; `:41-43` core vitest configs; `:48` devtools entry `test/holds-a-container.ts`; `:50` `lifts/**` | G + L | Moving `apps/api/tests/fixtures/web-build`, `apps/web/src/shared/ui`, `holds-a-container.ts` | Loud (knip reports unused files/exports). Knip reads each workspace's `exports` targets and vitest `include` itself. |
| `jscpd.config.mjs:5` paths `apps`, `packages`; `:13` `apps/web/src/shared/audit/audit-actions.ts`; `:15` `apps/worker/src/better_answers_worker/schema_view.py`; `:20` `apps/web/src/shared/ui/**`; `:22` `**/lifts/**` | L/G | Moving `audit-actions.ts`, `schema_view.py`, `shared/ui` | Loud (threshold 0, so the generated duplicate is reported). `devtools/test/jscpd.test.ts:99` names `schema_view.py`. |
| `apps/api/stryker.config.mjs:9` `src/**/*.ts`, `!src/main.ts`, `!src/migrate.ts`; `packages/core/stryker.config.mjs:9` `src/**/*.ts` | G + L | Moving `apps/api/src/main.ts` or `migrate.ts` | Silent (entry points start getting mutated) |
| `scripts/mutation-shards.mjs:17-20` core `split` map `src/store/git/index.ts` (4), `src/store/map/index.ts` (2) | L | Moving either | Loud (`named to be cut, but the core leg does not mutate it`, mutation-shards.ts:271). `devtools/test/ci/mutation-baseline.test.ts:476-484` also reads those files. |
| `scripts/mutation-shards.mjs:3-4,10,14` legs import `apps/api/stryker.config.mjs`, `packages/core/stryker.config.mjs` | L | Moving a stryker config | Loud |
| Stryker `incrementalFile` `reports/mutation/stryker-incremental.json` (artifact from main, `.github/actions/mutation-baseline/action.yml:20,52`) keyed by file path. `weightsOf` (mutation-shards.ts:84-101) and `mergeShards` read it by path. | data | Any `src` move in api or core | Silent, one-time. Moved files lose history, every mutant reruns once, shard weights fall back to bytes. No failure. |
| `.github/workflows/mutation.yml:43-67` legs by workspace path | L | Moving a workspace | n/a for in-workspace moves |
| `.github/workflows/check.yml:177` core suite sharded by a hash of test paths | data | Moving core tests | Silent (shard balance reshuffles) |

## Repository gates in `packages/devtools` and `scripts/`

| Mechanism | Kind | Trigger | Fails |
| --- | --- | --- | --- |
| `devtools/src/paths.ts:6` `repositoryRoot` (`../../..`) | L | Moving `paths.ts` | Silent and catastrophic (R1) |
| `devtools/src/paths.ts:8-24` `isTestPath`, `NEVER_WALKED` | G (segment names) | Folders named test/tests/e2e/build/dist/lifts/reports/coverage | Silent |
| `devtools/src/scans/insert-scan.ts:9-20` `FACTORY_MODULES`: `apps/worker/tests/{factories,pg_harness}.py`, `packages/core/test/{audit-rows,identity-rows}.ts`, `packages/schema/test/{before-the-action,before-the-knowledge-words,catalogue-statements,concept-index-rows,probes,rls-probes}.ts` | L | Moving any of these to a `test/support/` | Loud (`insert-scan.test.ts:108-116` asserts each exists and holds a raw insert) |
| `devtools/src/scans/table-ownership-scan.ts:18,36-47` every immediate subdir of `packages/core/src` except `NEVER_AN_OWNER` (`kernel`, `store`, `packages/schema/src/table-ownership.ts:17`) is an owner. `packages/schema/src/table-ownership.ts:1-5` literal owners `apps/api/src/auth`, `packages/core/src/store/postgres`, `packages/core/src/store/map`, `apps/api/src`, deploy scripts. `WHERE_THE_MAP_LIVES` (:11) = `packages/schema/src/table-ownership.ts`. | L + structural | A new top-level core folder (a new owner), moving a file across core slices, moving `apps/api/src/auth` or the two doors | Loud (an un-owned table reference is reported) |
| `package.json:32` `table-ownership-scan packages/core/src apps/api/src` | L (dirs) | none for subfolders | - |
| `package.json:33` `auth-seam-scan apps/web/tsconfig.json apps/web/src/features/auth/auth-hooks.ts` | L | Moving `auth-hooks.ts` | Loud |
| `package.json:34` `port-scan apps/worker/src`, and `apps/worker/src/**` `PORT_OF` tuples naming `packages/core/src/{concepts/file,erasure/identifiers,kernel/envelope,sources/passage-address,store/map/index}.ts`, `packages/schema/src/{concept-file,ulid}.ts` (`python/port_scan.py:125-131` checks `is_file()`) | L | Moving any of the seven TS files | Loud |
| `package.json:29` `comment-gate:python apps packages .github deploy .claude/hooks scripts ...`; `lefthook.yml:34` per staged file | L (roots) | none | - |
| `package.json:30,31` comment-density, insert-scan over `apps packages` | L (roots) | none | - |
| `package.json:25` `check:docs:core ... test/tier-contract.test.ts`; `:26` devtools four suites; `:27` `check:docs:web ... test/browser-suite-skill.test.ts`, mirrored by `devtools/test/ci/docs-lane.test.ts:407-470` `PROSE_SUITES` (also lists `apps/worker/tests/{test_redaction,test_redaction_windows,test_planted_page,test_tier_contract,test_image}.py`, `apps/worker/tests/fixtures/redaction/supplier-information-pack.md`) | L | Moving any named suite | Loud (`:511` exists-check, and the table is held against the scripts) |
| `scripts/docs-lane.mjs:9-33` `IMAGE_INPUTS`: `apps/api/tests/{backup-image.test,image-probe,image.test}.ts`, `apps/worker/src/better_answers_worker/__init__.py`, `.../redaction/`, `apps/worker/tests/test_image.py` and more | L | Moving any | Loud (`docs-lane.test.ts:385-394` exists-check, `:308-313` probe files derived from build.yml) |
| `.github/workflows/build.yml:141,146,151` probes `tests/image.test.ts`, `tests/test_image.py`, `tests/backup-image.test.ts`; `apps/api/tests/image.test.ts:284`, `backup-image.test.ts:906` assert their own path appears in build.yml | L | Moving an image probe | Loud |
| `build.yml:65,98`, `check.yml:210,253,364` `hashFiles('apps/worker/src/better_answers_worker/redaction/pins.py')` | L | Moving pins.py | Silent (the cache key goes empty) |
| `apps/worker/Dockerfile:66,68` `COPY src/better_answers_worker/__init__.py`, `.../redaction` | L | Moving those | Loud (image build) |
| `apps/api/Dockerfile:59-74,223-237` COPY by workspace dirs (`apps/api/src`, `apps/api/lifts`, `packages/*/src`, `packages/schema/migrations`) | L (dirs) | none for subfolders | - |
| `apps/web/test/browser-suite-skill.test.ts:10-13,36-41` every `` `apps/...(ts|tsx|json)` `` named in `.claude/skills/browser-suite/` must exist | L | Moving `apps/web/e2e/*` or any web file the skill names | Loud |
| `devtools/test/ci/deploy-tree.test.ts:88` `POSTGRES_PIN = packages/schema/src/postgres-image.ts`, matching `renovate.json:54` `managerFilePatterns` | L | Moving postgres-image.ts | `renovate.json` alone goes silent (Renovate stops updating the pin). The test is loud. |
| `devtools/test/ci/deploy-tree.test.ts:915` asserts `docs/operations/coolify.md` contains `apps/api/src/ingress/hostnames.ts` | L | Moving hostnames.ts | Silent (the test still passes on the stale doc text) |
| `devtools/test/contract-digest.test.ts:8-11` `packages/schema/src/contract-stamp.ts`, `apps/worker/src/better_answers_worker/contract_stamp.py`; `packages/schema/src/contract-digest.ts:5-7` | L | Moving a stamp | Loud |
| `contracts/*/*.json` descriptions name ~30 source and test paths (citation, cost-ledger, credential-envelope, document-passage, emptying-a-connected-source, erasure-match, id-shape, links, redaction, sync-sensitivity-moves, upload-media-types) | L (prose) | Moving a named file | Silent if left. Editing the prose changes the contract digest, so both stamps must be regenerated or `contract-digest.test.ts` and the tier-contract suites fail. |
| `apps/web/test/folder-case.test.ts:6-23` every folder under `apps/web/src` must be kebab-case | structural | New web folders | Loud |
| `devtools/src/comments/comment-inventory.ts` TSV rows keyed `path:start` | data | Moves during an in-flight inventory | Silent. No TSV is committed (`git ls-files` shows none). |
| `devtools/test/support/rule-baseline.ts` reads `.oxlintrc.json` overrides at run time | derived | Follows the overrides | - |

## Test runners and TypeScript

| Mechanism | Kind | Trigger | Fails |
| --- | --- | --- | --- |
| vitest `include`: api `tests/**/*.test.ts`; web `test/**/*.test.{ts,tsx}`; core, schema, devtools `test/**/*.test.ts` | G (recursive) | none | - |
| `packages/core/vitest.readings.config.ts:10` `test/readings/*.reading.ts` | G (one level) | Nesting readings deeper | Loud only when `reading:*` runs by hand (inferred: no file matches its filter). No gate runs readings. |
| `packages/schema/vitest.config.ts:5,17` `./test/apple-git.ts`, `./test/warm-postgres.ts`; api and core `globalSetup` use `@better-answers/{schema,core}/testing/*` exports | L / export key | Moving schema `test/apple-git.ts` or `warm-postgres.ts` (edit the config and the exports target) | Loud |
| `apps/web/playwright.config.ts:29` `testDir: "e2e"`; `:45` cwd `../api` | L | none for subfolders | - |
| `apps/api/package.json` scripts `serve:e2e tests/serve.ts`, `serve:local tests/local.ts`, `dev/start src/main.ts`, `migrate src/migrate.ts`, `ops src/ops.ts`; `packages/core` `generate:audit-actions scripts/...`; `packages/schema` `generate* scripts/...` | L | Moving those | Loud |
| tsconfig `include` (directory lists in every workspace); no `references`; `paths` only in web (`@/*`) | G (dirs) | none | - |
| `lefthook.yml:22,28,43-64` `root:` per workspace, globs by extension | G | none | - |
| `.github/workflows/*` | L | Only the probe and hashFiles rows above | - |

## Review, ownership, indexing

| Mechanism | Kind | Trigger | Fails |
| --- | --- | --- | --- |
| `.github/CODEOWNERS` | - | Absent | - |
| `cubic.yaml:57-80` ignore globs per workspace test dir (`packages/devtools/test/**`, etc.); `:127-141` custom-rule `include` by workspace; prose naming `apps/api/src/auth/`, `apps/web/src/features/auth/` (`:135`) | G + prose | Renaming a workspace test root or the auth dirs | Silent |
| `.cubic/wiki/**` | generated | - | Do not hand-edit |
| `renovate.json:24` ignorePaths `**/lifts/**`; `:31,37,45,54` managerFilePatterns (Dockerfile, `.tool-versions`, `.claude/settings.json`, `packages/schema/src/postgres-image.ts`) | G + L | Moving postgres-image.ts | Silent |
| `.gitnexusignore:52-110` excludes `packages/devtools/`, `scripts/`, `docs/`, every workspace test dir, configs | G (dirs) | none for in-tree moves | - |
| GitNexus | index | Re-runs `node .gitnexus/run.cjs analyze` after merge to main. In a worktree use `detect_changes({worktree})`. `rename` is for symbols, not file moves. | - |
| jCodeMunch `.jcodemunch.jsonc` ignores `**/.claude/worktrees/**`. The index this session resolved is the **main checkout** (`source_root` is the primary repo), so it does not see worktree moves. | index | After `git mv` from Bash, call `register_edit` with the paths (AGENTS.md) | - |
| `.dockerignore`, `apps/worker/.dockerignore` (`tests`, `**/reports`, ...) | G | A src folder named `reports`/`tests` | Silent (dropped from the image) |
| `AGENTS.md:21` and per-workspace `AGENTS.md`/`CLAUDE.md` name directories | prose | Directory renames | Silent |

## Python configuration

| Mechanism | Kind | Trigger | Fails |
| --- | --- | --- | --- |
| `apps/worker/pyproject.toml:231` per-file-ignore `src/better_answers_worker/check.py` (T20); `:238` `src/better_answers_worker/pipeline/**` (TID251, the one cocoindex-ban lift, which `tests/test_cocoindex_ban.py` holds to exactly one pattern) | L / G | Moving `check.py` or renaming `pipeline/` | Loud (ruff T20/TID251) |
| `apps/worker/pyproject.toml:243` mypy `files = ["src", "tests"]`; `:271` pytest `testpaths = ["tests"]`; `:318-320` mutmut `source_paths`, `do_not_mutate = ["src/better_answers_worker/check.py"]`, `tests/` | G (dirs) + L | Moving `check.py` | Silent (mutmut starts mutating the check runner) |
| `packages/devtools/python/ruff.toml:9-11` per-file-ignores by bare name `comment_gate.py`, `port_scan.py`; read by path from `apps/worker/tests/test_complexity_cap.py:11` | L | Moving `packages/devtools/python/` | Loud |

## Location anchors outside devtools (the R1 class, all silent on move)

Each file below finds another path from its own location, so moving it, or nesting it one level deeper, points it somewhere else with no import error. The codemod must rewrite these string arguments, or the area keeps the file at its depth. Source: a repo-wide grep for `import.meta.dirname|import.meta.url|__dirname|Path(__file__)`.

- **src and scripts.** `apps/api/src/config.ts:26` (`../../web/dist`). `packages/schema/src/contract-digest.ts:5` (`../../../contracts`), `:7` (sibling `contract-stamp.ts`). `packages/schema/src/migrations-folder.ts:7` (`../migrations`). `apps/worker/src/better_answers_worker/contract_digest.py:4` (`parents[4]` to contracts), `:6` (sibling `contract_stamp.py`). `packages/schema/scripts/roles-surface.ts:10` (`../roles-surface.json`), `generate-migrations.ts:9` (`..`), `generate-worker-schema.ts:9`. `packages/core/scripts/audit-actions.ts:10`. `packages/devtools/python/citations.py:8` (`parents[3]`).
- **apps/api tests.** `migrate.test.ts:11`, `serve.test.ts:8`, `restore.test.ts:15`, `stop.test.ts:16`, `ops.test.ts:2739` (`..`). `browse-production.test.ts:18`, `browse-role.test.ts:20`, `await-release.test.ts:10` (`../../../deploy/*`). `serve.ts:48`, `local.ts:42` (`../../web/dist`). `procedure-output.test.ts:12-13` (`../src/`, `../../../packages/core/src/`). `ops-update-concept-body.test.ts:20`, `ops.test.ts:3548`, `suite-app.ts:50` (`fixtures/*`). `better-auth-endpoints.test.ts:10`, `organisation-plugin.test.ts:143` (sibling `better-auth-endpoints.txt`). `image.test.ts:284`, `backup-image.test.ts:906` (`fileFromTheWorkspace(import.meta.url, "apps/api")`).
- **packages/core tests.** `warm-objects.ts:41,43` (`../../../deploy/*`). `worker-process.ts:20` (`../../../apps/worker`). `contract-fixture.ts:6`, `tier-contract.test.ts:49` (`../../../contracts`). `source-tree.ts:4` (`../src`). `entry-points.ts:9`, `face-admission.test.ts:67` (`../package.json`). `recall.ts:31,33`, `readings/reuse-set.ts:36` (`./fixtures/*`, `../fixtures/*`). `recall.test.ts:290` (`../../../.planning/client-bundle/`). `warm-objects.test.ts:16-17` (`..`, sibling `warm-objects.ts`). `audit.test.ts:99` (its own name `audit.test.ts`).
- **packages/schema tests.** `table-ownership.test.ts:16`, `full-text-match.test.ts:88`, `warm-postgres.test.ts:31` (`../../..`). `warm-postgres.test.ts:30,32`, `warm-postgres.ts:90` (`..`, siblings `warm-postgres.ts`, `harness.ts`). `finding-factory.test.ts:11` (`../../../contracts`), `:21-23` (walks its own directory recursively). `worker-schema-view.test.ts:16`.
- **apps/web tests and e2e.** `api-seam.test.ts:8`, `playwright-tree.ts:14` (`..`). `folder-case.test.ts:6`, `source-files.ts:4` (`../src`). `concept-body.test.tsx:29` (`../../../contracts/links/cases.json`). `api-client.test.tsx:319` (`../../api/src/trpc/mount.ts`). `e2e/blueprint-parts.spec.ts:16`, `e2e/list-parts.spec.ts:12` (`../test/blueprint-parts.tsx`, `../test/members-list.tsx`). `e2e/drawn-parts.ts:47` (`../src`).
- **apps/worker tests.** `parents[1]`: `test_redaction_suffixes.py:11`, `test_redaction_weights.py:13`, `test_sql_prepares.py:16`, `test_pipeline_landed.py:609`, `test_pytest_options.py:7`, `test_redaction_descriptors.py:43`, `test_complexity_cap.py:9`, `test_cocoindex_ban.py:8`, `test_directive_rules.py:7`. `parents[3]` (repo root): `pg_harness.py:21`, `deploy_unit.py:5`, `test_image.py:32`, `test_tier_contract.py:31,33`, and every `*_contract.py` `CONTRACTS_DIR`. Siblings: `test_pipeline_landed.py:103`, `test_pipeline_index.py:177` (`fixtures/conversion`), `planted_page.py:6`, `test_pg_harness.py:245,526`, `test_title_hold.py:9` (`conftest.py`), `pg_harness.py:215` (hashes its own bytes).

## Answers to the two direct questions

- **Does moving files under `apps/*` or `packages/*` need config edits?** Only where the tables mark L. Every glob above survives a move into a subfolder, except where the new folder's **name** is classified (test/tests/e2e/build/dist/lifts/reports/coverage/skills) or a folder the glob names is renamed (`features`, `shared`, `shared/ui`, `auth`). The literal lists that need edits are: `.oxlintrc.json` single-file overrides, `FACTORY_MODULES`, `PORT_OF`, `IMAGE_INPUTS` and build.yml probes, `check:docs:*` with `PROSE_SUITES`, the `split` map, `auth-seam-scan`'s `auth-hooks.ts`, `table-ownership.ts` owners, the jscpd ignores, knip entries, schema's vitest setup paths, workspace `package.json` scripts and exports targets, renovate's postgres pin, the worker Dockerfile COPY lines, and the browser-suite skill's named files.
- **Does any gate count files per directory or fail a new subfolder?** None counts files per directory. Three react to a new folder by **structure**. `import-direction` and `table-ownership-scan` treat a new top-level folder under `packages/core/src` as a new slice or owner (so group inside existing slices). `apps/web/test/folder-case.test.ts` requires kebab-case. `packages/core/vitest.readings.config.ts` does not recurse.
