# Explore: schema-core

> **Note, 28/10/2026.** This map records the tree at `d6fc08ee6`. PRs #914, #916, #920, #922 and #923 carried it out. #922 kept `ConceptFound` private to `concepts/reading/lookup.ts`, so section 6's list of face re-exports names one more than the face has. Paths and line numbers here can differ from `main`.

Area: `packages/schema/src/`, `packages/schema/test/`, `packages/core/src/<slice>/` (every slice over ~15 loose files), `packages/core/test/`. Read only; every claim below was read from the worktree at `refactor/folder-restructure` unless marked *inferred*.

## 1. Inventory

Loose files per folder, now and after the proposed move. Folders not listed (`core/src/{access,answering,audit,bundle,guides,llm,refusals,runs,sources,store/*,sweeps}`) are already at or under 15 and do not move.

| Folder | Now | After |
| --- | --- | --- |
| `packages/schema/src/` | 53 | 15 (+5 dirs) |
| `packages/schema/src/people/` | – | 12 |
| `packages/schema/src/knowledge/` | – | 12 |
| `packages/schema/src/sources/` | – | 6 |
| `packages/schema/src/platform/` | – | 6 |
| `packages/schema/src/boundary-schemas/` | – | 11 (split of `boundary-schemas.ts` + `drizzle-zod.ts`) |
| `packages/schema/test/` | 65 | 12 (+6 dirs) |
| `packages/schema/test/support/` | – | 15 |
| `packages/schema/test/migrations/` | – | 9 |
| `packages/schema/test/people/` | – | 7 |
| `packages/schema/test/knowledge/` | – | 13 |
| `packages/schema/test/sources/` | – | 5 |
| `packages/schema/test/platform/` | – | 4 |
| `packages/core/src/concepts/` | 20 | 9 (+3 dirs; `index.ts` split adds 3 modules) |
| `packages/core/src/concepts/{import,writes,reading}/` | – | 4 / 6 / 4 |
| `packages/core/src/erasure/` | 17 | 13 |
| `packages/core/src/erasure/sweeps/` | – | 4 |
| `packages/core/src/kernel/` | 18 | 12 |
| `packages/core/src/kernel/principal/` | – | 6 |
| `packages/core/src/members/` | 21 | 12 |
| `packages/core/src/members/{invitations,audit-log}/` | – | 6 / 3 |
| `packages/core/src/workspaces/` | 26 | 12 |
| `packages/core/src/workspaces/{second-factor,models}/` | – | 9 / 5 |
| `packages/core/test/` | 156 `.ts` + `fixtures/` (4) + `readings/` (6) | 5 (+ dirs) |
| `packages/core/test/support/` | – | 14 |
| `packages/core/test/fixtures/` | 4 | 10 |
| `packages/core/test/readings/` | 6 | 6 (unchanged) |
| `packages/core/test/<slice>/…` | – | largest: `answering/` 13, `concepts/` 13, `sources/` 12 |

## 2. Target tree and move tables

### Grouping rationale

- **schema src** groups by the GLOSSARY sections. `people/` = "People and accountability" (identity set, members, groups, access requests, audit, second factor). `knowledge/` = "Knowledge", "Suggestions", "The map", "Guides", "Search and answers" (+ "Visibility" columns). `sources/` = "Sources" + "Personal data" (passages, findings, erasure). `platform/` = "The platform" (model/LLM tables, jobs, platform tables, counters, web-api header and theme contracts). The table owner map in `src/table-ownership.ts` agrees: each moved `*-tables.ts` lands with the core slice that owns it (computed from `TABLE_OWNERS`).
- **schema src root keeps** every file a path literal outside an import pins, or that resolves a path relative to its own location: `postgres-image.ts` (deploy scripts, renovate, compose), `migrations-folder.ts` (`../migrations`), `contract-digest.ts` + `contract-stamp.ts` (`../../../contracts`, sibling write target), `table-ownership.ts` (devtools gate), `definer-reach.ts` (its own message text and the generated `roles-surface.json` name `packages/schema/src/definer-reach.ts`), `ulid.ts` (worker `PORT_OF`, api clock test, `contracts/id-shape` prose), `schema.ts` (`drizzle.config.ts`), plus the cross-domain plumbing (`index.ts`, `journal.ts`, `rls-exemptions.ts`, `with-rls.ts`, `column-helpers.ts`, `ids.ts`, `code-unit.ts`). That is exactly 15.
- **core src** keeps every slice face at `src/<slice>/index.ts` (the exports map and `import-direction` both require it: `faceOf` is `src/<first>/index.ts`, `packages/devtools/lint-rules/rules/import-direction.ts:183`). Sub-folders inside a slice stay in the slice's zone (`srcPlaceOf` keys on the first segment only, `:123-133`) and in the slice's table ownership (`sliceOf` is a prefix match on `packages/core/src/<slice>/`, `packages/devtools/src/table-ownership-scan.ts:46`). Every worker `PORT_OF` target in core stays put (`kernel/envelope.ts`, `concepts/file.ts`, `erasure/identifiers.ts`, `sources/passage-address.ts`, `store/map/index.ts`).
- **tests mirror src**: `test/<slice>/<sub>/x.test.ts` for `src/<slice>/<sub>/x.ts`. Cross-cutting tests stay at `test/` root. Shared helpers go to `test/support/`. The core helper set is 20 files, so the six that build data (bundles, workspaces, contract and cross-tier fixtures) join the existing `test/fixtures/` instead of overflowing `support/`; a helper used by one slice's tests sits beside them.
- **Deliberate deviation from rule 2.** `test/store/{git,map,objects}/`, `test/kernel/principal/`, `test/members/{invitations,audit-log}/` and `test/workspaces/models/` sit two levels below today's flat `test/` for groups of 2 to 4 files. Rule 3 (an agent predicts the test path from the source path) won over rule 2 there, because the src side already nests (`src/store/git/`, `src/kernel/principal/`, …). Fallback if the owner prefers rule 2: flatten `test/store/` (9 files) and `test/kernel/` (6), and keep only the `concepts`, `members` and `workspaces` mirrors.

### Target tree (directories only)

```
packages/schema/src/
  (15 root files) people/ knowledge/ sources/ platform/ boundary-schemas/
packages/schema/test/
  (12 root tests) support/ migrations/ people/ knowledge/ sources/ platform/
packages/core/src/
  concepts/{import,writes,reading}/  erasure/sweeps/  kernel/principal/
  members/{invitations,audit-log}/   workspaces/{second-factor,models}/
packages/core/test/
  (5 root tests) support/ fixtures/ readings/ access/ answering/ audit/
  concepts/{import,writes,reading}/ erasure/ guides/ kernel/principal/ llm/
  members/{invitations,audit-log}/ runs/ sources/ store/{git,map,objects}/
  sweeps/ workspaces/{models,second-factor}/
```

### Move table: `packages/schema/src/`

Stays at `src/`: `index.ts`, `schema.ts`, `postgres-image.ts`, `migrations-folder.ts`, `journal.ts`, `contract-digest.ts`, `contract-stamp.ts`, `table-ownership.ts`, `definer-reach.ts`, `rls-exemptions.ts`, `with-rls.ts`, `column-helpers.ts`, `ulid.ts`, `ids.ts`, `code-unit.ts`.

