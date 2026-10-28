# Folder restructure: `apps/web` explorer report

> **Note, 28/10/2026.** This map records the tree at `d6fc08ee6`. PR #928 carried it out, and BA-267 grouped `src/app/` into `shell/` and `pages/` afterwards. The tests of `app/pages/*` now mirror their source in `test/app/pages/`, so the sub-rule that put them in `test/app/` no longer holds. Paths and line numbers here can differ from `main`.

Read-only investigation on branch `refactor/folder-restructure`. Every count and every move row below was generated from the import graph (`/tmp/web-explore/edges.tsv`, 2159 import edges parsed from `src/`, `test/`, `e2e/`) and a mapping file, then checked by a script that (a) confirms every file on disk is placed exactly once and (b) recomputes every rewritten specifier and rejects any relative one the lint forbids. Result: 257 files move, 0 lint violations, 774 import specifiers change.

## 0. The constraint that shapes everything: the web's relative-import lint

`.oxlintrc.json:222-233` (all of `apps/web/**`) and the features override at `.oxlintrc.json:261-305` refuse relative imports matching `../*/**` or `../../**`. The features override also refuses `@/features/**`, including a feature's own folder (`.oxlintrc.json:265-270`). `apps/web/test/lint-rules.test.ts:36-48` proves the edges of this:

- `features/model-choices/components/reaches-its-own-feature.ts` importing `../api.ts` is allowed (line 38-40). One step up to a file is legal.
- `features/model-choices/` importing `../people/api.ts` is refused (line 36-37). The same glob refuses `features/x/a/f.ts -> ../b/g.ts`.

Consequences:

1. **Features are hub and spoke.** A file in `features/<f>/<sub>/` can import `./x` (own folder), `../x.ts` (feature root) and `@/shared/**`. It cannot import a sibling subfolder by any spelling. A feature-root file can import `./<sub>/x.ts`. So a file imported by two subfolders must sit at the feature root. The proposals below were found by assigning files to noun groups and promoting every cross-sibling importee to the root until no violation is left (`/tmp/web-explore/fit.mjs`).
2. **Nesting is one level inside a feature.** `features/<f>/<a>/<b>/x.ts` would need `../../x.ts` to reach the feature root, which is refused, and `@/features/<f>/...` is refused too.
3. **`shared/` is unconstrained.** Its override (`.oxlintrc.json:307-347`) bans only `@/features/**` and `@/app/**`, and shared files already cross folders as `@/shared/ui/button.tsx`. Subfolders there cost nothing but importer rewrites.
4. **`test/` and `e2e/` have no alias of their own.** `apps/web/tsconfig.json:20` maps only `@/*` to `./src/*`. From `test/people/x.test.tsx`, `../support/stub-server.ts` matches `../*/**` and is refused, and anything two levels deep cannot reach `test/` root at all. A mirrored test tree therefore needs one new alias (section 4).
5. **Do not solve this with a new override.** `apps/web/test/lint-rules.test.ts:14` throws unless exactly five `apps/web` overrides carry `no-restricted-imports` or `unicorn/filename-case`. A sixth override (for feature subfolders or for tests) breaks it and loosens a rule the owner wrote on purpose.
6. **The rule's message and its glob disagree.** The message says "A relative import in apps/web stays inside its own directory". The glob permits `../file.ts`. This plan leans on the glob (feature leaves import `../auth-hooks.ts`). The owner should know that the restructure makes `../x.ts` a normal pattern in features, where today no file in `src/` uses `../` at all.

## 1. Inventory