| old `src/…` | new `src/…` |
| --- | --- |
| `identity-tables.ts` | `people/identity-tables.ts` |
| `workspace-table.ts` | `people/workspace-table.ts` |
| `group-tables.ts` | `people/group-tables.ts` |
| `access-request-tables.ts` | `people/access-request-tables.ts` |
| `last-active-tables.ts` | `people/last-active-tables.ts` |
| `test-workspace-tables.ts` | `people/test-workspace-tables.ts` |
| `audit-tables.ts` | `people/audit-tables.ts` |
| `actor-id.ts` | `people/actor-id.ts` |
| `roles.ts` | `people/roles.ts` |
| `email-address.ts` | `people/email-address.ts` |
| `email-code.ts` | `people/email-code.ts` |
| `second-factor.ts` | `people/second-factor.ts` |
| `concept-tables.ts` | `knowledge/concept-tables.ts` |
| `suggestion-tables.ts` | `knowledge/suggestion-tables.ts` |
| `map-tables.ts` | `knowledge/map-tables.ts` |
| `guide-tables.ts` | `knowledge/guide-tables.ts` |
| `write-up-tables.ts` | `knowledge/write-up-tables.ts` |
| `question-tables.ts` | `knowledge/question-tables.ts` |
| `usage-tables.ts` | `knowledge/usage-tables.ts` |
| `readable-columns.ts` | `knowledge/readable-columns.ts` |
| `concept-file.ts` | `knowledge/concept-file.ts` |
| `bundle-manifest.ts` | `knowledge/bundle-manifest.ts` |
| `full-text-match.ts` | `knowledge/full-text-match.ts` |
| `scan.ts` | `knowledge/scan.ts` |
| `source-tables.ts` | `sources/source-tables.ts` |
| `index-tables.ts` | `sources/index-tables.ts` |
| `finding-tables.ts` | `sources/finding-tables.ts` |
| `erasure-tables.ts` | `sources/erasure-tables.ts` |
| `passage-locator.ts` | `sources/passage-locator.ts` |
| `upload-headers.ts` | `sources/upload-headers.ts` |
| `llm-tables.ts` | `platform/llm-tables.ts` |
| `job-tables.ts` | `platform/job-tables.ts` |
| `platform-tables.ts` | `platform/platform-tables.ts` |
| `counter-tables.ts` | `platform/counter-tables.ts` |
| `theme.ts` | `platform/theme.ts` |
| `tab-workspace.ts` | `platform/tab-workspace.ts` |
| `drizzle-zod.ts` | `boundary-schemas/drizzle-zod.ts` (its only importers are the boundary schemas and their test) |
| `boundary-schemas.ts` | split into `boundary-schemas/*.ts` (section 6) |

`packages/schema/package.json` `exports` targets that change (keys unchanged): `./concept-file` -> `./src/knowledge/concept-file.ts`; `./scan` -> `./src/knowledge/scan.ts`; `./email-code` -> `./src/people/email-code.ts`; `./email-address` -> `./src/people/email-address.ts`; `./second-factor` -> `./src/people/second-factor.ts`; `./theme` -> `./src/platform/theme.ts`; `./tab-workspace` -> `./src/platform/tab-workspace.ts`; `./upload-headers` -> `./src/sources/upload-headers.ts`. Unchanged: `.`, `./ulid`, `./table-ownership`, `./code-unit`.

### Move table: `packages/schema/test/`

Stays at `test/` (12): `rls.test.ts`, `roles-surface.test.ts`, `table-ownership.test.ts`, `boundary-schemas.test.ts`, `ids.test.ts`, `ulid.test.ts`, `code-unit.test.ts`, `column-helpers.test.ts`, `contract-digest.test.ts`, `null-safe-checks.test.ts`, `finding-factory.test.ts` (must stay, see Risks R1), `factory.test.ts` (beside its sibling factory test).

| new folder | files moved from `test/` |
| --- | --- |
| `test/support/` (15) | `harness.ts`, `harness.test.ts`, `end-pool.test.ts`, `warm-postgres.ts`, `warm-postgres.test.ts`, `testing.ts`, `probes.ts`, `probes.test.ts`, `rls-probes.ts`, `factory.ts`, `apple-git.ts`, `apple-git.test.ts`, `test-title.ts`, `test-title-setup.ts`, `matching.ts` |
| `test/migrations/` (9) | `migration-ownership.test.ts`, `upgrade-rebuild.test.ts`, `renamed-names.test.ts`, `worker-schema-view.test.ts`, `journal-statements.ts`, `catalogue-statements.ts`, `before-the-action.ts`, `before-the-passage.ts`, `before-the-knowledge-words.ts` |
| `test/people/` (7) | `account-key.test.ts`, `action-column.test.ts`, `actor-index.test.ts`, `waiting-invitation.test.ts`, `email-address.test.ts`, `authenticator-code.ts`, `authenticator-code.test.ts` |
| `test/knowledge/` (13) | `analysed-map.test.ts`, `bundle-manifest.test.ts`, `concept-file.test.ts`, `concept-search.test.ts`, `concept-description-migration.test.ts`, `full-text-match.test.ts`, `guide-tables.test.ts`, `knowledge-words.test.ts`, `knowledge-words-end-to-end.test.ts`, `question-tables.test.ts`, `resolved-resource.test.ts`, `concept-index-rows.ts`, `question-months.ts` |
| `test/sources/` (5) | `passage-columns.test.ts`, `readable-passage.test.ts`, `source-catalogue.test.ts`, `suppression.test.ts`, `provisioning-locks.test.ts` |
| `test/platform/` (4) | `job-kinds.test.ts`, `spend-tables.test.ts`, `model-key.test.ts`, `model-choice-scenario.ts` |

`exports` targets that change: `./testing` -> `./test/support/testing.ts`; `./testing/apple-git` -> `./test/support/apple-git.ts`; `./testing/authenticator-code` -> `./test/people/authenticator-code.ts`; `./testing/matching` -> `./test/support/matching.ts`; `./testing/probes` -> `./test/support/probes.ts`; `./testing/test-title` -> `./test/support/test-title.ts`; `./testing/test-title-setup` -> `./test/support/test-title-setup.ts`; `./testing/warm-postgres` -> `./test/support/warm-postgres.ts`.

### Move table: `packages/core/src/` (slices over ~15)

| old `packages/core/src/…` | new |
| --- | --- |
| `concepts/loader.ts` | `concepts/import/loader.ts` |
| `concepts/landing.ts` | `concepts/import/landing.ts` |
| `concepts/manifest.ts` | `concepts/import/manifest.ts` |
| `concepts/index.ts` lines 394-797 | new `concepts/import/import-bundle.ts` |
| `concepts/write.ts` | `concepts/writes/write.ts` |
| `concepts/edit.ts` | `concepts/writes/edit.ts` |
| `concepts/suggestions.ts` | `concepts/writes/suggestions.ts` |
| `concepts/reconciler.ts` | `concepts/writes/reconciler.ts` |
| `concepts/reconciler-hit.ts` | `concepts/writes/reconciler-hit.ts` |
| `concepts/index.ts` lines 216-392 | new `concepts/writes/acceptance.ts` |
| `concepts/read.ts` | `concepts/reading/read.ts` |
| `concepts/browse.ts` | `concepts/reading/browse.ts` |
| `concepts/latest-verification.ts` | `concepts/reading/latest-verification.ts` (users: `browse.ts` and the lookup chunk) |
| `concepts/index.ts` lines 799-1112 | new `concepts/reading/lookup.ts` |
| `erasure/actors.ts` | `erasure/sweeps/actors.ts` |
| `erasure/identity.ts` | `erasure/sweeps/identity.ts` |
| `erasure/questions.ts` | `erasure/sweeps/questions.ts` |
| `erasure/rederive.ts` | `erasure/sweeps/rederive.ts` |
| `kernel/principal.ts` | `kernel/principal/principal.ts` |
| `kernel/actor.ts` | `kernel/principal/actor.ts` |
| `kernel/role.ts` | `kernel/principal/role.ts` |
| `kernel/admission.ts` | `kernel/principal/admission.ts` |
| `kernel/freshness.ts` | `kernel/principal/freshness.ts` |
| `kernel/second-factor.ts` | `kernel/principal/second-factor.ts` |
| `members/invitations.ts` | `members/invitations/invitations.ts` |
| `members/invitation-bulk.ts` | `members/invitations/invitation-bulk.ts` |
| `members/invitation-ceilings.ts` | `members/invitations/invitation-ceilings.ts` |
| `members/invitation-statuses.ts` | `members/invitations/invitation-statuses.ts` |
| `members/accepting.ts` | `members/invitations/accepting.ts` |
| `members/testing-domain.ts` | `members/invitations/testing-domain.ts` |
| `members/audit-log.ts` | `members/audit-log/audit-log.ts` |
| `members/audit-export.ts` | `members/audit-log/audit-export.ts` |
| `members/activity.ts` | `members/audit-log/activity.ts` |
| `workspaces/second-factor.ts` | `workspaces/second-factor/second-factor.ts` |
| `workspaces/confirming.ts` | `workspaces/second-factor/confirming.ts` |
| `workspaces/confirm-throttle.ts` | `workspaces/second-factor/confirm-throttle.ts` |
| `workspaces/passkeys.ts` | `workspaces/second-factor/passkeys.ts` |
| `workspaces/passkey-confirm.ts` | `workspaces/second-factor/passkey-confirm.ts` |
| `workspaces/recovery-codes.ts` | `workspaces/second-factor/recovery-codes.ts` |
| `workspaces/session-standing.ts` | `workspaces/second-factor/session-standing.ts` |
| `workspaces/sessions.ts` | `workspaces/second-factor/sessions.ts` |
| `workspaces/person-lock.ts` | `workspaces/second-factor/person-lock.ts` (all six importers are in this group) |
| `workspaces/model-choice.ts` | `workspaces/models/model-choice.ts` |
| `workspaces/model-key.ts` | `workspaces/models/model-key.ts` |
| `workspaces/model-price.ts` | `workspaces/models/model-price.ts` |
| `workspaces/decision-threshold.ts` | `workspaces/models/decision-threshold.ts` |
| `workspaces/spending-limit.ts` | `workspaces/models/spending-limit.ts` |

Stays: `concepts/{index,vocabulary,file,trust,owners,visibility,map-maintenance,sync-cascade,waiting}.ts`; `erasure/{index,vocabulary,identifiers,requests,needles,suppressions,documents,map,report,routine,replay,replay-erasures,rehearsal}.ts`; `kernel/{index,vocabulary,refusal,refused-items,result,parse,constraint,ceiling,clock,address,portable-path,envelope}.ts`; `members/{index,vocabulary,bulk,credentials,groups,last-admin,member-list,name-flags,removal,requests,roles,sets}.ts`; `workspaces/{index,vocabulary,actors,add-person,display-name,grant-names,grants,listing,operator,people,promotion,sign-in-and-consent}.ts`.

Grouping evidence (each file's own `./` imports, read this session): the `kernel/principal` six import only each other plus `result`/`vocabulary`; the `members/invitations` six import each other plus `sets`/`vocabulary`; `audit-log`'s three are the audit-log read, its export and the activity view that calls it; the `workspaces/second-factor` nine import each other plus `display-name`/`sign-in-and-consent`/`vocabulary`; the `workspaces/models` five are single-setter modules importing only `vocabulary`; `erasure/sweeps` are the four arms `routine.ts` runs (`sweepTheActors`, `eraseFromTheIdentitySet`, `sweepTheQuestions`, `rederiveAfterErasure`).

Naming note: `erasure/sweeps/` reuses the code's own verb but shares a name with the `core/src/sweeps/` slice. `erasure/arms/` (the routine's other word) is the alternative if that collision reads badly.

### Move table: `packages/core/test/`

Stays at `test/` (5): `import-direction.test.ts`, `environment-lint.test.ts`, `face-admission.test.ts`, `tier-contract.test.ts` (named by root `package.json:25`), `refusal-words.test.ts` (the refusals slice has one test; a one-file folder is not allowed). `readings/` is unchanged (`vitest.readings.config.ts` includes `test/readings/*.reading.ts`). `fixtures/*.json` and `fixtures/northgate.ts` stay.

Each file appears exactly once (checked by script against `ls packages/core/test/*.ts`: 156 files, no duplicates, none missing).