| Folder | Loose files now | Loose files after | After, per folder |
| --- | --- | --- | --- |
| `src/features/auth` | 47 | 15 | root 15, `second-factor/` 14, `workspace/` 9, `sign-in/` 6, `sessions/` 3 |
| `src/features/people` | 49 | 15 | root 15, `members/` 10, `groups/` 9, `invitations/` 6, `requests/` 5, `audit-log/` 4 |
| `src/features/console` | 25 | 13 | root 13, `everyone/` 7, `names-waiting/` 5 |
| `src/shared` | 43 | 14 | root 14, `list/` 11, `page/` 7, `member/` 6, `address/` 3, `theme/` 2 (existing `api/` 6, `audit/` 6, `knowledge/` 9, `lib/` 1, `ui/` 29 unchanged) |
| `test` | 111 | 7 | root 7 (repo gates), `support/` 13, `app/` 15, `shared/` 9 + 9 subfolders, `auth/` 6 + 3, `people/` 4 + 4, one folder per other feature |
| `e2e` | 56 | 10 | root 10 (9 helpers + the gate's self-test), `auth/` 15, `app/` 9, `people/` 5, `knowledge/` 5, `shared/` 3, `ask/` 2, `questions/` 2, `console/` 2, `sources/` 1, `inbox/` 1, `model-choices/` 1 |

Other features, checked and left alone: `sources/` 12, `inbox/` 10, `ask/` 8, `knowledge/` 8, `questions/` 7, `model-choices/` 3. Only `console/` (25) needs the treatment, and it gets it above.

Out of scope but over the limit: `src/app/` holds 18 loose files plus `pages/` (3). `src/shared/ui/` holds 29 loose files; leave it flat because the shadcn CLI writes there through `components.json:14-15` (`"components"`/`"ui": "@/shared/ui"`), and `NOTICE:7`, `src/shared/ui/THIRD_PARTY_NOTICES.md:1`, `knip.config.ts:34`, `jscpd.config.mjs:20` and `.oxlintrc.json:427` all name it. `src/shared/lib/` is a one-file folder (rule 2) pinned by `components.json` `"utils": "@/shared/lib/utils"` and `"lib": "@/shared/lib"`; leave it.

`apps/web` has no `exports` map, so rule 4 (keep exports keys) is moot here.

## 2. Target tree

### `src/features/auth` (hub: seam, shared words, the account page that composes the leaves)

```
auth/
  account-page.tsx  account-sections.tsx  account-words.ts  auth-client.ts  auth-hooks.ts
  auth-page.tsx  carried-flow.ts  clipboard.ts  code-entry.ts  passkey-hooks.ts
  refusal-words.ts  second-factor-steps.ts  session-memory.ts  sign-out-button.tsx  theme-section.tsx
  second-factor/   authenticator-code.tsx authenticator-part.tsx confirm-hooks.ts passkey-offer.tsx
                   passkeys-part.tsx pending-refusal.ts reconfirm-dialog.tsx recovery-codes.tsx
                   second-factor-hooks.ts second-factor-pages.tsx second-factor-parts.tsx
                   second-factor-words.ts setup-page.tsx unsaved-change.ts
  sign-in/         display-name-page.tsx link-page.tsx link-words.ts passkey-sign-in.tsx
                   sign-in-page.tsx sign-in-words.ts
  workspace/       accept-invitation-page.tsx account-link.tsx ask-to-join-words.ts ask-to-join.tsx
                   choose-workspace-page.tsx invitation-words.ts no-workspace-page.tsx
                   switched-elsewhere.ts workspace-words.ts
  sessions/        sessions-hooks.ts sessions-part.tsx sessions-words.ts
```

Why these sit at the root (each is imported by two leaves, or composes leaves): `account-page.tsx` imports `sessions/sessions-part.tsx` and four `second-factor/` files; `account-sections.tsx` is imported by `sessions/sessions-part.tsx` and `second-factor/setup-page.tsx` and `passkeys-part.tsx`; `code-entry.ts` by `sign-in/sign-in-page.tsx` and `second-factor/authenticator-code.tsx`; `passkey-hooks.ts` by `sign-in/passkey-sign-in.tsx` and `second-factor/*`; `second-factor-steps.ts` by `sign-in/link-page.tsx` and `second-factor/*`. `auth-client.ts` and `auth-hooks.ts` must stay put: `.oxlintrc.json:392-394` names them as the only better-auth importers, and `package.json:33` (`auth-seam-scan`) names `auth-hooks.ts`. Root files that import down (legal, `./sub/x.ts`): `auth-hooks.ts` and `carried-flow.ts` import `./sign-in/sign-in-words.ts`; `passkey-hooks.ts` imports `./second-factor/second-factor-hooks.ts`; `account-sections.tsx` imports three `second-factor/` files.

### `src/features/people`

```
people/
  empty-lines.ts group-checklist.tsx groups-api.ts invitation-words.ts invite-action.tsx
  member-action-words.ts members-page.tsx people-api.ts people-state.ts refusal-words.ts
  refusal.tsx role-choice.tsx role-meanings.ts unsent-emails.tsx words.tsx
  audit-log/    audit-log-api.ts audit-log-page.tsx audit-log-state.ts audit-log-words.ts
  groups/       create-group-action.tsx delete-group-dialog.tsx delete-group-warning.tsx group-sheet.tsx
                group-words.ts groups-address.ts groups-page.tsx rename-group-dialog.tsx rename-group-form.ts
  invitations/  invitation-actions.tsx invitation-columns.tsx invitations-address.ts invitations-api.ts
                invitations-tab.tsx invite-addresses.ts
  members/      groups-read.tsx member-activity.tsx member-bulk-actions.tsx member-columns.tsx member-page.tsx
                member-removal.tsx member-sections.tsx members-address.ts members-tab.tsx self-action.tsx
  requests/     approve-request.tsx requests-address.ts requests-api.ts requests-columns.tsx requests-tab.tsx
```

Promoted to the root by the lint: `groups-api.ts` and `group-checklist.tsx` (imported from `members/`), `invite-action.tsx` and `unsent-emails.tsx` (imported from `members/` and `requests/`), `invitation-words.ts` (from `requests/`), `role-choice.tsx` (from `requests/` and `members/`), and `members-page.tsx`, which composes the three tabs in `members/`, `invitations/` and `requests/`. `groups-read.tsx` lives in `members/` because only `members/member-bulk-actions.tsx` and `members/member-sections.tsx` import it; that is the one placement that reads oddly by name. Without it the root would be 16.

### `src/features/console`

```
console/
  correct-display-name.tsx facts.tsx list-parts.tsx list-words.ts operator.ts people-address.ts
  people-api.ts people-keystrokes.ts person-words.tsx refusal-words.ts sheet-action.tsx words.ts
  workspaces-page.tsx
  everyone/       end-every-sign-in-everywhere.tsx everyone-list.tsx everyone-page.tsx everyone-pages.tsx
                  everyone-search.tsx grant-words.ts person-sheet.tsx
  names-waiting/  correct-name-dialog.tsx correcting-words.ts names-waiting-list.tsx names-waiting-page.tsx
                  use-correcting.ts
```

`correct-display-name.tsx` and `sheet-action.tsx` sit at the root because `everyone/person-sheet.tsx` and the names-waiting files both reach them.

### `src/shared`

```
shared/
  answer-words.ts blueprint.tsx browser-storage.ts icon.tsx keystroke-words.ts keystrokes.tsx
  landing.ts logo.tsx navigation.ts outcome.tsx read-said.ts refusal-outcome.tsx refusal-words.ts words.ts
  list/     filter-row.tsx grid-table.tsx keyed.ts last-read.ts list-pages.tsx row-focus.ts row-menu.tsx
            row-sheet.tsx searched-list.ts selection-bar.tsx summary-row.tsx
  page/     action-dialog.tsx breadcrumb-last-part.ts empty-state.tsx page-head.tsx page-toolbar.tsx
            sheet-part.tsx wide-layout.ts
  member/   address.tsx display-name-words.ts initials.ts member.ts ownership.ts role-words.ts
  address/  address-ask.ts address-query.ts list-address.ts
  theme/    theme-switch.ts theme.ts
  api/ audit/ knowledge/ lib/ ui/   (unchanged)
```

Rule chosen for `shared/`: the high fan-in spine stays at root (`navigation.ts` 101 importers, `keystrokes.tsx` 61, `refusal-words.ts` 52, `outcome.tsx` 51, `words.ts` 47, `refusal-outcome.tsx` 22, `icon.tsx` 18), and the long tail is grouped by concern. Importer rewrites this costs: `list/` 108, `page/` 74, `member/` 48, `address/` 22, `theme/` 10, total 262. Grouping the spine too (an `outcome/` folder for the refusal trio and a `keystrokes/` folder) would add 192 more rewrites (outcome trio 125, keystrokes pair 67, from the fan-in counts) for no gain in findability. `address.tsx` is the component that breaks an email address for wrapping, used only by people and console pages, so it goes to `member/`; leaving it at root beside a new `address/` folder (which means the URL) would mislead. `theme/` exists only to get the root to 14; it costs one line in `vite.config.ts:9`.

### `test` (mirrors `src`, minus the `features/` level; helpers through one alias)

```
test/
  api-seam.test.ts blueprint-in-one-place.test.ts browser-suite-skill.test.ts folder-case.test.ts
  lint-rules.test.ts playwright-config.test.ts run-summary.test.ts        (repo gates: no src mirror, depth-pinned)
  support/   address-router.tsx blueprint-parts.tsx clipboard-stand-in.ts measuring.ts members-list.tsx
             open-app.tsx playwright-tree.ts regions-seen.tsx second-factor-api.ts source-files.ts
             stub-server.ts stubbed-api.ts two-workspaces.ts
  app/       15 tests of src/app (shell, router, menu, jump-to, workspace switcher, member redirect)
  shared/    9 tests of shared root files, plus address/ 3, member/ 2, api/ 2, audit/ 2, knowledge/ 3,
             list/ 4, page/ 1, theme/ 1, ui/ 5
  auth/      6, plus second-factor/ 7, sign-in/ 3, workspace/ 1
  people/    4, plus audit-log/ 1, groups/ 2, invitations/ 2, members/ 7
  console/ 3   inbox/ 2   sources/ 2   ask/ 1   knowledge/ 1   model-choices/ 1   questions/ 1
```

Two sub-rules of the mirror, stated so a path can still be predicted: a test of a registry component under `shared/ui/kibo-ui/` or `shared/ui/ai-elements/` lives in `test/shared/ui/` (`counted-switch`, `qr-code`), and a test of `app/pages/*` lives in `test/app/` (`connect-assistant`), because both source subfolders are vendor or routing groupings with one test each.

Tests are mostly integration tests named for behaviour, not one-per-source-file, so each was placed by the source it exercises (its imports plus its `describe` titles). Cross-feature tests went to the zone that owns the behaviour: `said-after-mount` to `shared/` (beside `read-said`), `member-redirect` to `app/` (the shell's redirect), `refused-tab` and `returning-tab` to `people/` root.

The seven gates stay at `test/` root because each is pinned to its depth: `playwright-config.test.ts:22` imports `../playwright.config.ts` (one level deeper it becomes `../../`, refused), `folder-case.test.ts:6` and `api-seam.test.ts:8` resolve `../src` and `..`, and `browser-suite-skill.test.ts` is named by `package.json:27` and `packages/devtools/test/ci/docs-lane.test.ts:432` (which asserts the file exists).

Conflict to decide: mirroring creates eight one-file test folders (`shared/page`, `shared/theme`, `auth/workspace`, `people/audit-log`, `ask`, `knowledge`, `model-choices`, `questions`), which rule 2 forbids. I chose the mirror, because rule 3's purpose (predict the test path from the source path) fails the moment a test is kept elsewhere to avoid a lone folder.

### `e2e` (one level, specs by feature, helpers stay at root)

```
e2e/
  accessibility-gate.spec.ts action-timing.ts browser.ts drawn-parts.ts harness.ts knowledge.ts
  locators.ts refused-read.ts run-summary.ts virtual-authenticator.ts
  auth/ 15   app/ 9   people/ 5   knowledge/ 5   shared/ 3   ask/ 2   questions/ 2   console/ 2
  sources/ 1   inbox/ 1   model-choices/ 1
```

Specs stay one level deep so `../harness.ts` stays legal and e2e needs no alias. `e2e/auth/` is exactly 15; it does not mirror auth's subfolders, because a spec two levels deep could not import `../../harness.ts`. Helpers stay at root rather than `e2e/support/`: `run-summary.ts` is pinned by `playwright.config.ts:38` and asserted at `test/playwright-config.test.ts:61`, `drawn-parts.ts:47` resolves `../src`, and moving the rest would need the alias for nothing. `accessibility-gate.spec.ts` stays at root because it tests the suite's own fixture in `browser.ts`, not a feature. `e2e/sources`, `e2e/inbox` and `e2e/model-choices` are one-file folders for the same reason as the tests.

## 3. Move table (every file that moves; 257 rows)

Paths are relative to `apps/web/`. Files not listed stay where they are.

#### apps/web/src/features/auth

| old | new |
| --- | --- |
| `src/features/auth/authenticator-code.tsx` | `src/features/auth/second-factor/authenticator-code.tsx` |
| `src/features/auth/authenticator-part.tsx` | `src/features/auth/second-factor/authenticator-part.tsx` |
| `src/features/auth/confirm-hooks.ts` | `src/features/auth/second-factor/confirm-hooks.ts` |
| `src/features/auth/passkey-offer.tsx` | `src/features/auth/second-factor/passkey-offer.tsx` |
| `src/features/auth/passkeys-part.tsx` | `src/features/auth/second-factor/passkeys-part.tsx` |
| `src/features/auth/pending-refusal.ts` | `src/features/auth/second-factor/pending-refusal.ts` |
| `src/features/auth/reconfirm-dialog.tsx` | `src/features/auth/second-factor/reconfirm-dialog.tsx` |
| `src/features/auth/recovery-codes.tsx` | `src/features/auth/second-factor/recovery-codes.tsx` |
| `src/features/auth/second-factor-hooks.ts` | `src/features/auth/second-factor/second-factor-hooks.ts` |
| `src/features/auth/second-factor-pages.tsx` | `src/features/auth/second-factor/second-factor-pages.tsx` |
| `src/features/auth/second-factor-parts.tsx` | `src/features/auth/second-factor/second-factor-parts.tsx` |
| `src/features/auth/second-factor-words.ts` | `src/features/auth/second-factor/second-factor-words.ts` |
| `src/features/auth/setup-page.tsx` | `src/features/auth/second-factor/setup-page.tsx` |
| `src/features/auth/unsaved-change.ts` | `src/features/auth/second-factor/unsaved-change.ts` |
| `src/features/auth/display-name-page.tsx` | `src/features/auth/sign-in/display-name-page.tsx` |
| `src/features/auth/link-page.tsx` | `src/features/auth/sign-in/link-page.tsx` |
| `src/features/auth/link-words.ts` | `src/features/auth/sign-in/link-words.ts` |
| `src/features/auth/passkey-sign-in.tsx` | `src/features/auth/sign-in/passkey-sign-in.tsx` |
| `src/features/auth/sign-in-page.tsx` | `src/features/auth/sign-in/sign-in-page.tsx` |
| `src/features/auth/sign-in-words.ts` | `src/features/auth/sign-in/sign-in-words.ts` |
| `src/features/auth/accept-invitation-page.tsx` | `src/features/auth/workspace/accept-invitation-page.tsx` |
| `src/features/auth/account-link.tsx` | `src/features/auth/workspace/account-link.tsx` |
| `src/features/auth/ask-to-join-words.ts` | `src/features/auth/workspace/ask-to-join-words.ts` |
| `src/features/auth/ask-to-join.tsx` | `src/features/auth/workspace/ask-to-join.tsx` |
| `src/features/auth/choose-workspace-page.tsx` | `src/features/auth/workspace/choose-workspace-page.tsx` |
| `src/features/auth/invitation-words.ts` | `src/features/auth/workspace/invitation-words.ts` |
| `src/features/auth/no-workspace-page.tsx` | `src/features/auth/workspace/no-workspace-page.tsx` |
| `src/features/auth/switched-elsewhere.ts` | `src/features/auth/workspace/switched-elsewhere.ts` |
| `src/features/auth/workspace-words.ts` | `src/features/auth/workspace/workspace-words.ts` |
| `src/features/auth/sessions-hooks.ts` | `src/features/auth/sessions/sessions-hooks.ts` |
| `src/features/auth/sessions-part.tsx` | `src/features/auth/sessions/sessions-part.tsx` |
| `src/features/auth/sessions-words.ts` | `src/features/auth/sessions/sessions-words.ts` |

#### apps/web/src/features/people

| old | new |
| --- | --- |
| `src/features/people/audit-log-api.ts` | `src/features/people/audit-log/audit-log-api.ts` |
| `src/features/people/audit-log-page.tsx` | `src/features/people/audit-log/audit-log-page.tsx` |
| `src/features/people/audit-log-state.ts` | `src/features/people/audit-log/audit-log-state.ts` |
| `src/features/people/audit-log-words.ts` | `src/features/people/audit-log/audit-log-words.ts` |
| `src/features/people/create-group-action.tsx` | `src/features/people/groups/create-group-action.tsx` |
| `src/features/people/delete-group-dialog.tsx` | `src/features/people/groups/delete-group-dialog.tsx` |
| `src/features/people/delete-group-warning.tsx` | `src/features/people/groups/delete-group-warning.tsx` |
| `src/features/people/group-sheet.tsx` | `src/features/people/groups/group-sheet.tsx` |
| `src/features/people/group-words.ts` | `src/features/people/groups/group-words.ts` |
| `src/features/people/groups-address.ts` | `src/features/people/groups/groups-address.ts` |
| `src/features/people/groups-page.tsx` | `src/features/people/groups/groups-page.tsx` |
| `src/features/people/rename-group-dialog.tsx` | `src/features/people/groups/rename-group-dialog.tsx` |
| `src/features/people/rename-group-form.ts` | `src/features/people/groups/rename-group-form.ts` |
| `src/features/people/invitation-actions.tsx` | `src/features/people/invitations/invitation-actions.tsx` |
| `src/features/people/invitation-columns.tsx` | `src/features/people/invitations/invitation-columns.tsx` |
| `src/features/people/invitations-address.ts` | `src/features/people/invitations/invitations-address.ts` |
| `src/features/people/invitations-api.ts` | `src/features/people/invitations/invitations-api.ts` |
| `src/features/people/invitations-tab.tsx` | `src/features/people/invitations/invitations-tab.tsx` |
| `src/features/people/invite-addresses.ts` | `src/features/people/invitations/invite-addresses.ts` |
| `src/features/people/groups-read.tsx` | `src/features/people/members/groups-read.tsx` |
| `src/features/people/member-activity.tsx` | `src/features/people/members/member-activity.tsx` |
| `src/features/people/member-bulk-actions.tsx` | `src/features/people/members/member-bulk-actions.tsx` |
| `src/features/people/member-columns.tsx` | `src/features/people/members/member-columns.tsx` |
| `src/features/people/member-page.tsx` | `src/features/people/members/member-page.tsx` |
| `src/features/people/member-removal.tsx` | `src/features/people/members/member-removal.tsx` |
| `src/features/people/member-sections.tsx` | `src/features/people/members/member-sections.tsx` |
| `src/features/people/members-address.ts` | `src/features/people/members/members-address.ts` |
| `src/features/people/members-tab.tsx` | `src/features/people/members/members-tab.tsx` |
| `src/features/people/self-action.tsx` | `src/features/people/members/self-action.tsx` |
| `src/features/people/approve-request.tsx` | `src/features/people/requests/approve-request.tsx` |
| `src/features/people/requests-address.ts` | `src/features/people/requests/requests-address.ts` |
| `src/features/people/requests-api.ts` | `src/features/people/requests/requests-api.ts` |
| `src/features/people/requests-columns.tsx` | `src/features/people/requests/requests-columns.tsx` |
| `src/features/people/requests-tab.tsx` | `src/features/people/requests/requests-tab.tsx` |

#### apps/web/src/features/console

| old | new |
| --- | --- |
| `src/features/console/end-every-sign-in-everywhere.tsx` | `src/features/console/everyone/end-every-sign-in-everywhere.tsx` |
| `src/features/console/everyone-list.tsx` | `src/features/console/everyone/everyone-list.tsx` |
| `src/features/console/everyone-page.tsx` | `src/features/console/everyone/everyone-page.tsx` |
| `src/features/console/everyone-pages.tsx` | `src/features/console/everyone/everyone-pages.tsx` |
| `src/features/console/everyone-search.tsx` | `src/features/console/everyone/everyone-search.tsx` |
| `src/features/console/grant-words.ts` | `src/features/console/everyone/grant-words.ts` |
| `src/features/console/person-sheet.tsx` | `src/features/console/everyone/person-sheet.tsx` |
| `src/features/console/correct-name-dialog.tsx` | `src/features/console/names-waiting/correct-name-dialog.tsx` |
| `src/features/console/correcting-words.ts` | `src/features/console/names-waiting/correcting-words.ts` |
| `src/features/console/names-waiting-list.tsx` | `src/features/console/names-waiting/names-waiting-list.tsx` |
| `src/features/console/names-waiting-page.tsx` | `src/features/console/names-waiting/names-waiting-page.tsx` |
| `src/features/console/use-correcting.ts` | `src/features/console/names-waiting/use-correcting.ts` |

#### apps/web/src/shared

| old | new |
| --- | --- |
| `src/shared/filter-row.tsx` | `src/shared/list/filter-row.tsx` |
| `src/shared/grid-table.tsx` | `src/shared/list/grid-table.tsx` |
| `src/shared/keyed.ts` | `src/shared/list/keyed.ts` |
| `src/shared/last-read.ts` | `src/shared/list/last-read.ts` |
| `src/shared/list-pages.tsx` | `src/shared/list/list-pages.tsx` |
| `src/shared/row-focus.ts` | `src/shared/list/row-focus.ts` |
| `src/shared/row-menu.tsx` | `src/shared/list/row-menu.tsx` |
| `src/shared/row-sheet.tsx` | `src/shared/list/row-sheet.tsx` |
| `src/shared/searched-list.ts` | `src/shared/list/searched-list.ts` |
| `src/shared/selection-bar.tsx` | `src/shared/list/selection-bar.tsx` |
| `src/shared/summary-row.tsx` | `src/shared/list/summary-row.tsx` |
| `src/shared/address-ask.ts` | `src/shared/address/address-ask.ts` |
| `src/shared/address-query.ts` | `src/shared/address/address-query.ts` |
| `src/shared/list-address.ts` | `src/shared/address/list-address.ts` |
| `src/shared/address.tsx` | `src/shared/member/address.tsx` |
| `src/shared/display-name-words.ts` | `src/shared/member/display-name-words.ts` |
| `src/shared/initials.ts` | `src/shared/member/initials.ts` |
| `src/shared/member.ts` | `src/shared/member/member.ts` |
| `src/shared/ownership.ts` | `src/shared/member/ownership.ts` |
| `src/shared/role-words.ts` | `src/shared/member/role-words.ts` |
| `src/shared/action-dialog.tsx` | `src/shared/page/action-dialog.tsx` |
| `src/shared/breadcrumb-last-part.ts` | `src/shared/page/breadcrumb-last-part.ts` |
| `src/shared/empty-state.tsx` | `src/shared/page/empty-state.tsx` |
| `src/shared/page-head.tsx` | `src/shared/page/page-head.tsx` |
| `src/shared/page-toolbar.tsx` | `src/shared/page/page-toolbar.tsx` |
| `src/shared/sheet-part.tsx` | `src/shared/page/sheet-part.tsx` |
| `src/shared/wide-layout.ts` | `src/shared/page/wide-layout.ts` |
| `src/shared/theme-switch.ts` | `src/shared/theme/theme-switch.ts` |
| `src/shared/theme.ts` | `src/shared/theme/theme.ts` |

#### apps/web/test

| old | new |
| --- | --- |
| `test/address-router.tsx` | `test/support/address-router.tsx` |
| `test/blueprint-parts.tsx` | `test/support/blueprint-parts.tsx` |
| `test/clipboard-stand-in.ts` | `test/support/clipboard-stand-in.ts` |
| `test/measuring.ts` | `test/support/measuring.ts` |
| `test/members-list.tsx` | `test/support/members-list.tsx` |
| `test/open-app.tsx` | `test/support/open-app.tsx` |
| `test/playwright-tree.ts` | `test/support/playwright-tree.ts` |
| `test/regions-seen.tsx` | `test/support/regions-seen.tsx` |
| `test/second-factor-api.ts` | `test/support/second-factor-api.ts` |
| `test/source-files.ts` | `test/support/source-files.ts` |
| `test/stub-server.ts` | `test/support/stub-server.ts` |
| `test/stubbed-api.ts` | `test/support/stubbed-api.ts` |
| `test/two-workspaces.ts` | `test/support/two-workspaces.ts` |
| `test/api-client.test.tsx` | `test/app/api-client.test.tsx` |
| `test/band-drawn-height.test.tsx` | `test/app/band-drawn-height.test.tsx` |
| `test/breadcrumb.test.ts` | `test/app/breadcrumb.test.ts` |
| `test/connect-assistant.test.tsx` | `test/app/connect-assistant.test.tsx` |
| `test/failed-page.test.tsx` | `test/app/failed-page.test.tsx` |
| `test/frame.test.tsx` | `test/app/frame.test.tsx` |
| `test/jump-to-chord.test.tsx` | `test/app/jump-to-chord.test.tsx` |
| `test/jump-to.test.tsx` | `test/app/jump-to.test.tsx` |
| `test/member-redirect.test.tsx` | `test/app/member-redirect.test.tsx` |
| `test/menu-showing.test.tsx` | `test/app/menu-showing.test.tsx` |
| `test/menu.test.ts` | `test/app/menu.test.ts` |
| `test/navigation-sheet.test.tsx` | `test/app/navigation-sheet.test.tsx` |
| `test/toolbar.test.tsx` | `test/app/toolbar.test.tsx` |
| `test/two-areas.test.tsx` | `test/app/two-areas.test.tsx` |
| `test/workspace-switcher.test.tsx` | `test/app/workspace-switcher.test.tsx` |
| `test/answer-words.test.ts` | `test/shared/answer-words.test.ts` |
| `test/keystroke-repeat.test.tsx` | `test/shared/keystroke-repeat.test.tsx` |
| `test/keystrokes.test.tsx` | `test/shared/keystrokes.test.tsx` |
| `test/landing.test.tsx` | `test/shared/landing.test.tsx` |
| `test/navigation.test.ts` | `test/shared/navigation.test.ts` |
| `test/read-said.test.tsx` | `test/shared/read-said.test.tsx` |
| `test/refusal-outcome.test.tsx` | `test/shared/refusal-outcome.test.tsx` |
| `test/refusal.test.ts` | `test/shared/refusal.test.ts` |
| `test/said-after-mount.test.tsx` | `test/shared/said-after-mount.test.tsx` |
| `test/address-ask.test.tsx` | `test/shared/address/address-ask.test.tsx` |
| `test/address-query.test.ts` | `test/shared/address/address-query.test.ts` |
| `test/list-address.test.tsx` | `test/shared/address/list-address.test.tsx` |
| `test/address.test.tsx` | `test/shared/member/address.test.tsx` |
| `test/initials.test.ts` | `test/shared/member/initials.test.ts` |
| `test/ask-stream.test.ts` | `test/shared/api/ask-stream.test.ts` |
| `test/ceiling-wait.test.ts` | `test/shared/api/ceiling-wait.test.ts` |
| `test/audit-details.test.ts` | `test/shared/audit/audit-details.test.ts` |
| `test/audit-sentences.test.ts` | `test/shared/audit/audit-sentences.test.ts` |
| `test/concept-body.test.tsx` | `test/shared/knowledge/concept-body.test.tsx` |
| `test/concept-frontmatter.test.ts` | `test/shared/knowledge/concept-frontmatter.test.ts` |
| `test/reads-ceiling-words.test.ts` | `test/shared/knowledge/reads-ceiling-words.test.ts` |
| `test/grid-table.test.tsx` | `test/shared/list/grid-table.test.tsx` |
| `test/row-menu.test.tsx` | `test/shared/list/row-menu.test.tsx` |
| `test/searched-list.test.tsx` | `test/shared/list/searched-list.test.tsx` |
| `test/selection-bar.test.tsx` | `test/shared/list/selection-bar.test.tsx` |
| `test/page-head.test.tsx` | `test/shared/page/page-head.test.tsx` |
| `test/theme.test.ts` | `test/shared/theme/theme.test.ts` |
| `test/breadcrumb-ellipsis.test.tsx` | `test/shared/ui/breadcrumb-ellipsis.test.tsx` |
| `test/button-marks.test.tsx` | `test/shared/ui/button-marks.test.tsx` |
| `test/counted-switch.test.tsx` | `test/shared/ui/counted-switch.test.tsx` |
| `test/pagination-ellipsis.test.tsx` | `test/shared/ui/pagination-ellipsis.test.tsx` |
| `test/qr-code.test.tsx` | `test/shared/ui/qr-code.test.tsx` |
| `test/account-page.test.tsx` | `test/auth/account-page.test.tsx` |
| `test/auth-refusals.test.ts` | `test/auth/auth-refusals.test.ts` |
| `test/code-entry.test.ts` | `test/auth/code-entry.test.ts` |
| `test/passkey-name.test.ts` | `test/auth/passkey-name.test.ts` |
| `test/resume-refusal.test.tsx` | `test/auth/resume-refusal.test.tsx` |
| `test/session-reread.test.tsx` | `test/auth/session-reread.test.tsx` |
| `test/confirm-pages.test.tsx` | `test/auth/second-factor/confirm-pages.test.tsx` |
| `test/finish-authenticator.test.tsx` | `test/auth/second-factor/finish-authenticator.test.tsx` |
| `test/passkey-offer.test.tsx` | `test/auth/second-factor/passkey-offer.test.tsx` |
| `test/pending-gate.test.tsx` | `test/auth/second-factor/pending-gate.test.tsx` |
| `test/reconfirm.test.tsx` | `test/auth/second-factor/reconfirm.test.tsx` |
| `test/recovery-codes.test.tsx` | `test/auth/second-factor/recovery-codes.test.tsx` |
| `test/setup-page.test.tsx` | `test/auth/second-factor/setup-page.test.tsx` |
| `test/link-page.test.tsx` | `test/auth/sign-in/link-page.test.tsx` |
| `test/passkey-autofill.test.tsx` | `test/auth/sign-in/passkey-autofill.test.tsx` |
| `test/sign-in-link.test.ts` | `test/auth/sign-in/sign-in-link.test.ts` |
| `test/choose-workspace.test.tsx` | `test/auth/workspace/choose-workspace.test.tsx` |
| `test/invitation-words.test.ts` | `test/people/invitation-words.test.ts` |
| `test/member-action-words.test.ts` | `test/people/member-action-words.test.ts` |
| `test/refused-tab.test.tsx` | `test/people/refused-tab.test.tsx` |
| `test/returning-tab.test.tsx` | `test/people/returning-tab.test.tsx` |
| `test/audit-log-export.test.tsx` | `test/people/audit-log/audit-log-export.test.tsx` |
| `test/create-group-action.test.tsx` | `test/people/groups/create-group-action.test.tsx` |
| `test/rename-group-dialog.test.tsx` | `test/people/groups/rename-group-dialog.test.tsx` |
| `test/invitations-address.test.tsx` | `test/people/invitations/invitations-address.test.tsx` |
| `test/invite-addresses.test.ts` | `test/people/invitations/invite-addresses.test.ts` |
| `test/list-state.test.tsx` | `test/people/members/list-state.test.tsx` |
| `test/member-bulk-actions.test.tsx` | `test/people/members/member-bulk-actions.test.tsx` |
| `test/member-change.test.tsx` | `test/people/members/member-change.test.tsx` |
| `test/member-list-read-overtaken.test.tsx` | `test/people/members/member-list-read-overtaken.test.tsx` |
| `test/member-refused-rows.test.tsx` | `test/people/members/member-refused-rows.test.tsx` |
| `test/member-removal.test.tsx` | `test/people/members/member-removal.test.tsx` |
| `test/self-action.test.tsx` | `test/people/members/self-action.test.tsx` |
| `test/console-frame.test.tsx` | `test/console/console-frame.test.tsx` |
| `test/console-list-words.test.ts` | `test/console/console-list-words.test.ts` |
| `test/people-address.test.ts` | `test/console/people-address.test.ts` |
| `test/edit-compared.test.ts` | `test/inbox/edit-compared.test.ts` |
| `test/inbox-decided.test.ts` | `test/inbox/inbox-decided.test.ts` |
| `test/knowledge-tree.test.tsx` | `test/knowledge/knowledge-tree.test.tsx` |
| `test/model-choices-words.test.ts` | `test/model-choices/model-choices-words.test.ts` |
| `test/questions-grouping.test.ts` | `test/questions/questions-grouping.test.ts` |
| `test/sources-actions.test.tsx` | `test/sources/sources-actions.test.tsx` |
| `test/sources-words.test.ts` | `test/sources/sources-words.test.ts` |
| `test/shown-answer.test.ts` | `test/ask/shown-answer.test.ts` |

#### apps/web/e2e

| old | new |
| --- | --- |
| `e2e/accept-invitation.spec.ts` | `e2e/auth/accept-invitation.spec.ts` |
| `e2e/ask-to-join.spec.ts` | `e2e/auth/ask-to-join.spec.ts` |
| `e2e/confirm-recovery.spec.ts` | `e2e/auth/confirm-recovery.spec.ts` |
| `e2e/consent.spec.ts` | `e2e/auth/consent.spec.ts` |
| `e2e/display-name.spec.ts` | `e2e/auth/display-name.spec.ts` |
| `e2e/no-workspace.spec.ts` | `e2e/auth/no-workspace.spec.ts` |
| `e2e/passkeys.spec.ts` | `e2e/auth/passkeys.spec.ts` |
| `e2e/pending-gate.spec.ts` | `e2e/auth/pending-gate.spec.ts` |
| `e2e/reconfirm.spec.ts` | `e2e/auth/reconfirm.spec.ts` |
| `e2e/second-factor.spec.ts` | `e2e/auth/second-factor.spec.ts` |
| `e2e/sessions.spec.ts` | `e2e/auth/sessions.spec.ts` |
| `e2e/sign-in-link.spec.ts` | `e2e/auth/sign-in-link.spec.ts` |
| `e2e/sign-in.spec.ts` | `e2e/auth/sign-in.spec.ts` |
| `e2e/sign-out.spec.ts` | `e2e/auth/sign-out.spec.ts` |
| `e2e/switched-elsewhere.spec.ts` | `e2e/auth/switched-elsewhere.spec.ts` |
| `e2e/audit-log.spec.ts` | `e2e/people/audit-log.spec.ts` |
| `e2e/people-groups.spec.ts` | `e2e/people/people-groups.spec.ts` |
| `e2e/people-invitations.spec.ts` | `e2e/people/people-invitations.spec.ts` |
| `e2e/people-requests.spec.ts` | `e2e/people/people-requests.spec.ts` |
| `e2e/people.spec.ts` | `e2e/people/people.spec.ts` |
| `e2e/collections-and-owners.spec.ts` | `e2e/knowledge/collections-and-owners.spec.ts` |
| `e2e/concept-body-links.spec.ts` | `e2e/knowledge/concept-body-links.spec.ts` |
| `e2e/concept-page.spec.ts` | `e2e/knowledge/concept-page.spec.ts` |
| `e2e/knowledge-base.spec.ts` | `e2e/knowledge/knowledge-base.spec.ts` |
| `e2e/knowledge-search.spec.ts` | `e2e/knowledge/knowledge-search.spec.ts` |
| `e2e/ask-new-question.spec.ts` | `e2e/ask/ask-new-question.spec.ts` |
| `e2e/ask-your-questions.spec.ts` | `e2e/ask/ask-your-questions.spec.ts` |
| `e2e/answer-tests.spec.ts` | `e2e/questions/answer-tests.spec.ts` |
| `e2e/questions-asked.spec.ts` | `e2e/questions/questions-asked.spec.ts` |
| `e2e/console-people.spec.ts` | `e2e/console/console-people.spec.ts` |
| `e2e/console.spec.ts` | `e2e/console/console.spec.ts` |
| `e2e/sources.spec.ts` | `e2e/sources/sources.spec.ts` |
| `e2e/waiting-on-you.spec.ts` | `e2e/inbox/waiting-on-you.spec.ts` |
| `e2e/models-and-spend.spec.ts` | `e2e/model-choices/models-and-spend.spec.ts` |
| `e2e/dark-theme.spec.ts` | `e2e/app/dark-theme.spec.ts` |
| `e2e/failed-page.spec.ts` | `e2e/app/failed-page.spec.ts` |
| `e2e/focus-ring.spec.ts` | `e2e/app/focus-ring.spec.ts` |
| `e2e/frame.spec.ts` | `e2e/app/frame.spec.ts` |
| `e2e/home.spec.ts` | `e2e/app/home.spec.ts` |
| `e2e/jump-to.spec.ts` | `e2e/app/jump-to.spec.ts` |
| `e2e/member-unread.spec.ts` | `e2e/app/member-unread.spec.ts` |
| `e2e/unknown-address.spec.ts` | `e2e/app/unknown-address.spec.ts` |
| `e2e/workspace-switcher.spec.ts` | `e2e/app/workspace-switcher.spec.ts` |
| `e2e/blueprint-parts.spec.ts` | `e2e/shared/blueprint-parts.spec.ts` |
| `e2e/list-parts.spec.ts` | `e2e/shared/list-parts.spec.ts` |
| `e2e/outcome-regions.spec.ts` | `e2e/shared/outcome-regions.spec.ts` |

## 4. Path coupling outside plain relative imports

Each row says what must change. "None" rows are listed because they name a path near the move and were checked.

### Config and build

| Where | What it names | Change |
| --- | --- | --- |
| `apps/web/vite.config.ts:9` | `./src/shared/theme-switch.ts` (relative, outside `@/`) | `./src/shared/theme/theme-switch.ts` |
| `apps/web/vite.config.ts:10` | `./src/shared/words.ts` | none (stays) |
| `apps/web/tsconfig.json:20` | `paths: { "@/*": ["./src/*"] }` | add `"@test/*": ["./test/support/*"]` |
| `apps/web/tsconfig.json:22` | `include: ["src","test","e2e",...]` | none (recursive) |
| `apps/web/vitest.config.ts:10` | `resolve.alias { "@": ./src }` | add `"@test": ./test/support` (Vite's string alias matches only `@` or `@/…`, so `@test/…` does not collide) |
| `apps/web/vitest.config.ts:12` | `include: ["test/**/*.test.ts", "test/**/*.test.tsx"]` | none (recursive) |
| `apps/web/playwright.config.ts:29` | `testDir: "e2e"` (default `testMatch` is recursive) | none |
| `apps/web/playwright.config.ts:38` | reporter `./e2e/run-summary.ts` | none (stays at e2e root) |
| `.oxfmtrc.json:5` | `customGroups` `app-alias` = `["@/**"]` | add `"@test/**"`, or oxfmt sorts `@test/…` as an external scoped package and `format:check` reorders every test |
| `.oxlintrc.json:545` | `apps/web/src/features/people/groups-page.tsx` (max-lines-per-function 197) | `.../people/groups/groups-page.tsx`, or lint fails the default cap of 150 |
| `.oxlintrc.json:392-394` | `features/auth/auth-client.ts`, `features/auth/auth-hooks.ts` | none (both stay at auth root) |
| `.oxlintrc.json:249,295,337,380,349,563,554,539,427` | auth-client/auth-hooks messages, `shared/api/trpc.ts`, `shared/navigation.ts`, `sources/connect-action.tsx`, `app/router.tsx`, `shared/ui/**` | none (none move) |
| `.oxlintrc.json:436,485` | `**/test/**`, `**/e2e/**`, `**/*.test.ts(x)` | none (segment globs) |
| `package.json:33` | `auth-seam-scan ... apps/web/src/features/auth/auth-hooks.ts` | none |
| `package.json:27` | `check:docs:web` runs `test/browser-suite-skill.test.ts` | none (stays at test root) |
| `packages/devtools/test/ci/docs-lane.test.ts:432` | `apps/web/test/browser-suite-skill.test.ts`, asserted to exist (line 509-520) | none (stays) |
| `components.json:14-17` | `@/shared/ui`, `@/shared/lib/utils`, `@/shared/lib` | none (not moved) |
| `knip.config.ts:34` | `src/shared/ui/**` | none |
| `jscpd.config.mjs:13,20` | `shared/audit/audit-actions.ts`, `shared/ui/**` | none |
| `packages/core/scripts/audit-actions.ts:11` | `apps/web/src/shared/audit/audit-actions.ts` | none |
| `cubic.yaml:69-70` | `apps/web/e2e/**`, `apps/web/test/**` | none |
| `.gitnexusignore:86,90` | `apps/web/e2e/`, `apps/web/test/` | none |
| `packages/devtools/src/paths.ts:8,43-47` | `isTestPath` matches `test`/`e2e` as any path segment | none (nested tests still classify as test for comment-density and insert-scan) |
| `.github/workflows/check.yml:320` | `check:web:e2e --shard=…` | none (Playwright shards by file) |
| `lefthook.yml:46-48,136-138` | web typecheck, `check:docs:web` | none |

### Tests that hold a path as a string (tsc cannot see these; they fail at run time)

| Where | Now | After |
| --- | --- | --- |
| `apps/web/test/browser-suite-skill.test.ts:19` | `readdirSync(apps/web/e2e)` is not recursive | make it walk recursively. Otherwise `specs` is empty once specs nest, "names every helper that two or more specs share" finds nothing, and its `toBeGreaterThan(0)` guard (line 65-67) fails |
| `apps/web/test/playwright-tree.ts:14` | `new URL("..", import.meta.url)` is the web root | `new URL("../..", import.meta.url)` after it moves to `test/support/` |
| `apps/web/test/source-files.ts:4` | `path.resolve(import.meta.dirname, "../src")` | `"../../src"` |
| `apps/web/test/run-summary.test.ts:8` | `moduleAt("e2e/run-summary.ts")`, web-root relative through `playwright-tree.ts` | none once `playwright-tree.ts:14` is fixed |
| `apps/web/test/api-client.test.tsx:319` | `path.join(import.meta.dirname, "../../api/src/trpc/mount.ts")` | `"../../../api/src/trpc/mount.ts"` (moves to `test/app/`) |
| `apps/web/test/concept-body.test.tsx:29` | `path.resolve(import.meta.dirname, "../../../contracts/links/cases.json")` | five `../` (moves to `test/shared/knowledge/`) |
| `apps/web/test/page-head.test.tsx:14` | allow-list key `features/auth/recovery-codes.tsx` | `features/auth/second-factor/recovery-codes.tsx` |
| `apps/web/test/page-head.test.tsx:26` | `shared/page-head.tsx` | `shared/page/page-head.tsx` |
| `apps/web/test/page-head.test.tsx:12,13,16` | `app/failed-page.tsx`, `features/auth/auth-page.tsx`, `shared/knowledge/concept-body.tsx` | none |
| `apps/web/test/theme.test.ts:204` | `shared/theme-switch.ts` | `shared/theme/theme-switch.ts` |
| `apps/web/test/blueprint-in-one-place.test.ts:13,18-20` | `shared/ui/card.tsx`, `shared/blueprint.tsx`, `shared/ui/button.tsx` | none |
| `apps/web/e2e/blueprint-parts.spec.ts:16` | `new URL("../test/blueprint-parts.tsx", import.meta.url)` | `"../../test/support/blueprint-parts.tsx"` |
| `apps/web/e2e/list-parts.spec.ts:12` | `new URL("../test/members-list.tsx", import.meta.url)` | `"../../test/support/members-list.tsx"` |
| `apps/web/e2e/drawn-parts.ts:47` | `new URL("../src", import.meta.url)` | none (stays at e2e root) |
| `apps/web/test/lint-rules.test.ts:14` | exactly five apps/web overrides | none, as long as no override is added |
| `apps/web/test/lint-rules.test.ts:94-95` | `HOOKS`/`CLIENT` real override paths | none (stay) |
| `apps/web/test/lint-rules.test.ts` (other probes) and `packages/core/test/environment-lint.test.ts:37,51,54` | virtual paths in a throwaway tree | none needed; optionally refresh `features/auth/sign-in-page.tsx`, `test/frame.test.tsx`, `e2e/models-and-spend.spec.ts` to the new shapes |
| `apps/web/test/playwright-config.test.ts:22,61` | `../playwright.config.ts`, `./e2e/run-summary.ts` | none (stays at test root) |

### Agent and human docs

`apps/web/test/browser-suite-skill.test.ts` fails if a backticked `apps/…` path in the skill does not exist, so these must be updated in the same change:

- `.claude/skills/browser-suite/SKILL.md` lines 10, 45, 46, 73, 78, 118, 135, 136, 153, 177, 178, 179, 193, 195, 201, 202, 218, 219, 220, 224, 225, 229, 232 (spec paths under `apps/web/e2e/`). Lines 3, 40, 48, 63, 89, 93, 146, 163, 199, 211, 261, 265 name helpers, config or `src/shared/api/link.ts`, which stay.
- `.claude/skills/browser-suite/SKILL.md:245,248` run `playwright test e2e/models-and-spend.spec.ts`. The skill test does not check these (no `apps/` prefix), so they would go stale silently. Change to `e2e/model-choices/models-and-spend.spec.ts`.
- `.claude/skills/browser-suite/references/harness.md` lines 44, 146, 152-156, 160, 161, 170, 179, 187, 192, 193, 212, 213, 217, 218. Lines 22, 30, 183, 206 name helpers that stay.
- `.claude/skills/browser-suite/references/accessibility-gate.md:34`.

Prose with no gate behind it (update so the next agent is not misled; nothing fails if skipped):

- `docs/solutions/logic-errors/a-second-mutate-drops-the-first-actions-callbacks.md:66,67,69`
- `docs/solutions/logic-errors/workspace-switch-serves-left-workspace-member-after-failed-reread.md:44,174` (line 93 already names a file that no longer exists, `features/auth/member.ts`)
- `docs/solutions/logic-errors/a-stale-tab-acted-in-the-workspace-the-session-had-moved-to.md:87,94,97`
- `docs/solutions/logic-errors/better-auth-lookup-deleted-another-persons-expired-sign-in-code.md:15,46,167`
- `docs/solutions/logic-errors/a-non-modal-radix-sheet-still-loops-tab-inside-itself.md:82,84`
- `docs/solutions/logic-errors/a-held-read-in-a-spec-stalls-the-actions-settle-and-its-refusal-line.md:39`
- `docs/solutions/integration-issues/chromium-keeps-no-body-for-a-streamed-trpc-answer.md:43`
- `docs/solutions/best-practices/what-a-rename-prose-pass-gets-wrong-and-the-checks-that-catch-it.md:99` (`apps/web/test/navigation.test.ts`)
- `docs/specs/route/p1.md:15` (`apps/web/src/features/auth/account-page.tsx`, which stays; no change)
- `docs/plans/007-s3-concepts-and-guides.md`, an active plan: 37 full-path mentions (lines 302-1423) plus short `e2e/<name>.spec.ts` mentions at 541, 555, 640, 654, 1102, 1146, 1147, 1306. It also plans new specs at `apps/web/e2e/guides.spec.ts` (1102) and `apps/web/e2e/all-knowledge.spec.ts` (1306); under this layout those belong in `e2e/knowledge/`.
- `.claude/skills/survey-architecture/SKILL.md:17` treats each `apps/web/src/features/<f>/` as one unit; still true, no change.
- `docs/archive/plans/*`: about 260 mentions across 30 archived plans. Leave them; they are history.
- No mentions in `AGENTS.md`, `apps/web/AGENTS.md`, `CODEOWNERS` (none exists), `.cubic/wiki/` (names only `src/features/auth/` and `src/shared/api/trpc.ts`, which stay), `.github/workflows/`, `scripts/` or `packages/devtools/src/`.

## 5. Import rewrite mechanics

How imports are written today, from the 2159 parsed edges:

- Every specifier carries its `.ts`/`.tsx` extension.
- Cross-directory imports in `src/`, `test/` and `e2e/` use `@/<zone>/…` (`tsconfig.json:20`, mirrored in `vitest.config.ts:10`; Playwright resolves it through tsconfig `paths`).
- Same-directory imports use `./x.ts` (801 edges). 31 same-directory edges inside `src/shared` use `@/shared/x.ts` instead; keep whichever style a line already has.
- Nothing in `src/` uses `../`. The only `../` edge is `test/playwright-config.test.ts:22`.
- One re-export: `src/features/people/role-meanings.ts:7` re-exports from `@/shared/role-words.ts` (moves to `@/shared/member/role-words.ts`).
- Dynamic imports: 11, all with literal specifiers (`await import("./stub-server.ts")` in 7 tests, `./second-factor-api.ts` in 1, `@/shared/initials.ts` and `@/shared/theme.ts` in 2, `../playwright.config.ts` in 1). No `vi.mock`, no `import.meta.glob`, no `require`.

Rewrite rules a codemod applies per edge, after mapping old path to new:

1. Importer and target in the same feature: relative. Same folder `./x.ts`, target at the feature root `../x.ts`, target in a subfolder of the importer's folder `./sub/x.ts`. Leaf to sibling leaf never occurs in this plan (the checker found 0).
2. Otherwise in `src/`, `test/` or `e2e/` importing `src/`: `@/<new path>`.
3. A test importing a helper in `test/support/`: `@test/<name>`; helpers importing each other keep `./`.
4. An e2e spec importing an e2e helper: `../<name>.ts`.

Tool: a Node script over the move map (the same shape as `/tmp/web-explore/apply.mjs`, which already computes every new specifier and counts 774 changes: features 429, tests 151, e2e 141, app 45, shared 8). Parse specifiers with `oxc-parser` (already in the toolchain through oxlint) rather than regex for the write pass, replace exact specifier strings, `git mv` each file so history follows, then run `oxfmt` because `./x` becoming `../x` moves an import from the sibling group to the parent group under `.oxfmtrc.json:6-14`. `ts-morph` file moves fix relative paths but not the `@/` alias, so a custom pass is simpler and reviewable. GitNexus `rename` works on symbols, not files, so it does not apply. After the pass: `pnpm --filter @better-answers/web run typecheck`, `lint`, `test`, `e2e`, then `pnpm run check:docs:web`.

## 6. Risks (things that could change behaviour or go silently stale)

1. `browser-suite-skill.test.ts:19` reads `e2e/` non-recursively. Nested specs empty its spec list and the test goes red (good), but if someone "fixes" that by deleting the guard, the skill check becomes hollow. Make the walk recursive in the same change.
2. Six path strings (section 4) are invisible to tsc and lint. Five fail loudly at run time (ENOENT or a failed build); `playwright-tree.ts:14` makes `run-summary.test.ts` spawn Playwright in the wrong place and fail.
3. `.oxlintrc.json:545` keyed on the old `groups-page.tsx` path stops applying silently; the default 150-line cap then fails the lint loudly. No gate checks that override paths exist.
4. `SKILL.md:245,248` short paths are not covered by the skill test and would rot silently.
5. Order-sensitive helpers: `test/stub-server.ts` replaces `globalThis.fetch` at import time (line 11) and seven tests import it dynamically after setup. With the alias every importer resolves to the same absolute file, so Vite keeps one module instance; the codemod must not leave a mix of a stale relative and an alias specifier pointing at two different files.
6. Hub-and-spoke is now load-bearing. A later edit that makes a leaf import a sibling leaf is refused with the message "stays inside its own directory", which does not say "move the shared file to the feature root". Worth one line in `apps/web/AGENTS.md`, or a sharper lint message, when the restructure lands.
7. The new `@test` alias needs both `tsconfig.json` and `vitest.config.ts`, plus `.oxfmtrc.json` for sorting. `e2e/drawn-parts.ts:47` builds `test/support/blueprint-parts.tsx` and `members-list.tsx` with only the `@` alias; that is fine today because neither imports a test helper.
8. Checked and absent: path literals in `src/index.css` (only package `@import`s, no `@source`), snapshot files (`toMatchSnapshot`, `toHaveScreenshot`, `__snapshots__`), tests asserting their own file name, gates that count files per folder, `__dirname` reads beyond those listed, glob-discovered source modules. `run-summary.ts:42` reports `test.location.file` relative to the workspace, which works nested. `folder-case.test.ts` requires kebab-case folder names; every new folder name is kebab-case.
9. Not behaviour, but review load: 257 renames plus 774 specifier edits. Land as one mechanical commit produced by the script, with the script in the PR, so a reviewer reruns it instead of reading 300 diffs.

## 7. Big-file split: `src/shared/navigation.ts`

624 lines, over the 500 cap, held by `.oxlintrc.json:563` at 572 non-blank lines. 101 files import it; by symbol, `menuGroupIn` 48, `pageNamed` 38, `CONTROL_CENTRE` 32, `HOMES` 26, `Role` 13, `CONSOLE` 9, `ASK` 7, `KNOWLEDGE` 6, the rest 1 to 7.

Proposed modules by concern:

| New module | Lines now | Holds |
| --- | --- | --- |
| `shared/navigation/model.ts` | 1-59 | `Role`, `RoleOrOperator`, `Action`, `INVITE_A_PERSON`, `Detail`, `Owns`, `OWNS_NOTHING`, `OWNING`, `Page`, `MenuGroup`, `Area` |
| `shared/navigation/areas.ts` | 61-458 | `EVERY_ROLE`, `ADMINS`, `THE_OPERATOR`, `ASK`, `KNOWLEDGE`, `INBOX`, `CONTROL_CENTRE`, `CONSOLE`, `AREAS`, `EVERY_AREA` (imports only types and `INVITE_A_PERSON` from `model.ts`, so no runtime cycle) |
| `shared/navigation.ts` (stays) | 460-624 | `PagePath`, `menuGroupIn`, `pageNamed`, `HOMES`, `Reader`, `readerOf`, `OPERATOR_READER`, `VisibleArea`, `VisibleTree`, `NO_TREE`, `visibleTo`, `Place`, `pagesOf`, `placeAt`, `detailAt`, `hides`, `headingOf`, `Moved`, `movedWithin`, `leadsTo` |

Keeping exports identical needs either re-export lines in `navigation.ts` (the pattern `people/role-meanings.ts:7` already uses) or rewriting about 45 importers to the new modules per symbol. My recommendation is to leave this out of the restructure. The file is under its own cap, the restructure does not need it, and the re-export route is the kind of compatibility layer `AGENTS.md` ("No backward compatibility by default") argues against. If it is done later, rewrite the importers and drop the `.oxlintrc.json:563` override in the same change. Nothing else in scope is over 500 lines: `auth-hooks.ts` 549 and `invite-action.tsx` 530 raw lines are under the cap once blank lines and comments are skipped (no override exists for them), and test files have `max-lines` off (`.oxlintrc.json:436-454`).

## 8. Decisions for the parent

1. Accept the `@test/*` alias (needed for any mirrored test tree under the current lint), or keep helpers at `test/` root and flatten tests to one level, which leaves `test/shared/` at 32 and `test/auth/` at 17.
2. Accept one-file test and e2e folders (11 of them) as the price of mirroring, against rule 2.
3. Accept `../x.ts` in feature leaves as the new normal (section 0, point 6), and decide whether to say so in `apps/web/AGENTS.md`.
4. Optional: `src/app/` (18 loose) is over the limit and was not in scope.

## Appendix: the scripts that produced this report

Recreate in an empty scratch directory (not in the worktree). `graph.mjs <apps/web>` prints the edge list (importer, specifier, resolved target, kind) to stdout; save it as `edges.tsv`. `fit.mjs <feature> <assignment.json>` promotes every cross-sibling importee to the feature root and prints the result. `apply.mjs <apps/web>` reads `plan.json`, checks that every file on disk is placed exactly once, recomputes every changed specifier, rejects any relative specifier matching `../*/**` or `../../**`, and prints counts and the move list. The scripts hard-code `/tmp/web-explore/` as their scratch path; change it to yours.

### `graph.mjs`

```js
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
const web = process.argv[2];
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  if (e.name === "node_modules" || e.name === "dist") return [];
  return e.isDirectory() ? walk(p) : /\.(tsx?|mts)$/.test(e.name) ? [p] : [];
});
const files = ["src", "test", "e2e"].flatMap((d) => walk(path.join(web, d)));
const RE = /(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|vi\.mock\(\s*["']([^"']+)["']/g;
const out = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    let target = null;
    if (spec.startsWith("@/")) target = path.join("src", spec.slice(2));
    else if (spec.startsWith(".")) target = path.relative(web, path.resolve(path.dirname(f), spec));
    if (target) out.push([path.relative(web, f), spec, target, m[2] ? "dynamic" : m[3] ? "mock" : "static"].join("\t"));
  }
}
console.log(out.join("\n"));
```

### `fit.mjs`

```js
// usage: node fit.mjs <feature> <assignment.json>  -- promotes cross-sibling importees to root
import { readFileSync } from "node:fs";
const [feat, assignFile] = process.argv.slice(2);
const F = `src/features/${feat}/`;
const edges = readFileSync("/tmp/web-explore/edges.tsv", "utf8").trim().split("\n").map((l) => l.split("\t"))
  .filter(([a, , b]) => a.startsWith(F) && b.startsWith(F)).map(([a, , b]) => [a.slice(F.length), b.slice(F.length)]);
const assign = JSON.parse(readFileSync(assignFile, "utf8"));
const home = {};
for (const [folder, files] of Object.entries(assign)) for (const f of files) home[f] = folder;
const all = new Set(edges.flat());
for (const f of all) if (!(f in home)) { console.log("UNASSIGNED", f); home[f] = "."; }
let changed = true; const promoted = [];
while (changed) {
  changed = false;
  for (const [a, b] of edges) {
    if (home[b] !== "." && home[a] !== "." && home[a] !== home[b]) { promoted.push(`${b} (from ${home[b]}, imported by ${a} in ${home[a]})`); home[b] = "."; changed = true; }
  }
}
const by = {};
for (const [f, d] of Object.entries(home)) (by[d] ??= []).push(f);
for (const [d, fs] of Object.entries(by).sort()) console.log(`${d} (${fs.length}): ${fs.sort().join(" ")}`);
if (promoted.length) console.log("PROMOTED:\n  " + promoted.join("\n  "));
```

### `apply.mjs`

```js
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
const web = process.argv[2];
const plan = JSON.parse(readFileSync("/tmp/web-explore/plan.json", "utf8"));
const move = new Map(); const problems = [];
for (const [base, groups] of Object.entries(plan)) {
  const onDisk = readdirSync(path.join(web, base), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  const listed = Object.values(groups).flat();
  for (const f of onDisk) if (!listed.includes(f)) problems.push(`not in plan: ${base}/${f}`);
  for (const f of listed) if (!onDisk.includes(f)) problems.push(`in plan, not on disk: ${base}/${f}`);
  if (new Set(listed).size !== listed.length) problems.push(`duplicate in ${base}`);
  for (const [g, files] of Object.entries(groups)) for (const f of files) move.set(`${base}/${f}`, g === "." ? `${base}/${f}` : `${base}/${g}/${f}`);
}
const to = (p) => move.get(p) ?? p;
const edges = readFileSync("/tmp/web-explore/edges.tsv", "utf8").trim().split("\n").map((l) => l.split("\t"));
const featureOf = (p) => /^src\/features\/([^/]+)\//.exec(p)?.[1];
const rel = (from, target) => { let r = path.posix.relative(path.posix.dirname(from), target); return r.startsWith(".") ? r : `./${r}`; };
const BANNED = (s) => /^\.\.\/[^/]+\/.+/.test(s) || /^\.\.\/\.\.\//.test(s);
let rewrites = 0, rewritesByKind = {}; const violations = [];
const newSpecOf = (a, t, oldSpec) => {
  if (t === "playwright.config.ts") return rel(a, t);
  if (t.startsWith("src/")) {
    const fa = featureOf(a), ft = featureOf(t);
    if (fa && fa === ft) return rel(a, t);
    if (a.startsWith("src/") && path.posix.dirname(a) === path.posix.dirname(t)) return rel(a, t);
    return "@/" + t.slice(4);
  }
  if (t.startsWith("test/")) {
    if (path.posix.dirname(a) === path.posix.dirname(t)) return rel(a, t);
    return "@test/" + t.slice("test/support/".length);
  }
  return rel(a, t);
};
for (const [a0, spec, t0, kind] of edges) {
  const a = to(a0), t = to(t0);
  if (a === a0 && t === t0) continue;
  let ns = newSpecOf(a, t, spec);
  if (spec.startsWith("@/") && ns.startsWith(".") && !featureOf(a)) ns = "@/" + t.slice(4);
  if (ns.startsWith(".") && BANNED(ns)) violations.push(`${a} -> ${ns}`);
  if (ns !== spec) { rewrites++; const k = a0.split("/").slice(0, a0.startsWith("src/") ? 2 : 1).join("/"); rewritesByKind[k] = (rewritesByKind[k] ?? 0) + 1; }
}
const moved = [...move].filter(([o, n]) => o !== n);
console.error(JSON.stringify({ problems, violations, moved: moved.length, rewrites, rewritesByKind }, null, 1));
const out = [];
for (const [base, groups] of Object.entries(plan)) {
  const before = Object.values(groups).flat().length;
  out.push(`COUNT\t${base}\t${before}\t${Object.entries(groups).map(([g, f]) => `${g === "." ? "(root)" : g}=${f.length}`).join(", ")}`);
}
for (const [o, n] of moved) out.push(`MOVE\t${o}\t${n}`);
console.log(out.join("\n"));
```

### `plan.json`

```json
{
 "src/features/auth": {
  ".": ["account-page.tsx","account-sections.tsx","account-words.ts","auth-client.ts","auth-hooks.ts","auth-page.tsx","carried-flow.ts","clipboard.ts","code-entry.ts","passkey-hooks.ts","refusal-words.ts","second-factor-steps.ts","session-memory.ts","sign-out-button.tsx","theme-section.tsx"],
  "second-factor": ["authenticator-code.tsx","authenticator-part.tsx","confirm-hooks.ts","passkey-offer.tsx","passkeys-part.tsx","pending-refusal.ts","reconfirm-dialog.tsx","recovery-codes.tsx","second-factor-hooks.ts","second-factor-pages.tsx","second-factor-parts.tsx","second-factor-words.ts","setup-page.tsx","unsaved-change.ts"],
  "sign-in": ["display-name-page.tsx","link-page.tsx","link-words.ts","passkey-sign-in.tsx","sign-in-page.tsx","sign-in-words.ts"],
  "workspace": ["accept-invitation-page.tsx","account-link.tsx","ask-to-join-words.ts","ask-to-join.tsx","choose-workspace-page.tsx","invitation-words.ts","no-workspace-page.tsx","switched-elsewhere.ts","workspace-words.ts"],
  "sessions": ["sessions-hooks.ts","sessions-part.tsx","sessions-words.ts"]
 },
 "src/features/people": {
  ".": ["empty-lines.ts","group-checklist.tsx","groups-api.ts","invitation-words.ts","invite-action.tsx","member-action-words.ts","members-page.tsx","people-api.ts","people-state.ts","refusal-words.ts","refusal.tsx","role-choice.tsx","role-meanings.ts","unsent-emails.tsx","words.tsx"],
  "audit-log": ["audit-log-api.ts","audit-log-page.tsx","audit-log-state.ts","audit-log-words.ts"],
  "groups": ["create-group-action.tsx","delete-group-dialog.tsx","delete-group-warning.tsx","group-sheet.tsx","group-words.ts","groups-address.ts","groups-page.tsx","rename-group-dialog.tsx","rename-group-form.ts"],
  "invitations": ["invitation-actions.tsx","invitation-columns.tsx","invitations-address.ts","invitations-api.ts","invitations-tab.tsx","invite-addresses.ts"],
  "members": ["groups-read.tsx","member-activity.tsx","member-bulk-actions.tsx","member-columns.tsx","member-page.tsx","member-removal.tsx","member-sections.tsx","members-address.ts","members-tab.tsx","self-action.tsx"],
  "requests": ["approve-request.tsx","requests-address.ts","requests-api.ts","requests-columns.tsx","requests-tab.tsx"]
 },
 "src/features/console": {
  ".": ["correct-display-name.tsx","facts.tsx","list-parts.tsx","list-words.ts","operator.ts","people-address.ts","people-api.ts","people-keystrokes.ts","person-words.tsx","refusal-words.ts","sheet-action.tsx","words.ts","workspaces-page.tsx"],
  "everyone": ["end-every-sign-in-everywhere.tsx","everyone-list.tsx","everyone-page.tsx","everyone-pages.tsx","everyone-search.tsx","grant-words.ts","person-sheet.tsx"],
  "names-waiting": ["correct-name-dialog.tsx","correcting-words.ts","names-waiting-list.tsx","names-waiting-page.tsx","use-correcting.ts"]
 },
 "src/shared": {
  ".": ["answer-words.ts","blueprint.tsx","browser-storage.ts","icon.tsx","keystroke-words.ts","keystrokes.tsx","landing.ts","logo.tsx","navigation.ts","outcome.tsx","read-said.ts","refusal-outcome.tsx","refusal-words.ts","words.ts"],
  "list": ["filter-row.tsx","grid-table.tsx","keyed.ts","last-read.ts","list-pages.tsx","row-focus.ts","row-menu.tsx","row-sheet.tsx","searched-list.ts","selection-bar.tsx","summary-row.tsx"],
  "address": ["address-ask.ts","address-query.ts","list-address.ts"],
  "member": ["address.tsx","display-name-words.ts","initials.ts","member.ts","ownership.ts","role-words.ts"],
  "page": ["action-dialog.tsx","breadcrumb-last-part.ts","empty-state.tsx","page-head.tsx","page-toolbar.tsx","sheet-part.tsx","wide-layout.ts"],
  "theme": ["theme-switch.ts","theme.ts"]
 },
 "test": {
  ".": ["api-seam.test.ts","blueprint-in-one-place.test.ts","browser-suite-skill.test.ts","folder-case.test.ts","lint-rules.test.ts","playwright-config.test.ts","run-summary.test.ts"],
  "support": ["address-router.tsx","blueprint-parts.tsx","clipboard-stand-in.ts","measuring.ts","members-list.tsx","open-app.tsx","playwright-tree.ts","regions-seen.tsx","second-factor-api.ts","source-files.ts","stub-server.ts","stubbed-api.ts","two-workspaces.ts"],
  "app": ["api-client.test.tsx","band-drawn-height.test.tsx","breadcrumb.test.ts","connect-assistant.test.tsx","failed-page.test.tsx","frame.test.tsx","jump-to-chord.test.tsx","jump-to.test.tsx","member-redirect.test.tsx","menu-showing.test.tsx","menu.test.ts","navigation-sheet.test.tsx","toolbar.test.tsx","two-areas.test.tsx","workspace-switcher.test.tsx"],
  "shared": ["answer-words.test.ts","keystroke-repeat.test.tsx","keystrokes.test.tsx","landing.test.tsx","navigation.test.ts","read-said.test.tsx","refusal-outcome.test.tsx","refusal.test.ts","said-after-mount.test.tsx"],
  "shared/address": ["address-ask.test.tsx","address-query.test.ts","list-address.test.tsx"],
  "shared/member": ["address.test.tsx","initials.test.ts"],
  "shared/api": ["ask-stream.test.ts","ceiling-wait.test.ts"],
  "shared/audit": ["audit-details.test.ts","audit-sentences.test.ts"],
  "shared/knowledge": ["concept-body.test.tsx","concept-frontmatter.test.ts","reads-ceiling-words.test.ts"],
  "shared/list": ["grid-table.test.tsx","row-menu.test.tsx","searched-list.test.tsx","selection-bar.test.tsx"],
  "shared/page": ["page-head.test.tsx"],
  "shared/theme": ["theme.test.ts"],
  "shared/ui": ["breadcrumb-ellipsis.test.tsx","button-marks.test.tsx","counted-switch.test.tsx","pagination-ellipsis.test.tsx","qr-code.test.tsx"],
  "auth": ["account-page.test.tsx","auth-refusals.test.ts","code-entry.test.ts","passkey-name.test.ts","resume-refusal.test.tsx","session-reread.test.tsx"],
  "auth/second-factor": ["confirm-pages.test.tsx","finish-authenticator.test.tsx","passkey-offer.test.tsx","pending-gate.test.tsx","reconfirm.test.tsx","recovery-codes.test.tsx","setup-page.test.tsx"],
  "auth/sign-in": ["link-page.test.tsx","passkey-autofill.test.tsx","sign-in-link.test.ts"],
  "auth/workspace": ["choose-workspace.test.tsx"],
  "people": ["invitation-words.test.ts","member-action-words.test.ts","refused-tab.test.tsx","returning-tab.test.tsx"],
  "people/audit-log": ["audit-log-export.test.tsx"],
  "people/groups": ["create-group-action.test.tsx","rename-group-dialog.test.tsx"],
  "people/invitations": ["invitations-address.test.tsx","invite-addresses.test.ts"],
  "people/members": ["list-state.test.tsx","member-bulk-actions.test.tsx","member-change.test.tsx","member-list-read-overtaken.test.tsx","member-refused-rows.test.tsx","member-removal.test.tsx","self-action.test.tsx"],
  "console": ["console-frame.test.tsx","console-list-words.test.ts","people-address.test.ts"],
  "inbox": ["edit-compared.test.ts","inbox-decided.test.ts"],
  "knowledge": ["knowledge-tree.test.tsx"],
  "model-choices": ["model-choices-words.test.ts"],
  "questions": ["questions-grouping.test.ts"],
  "sources": ["sources-actions.test.tsx","sources-words.test.ts"],
  "ask": ["shown-answer.test.ts"]
 },
 "e2e": {
  ".": ["accessibility-gate.spec.ts","action-timing.ts","browser.ts","drawn-parts.ts","harness.ts","knowledge.ts","locators.ts","refused-read.ts","run-summary.ts","virtual-authenticator.ts"],
  "auth": ["accept-invitation.spec.ts","ask-to-join.spec.ts","confirm-recovery.spec.ts","consent.spec.ts","display-name.spec.ts","no-workspace.spec.ts","passkeys.spec.ts","pending-gate.spec.ts","reconfirm.spec.ts","second-factor.spec.ts","sessions.spec.ts","sign-in-link.spec.ts","sign-in.spec.ts","sign-out.spec.ts","switched-elsewhere.spec.ts"],
  "people": ["audit-log.spec.ts","people-groups.spec.ts","people-invitations.spec.ts","people-requests.spec.ts","people.spec.ts"],
  "knowledge": ["collections-and-owners.spec.ts","concept-body-links.spec.ts","concept-page.spec.ts","knowledge-base.spec.ts","knowledge-search.spec.ts"],
  "ask": ["ask-new-question.spec.ts","ask-your-questions.spec.ts"],
  "questions": ["answer-tests.spec.ts","questions-asked.spec.ts"],
  "console": ["console-people.spec.ts","console.spec.ts"],
  "sources": ["sources.spec.ts"],
  "inbox": ["waiting-on-you.spec.ts"],
  "model-choices": ["models-and-spend.spec.ts"],
  "app": ["dark-theme.spec.ts","failed-page.spec.ts","focus-ring.spec.ts","frame.spec.ts","home.spec.ts","jump-to.spec.ts","member-unread.spec.ts","unknown-address.spec.ts","workspace-switcher.spec.ts"],
  "shared": ["blueprint-parts.spec.ts","list-parts.spec.ts","outcome-regions.spec.ts"]
 }
}
```