| new folder | files moved from `test/` |
| --- | --- |
| `test/support/` (14) | `suite-postgres.ts`, `suite-objects.ts`, `warm-objects.ts`, `suite-documents.ts`, `suite-input.ts`, `worker-process.ts`, `platform.ts`, `rows.ts`, `identity-rows.ts`, `source-tree.ts`, `figures.ts`, `judge-wire.ts`, `restore-code.ts`, `planned.ts` |
| `test/fixtures/` (+6) | `contract-fixture.ts`, `cross-tier-fixture.ts`, `bundle.ts`, `bundle-root.ts`, `workspace-with-bundle.ts`, `sourced-concept.ts` |
| `test/access/` | `sensitivity-ranking.test.ts`, `invisibility.test.ts` |
| `test/answering/` (13) | `answering.test.ts`, `analysed-map.test.ts`, `decision-judge.test.ts`, `draft.test.ts`, `find-budget.test.ts`, `find-matching.test.ts`, `judge.test.ts`, `questions-asked.test.ts`, `recall.test.ts`, `unmapped-passage-rate.test.ts`, `passage-visibility.test.ts`, `asking.ts`, `recall.ts` |
| `test/audit/` | `audit.test.ts`, `audit-actions.test.ts`, `stored-names.test.ts`, `entry-points.ts` |
| `test/concepts/` (13) | `concepts.test.ts`, `concept-file-grammar.test.ts`, `concept-file.contract.test.ts`, `owners.test.ts`, `visibility.test.ts`, `sync-cascade.test.ts`, `waiting-on-you.test.ts`, `map-ops.test.ts`, `map-budget.test.ts`, `rebuild-equivalence.test.ts`, `bundle-fence.test.ts`, `bundle-fence.ts`, `revocation-race.ts` |
| `test/concepts/import/` | `import-bundle.test.ts`, `manifest.test.ts` |
| `test/concepts/writes/` | `concept-edit.test.ts`, `concept-search.test.ts`, `edit-budget.test.ts`, `write-budget.test.ts`, `suggestions.test.ts`, `suggestions.contract.test.ts`, `reconciler.test.ts` |
| `test/concepts/reading/` | `concept-read.test.ts`, `concept-plans.test.ts`, `browse.test.ts`, `browse-budget.test.ts` |
| `test/erasure/` (9) | `erasure.test.ts`, `erasure-map.test.ts`, `erasure-match.contract.test.ts`, `erasure-records.test.ts`, `erasure-rehearsal.test.ts`, `erasure-replay.test.ts`, `erasure-routine.test.ts`, `erasure-doors.ts`, `question-rows.ts` |
| `test/guides/` | `guides.test.ts`, `guide-read-budget.test.ts`, `guide-seed-budget.test.ts`, `templates.test.ts` |
| `test/kernel/` | `kernel.test.ts`, `credential-envelope.contract.test.ts`, `parse.test.ts` |
| `test/kernel/principal/` | `admission.test.ts`, `freshness.test.ts`, `principal.test.ts` |
| `test/llm/` (8) | `model-client.test.ts`, `model-stream.test.ts`, `model-choices.test.ts`, `credentials.test.ts` (it tests `openCredentials` from llm), `cost-ledger.contract.test.ts`, `typed-text.test.ts`, `spend.test.ts`, `stream-pauses.ts` |
| `test/members/` (10) | `members.test.ts`, `member-bulk.test.ts`, `member-credentials.test.ts`, `member-list.test.ts`, `member-removal.test.ts`, `member-role.test.ts`, `name-flag.test.ts`, `last-active.test.ts`, `access-requests.test.ts`, `members-suite.ts` |
| `test/members/invitations/` | `accepting.test.ts`, `invitation-sets.test.ts`, `invitations.test.ts`, `invitations-suite.ts` |
| `test/members/audit-log/` | `audit-log.test.ts`, `audit-export.test.ts`, `member-activity.test.ts`, `audit-rows.ts` |
| `test/runs/` | `runs.test.ts`, `queue.contract.test.ts`, `sync-sensitivity-moves.contract.test.ts` |
| `test/sources/` (12) | `sources.test.ts`, `connected-source-list.test.ts`, `document-passage.contract.test.ts`, `dpia.test.ts`, `findings.test.ts`, `passages.test.ts`, `passage-plans.test.ts`, `redaction.contract.test.ts`, `review.test.ts`, `upload-media-types.contract.test.ts`, `emptying-a-connected-source.contract.test.ts`, `cross-tier-document.test.ts` |
| `test/store/git/` | `git.test.ts`, `git-starts.ts`, `bundle-root.test.ts` |
| `test/store/map/` | `map.test.ts`, `map-target.test.ts`, `links.contract.test.ts`, `reader-linear.perf.test.ts` |
| `test/store/objects/` | `objects.test.ts`, `warm-objects.test.ts` |
| `test/sweeps/` | `sweeps.test.ts`, `identity-housekeeping.test.ts` |
| `test/workspaces/` | `workspaces.test.ts`, `display-name.test.ts`, `people.test.ts`, `promotion.test.ts`, `sign-in-and-consent.test.ts` |
| `test/workspaces/models/` | `model-choice.contract.test.ts`, `spend-settings.test.ts` |
| `test/workspaces/second-factor/` | `second-factor.test.ts`, `confirming.test.ts`, `passkeys.test.ts`, `passkey-confirm.test.ts`, `recovery-codes.test.ts`, `session-standing.test.ts`, `sessions.test.ts`, `second-factor-suite.ts` |

Helper placement evidence (importer counts measured by grep this session): `suite-postgres` 102 importers, `platform` 54, `workspace-with-bundle` 49, `suite-input` 37, `sourced-concept` 32, `rows` 25, `identity-rows` 24, `contract-fixture` 17, `bundle` 15, `figures` 12 (incl. readings): all cross-slice, so `support/` or `fixtures/`. Single-slice helpers: `invitations-suite` (2, members/invitations), `audit-rows` (1, members/audit-log), `erasure-doors` (4, erasure), `second-factor-suite` (7, workspaces/second-factor + `promotion.test`), `stream-pauses` (2, llm + `draft.test`), `revocation-race` (3, concepts), `git-starts` (2, `git.test` + `concepts.test`), `entry-points` (2 tests + `scripts/audit-actions.ts`).

`packages/core/package.json` `exports` targets that change (keys unchanged): `./testing/input` -> `./test/support/suite-input.ts`; `./testing/objects` -> `./test/support/suite-objects.ts`; `./testing/warm-objects` -> `./test/support/warm-objects.ts`; `./testing/postgres` -> `./test/support/suite-postgres.ts`; `./testing/bundle` -> `./test/fixtures/bundle.ts`; `./testing/bundle-root` -> `./test/fixtures/bundle-root.ts`; `./testing/documents` -> `./test/support/suite-documents.ts`; `./testing/worker-process` -> `./test/support/worker-process.ts`; `./testing/cross-tier` -> `./test/fixtures/cross-tier-fixture.ts`; `./testing/restore-code` -> `./test/support/restore-code.ts`; `./testing/judge-wire` -> `./test/support/judge-wire.ts`; `./testing/identity-rows` -> `./test/support/identity-rows.ts`. Every consumer outside core imports these through the keys (grep of `@better-answers/core/testing/*` across apps), so no consumer edit.

## 3. Path coupling

Grouped by what breaks. "Edit" means the literal must be rewritten in the same commit; "prose" means it goes stale but nothing fails.

### 3a. Gates and configs that fail loudly if not edited

| file:line | names | action |
| --- | --- | --- |
| `apps/worker/src/better_answers_worker/links.py:25` | `PORT_OF` `packages/schema/src/concept-file.ts` | edit to `knowledge/concept-file.ts`; `port_scan.py:131` checks `Path(ported).is_file()` |
| `packages/devtools/src/insert-scan.ts:12-19` | `FACTORY_MODULES`: `packages/core/test/audit-rows.ts`, `identity-rows.ts`, `packages/schema/test/before-the-action.ts`, `before-the-knowledge-words.ts`, `catalogue-statements.ts`, `concept-index-rows.ts`, `probes.ts`, `rls-probes.ts` | edit to `core/test/members/audit-log/audit-rows.ts`, `core/test/support/identity-rows.ts`, `schema/test/migrations/{before-the-action,before-the-knowledge-words,catalogue-statements}.ts`, `schema/test/knowledge/concept-index-rows.ts`, `schema/test/support/{probes,rls-probes}.ts` |
| `packages/devtools/test/insert-scan.test.ts:79-80,153` | `packages/schema/test/probes.ts` asserted as a factory module | edit to `schema/test/support/probes.ts` |
| `packages/schema/vitest.config.ts:5` | `import ... from "./test/apple-git.ts"` | edit to `./test/support/apple-git.ts` |
| `packages/schema/vitest.config.ts:17` | `globalSetup` `./test/warm-postgres.ts` | edit to `./test/support/warm-postgres.ts` |
| `packages/schema/scripts/generate-worker-schema.ts:6`, `generate-roles-surface.ts:6` | `../test/harness.ts` | edit to `../test/support/harness.ts` |
| `packages/schema/scripts/roles-surface.ts:8` | `../test/factory.ts` | edit to `../test/support/factory.ts` |
| `packages/core/scripts/audit-actions.ts:6` | `../test/entry-points.ts` | edit to `../test/audit/entry-points.ts` |
| `packages/schema/package.json` `exports` | targets listed in section 2 | edit targets only |
| `packages/core/package.json` `exports` | `./testing/*` targets listed in section 2 | edit targets only |
| `.oxlintrc.json:181` | override `files: ["packages/schema/src/drizzle-zod.ts"]` (the one file allowed to import `drizzle-zod`) | edit to `packages/schema/src/boundary-schemas/drizzle-zod.ts`, or the restriction fires on the moved file |
| `.oxlintrc.json:163,195,239,285,327,370,419` | restricted-import message text naming `packages/schema/src/drizzle-zod.ts` | edit (message prose) |
| `.oxlintrc.json:575` | `max-lines` 674 for `packages/core/src/concepts/edit.ts` | edit to `concepts/writes/edit.ts` (the file measures 674 code lines; at the new path without the override the 500 base cap at `:147` fires) |
| `.oxlintrc.json:581` | `max-lines` 1012 for `concepts/index.ts` | delete after the split (index becomes about 136 code lines) |
| `.oxlintrc.json:644` | `max-lines` 1388 for `packages/schema/src/boundary-schemas.ts` | delete after the split |
| `.oxlintrc.json:587,623,650` | `erasure/routine.ts`, `workspaces/index.ts`, `schema/src/table-ownership.ts` | no change (files stay) |
| `packages/schema/drizzle.config.ts:5` | `schema: "./src/schema.ts"` | no change (`schema.ts` stays; drizzle-kit follows its imports) |
| `package.json:25` | `check:docs:core` runs `test/tier-contract.test.ts` | no change (stays at root) |
| `package.json:32` | `table-ownership-scan ... packages/core/src apps/api/src` | no change (directory) |
| `scripts/mutation-shards.mjs:17-20` | `split` map `src/store/git/index.ts`, `src/store/map/index.ts` | no change (store does not move) |
| `packages/core/stryker.config.mjs:9` | `mutate: ["src/**/*.ts"]` | no change (recursive) |
| `packages/core/vitest.config.ts:7`, `packages/schema/vitest.config.ts:9` | `include: ["test/**/*.test.ts"]` | no change (recursive) |
| `packages/core/vitest.config.ts:15-18` | `globalSetup` by exports key | no change |
| `packages/core/vitest.readings.config.ts:10` | `test/readings/*.reading.ts` | no change |
| `packages/core/tsconfig.json`, `packages/schema/tsconfig.json` | `include: ["src","test","scripts",…]` | no change |
| `knip.config.ts:39-43` | core vitest configs | no change |
| `jscpd.config.mjs` | no core/schema paths | no change |
| `lefthook.yml:53,58` | package roots | no change |
| `cubic.yaml:66-67,129-130`, `.gitnexusignore:57,65` | directory globs | no change |
| `apps/api/Dockerfile:73,229,235,237` | copies `packages/schema/src`, `packages/core/src`, `packages/schema/migrations` | no change (whole directories; `migrations-folder.ts` stays at `src/` so `../migrations` still resolves inside the image) |
| `deploy/test-postgres.sh:12,14`, `deploy/local-database.sh:16,18`, `deploy/*.compose.yaml:3`, `renovate.json:53-54`, `packages/devtools/test/ci/deploy-tree.test.ts:88` | `packages/schema/src/postgres-image.ts` | no change (stays) |
| `packages/devtools/src/table-ownership-scan.ts:11` | `WHERE_THE_MAP_LIVES` `schema/src/table-ownership.ts` | no change (stays) |
| `apps/worker/src/better_answers_worker/ids.py:14` | `PORT_OF` `schema/src/ulid.ts` | no change (stays) |
| other `PORT_OF`: `envelope.py:16`, `concept_file.py:24`, `redaction/suppressions.py:22`, `pipeline/passages.py:17`, `links.py:26` | core `kernel/envelope.ts`, `concepts/file.ts`, `erasure/identifiers.ts`, `sources/passage-address.ts`, `store/map/index.ts` | no change (all stay) |
| `packages/devtools/test/ci/docs-lane.test.ts:334,340` | directories `packages/core/src`, `packages/schema/src` | no change |
| `packages/devtools/test/contract-digest.test.ts:9` | `packages/schema/src/contract-stamp.ts` | no change (stays) |
| `.github/workflows/*` | only `packages/core` as a leg path (`mutation.yml:48-67`) | no change |

### 3b. Tests that assert a moved path (fail when not edited)

| file:line | asserted literal | edit to |
| --- | --- | --- |
| `packages/core/test/access-requests.test.ts:648-653` (moves to `test/members/`) | slice-relative callers of `recordFor`: `members/accepting.ts`, `members/requests.ts`, `workspaces/display-name.ts`, `workspaces/recovery-codes.ts`, `workspaces/second-factor.ts`, `workspaces/sign-in-and-consent.ts` | `members/invitations/accepting.ts`, `members/requests.ts`, `workspaces/display-name.ts`, `workspaces/second-factor/recovery-codes.ts`, `workspaces/second-factor/second-factor.ts`, `workspaces/sign-in-and-consent.ts`, written in code-unit sorted order (the actual is `.toSorted()`) |
| `apps/api/tests/procedure-output.test.ts:23` | `NAMING_THE_MARK_IN_CORE = ["members/testing-domain.ts"]` (compared with a recursive `readdirSync` of core src) | `members/invitations/testing-domain.ts` |
| `packages/schema/test/full-text-match.test.ts:90` (moves to `test/knowledge/`) | `THE_RULE = "packages/schema/src/full-text-match.ts"`, excluded from the "chooses its own language" scan at `:412` and required in the scan at `:423` | `packages/schema/src/knowledge/full-text-match.ts` |
| `packages/devtools/test/insert-scan.test.ts:79-80,153` | see 3a | – |
| `apps/api/tests/no-ambient-clock.test.ts:40,42,45-49` | `core/src/kernel/clock.ts`, `schema/src/ulid.ts`, the two `src` dirs | no change (both stay) |
| `packages/core/test/stored-names.test.ts:22` | message text naming `core/src/audit/stored-names.ts` | no change (audit stays) |
| `packages/core/test/environment-lint.test.ts:19,33,38,47-52,83,90-91` | `concepts/landing.ts`, `schema/src/concept-tables.ts`, `core/test/git.test.ts`, `core/test/bundle.ts` | probe paths written into a throwaway tree, not real files; edit for accuracy only (`concepts/import/landing.ts`, `schema/src/knowledge/concept-tables.ts`, `core/test/store/git/git.test.ts`, `core/test/fixtures/bundle.ts`), not required to pass |
| `packages/devtools/test/port-scan.test.ts:14,16,138` | `schema/src/concept-file.ts` written into a throwaway tree (`runsOverThrowawayTree`) | optional edit |
| `packages/devtools/test/ci/docs-lane.test.ts:96,242,785` | `core/src/kernel/actor.ts` as a sample path for lane classification | optional edit (classification is by prefix) |
| `packages/core/test/import-direction.test.ts:289` | `src/kernel/actor.ts` as the cross-zone probe specifier (`placeOf` classifies by path shape and never stats) | optional edit to `src/kernel/principal/actor.ts` |
| `packages/devtools/test/table-ownership-scan.test.ts:25,34-35,167,181,191,250` | `core/src/{workspaces,members,runs}/index.ts` probes | no change (faces stay) |

### 3c. Depth-sensitive reads inside moved files (string edits, not imports)

| file:line (current) | expression | new value at new depth |
| --- | --- | --- |
| `packages/schema/test/warm-postgres.ts:90` -> `test/support/` | `new URL("./harness.ts", import.meta.url)` | unchanged (`harness.ts` moves beside it) |
| `packages/schema/test/warm-postgres.test.ts:30-32` -> `test/support/` | `new URL("..")`, `new URL("../../..")`, `./warm-postgres.ts` | `"../.."`, `"../../../.."`, unchanged |
| `packages/schema/test/worker-schema-view.test.ts:15-18` -> `test/migrations/` | `path.resolve(import.meta.dirname, "../../../apps/worker/...")` | `"../../../../apps/worker/..."` |
| `packages/schema/test/full-text-match.test.ts:88` -> `test/knowledge/` | `REPO_ROOT = path.resolve(import.meta.dirname, "../../..")` | `"../../../.."` |
| `packages/schema/test/table-ownership.test.ts:16`, `finding-factory.test.ts:11,21-23` | `../../../` | unchanged (both stay at root) |
| `packages/core/test/warm-objects.ts:41,43` -> `test/support/` | `"../../../deploy/garage.toml"`, `"../../../deploy/stores.compose.yaml"` | `"../../../../deploy/…"` |
| `packages/core/test/worker-process.ts:20` -> `test/support/` | `"../../../apps/worker"` | `"../../../../apps/worker"` |
| `packages/core/test/source-tree.ts:4` -> `test/support/` | `CORE_SRC = path.resolve(import.meta.dirname, "../src")` | `"../../src"` |
| `packages/core/test/contract-fixture.ts:6` -> `test/fixtures/` | `"../../../contracts"` | `"../../../../contracts"` |
| `packages/core/test/entry-points.ts:9` -> `test/audit/` | `"../package.json"` | `"../../package.json"` |
| `packages/core/test/recall.ts:31,33` -> `test/answering/` | `new URL("./fixtures/recall-set.json")`, `"./fixtures/buyer-questions.json"` | `"../fixtures/…"` |
| `packages/core/test/recall.test.ts:290` -> `test/answering/` | `new URL("../../../.planning/client-bundle/")` | `"../../../../.planning/client-bundle/"` |
| `packages/core/test/warm-objects.test.ts:16-17` -> `test/store/objects/` | `new URL("..")`, `new URL("./warm-objects.ts")` | `"../../.."`, `"../../support/warm-objects.ts"` |
| `packages/core/test/audit.test.ts:99` -> `test/audit/` | `path.resolve(import.meta.dirname, "audit.test.ts")` | unchanged (own directory) |
| `packages/core/test/tier-contract.test.ts:49`, `face-admission.test.ts:67` | `../../../contracts`, `../package.json` | unchanged (stay at root) |
| `packages/core/test/readings/reuse-set.ts:36` | `../fixtures/reuse-set.json` | unchanged (`readings/` and the JSON stay) |
| `packages/schema/src/migrations-folder.ts:7` | `new URL("../migrations")` | unchanged (stays) |
| `packages/schema/src/contract-digest.ts:5,7` | `../../../contracts`, sibling `contract-stamp.ts` | unchanged (both stay) |

### 3d. Contract fixtures: prose whose edit changes the tier-contract digest

`contracts/` is hashed byte for byte by both tiers (`packages/schema/src/contract-digest.ts:27-40`, `contracts/README.md`); the worker's loop compares its `CONTRACT_DIGEST` with the stamped row and idles on a mismatch (`apps/worker/src/better_answers_worker/loop.py:82`). These descriptions name moved paths:

- `contracts/cost-ledger/rows.json:2` (`schema/src/llm-tables.ts`), `contracts/emptying-a-connected-source/cases.json:2` (`schema/src/job-tables.ts`), `contracts/links/cases.json:2` (`core/test/links.contract.test.ts`), `contracts/document-passage/cases.json:2`, `contracts/redaction/cases.json:2` (`redaction.contract.test.ts`, `typed-text.test.ts`), `contracts/erasure-match/cases.json:2`, `contracts/upload-media-types/cases.json:2` (`core/test/sources.test.ts`).

Recommendation: leave `contracts/` untouched in the restructure so the digest does not move, and fix the prose in a separate PR that also runs `pnpm --filter @better-answers/schema run generate:contract-stamp` and `cd apps/worker && uv run --frozen generate-contract-stamp`. If edited here, both stamps must be regenerated in the same commit or `packages/schema/test/contract-digest.test.ts` and `apps/worker/tests/test_tier_contract.py:292` fail. `contracts/id-shape/cases.json` names `schema/src/ulid.ts` and `contracts/credential-envelope/cases.json` names `core/src/kernel/envelope.ts`; both stay, which is one reason they were kept in place.

### 3e. Prose that goes stale (no check reads it)

- `packages/schema/AGENTS.md:4` names `src/definer-reach.ts` (stays).
- `.cubic/wiki/04-s-data-management/01-p-relational-schema.md:11,13,43,47,100,163` (`boundary-schemas.ts` and its test with line anchors), `.cubic/wiki/05-s-backend/03-p-core-logic.md:11-12` (`kernel/actor.ts`, `kernel/principal.ts`), `.cubic/wiki/03-s-core-features/02-p-workspace-users.md:15,65,153` (`schema/test/rls.test.ts`, stays). Cubic regenerates its wiki.
- `docs/specs/route/{p1,s3,s4,s5,s6,s7,s8,v1,seams}.md` name `schema/src/{counter,write-up,source,job,index,concept}-tables.ts`, `core/src/concepts/{suggestions,reconciler,landing}.ts`, `core/src/kernel/principal.ts`, `core/test/{recall,rebuild-equivalence,cross-tier-document,invisibility}.test.ts`, `core/test/judge-wire.ts` (exact lines in the grep summary: `p1.md:27`, `s3.md:14`, `s4.md:16`, `s5.md:15`, `s6.md:15,23`, `s7.md:16`, `s8.md:16`, `v1.md:14`, `seams.md:31,33,35,41`).
- `docs/operations/readings.md:7,100,106-109` (`core/test/recall.test.ts`, `write-budget.test.ts`).
- `docs/solutions/**`: `a-ceiling-keyed-on-the-target-does-not-bound-the-actor.md:43,45,74,76,78,138`; `a-race-test-held-late-or-released-in-turn-cannot-prove-a-lock-order.md:11,16,44,56,68,113,129,152`; `a-race-test-cannot-count-on-a-queued-lock-waiter-taking-the-row-first.md:72`; `a-test-that-one-transaction-never-waits-parks-the-reader-on-a-table-neither-side-touches.md:39,45,49,68,85`; `a-bulk-write-to-the-map-analyses-it-for-the-planner.md:27,44,45,50`; `renaming-a-table-drizzle-kit-will-not-generate-so-the-migration-and-snapshot-are-written-by-hand.md:45,63,72,73`; `changing-a-generated-column-drizzle-kit-drops-its-index-so-the-migration-is-set-expression.md:25,51,53`; `better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md:104`; `better-auth-lookup-deleted-another-persons-expired-sign-in-code.md:149,157`; `two-tiers-regex-engines-split-lines-and-whitespace-differently.md:55,56,93`; `python-unquote-is-not-javascript-decodeuri.md:41`; `what-a-rename-prose-pass-gets-wrong-and-the-checks-that-catch-it.md:97` (`schema/test/test-title.ts`). Frontmatter `applies_when` entries that name a directory (`packages/schema/src/`) stay valid. `packages/devtools/test/solutions-docs.test.ts` does not check that cited paths exist (read this session).
- `docs/archive/**` and `docs/plans/**` hold about 170 historical mentions; leave them.
- `apps/api/Dockerfile:236` comment names `packages/schema/src/index.ts` (stays).
- `.claude/skills/survey-architecture/SKILL.md:16,18` names the directories only.

## 4. Import rewrite mechanics

- Every intra-package import is a relative specifier with an explicit `.ts` extension (`allowImportingTsExtensions`, `tsconfig.base.json`). Tallied in core tests: `./suite-postgres.ts` (98), `../src/kernel/index.ts` (90), and so on.
- Every cross-package import goes through an `exports` key (`@better-answers/schema/…`, `@better-answers/core/…`). No package declares an `imports` (`#`) field and `tsconfig.base.json` has no `paths`. Grep found no relative import that crosses a package boundary.
- One dynamic import, `packages/core/test/entry-points.ts:15`, takes a variable built from `package.json` exports, so nothing to rewrite there. No `vi.mock` strings in either package.
- `import-direction` forbids a test or a sibling slice from importing a slice internal (`faceFinding`, `import-direction.ts:200-221`), so moving a slice internal only rewrites imports inside that slice plus its own `index.ts` re-exports.

Codemod. A Node script over `oxc-parser` (already a devtools dependency; `oxc-parser@0.155.0` is installed). Input: the move table as JSON. Steps: `git mv` each file; for every `.ts`/`.mjs` under `packages/{schema,core}/{src,test,scripts}` plus `packages/*/vitest*.config.ts` and `packages/core/scripts/`, collect the `source` of `ImportDeclaration`, `ExportAllDeclaration`, `ExportNamedDeclaration` and literal `ImportExpression`; for each relative specifier resolve it against the importer's old path, map the target through the table, recompute it from the importer's new path, and splice by byte offset. Then rewrite the `exports` targets. TypeScript 7 (`typescript@7.0.2`) rules out `ts-morph`/language-service rename. The string edits in 3a to 3c stay a hand-kept table that the same script applies by exact match, and a verification pass greps the old paths afterwards.

Specific non-mechanical import edits:
- `concepts/import/landing.ts:33` and `concepts/writes/reconciler.ts:30` import `type Acceptance` from `./index.ts`; `concepts/writes/suggestions.ts:41` imports `type Frontmatter` from `./index.ts`. Point them at `../writes/write.ts` / `./write.ts` (`Acceptance`) and `../file.ts` (`Frontmatter`) so the face does not import its own leaves. The mechanical alternative (`../index.ts`) also type-checks.
- `@public` knip tags. `AcceptSuggestionRefusal` carries `/** @public S3 */` at `concepts/index.ts:230`. Keep the tag on its new re-export line in the face, as the face already does for `./edit.ts`, `./owners.ts` and others.

## 5. Risks

- **R1. `packages/schema/test/finding-factory.test.ts:21-23` walks `import.meta.dirname` recursively** and counts category words across the whole test tree (`CATEGORY_WORDS_IN_THE_TREE = 10`). Nested, it would see only its own folder. Kept at `test/` root.
- **R2. Asserted path lists** (3b). `access-requests.test.ts:648-653` and `procedure-output.test.ts:23` compare real directory walks with literal slice-relative paths. Both must be rewritten.
- **R3. Depth-sensitive `import.meta.dirname` / `new URL` reads** (3c). The import codemod does not see them.
- **R4. Warm Postgres template name changes once.** `packages/schema/test/warm-postgres.ts:112` hashes the bytes of `harness.ts` into the template name. `harness.ts`'s imports change (`../src/index.ts` -> `../../src/index.ts`), so the shared test server builds one new template. This is a one-time cost, not a behaviour change.
- **R5. Stryker incremental baseline keys by file path** (`stryker.config.mjs:19`, `incrementalFile`). Moved and split files lose their per-file history for one run, and `weightsOf` (`packages/devtools/src/mutation-shards.ts:84-101`) falls back to byte size when sharding them. This is a one-run cost.
- **R6. `face-admission` follows only `./` re-exports** (`packages/devtools/src/face-admission.ts:151,201,241`). Each face's re-export must point straight at the defining module (`./writes/edit.ts`), never through a nested module that re-exports from `../`. Otherwise `test/face-admission.test.ts` `STEPS` lines change. The proposed tree keeps every chain one hop.
- **R7. `import-direction.test.ts:271-306` generates one `it.each` per directory under `core/src`.** The new sub-directories add test cases (`places src/concepts/writes in its zone`). They pass: zone is keyed by the first segment. They are new titles, all under the 10-word cap in `test/test-title.ts`.
- **R8. `boundarySchemas` key order.** If the registry is rebuilt by spreading per-domain parts, key order changes. `boundary-schemas.test.ts:1019` (`ownKeys`) only drives `it.each` order, `rls.test.ts:2548` uses `.find` by table identity, and `:1049,1211` compare sorted. No consumer depends on order (all `Object.keys/entries(boundarySchemas)` sites grepped). Section 6 still keeps one literal in the original order, to stay byte-for-byte in behaviour.
- **R9. Contract digest** (3d). Editing `contracts/` prose bumps the digest and needs both stamps regenerated.
- **R10. `drizzle-zod` restriction.** If `drizzle-zod.ts` moves without its `.oxlintrc.json:181` override moving, the moved file itself violates the restricted import.
- **R11. `table-ownership-scan` and `NEVER_AN_OWNER`** (`schema/src/table-ownership.ts:17`) read only top-level core slice directories (`readdirSync` of `packages/core/src`, `table-ownership-scan.ts:37-39`; `schema/test/table-ownership.test.ts:18-23`). Sub-folders are not new slices. Do not name a sub-folder `test`/`tests`/`e2e`, or `isTestPath` (`packages/devtools/src/paths.ts:8,43-47`) drops its files from the ownership and insert scans.
- **R12. Docker image.** Only `packages/schema/src`, `packages/schema/migrations` and `packages/core/src` are copied (`apps/api/Dockerfile:73,229,235,237`). No moved `src` file may import from `test/`. None does.
- **R13. `max-lines` ratchets and the formatter.** Each override at `.oxlintrc.json:563-653` caps a file at its exact current count. `concepts/edit.ts` measures 674 code lines against a cap of 674. Three capped files import moved siblings: `workspaces/index.ts` (cap 621) gains `./second-factor/…` and `./models/…` specifiers, `erasure/routine.ts` (cap 551) gains `./sweeps/…`, and `concepts/writes/edit.ts` (674) gains `../import/landing.ts`. A longer specifier can push a one-line `import { a, b } from "…"` past the print width. `oxfmt` then wraps it one name per line, and import lines count as code lines. Files near the 500 base cap (`members/invitations.ts` 502 raw lines, `concepts/write.ts` 555 raw lines, `workspaces/second-factor.ts` 471) are exposed the same way. The move step should run `oxfmt` and then `oxlint`, and expect to re-ratchet these caps in the same commit (*inferred*, not run). `oxfmt` also re-sorts the rewritten import blocks, so the diff is wider than the codemod's splices.
- No snapshot files, no gate counting files per folder, no fixture loaded by a path a test computes from its own name (beyond R1/3c), and drizzle meta snapshots hold no TS paths (`grep` of `migrations/meta/*.json` found none).

## 6. Big-file splits

### 6a. `packages/schema/src/boundary-schemas.ts` (1566 lines; cap 1388 at `.oxlintrc.json:644`)

Current exports (the public surface through `src/index.ts`'s `export *`): `ACTOR_ID`, `PROCESS_PREFIX` (re-export, `:474`), `recordKeepingEveryKey` (`:543`), `conceptFrontmatter` (`:567`), `RecordConcept` (`:1005`), `recordMapState` (`:1007`), `RecordMapState` (`:1012`), `DraftedSentence` (`:1038`), `boundarySchemas` (`:1226`). Everything else is module-private.

Code lines measured per chunk (non-blank, non-comment): imports 168, id helpers 13, workspace+LLM 90, passage 26, identity+groups 80, platform rows 30, audit+access 46, concepts 177, sources+erasure 104, guides+write-ups 104, answers 75, map 76, job 23, suggestions 35, registry 341.

| new module | takes lines | holds | est. code lines |
| --- | --- | --- | --- |
| `boundary-schemas/shared.ts` | 171-188, 303-307, 530, 860 | `workspaceId`, `userId`, `groupId`, `connectedSourceId`, `writeUpId`, `identityId`, `plain`, `readableUnit`, `conceptIri`, `ordinal` (each used by 2+ domains, by grep of use lines) | ~30 |
| `boundary-schemas/platform.ts` | 190-301, 385-412, 427-472, 1159-1184 | workspace, model choice, model key (`sealedFrame`), LLM call (`decimal`, `tokenCount`, `servedBy`), spend reservation, model price, decision threshold, workspace config; MCP-call, invitation-email and ingress counters; contract stamp, `aCount`, sweep pass, backup; `outcomeScalar`, `outcome`, job | ~190 |
| `boundary-schemas/people.ts` | 334-383, 414-425, 474-528 | user, member, session, invitation, group, group member; `isTestingDomain`, test workspace mark; `detailEntry`, `detail`, audit-log refinements, audit event, identity audit event, access request | ~120 |
| `boundary-schemas/concepts.ts` | 532-732, 1186-1224 | `PROTO_FAMILY`…`withKeysRenamed`, `recordKeepingEveryKey`, `frontmatterEntry`, `namesAResource`, `conceptFrontmatter`, `frontmatter`, concept identity/file/kind/index, bundle commit, evidence, verification, concept evidence, sensitivity override, owner; suggestion, concept write request (`conceptKind` is shared by both) | ~235 |
| `boundary-schemas/sources.ts` | 309-332, 734-852 | passage; `rulesInForce`, connected source, source document, finding, subject identifiers, subject request, erasure action(s), erasure request, suppression | ~145 |
| `boundary-schemas/guides.ts` | 854-858, 862-977 | `guideId`, `sectionId`, `expectedFactId`, `versioned`, guide definition/role/section/expected fact/version, write-up, include, version | ~115 |
| `boundary-schemas/answers.ts` | 979-1066 | usage, `recordConcept`/`RecordConcept`, `recordMapState`/`RecordMapState`, question asked, `draftedSentence`/`DraftedSentence`, question content, question feedback | ~85 |
| `boundary-schemas/map.ts` | 1068-1157 | map label, generation, key, row, map generation/node/edge/unresolved reference | ~85 |
| `boundary-schemas/registry.ts` | 1226-1566 | the `boundarySchemas` literal, verbatim and in its current key order | ~355 |
| `boundary-schemas/index.ts` | – | `export { ACTOR_ID, PROCESS_PREFIX } from "../people/actor-id.ts"; export { recordKeepingEveryKey, conceptFrontmatter } from "./concepts.ts"; export { recordMapState, type RecordConcept, type RecordMapState, type DraftedSentence } from "./answers.ts"; export { boundarySchemas } from "./registry.ts";` | ~6 |
| `boundary-schemas/drizzle-zod.ts` | moved file | unchanged one-line re-export of `drizzle-zod` | 1 |

How the exports stay identical:
- `src/index.ts:9` changes `./boundary-schemas.ts` to `./boundary-schemas/index.ts`. The folder `index.ts` is a named list of exactly the nine names, never `export *` of each leaf, so `src/index.ts`'s `export *` does not widen.
- The leaf modules export their `*Select`/`*Insert`/`*Update` consts (and the helpers in `shared.ts`) for `registry.ts` only. Knip's `includeEntryExports` does not apply, because no leaf is an entry. No lint rule demands a doc block on an exported declaration. `better-answers/declaration-doc-block` (`packages/devtools/lint-rules/rules/declaration-doc-block.ts`) only turns an existing line comment above a declaration into a `/** */` block, and `.oxlintrc.json` turns on no `jsdoc/require-*` rule (both read this session). So about 200 newly exported consts add no lint findings.
- Imports at lines 1-169 split by use: each leaf imports only its own tables from `../people/…`, `../knowledge/…`, `../sources/…`, `../platform/…`, `../schema.ts`, `../ulid.ts`, `../contract-digest.ts`, and `./drizzle-zod.ts`.
- `registry.ts` should take each leaf as a namespace (`import * as platform from "./platform.ts"`, entries written `select: platform.workspaceSelect`). About 200 named imports would be wrapped one per line by the formatter and push the module past 500 code lines (*inferred* from the formatter's wrapping, not run).
- Alternative: each leaf exports its slice of the registry and `registry.ts` spreads them. That module is smaller, but key order changes (R8).
- `boundary-schemas.test.ts:1057,1593,1620,1862` and the `Equal<>` map at `:2749` read `boundarySchemas[name]` by key. Both shapes keep the literal key types.

### 6b. `packages/core/src/concepts/index.ts` (1119 lines; cap 1012 at `.oxlintrc.json:581`)

Measured code lines: imports 91, face re-exports (95-214) 114, accept suggestions (216-392) 155, import bundle (394-797) 364, concept lookup (799-1112) 281, `waiting.ts` re-export (1113-1119) 7.

| new module | takes lines | exports (all re-exported by the face, names unchanged) | est. code lines |
| --- | --- | --- | --- |
| `concepts/writes/acceptance.ts` | 216-392 | `AcceptanceDecision`, `AcceptSuggestionRefusal` (`@public S3`), `AcceptanceOutcome`, `acceptSuggestions` | ~180 |
| `concepts/import/import-bundle.ts` | 394-797 | `ImportBundleInput`, `ConceptRewritten`, `ImportProgress`, `BundleImported`, `MapNotAnalysedLine`, `ImportLog`, `ImportBundleRefusal`, `importBundle` | ~405 |
| `concepts/reading/lookup.ts` | 799-1112 | `OpenedConcept`, `conceptByIri`, `conceptsByIris`, `ConceptRead`, `readConcept`, `evidenceOf`, `corpusCountsOf`, `conceptCountsOf`, `ConceptBound`, `ConceptFound`, `findConcepts`, `readableCollections`, `evidenceForAReadableConcept` | ~305 |
| `concepts/index.ts` | 95-214, 1113-1119 + three new re-export blocks | only re-exports: the 120-line block with paths updated to `./import/…`, `./writes/…`, `./reading/…`, plus the 25 names above | ~136 |

Why these cut points. Internal helpers never cross a chunk boundary: `acceptOne`/`preparedFor`/`acceptanceOf`/`authorFor` stay inside 216-392, `openImport`/`landEach`/`runImport`/`ResolvedConcept` inside 394-797, and `ConceptRow`/`conceptSelect`/`openedOf`/`MATCH` inside 799-1112 (use lines grepped per name). The lookup chunk stays one module: `findConcepts` (1031) uses `conceptCountsOf` (999), `openedOf` (840) and `conceptSelect` (828), so a three-way split would export internals for siblings. The name `read.ts` is taken (`conceptPageOf`), hence `lookup.ts`.

How the exports stay identical. The face exports exactly today's names, keeping `/** @public … */` tags on their re-export lines. `export { foldKind } from "../bundle/index.ts"` and `export type { SweptGeneration } from "../store/map/index.ts"` stay as they are. The face imports nothing after the split. `face-admission` `STEPS` keys (`concepts/findConcepts`, `concepts/readConcept`, `concepts/evidenceOf`, `concepts/conceptCountsOf`, …) are face/name pairs, so they hold as long as each re-export is a direct `./` hop (R6).
