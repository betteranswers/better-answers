# Explore: api (`apps/api/src/`, `apps/api/tests/`)

> **Note, 28/10/2026.** This map records the tree at `d6fc08ee6`. PRs #925 and #927 carried it out. Paths and line numbers here can differ from `main`.

Read-only survey of the worktree at `d6fc08ee6`. Counts are measured with `find`/`ls`. Code-line counts use oxlint's `max-lines` rule (blank lines and comments skipped) and were computed with a small script over the worktree file.

## 1. Inventory

| Folder | Loose files now | After |
| --- | --- | --- |
| `apps/api/src/` | 21 | 11 (`main`, `migrate`, `ops`, `config`, `server`, `doors`, `logger`, `refusal`, `identity-principal`, `second-factor-gate`, `product-name`) |
| `apps/api/src/ask/` (new) | 0 | 2 |
| `apps/api/src/email/` (new) | 0 | 5 |
| `apps/api/src/timers/` (new) | 0 | 3 |
| `apps/api/src/auth/` | 21 | 13 |
| `apps/api/src/auth/sign-in/` (new) | 0 | 3 |
| `apps/api/src/auth/second-factor/` (new) | 0 | 5 |
| `apps/api/src/ingress/` | 3 | 3 (unchanged) |
| `apps/api/src/mcp/` | 2 (+ `entries/` 2) | unchanged |
| `apps/api/src/ops/` | 4 | 15 (index.ts split into 12 modules, plus `body-diff`, `http-fetch`, `read-tree`). At the ~15 cap |
| `apps/api/src/trpc/` | 14 | 14 (unchanged) |
| `apps/api/tests/` | 115 files + `fixtures/` | 14 + `fixtures/` |
| `apps/api/tests/support/` (new) | 0 | 15 (14 moved + `ops-run.ts` from the ops.test split) |
| `apps/api/tests/support/harness/` (new) | 0 | 13 |
| `apps/api/tests/deploy/` (new) | 0 | 11 |
| `apps/api/tests/auth/` (new) | 0 | 15 (14 tests + `better-auth-endpoints.txt`) |
| `apps/api/tests/auth/sign-in/` (new) | 0 | 3 |
| `apps/api/tests/auth/second-factor/` (new) | 0 | 5 |
| `apps/api/tests/trpc/` (new) | 0 | 13 |
| `apps/api/tests/trpc/members/` (new) | 0 | 9 |
| `apps/api/tests/mcp/` (new) | 0 | 9 |
| `apps/api/tests/ingress/` (new) | 0 | 3 |
| `apps/api/tests/timers/` (new) | 0 | 2 |
| `apps/api/tests/email/` (new) | 0 | 1 (one-file folder, see deviations) |
| `apps/api/tests/ops/` (new) | 0 | 12 (10 from the split + `ops-update-concept-body.test.ts` + `operator.test.ts`) |

The brief said 22 loose src files and 116 loose test files. Measured: 21 in `src/` and 115 files in `tests/` (88 `*.test.ts`, 26 helpers, 1 `.txt`), plus the `fixtures/` directory.

`apps/api/lifts/` (one vendored lift) and `apps/api/.claude/skills/` (vendored `resend` and `email-best-practices` skills) stay as they are. The skills name no `apps/api` source or test path (grep found only the folder's own title in `THIRD_PARTY_NOTICES.md:1`).

## 2. Target tree

```
apps/api/src/
  main.ts  migrate.ts  ops.ts            # process entries: Dockerfile CMD, package.json scripts, image.test.ts, stryker excludes
  config.ts  server.ts  doors.ts  logger.ts  refusal.ts
  identity-principal.ts  second-factor-gate.ts  product-name.ts
  ask/        ask-steps.ts  ask-stream.ts                       # shared by trpc/ and mcp/
  email/      email.ts  email-page.ts  smtp.ts  factor-notice-email.ts  promotion-notice-email.ts
  timers/     reconciler.ts  sweeps.ts  dead-man-ping.ts        # the api's own timers (RUNBOOK's word)
  auth/       auth.ts  consent-grant.ts  constants.ts  endpoints.ts  index.ts  page-style.ts  pages.ts
              promotion-lock.ts  roles.ts  routes.ts  same-origin.ts  unique-violations.ts  verify.ts
    sign-in/        sign-in-email.ts  sign-in-link.ts  link-token.ts
    second-factor/  authenticator.ts  authenticator-key.ts  passkeys.ts  confirm.ts  person-routes.ts
  ingress/    hostnames.ts  limits.ts  spa.ts
  mcp/        crossing.ts  surface.ts  entries/{define,index}.ts
  ops/        index.ts  cli.ts  job-wait.ts  erasure.ts  restore-checks.ts  map.ts  sources.ts  concepts.ts
              workspaces.ts  llm.ts  operator.ts  answering.ts  body-diff.ts  http-fetch.ts  read-tree.ts
  trpc/       (unchanged, 14 files)

apps/api/tests/
  config.test.ts  doors.test.ts  migrate.test.ts  stop.test.ts  health.test.ts  product-name.test.ts
  second-factor-gate.test.ts  pending-set.test.ts  no-ambient-clock.test.ts  lint-rules.test.ts
  serve.test.ts  cimd-fetch.test.ts  serve.ts  local.ts
  fixtures/   (unchanged)
  support/    flow.ts provoke.ts suite-app.ts auth-instance.ts factor-harness.ts mcp-call.ts web-client.ts
              passkey-device.ts people-refusals.ts people-suite.ts postgres.ts loopback-port.ts
              client-addresses.ts client-addresses.test.ts ops-run.ts(new)
    harness/  harness.ts harness-{asked,asking,control,knowledge,model,people,questions,sources}.ts
              harness-{asking,control,knowledge,start}.test.ts
  deploy/     image.test.ts backup-image.test.ts image-probe.ts image-probe.test.ts browse-production.test.ts
              browse-role.test.ts await-release.test.ts restore.test.ts local-database.test.ts
              test-postgres.test.ts compose-project.ts
  auth/       better-auth-endpoints.test.ts better-auth-endpoints.txt organisation-plugin.test.ts
              consent-grant.test.ts oauth-flow.test.ts token-verifier.test.ts unique-violations.test.ts
              promotion-lock.test.ts revocation-fields.test.ts invitation-shape.test.ts identity-ids.test.ts
              delete-user.test.ts update-user.test.ts sessions.test.ts auth-pages.test.ts
    sign-in/        sign-in-email.test.ts sign-in-link.test.ts sign-in-and-consent.test.ts
    second-factor/  authenticator.test.ts passkeys.test.ts confirm.test.ts second-factor-foundation.test.ts reconfirm.test.ts
  trpc/       ask-to-join crossing display-name inbox-procedures knowledge-owners knowledge-procedures
              model-choices-list person-workspaces procedure-output sources-procedures trpc-ask
              trpc-questions trpc-roads  (all .test.ts)
    members/  audit-log-procedures member-revocation members-accept members-groups members-invitations
              members-name-flag-unaddressed members-name-flag members-procedures members-requests (.test.ts)
  mcp/        ask ask-without-envelope-key model-client-wire mcp-cross-tier mcp-crossing mcp-doors
              mcp-surface invisibility feedback (.test.ts)
  ingress/    hostnames.test.ts limits.test.ts spa.test.ts
  timers/     reconciler.test.ts sweeps.test.ts
  email/      smtp.test.ts
  ops/        index erasure restore-checks map sources concepts workspaces llm restore-sign-in answering
              ops-update-concept-body operator (.test.ts)
```

Why each group:

- `src/` keeps the three process entries in place. `image.test.ts:163,177` runs `/app/apps/api/src/<entry>` for `main.ts`, `migrate.ts`, `ops.ts`; the Dockerfile `CMD` (`apps/api/Dockerfile:259`), `package.json` scripts, `stryker.config.mjs` `mutate` excludes and `docs/operations/local-gates.md:213` name them. `config.ts` stays because `.oxlintrc.json:457` and `packages/core/test/environment-lint.test.ts:45,82` name it and it resolves `../../web/dist` from its own location (`src/config.ts:26`). `server.ts` stays (`environment-lint.test.ts:34`).
- `second-factor-gate.ts` and `identity-principal.ts` stay at the root, NOT in `auth/`. `trpc/base.ts` imports `second-factor-gate.ts`, and `apps/web/test/api-seam.test.ts:23,35` fails if the web program's type graph (rooted at `trpc/app-router.ts`) pulls any `/apps/api/src/auth/` file other than `verify.ts` and `constants.ts`. Moving either file into `auth/` would break that test.
- `auth/` keeps its folder name. `.oxlintrc.json:173,187` (better-auth imports only under `apps/api/src/auth/**`), `packages/schema/src/table-ownership.ts:1` (`IDENTITY_PROVIDER = "apps/api/src/auth"`, a prefix match in `packages/devtools/src/table-ownership-scan.ts:47`), and the web seam test all match subfolders, so `sign-in/` and `second-factor/` stay covered. `person-routes.ts` goes to `second-factor/` because only `authenticator.ts`, `confirm.ts` and `passkeys.ts` import it. `same-origin.ts` stays because `routes.ts` uses it as well. `pages.ts` and `page-style.ts` stay at the auth root. A `pages/` folder would leave `tests/auth/pages/` holding one test.
- `timers/` follows `docs/operations/RUNBOOK.md:248` ("on a daily timer of its own beside the reconciler's"). GLOSSARY.md has no operational term for this (rule 1 gap, see deviations).
- `tests/deploy/` holds suites that test `deploy/` scripts and the Dockerfiles. None has a `src/` counterpart. It is named after the repository's `deploy/` directory.
- `tests/serve.ts` and `tests/local.ts` stay at the tests root as the suite's two process entries (see section 3).

### Complete move table (src and tests)

`git mv` only. No file is renamed. The ops split adds new files, listed in section 6.

| Old path | New path |
| --- | --- |
| `apps/api/src/ask-steps.ts` | `apps/api/src/ask/ask-steps.ts` |
| `apps/api/src/ask-stream.ts` | `apps/api/src/ask/ask-stream.ts` |
| `apps/api/src/email.ts` | `apps/api/src/email/email.ts` |
| `apps/api/src/email-page.ts` | `apps/api/src/email/email-page.ts` |
| `apps/api/src/smtp.ts` | `apps/api/src/email/smtp.ts` |
| `apps/api/src/factor-notice-email.ts` | `apps/api/src/email/factor-notice-email.ts` |
| `apps/api/src/promotion-notice-email.ts` | `apps/api/src/email/promotion-notice-email.ts` |
| `apps/api/src/reconciler.ts` | `apps/api/src/timers/reconciler.ts` |
| `apps/api/src/sweeps.ts` | `apps/api/src/timers/sweeps.ts` |
| `apps/api/src/dead-man-ping.ts` | `apps/api/src/timers/dead-man-ping.ts` |
| `apps/api/src/auth/sign-in-email.ts` | `apps/api/src/auth/sign-in/sign-in-email.ts` |
| `apps/api/src/auth/sign-in-link.ts` | `apps/api/src/auth/sign-in/sign-in-link.ts` |
| `apps/api/src/auth/link-token.ts` | `apps/api/src/auth/sign-in/link-token.ts` |
| `apps/api/src/auth/authenticator.ts` | `apps/api/src/auth/second-factor/authenticator.ts` |
| `apps/api/src/auth/authenticator-key.ts` | `apps/api/src/auth/second-factor/authenticator-key.ts` |
| `apps/api/src/auth/passkeys.ts` | `apps/api/src/auth/second-factor/passkeys.ts` |
| `apps/api/src/auth/confirm.ts` | `apps/api/src/auth/second-factor/confirm.ts` |
| `apps/api/src/auth/person-routes.ts` | `apps/api/src/auth/second-factor/person-routes.ts` |
| `apps/api/tests/auth-pages.test.ts` | `apps/api/tests/auth/auth-pages.test.ts` |
| `apps/api/tests/better-auth-endpoints.test.ts` | `apps/api/tests/auth/better-auth-endpoints.test.ts` |
| `apps/api/tests/better-auth-endpoints.txt` | `apps/api/tests/auth/better-auth-endpoints.txt` |
| `apps/api/tests/consent-grant.test.ts` | `apps/api/tests/auth/consent-grant.test.ts` |
| `apps/api/tests/delete-user.test.ts` | `apps/api/tests/auth/delete-user.test.ts` |
| `apps/api/tests/identity-ids.test.ts` | `apps/api/tests/auth/identity-ids.test.ts` |
| `apps/api/tests/invitation-shape.test.ts` | `apps/api/tests/auth/invitation-shape.test.ts` |
| `apps/api/tests/oauth-flow.test.ts` | `apps/api/tests/auth/oauth-flow.test.ts` |
| `apps/api/tests/organisation-plugin.test.ts` | `apps/api/tests/auth/organisation-plugin.test.ts` |
| `apps/api/tests/promotion-lock.test.ts` | `apps/api/tests/auth/promotion-lock.test.ts` |
| `apps/api/tests/revocation-fields.test.ts` | `apps/api/tests/auth/revocation-fields.test.ts` |
| `apps/api/tests/authenticator.test.ts` | `apps/api/tests/auth/second-factor/authenticator.test.ts` |
| `apps/api/tests/confirm.test.ts` | `apps/api/tests/auth/second-factor/confirm.test.ts` |
| `apps/api/tests/passkeys.test.ts` | `apps/api/tests/auth/second-factor/passkeys.test.ts` |
| `apps/api/tests/reconfirm.test.ts` | `apps/api/tests/auth/second-factor/reconfirm.test.ts` |
| `apps/api/tests/second-factor-foundation.test.ts` | `apps/api/tests/auth/second-factor/second-factor-foundation.test.ts` |
| `apps/api/tests/sessions.test.ts` | `apps/api/tests/auth/sessions.test.ts` |
| `apps/api/tests/sign-in-and-consent.test.ts` | `apps/api/tests/auth/sign-in/sign-in-and-consent.test.ts` |
| `apps/api/tests/sign-in-email.test.ts` | `apps/api/tests/auth/sign-in/sign-in-email.test.ts` |
| `apps/api/tests/sign-in-link.test.ts` | `apps/api/tests/auth/sign-in/sign-in-link.test.ts` |
| `apps/api/tests/token-verifier.test.ts` | `apps/api/tests/auth/token-verifier.test.ts` |
| `apps/api/tests/unique-violations.test.ts` | `apps/api/tests/auth/unique-violations.test.ts` |
| `apps/api/tests/update-user.test.ts` | `apps/api/tests/auth/update-user.test.ts` |
| `apps/api/tests/await-release.test.ts` | `apps/api/tests/deploy/await-release.test.ts` |
| `apps/api/tests/backup-image.test.ts` | `apps/api/tests/deploy/backup-image.test.ts` |
| `apps/api/tests/browse-production.test.ts` | `apps/api/tests/deploy/browse-production.test.ts` |
| `apps/api/tests/browse-role.test.ts` | `apps/api/tests/deploy/browse-role.test.ts` |
| `apps/api/tests/compose-project.ts` | `apps/api/tests/deploy/compose-project.ts` |
| `apps/api/tests/image-probe.test.ts` | `apps/api/tests/deploy/image-probe.test.ts` |
| `apps/api/tests/image-probe.ts` | `apps/api/tests/deploy/image-probe.ts` |
| `apps/api/tests/image.test.ts` | `apps/api/tests/deploy/image.test.ts` |
| `apps/api/tests/local-database.test.ts` | `apps/api/tests/deploy/local-database.test.ts` |
| `apps/api/tests/restore.test.ts` | `apps/api/tests/deploy/restore.test.ts` |
| `apps/api/tests/test-postgres.test.ts` | `apps/api/tests/deploy/test-postgres.test.ts` |
| `apps/api/tests/smtp.test.ts` | `apps/api/tests/email/smtp.test.ts` |
| `apps/api/tests/hostnames.test.ts` | `apps/api/tests/ingress/hostnames.test.ts` |
| `apps/api/tests/limits.test.ts` | `apps/api/tests/ingress/limits.test.ts` |
| `apps/api/tests/spa.test.ts` | `apps/api/tests/ingress/spa.test.ts` |
| `apps/api/tests/ask-without-envelope-key.test.ts` | `apps/api/tests/mcp/ask-without-envelope-key.test.ts` |
| `apps/api/tests/ask.test.ts` | `apps/api/tests/mcp/ask.test.ts` |
| `apps/api/tests/feedback.test.ts` | `apps/api/tests/mcp/feedback.test.ts` |
| `apps/api/tests/invisibility.test.ts` | `apps/api/tests/mcp/invisibility.test.ts` |
| `apps/api/tests/mcp-cross-tier.test.ts` | `apps/api/tests/mcp/mcp-cross-tier.test.ts` |
| `apps/api/tests/mcp-crossing.test.ts` | `apps/api/tests/mcp/mcp-crossing.test.ts` |
| `apps/api/tests/mcp-doors.test.ts` | `apps/api/tests/mcp/mcp-doors.test.ts` |
| `apps/api/tests/mcp-surface.test.ts` | `apps/api/tests/mcp/mcp-surface.test.ts` |
| `apps/api/tests/model-client-wire.test.ts` | `apps/api/tests/mcp/model-client-wire.test.ts` |
| `apps/api/tests/operator.test.ts` | `apps/api/tests/ops/operator.test.ts` |
| `apps/api/tests/ops-update-concept-body.test.ts` | `apps/api/tests/ops/ops-update-concept-body.test.ts` |
| `apps/api/tests/ops.test.ts` | split into 10 files under `apps/api/tests/ops/` (see section 6.3); no `ops.test.ts` remains |
| `apps/api/tests/auth-instance.ts` | `apps/api/tests/support/auth-instance.ts` |
| `apps/api/tests/client-addresses.test.ts` | `apps/api/tests/support/client-addresses.test.ts` |
| `apps/api/tests/client-addresses.ts` | `apps/api/tests/support/client-addresses.ts` |
| `apps/api/tests/factor-harness.ts` | `apps/api/tests/support/factor-harness.ts` |
| `apps/api/tests/flow.ts` | `apps/api/tests/support/flow.ts` |
| `apps/api/tests/harness-asked.ts` | `apps/api/tests/support/harness/harness-asked.ts` |
| `apps/api/tests/harness-asking.test.ts` | `apps/api/tests/support/harness/harness-asking.test.ts` |
| `apps/api/tests/harness-asking.ts` | `apps/api/tests/support/harness/harness-asking.ts` |
| `apps/api/tests/harness-control.test.ts` | `apps/api/tests/support/harness/harness-control.test.ts` |
| `apps/api/tests/harness-control.ts` | `apps/api/tests/support/harness/harness-control.ts` |
| `apps/api/tests/harness-knowledge.test.ts` | `apps/api/tests/support/harness/harness-knowledge.test.ts` |
| `apps/api/tests/harness-knowledge.ts` | `apps/api/tests/support/harness/harness-knowledge.ts` |
| `apps/api/tests/harness-model.ts` | `apps/api/tests/support/harness/harness-model.ts` |
| `apps/api/tests/harness-people.ts` | `apps/api/tests/support/harness/harness-people.ts` |
| `apps/api/tests/harness-questions.ts` | `apps/api/tests/support/harness/harness-questions.ts` |
| `apps/api/tests/harness-sources.ts` | `apps/api/tests/support/harness/harness-sources.ts` |
| `apps/api/tests/harness-start.test.ts` | `apps/api/tests/support/harness/harness-start.test.ts` |
| `apps/api/tests/harness.ts` | `apps/api/tests/support/harness/harness.ts` |
| `apps/api/tests/loopback-port.ts` | `apps/api/tests/support/loopback-port.ts` |
| `apps/api/tests/mcp-call.ts` | `apps/api/tests/support/mcp-call.ts` |
| `apps/api/tests/passkey-device.ts` | `apps/api/tests/support/passkey-device.ts` |
| `apps/api/tests/people-refusals.ts` | `apps/api/tests/support/people-refusals.ts` |
| `apps/api/tests/people-suite.ts` | `apps/api/tests/support/people-suite.ts` |
| `apps/api/tests/postgres.ts` | `apps/api/tests/support/postgres.ts` |
| `apps/api/tests/provoke.ts` | `apps/api/tests/support/provoke.ts` |
| `apps/api/tests/suite-app.ts` | `apps/api/tests/support/suite-app.ts` |
| `apps/api/tests/web-client.ts` | `apps/api/tests/support/web-client.ts` |
| `apps/api/tests/reconciler.test.ts` | `apps/api/tests/timers/reconciler.test.ts` |
| `apps/api/tests/sweeps.test.ts` | `apps/api/tests/timers/sweeps.test.ts` |
| `apps/api/tests/ask-to-join.test.ts` | `apps/api/tests/trpc/ask-to-join.test.ts` |
| `apps/api/tests/crossing.test.ts` | `apps/api/tests/trpc/crossing.test.ts` |
| `apps/api/tests/display-name.test.ts` | `apps/api/tests/trpc/display-name.test.ts` |
| `apps/api/tests/inbox-procedures.test.ts` | `apps/api/tests/trpc/inbox-procedures.test.ts` |
| `apps/api/tests/knowledge-owners.test.ts` | `apps/api/tests/trpc/knowledge-owners.test.ts` |
| `apps/api/tests/knowledge-procedures.test.ts` | `apps/api/tests/trpc/knowledge-procedures.test.ts` |
| `apps/api/tests/audit-log-procedures.test.ts` | `apps/api/tests/trpc/members/audit-log-procedures.test.ts` |
| `apps/api/tests/member-revocation.test.ts` | `apps/api/tests/trpc/members/member-revocation.test.ts` |
| `apps/api/tests/members-accept.test.ts` | `apps/api/tests/trpc/members/members-accept.test.ts` |
| `apps/api/tests/members-groups.test.ts` | `apps/api/tests/trpc/members/members-groups.test.ts` |
| `apps/api/tests/members-invitations.test.ts` | `apps/api/tests/trpc/members/members-invitations.test.ts` |
| `apps/api/tests/members-name-flag-unaddressed.test.ts` | `apps/api/tests/trpc/members/members-name-flag-unaddressed.test.ts` |
| `apps/api/tests/members-name-flag.test.ts` | `apps/api/tests/trpc/members/members-name-flag.test.ts` |
| `apps/api/tests/members-procedures.test.ts` | `apps/api/tests/trpc/members/members-procedures.test.ts` |
| `apps/api/tests/members-requests.test.ts` | `apps/api/tests/trpc/members/members-requests.test.ts` |
| `apps/api/tests/model-choices-list.test.ts` | `apps/api/tests/trpc/model-choices-list.test.ts` |
| `apps/api/tests/person-workspaces.test.ts` | `apps/api/tests/trpc/person-workspaces.test.ts` |
| `apps/api/tests/procedure-output.test.ts` | `apps/api/tests/trpc/procedure-output.test.ts` |
| `apps/api/tests/sources-procedures.test.ts` | `apps/api/tests/trpc/sources-procedures.test.ts` |
| `apps/api/tests/trpc-ask.test.ts` | `apps/api/tests/trpc/trpc-ask.test.ts` |
| `apps/api/tests/trpc-questions.test.ts` | `apps/api/tests/trpc/trpc-questions.test.ts` |
| `apps/api/tests/trpc-roads.test.ts` | `apps/api/tests/trpc/trpc-roads.test.ts` |

## 3. Path coupling

Each entry gives `file:line`, what it names, and whether a gate catches a miss. **Enforced** means a test or tool fails when the path goes stale. **Prose** means nothing fails, so the coder must edit it by hand.

### Build, run and CI config

- `apps/api/package.json:12-16`. Scripts `node src/main.ts`, `node src/migrate.ts`, `node src/ops.ts`, `node tests/serve.ts`, `node tests/local.ts`. None of these files moves, so no edit. Knip reads these scripts as entries.
- `apps/api/package.json:6-8`. The `exports` key `./trpc` points at `./src/trpc/app-router.ts`. It does not move.
- `apps/api/Dockerfile:224,227,259`. `COPY apps/api/src`, `COPY apps/api/lifts`, `CMD node apps/api/src/main.ts`. Unchanged. The prose at `Dockerfile:95,171,219` names `tests/image.test.ts`; change it to `tests/deploy/image.test.ts` (prose).
- `.github/workflows/build.yml:141` `vitest run tests/image.test.ts` and `:151` `vitest run tests/backup-image.test.ts`. Change both to `tests/deploy/...`. **Enforced** by `image.test.ts:284` and `backup-image.test.ts:906`: each asserts that its leg's probe contains its own workspace-relative path (`fileFromTheWorkspace`, `image-probe.ts:255-256`).
- `scripts/docs-lane.mjs:21-23` `IMAGE_INPUTS` lists `apps/api/tests/backup-image.test.ts`, `image-probe.ts`, `image.test.ts`. Change all three to `tests/deploy/`. **Enforced** by `packages/devtools/test/ci/docs-lane.test.ts:393` (every input must exist). The fixture at `docs-lane.test.ts:174` (`changed: ["apps/api/tests/image.test.ts"]`, expects `images: "yes"`) must change with it. It fails once the lane list moves.
- `apps/api/vitest.config.ts:7` `include: ["tests/**/*.test.ts"]`. Covers subfolders, no edit.
- `apps/api/tsconfig.json:8` `include: ["src", "lifts", "tests", ...]`. Covers subfolders, no edit.
- `apps/api/stryker.config.mjs:9` `mutate: ["src/**/*.ts", "!src/main.ts", "!src/migrate.ts"]`. No edit, since the entries stay. `scripts/mutation-shards.mjs:3,10` and `packages/devtools/test/ci/mutation-baseline.test.ts:18,237` import this config. Nothing to change.
- `knip.config.ts:18-28`. The `apps/api` workspace ignores `lifts/**`, `tests/fixtures/web-build/**` and `.claude/skills/**`. `fixtures/` stays, so no edit.
- `jscpd.config.mjs:5` scans `apps` with `threshold: 0` and does not ignore tests. This matters for the ops.test split (section 5).
- `lefthook.yml:41-44` `api-typecheck` (root `apps/api/`). No path, no edit.
- `.oxlintrc.json:187` `files: ["apps/api/src/auth/**", ...]` and `:173` (message text). They match the new subfolders, no edit.
- `.oxlintrc.json:514` `files: ["apps/api/src/auth/confirm.ts"]` (a `max-lines-per-function` 245 override). Change to `apps/api/src/auth/second-factor/confirm.ts`. **Enforced**: lint fails on the 245-line function once the override stops matching.
- `.oxlintrc.json:533-537` `files: ["apps/api/src/ops/index.ts"]` `max-lines` 1620. Delete it after the split. A stale entry would fail nothing, so the coder must remember it.
- `.oxlintrc.json:504,523` (`auth/auth.ts`, `auth/routes.ts` overrides). Unchanged by the move.
- `.oxlintrc.json:436,485,491-495` `**/tests/**` globs. They cover subfolders.
- `.oxlintrc.json:457` `apps/api/src/config.ts`. Unchanged.
- The test-path globs (`.oxlintrc.json:436,485,491-495` `**/tests/**`) also lift `node/no-process-env` for helpers that read the environment (`IMAGE_PROBE_DEFERRED`, `TEST_POSTGRES_URI`). They match any `tests` segment, so `tests/deploy/` and `tests/support/harness/` stay excused. `packages/devtools/src/paths.ts:8,43-46` (`isTestPath`, used by the table-ownership and insert scans) also matches any `test`/`tests`/`e2e` segment. Checked.
- `.oxlintrc.json:666` and `cubic.yaml:68,77,128,139` `apps/api/tests/**`, `apps/api/.claude/skills/**`, `apps/api/**`. Globs, no edit.
- `.gitnexusignore:69-79` `apps/api/tests/` and others. Folder-level, no edit.
- `package.json:32` (root) `table-ownership-scan ... apps/api/src`. Folder-level, no edit.
- `packages/schema/src/table-ownership.ts:1,5` `IDENTITY_PROVIDER = "apps/api/src/auth"` and `MIGRATE_TS_DIRECTORY = "apps/api/src"`. Prefix-matched (`table-ownership-scan.ts:47`). The new auth subfolders stay in the identity slice and non-auth moves stay in the `apps/api/src` slice. No edit.
- `apps/web/playwright.config.ts:43-44` `node tests/serve.ts` with `cwd ../api`. `serve.ts` stays, no edit.
- No `CODEOWNERS` file exists in the repository.

### Tests that name paths

- `apps/web/test/browser-suite-skill.test.ts:13,40,52`. Every backticked `apps/...ts` path in `.claude/skills/browser-suite/SKILL.md` and `references/*.md` must exist, and `apps/api/tests/serve.ts` must be among them (serve stays). **Enforced** for full paths. The glob text `apps/api/tests/harness-*.ts` at `SKILL.md:92` contains a `*`, which the regex does not match, so it is **prose**.
- `apps/web/test/api-seam.test.ts:23,35`. Matches by basename under `/apps/api/src/auth/`. The move keeps `verify.ts` and `constants.ts` as the only auth files the web pulls. **Enforced**.
- `apps/api/tests/no-ambient-clock.test.ts:45-48` walks `apps/api/src` recursively. No edit.
- `apps/api/tests/procedure-output.test.ts:12-13` `new URL("../src/")` and `new URL("../../../packages/core/src/")`. Moving it to `tests/trpc/` needs `../../src/` and `../../../../packages/core/src/`. **Enforced**: the test reads an empty or missing tree and fails.
- `apps/api/tests/better-auth-endpoints.test.ts:10` (`path.join(import.meta.dirname, "better-auth-endpoints.txt")`) and `organisation-plugin.test.ts:143` (the same sibling read). Both move to `tests/auth/` together with the `.txt`, so the reads still resolve.
- `apps/api/tests/better-auth-endpoints.test.ts:34` and `better-auth-endpoints.txt:22`. The snapshot HEADER embeds `pnpm --filter @better-answers/api run test tests/better-auth-endpoints.test.ts`. After the move, update the HEADER to `tests/auth/better-auth-endpoints.test.ts` and regenerate the `.txt` with `UPDATE_BETTER_AUTH_ENDPOINTS=1`. Do not hand-edit it (the test says so at `:112`, and that message also names `tests/better-auth-endpoints.txt`). **Enforced**: the snapshot comparison fails if the header and the file disagree.
- `apps/api/src/ingress/hostnames.ts:63`. A reason string names `apps/api/tests/better-auth-endpoints.txt`. `better-auth-endpoints.test.ts:139-141` asserts only the basename, so this is **prose**. Update it to `apps/api/tests/auth/better-auth-endpoints.txt`.
- `apps/api/tests/lint-rules.test.ts:22-29,441-532` builds throwaway trees with `apps/api/src/auth/**`, `apps/api/src/mcp/...` and `src/*.ts` probe paths. These are fixtures, not real files. No edit.
- `packages/core/test/environment-lint.test.ts:34,35,45,53,82` (`apps/api/src/server.ts`, `trpc/router.ts`, `config.ts`, `apps/api/tests/image-probe.ts`). These are fixture paths that classify a path shape. They stay valid as strings. Optionally update `:53` to `tests/deploy/image-probe.ts`.
- `packages/core/test/import-direction.test.ts:245-246` and `packages/devtools/test/{comment-lint,comment-only-the-why,table-ownership-scan}.test.ts` (`apps/api/src/probe.ts` and similar). Synthetic fixtures. No edit.
- `packages/devtools/test/ci/deploy-tree.test.ts:915` checks that coolify.md contains `apps/api/src/ingress/hostnames.ts`. Unchanged.

### Docs and skills (all prose; nothing fails)

- `.claude/skills/browser-suite/SKILL.md:26` (`tests/harness.ts`), `:32,91` (`tests/harness-control.ts`), `:92` (`tests/harness-*.ts` glob text). The new paths are `apps/api/tests/support/harness/...`. The first three are enforced, the glob text is not.
- `.claude/skills/browser-suite/references/harness.md:31-33`: `harness-control/sources/people/knowledge/questions/asking.ts` become `apps/api/tests/support/harness/`. Enforced. `harness.md:7,8,11,13,17,22` name `src/auth/constants.ts`, `src/auth/routes.ts`, `src/ingress/limits.ts`, `src/trpc/base.ts`, `src/trpc/knowledge.ts`, none of which move.
- `.claude/skills/renovate-prs/SKILL.md:76` names `apps/api/tests/image.test.ts`. Change it to `tests/deploy/`.
- `.claude/skills/survey-architecture/SKILL.md:17,20`. Areas are the directories under `apps/api/src/`. The new folders become areas, so no edit.
- `docs/operations/BUILD_CACHE.md:65,73` (`tests/image-probe.ts`), `docs/operations/CI.md:164` (`tests/await-release.test.ts`), `docs/operations/coolify.md:68` and `docs/operations/local-gates.md:200` (`tests/browse-role.test.ts`). All move to `tests/deploy/`.
- `docs/operations/RUNBOOK.md:248` names `apps/api/src/sweeps.ts`, which becomes `src/timers/sweeps.ts`.
- `docs/specs/route/o1.md:20` (`src/dead-man-ping.ts`) and `docs/specs/route/s5.md:15` (`src/reconciler.ts`) move to `src/timers/`. `docs/specs/route/seams.md:35` (`tests/invisibility.test.ts` becomes `tests/mcp/`) and `:41` (`tests/harness-model.ts` becomes `tests/support/harness/`).
- `deploy/wizard-41.sh:260` names `apps/api/src/smtp.ts` in an echoed note. It becomes `src/email/smtp.ts`.
- `apps/worker/pyproject.toml:316` names `apps/api/tests/image-probe.ts` in a comment. It becomes `tests/deploy/`.
- `docs/solutions/best-practices/a-ceiling-keyed-on-the-target-does-not-bound-the-actor.md:51` (`src/smtp.ts:14-15`).
- `docs/solutions/best-practices/a-ceiling-test-on-the-wall-clock-splits-its-count-across-two-windows.md:38` (`tests/passkeys.test.ts`), `:72` (`tests/suite-app.ts`), `:80` (`tests/harness.ts:335`).
- `docs/solutions/best-practices/better-auth-closed-endpoints-run-as-server-functions-without-router-guards.md:50` (`tests/auth-instance.ts:23-24`), `:74,132` (`tests/provoke.ts:47-60`), `:100` (`src/auth/passkeys.ts`), `:130` (`tests/second-factor-foundation.test.ts`). `:35` names `passkeys.ts` and `authenticator.ts` by basename under `apps/api/src/auth/`.
- `docs/solutions/logic-errors/better-auth-lookup-deleted-another-persons-expired-sign-in-code.md:53,165` (`tests/sign-in-and-consent.test.ts`), `:89` (`src/sweeps.ts`), `:120,168` (`tests/promotion-lock.test.ts`), `:149` (`src/auth/link-token.ts:151-169`, `src/auth/sign-in-link.ts:74-76`), `:153` (`src/auth/authenticator.ts`), `:166` (`tests/sweeps.test.ts:270-282`).
- `docs/solutions/logic-errors/a-stale-tab-acted-in-the-workspace-the-session-had-moved-to.md:64` (`tests/trpc-roads.test.ts`).
- `docs/plans/007-s3-concepts-and-guides.md` is an active plan. About 45 mentions at lines 188-1517 name `tests/harness-knowledge.ts`, `harness-control.ts`, `harness-sources.ts`, `harness-knowledge.test.ts`, `knowledge-procedures.test.ts`, `knowledge-owners.test.ts`, `inbox-procedures.test.ts` and `ops.test.ts` (`:188,220`, which the split removes). Update them, or note the move at the top of the plan.
- `docs/plans/001-remove-vocabulary-gate.md` names files that no longer exist (`old-words.ts`, `avoid-words.test.ts`). It is already stale, so leave it.
- `docs/archive/**` is excluded by design (historical).
- `.cubic/wiki/**` is generated. It already cites a nonexistent `apps/api/tests/deploy-tree.test.ts` and also names `tests/oauth-flow.test.ts` and `tests/mcp-surface.test.ts`. Regenerate it, never hand-edit it.

## 4. Import rewrite mechanics

- **How imports are written.** Every in-workspace import is relative with an explicit `.ts` extension (`allowImportingTsExtensions`, `verbatimModuleSyntax`). There are no `#` subpath imports, no tsconfig `paths` and no aliases. Cross-workspace imports go through package names (`@better-answers/core/...`, `@better-answers/schema/...`). The api's one `exports` key, `./trpc`, does not move. No other workspace imports an api file by relative path. The only exceptions are `scripts/mutation-shards.mjs:3` and `mutation-baseline.test.ts:18`, which import `stryker.config.mjs`, and that file does not move.
- **Specifier shapes the codemod must handle:**
  - Static: `import ... from "./x.ts"` and `import type ... from`.
  - Re-exports: `export ... from "./x.ts"` (`src/auth/index.ts:1-8`, and the new `src/ops/index.ts`).
  - Dynamic string imports: `tests/serve.ts:31-33` (`import("./harness-asking.ts")`, `"./harness-control.ts"`, `"./harness.ts"`).
  - `new URL("<rel>", import.meta.url)`: `tests/suite-app.ts:50`, `tests/procedure-output.test.ts:12-13`, `tests/ops.test.ts:3548`, `tests/ops-update-concept-body.test.ts:20`.
  - `path.resolve(import.meta.dirname, "<rel>")`. Section 5 lists each one.
- **Tool.** TypeScript here is 7.0.2, the native port. Its npm package ships only `tsc.js` and `getExePath`, with no JS language-service API, so `getEditsForFileRename` is not available. ts-morph and jscodeshift are not installed. Build a small Node script (the lever) that:
  1. reads this move table as TSV,
  2. runs `git mv` for each row,
  3. for every `.ts` file under `apps/api/{src,tests,lifts}`, resolves each relative specifier (static, re-export, dynamic, `new URL`) against the file's old location, maps the target through the table, and rewrites it relative to the file's new location,
  4. fails if any relative specifier then resolves to a missing file.

  The `import.meta.dirname` joins in section 5 are few and need hand edits. Verify with `pnpm --filter @better-answers/api typecheck`, `oxlint` (`import/no-cycle: "error"` at `.oxlintrc.json:57`), `pnpm knip`, `pnpm jscpd`, `apps/web` `api-seam.test.ts` and `browser-suite-skill.test.ts`, `packages/devtools` `docs-lane.test.ts`, and the api suite. Then rerun `.audit/test-inventory.sh` and diff it against `.audit/baseline/vitest-api.txt`.

## 5. Risks (behaviour-changing first)

1. **Reads relative to `import.meta.dirname` or `import.meta.url` in moved tests.** Each path below gains one `../` (two for `support/harness/`), or a test silently reads the wrong place:
   - `tests/restore.test.ts:15` `apiRoot = path.resolve(import.meta.dirname, "..")`, used to spawn `src/migrate.ts` at `:92`. In `tests/deploy/` it needs `"../.."`.
   - `tests/browse-production.test.ts:18` `"../../../deploy/browse-production.sh"` becomes `"../../../../deploy/..."`.
   - `tests/browse-role.test.ts:20` `"../../../deploy/browse-role.sql"` becomes `"../../../../deploy/..."`.
   - `tests/await-release.test.ts:10` `"../../../deploy/await-release.sh"` becomes `"../../../../deploy/..."`.
   - `tests/ops.test.ts:2739` `cwd: path.resolve(import.meta.dirname, "..")`, which spawns `src/ops.ts` at `:2737`. In `tests/ops/llm.test.ts` (the set-model-key block) it needs `".."` → `"../.."`.
   - `tests/ops.test.ts:3548` and `tests/ops-update-concept-body.test.ts:20` `new URL("fixtures/bundle", ...)` become `"../fixtures/bundle"`.
   - `tests/suite-app.ts:50` `new URL("fixtures/web-build", ...)` becomes `"../fixtures/web-build"` in `tests/support/`.
   - `tests/procedure-output.test.ts:12-13` (section 3).
   - These are unaffected: `tests/migrate.test.ts:11`, `tests/stop.test.ts:16`, `tests/serve.test.ts:8` (all stay at the root, and spawn `src/migrate.ts`, `src/main.ts` and `tests/serve.ts` with cwd `apps/api`). `tests/serve.ts:48` and `tests/local.ts:42` (`../../web/dist`) also stay. So do `src/config.ts:26` (stays), `image-probe.ts:256`, `backup-image.test.ts:31`, `image.test.ts:25,42` and `local-database.test.ts:27` (all through `repositoryRoot`).
2. **The ops.test.ts split and the object store.** `apps/api/vitest.config.ts:13-14` says: "A file that wants the object store names `objectStoreForSuite` in its own source, or the run it is selected in starts no Garage for it." `startWarmObjects` (`packages/core/test/warm-objects.ts:102-109`) scans the selected test files' text. Today `ops.test.ts:125` calls it once at module scope, and `doorsFrom` (`:156-160`) closes over it, so every `ops(...)` run needs it. Each split file must call `const objects = objectStoreForSuite()` at its own module level and pass it to the shared runner. If the call moves into `tests/support/ops-run.ts`, a run that selects one split file starts no Garage and fails.
3. **The split breaks the parent's baseline invariant.** `.audit/test-inventory.sh` keys each line as `<basename> :: <title>`, and the decision log says a move keeps every line. Moves keep basenames, so every other file diffs clean. Splitting `ops.test.ts` re-keys all 174 `ops.test.ts :: ...` lines in `.audit/baseline/vitest-api.txt` (measured) under 10 new basenames. The parent must choose one of two checks for that file: compare titles only (the sorted multiset of titles from the 10 new files plus nothing else must equal the old `ops.test.ts` titles), or apply the file mapping in section 6.3. Every split file must wrap its blocks in the same outer `describe("pnpm ops — the restore scripts' commands", ...)` so the titles stay byte-identical.
4. **jscpd with `threshold: 0` scans tests** (`jscpd.config.mjs:5-27`; tests are not ignored). Ten split files sharing the same import block and preamble (`objectStoreForSuite`, `servedApp`, the runner factory) can trip the 5-line, 50-token clone floor. Keep the per-file preamble to the two calls plus one factory call, and run `pnpm jscpd` after the split.
5. **The snapshot header names its own test path** (section 3). Regenerate it with `UPDATE_BETTER_AUTH_ENDPOINTS=1` and do not hand-edit it.
6. **The web seam.** Anything reachable from `src/trpc/app-router.ts` must not move into `src/auth/`. Today that covers `second-factor-gate.ts`, `identity-principal.ts`, `refusal.ts`, `doors.ts` and `ask/*`. This plan keeps them out. `api-seam.test.ts` enforces it.
7. **Moves must not cross the `auth/` boundary.** `.oxlintrc.json:187` allows better-auth imports only under `apps/api/src/auth/**`, and the table-ownership scan gives auth tables to `apps/api/src/auth`. No file moves in or out of `auth/` here.
8. **Mutation cost, not breakage.** Stryker's `incrementalFile` (`stryker.config.mjs:17-19`) and the nightly baseline artifact (`.github/actions/mutation-baseline/action.yml`) key on file paths. After the move the api leg re-runs every moved file in full once.
9. **Low risk, checked.** The per-file Postgres database is named from `expect.getState().testPath` (`packages/schema/test/warm-postgres.ts:355-392`), so moved files get new database names, which is harmless. `test-title-setup.ts` holds titles, not paths. There is no snapshot directory, no file-count gate per folder, no `vi.mock` by path, and no glob that discovers src files besides vitest's `tests/**/*.test.ts`, stryker's `src/**/*.ts`, and the recursive walks in `no-ambient-clock` and `procedure-output`.

## 6. Big-file split

### 6.1 `apps/api/src/ops/index.ts` (1754 lines, 1620 code lines, cap 1620)

The file has a clean registry spine: `NEEDS` (`:199-213`), `SLICE_RUNNERS` (`:1701-1723`) and `SLICELESS_COMMANDS` (`:1725-1740`). Each command is a self-contained function, so the split follows the registry. The new modules mirror the core slices each command calls. Code-line counts below cover the body only and were measured on the line ranges; the 126 import lines (`:1-129`) are shared out. The largest module, `concepts.ts`, lands near 320 code lines, and every module stays under 500. The ranges cover every non-blank line from 130 to 1754 (script-checked).

| New module | Lines from `index.ts` | Body code lines | Holds |
| --- | --- | --- | --- |
| `ops/index.ts` | 197-219, 228-279, 484-505, 1701-1754 | 145 | `MAP_TABLES`, `NEEDS`, `SliceCommand`, `isSliceCommand`, `SLICE_COMMANDS` (export), `USAGE_TEXT`, `sliceCommand`, `SLICE_RUNNERS`, `SLICELESS_COMMANDS`, `runOps` (export), and the re-exports |
| `ops/cli.ts` | 130-195, 281-285, 507-529, 637-638 | 81 | `DONE`, `REFUSED`, `USAGE`, `NOT_BUILT`, `EXIT_OF_CLASS`, `OpsIo`, `parseSince`, `Flags`, `parseFlags`, `flagValue`, `bundleStore`, `reasonOf`, `refused`, `exitOf`, `plural`, `counted` |
| `ops/job-wait.ts` | 223-224, 544-609 | 62 | `WAIT_SECONDS`, `WAIT_POLL_MS`, `waitSecondsOf`, `after`, `jobAfterWaiting`, `unfinished`, `waitForJob` (used by map-rebuild and erasure-rehearsal) |
| `ops/erasure.ts` | 287-340, 1025-1162 | 184 | `erasureDoors`, `replayErasuresCommand`, the rehearsal helpers, `erasureRehearsal` |
| `ops/restore-checks.ts` | 342-482 | 130 | `smoke` and `check`, `dumpGrep` with its scanning helpers |
| `ops/map.ts` | 221, 531-542, 611-636, 639-657 | 55 | `REBUILD_DEFAULT_REASON`, `mapCountsCommand`, `rebuildReasonOf`, `mapRebuildCommand`, `mapSweepCommand` |
| `ops/sources.ts` | 659-711 | 52 | `reindexConnectedSources`, `objectStoreOrphans` |
| `ops/concepts.ts` | 713-1023 | 290 | `reconcileWatermark`, `importBundleCommand` and its helpers, `updateConceptBodyCommand` and its helpers |
| `ops/workspaces.ts` | 1164-1377 | 200 | `notSignedIn`, `noDisplayName`, `noSuchWorkspace`, `provisionWorkspaceCommand`, `addMemberCommand`, `addPersonCommand`, `renameWorkspaceCommand` |
| `ops/llm.ts` | 226, 1379-1599 | 204 | `CHOSEN_PURPOSES`, `setModelKeyCommand`, `setSpendingLimitCommand`, `setModelChoiceCommand`, `setModelPriceCommand`, `setDecisionThresholdCommand` |
| `ops/operator.ts` | 1601-1673 | 67 | `operatorCommand`, `restoreSignInCommand` |
| `ops/answering.ts` | 1675-1699 | 24 | `unmappedPassageRateCommand` |

**Exports keep their names and import sites.** `src/ops/index.ts` keeps `runOps` and `SLICE_COMMANDS` as its own exports. It re-exports the rest:

```ts
export { EXIT_OF_CLASS, NOT_BUILT, parseSince, reasonOf, type OpsIo } from "./cli.ts";
```

`verbatimModuleSyntax` needs the inline `type`. `src/auth/index.ts:1-8` is the precedent for re-exports. These importers keep working unchanged: `src/ops.ts:16`, `src/sweeps.ts:17` and `src/reconciler.ts:17` (`reasonOf`, after `../ops/index.ts` is re-pathed for `timers/`), `tests/ops.test.ts:79-86`, `tests/operator.test.ts:10`, `tests/harness-model.ts:10` and `tests/ops-update-concept-body.test.ts:13`. `body-diff.ts`, `http-fetch.ts` and `read-tree.ts` do not change.

**New internal exports**, consumed only by sibling modules: `DONE`, `REFUSED`, `USAGE`, `Flags`, `flagValue`, `refused`, `exitOf`, `plural`, `counted` and `bundleStore` from `cli.ts`; `WAIT_SECONDS` and `waitSecondsOf` / `jobAfterWaiting` / `unfinished` / `waitForJob` from `job-wait.ts`; `REBUILD_DEFAULT_REASON` from `map.ts`; `CHOSEN_PURPOSES` from `llm.ts`; `notSignedIn` and `noSuchWorkspace` from `workspaces.ts` (used by `operator.ts` and `llm.ts`). Every one has an importer, so knip's `includeEntryExports` stays quiet.

**One lint edit the split forces.** `mapCountsCommand` (`:531-537`) declares a local `const counted`, while the helper `counted` is a module-level `const` declared later (`:638`). `eslint/no-shadow` (`.oxlintrc.json:116`, default hoist) passes this today. In `map.ts`, `counted` becomes a top-level import because `mapSweepCommand` (`:654`) uses it, and the local then shadows an import. Rename the local (for example `counts`), a three-token edit. `dumpGrep`'s locals named `counted` (`:434,470`) are safe because `restore-checks.ts` does not import the helper. A script over the split ranges found no other local that shadows a shared name.

**Cycle rule.** `index.ts` imports every command module, and `USAGE_TEXT` reads constants from `job-wait.ts`, `map.ts` and `llm.ts`. No module may import `index.ts`. The import graph is `index → {commands} → {workspaces, job-wait} → cli → ../doors, ../refusal, ../email/...`, with no back edge. `import/no-cycle: "error"` is the gate. After the split, delete `.oxlintrc.json:532-537`.

### 6.2 `apps/api/src/auth/auth.ts` (754 lines, 674 code, cap 674) and `auth/routes.ts` (607 lines, 533 code, cap 533)

These are notes. The task asked only to note them, and both changes are optional and beyond the move.

- `auth.ts`. `createAuth` (`:345-743`) is 364 code lines in one function (the override at `.oxlintrc.json:504-512` caps the function at 364). The helpers before it total about 220 code lines: path lists `:141-192` (54), request-field helpers `:193-246` (45), and the audit line `:247-344` (81). Moving them to `auth/audit-line.ts` and `auth/closed-paths.ts` would leave about 460-500 code lines plus imports, which is borderline. The file cannot drop safely under 500 without splitting `createAuth` itself (its hooks and plugin list), and that is a logic refactor. Recommendation: leave it out of this restructure.
- `routes.ts`. `mountTheSignInLink` (`:303-429`, 118 code) and its helpers `:236-302` (54 code: `codeAsk`, `bindTheLink`, `tokenOf`, `LINK_REFUSALS`, `linkSignInBody`, `displayNameGivenIn`) are self-contained apart from the shared flow helpers `forwardCookies`, `flowHeaders`, `callFlow` and `FlowBody` (`:114-192`). An extract to `auth/sign-in/sign-in-link-routes.ts` would bring `routes.ts` to about 360-415 code lines and drop its `max-lines` override. `createAuthRoutes` stays at 153 lines, so the function override at `:526-529` stays. To avoid a cycle, the flow helpers move to a shared `auth/library-flow.ts`, which puts the auth root at 14 files. Optional, as a follow-up.
- `auth/confirm.ts` keeps its function override, at its new path (section 3).

### 6.3 Should `apps/api/tests/ops.test.ts` (4158 lines) split? Yes, mirroring 6.1.

One outer `describe` (`:586`) wraps 27 command blocks, with about 480 lines of shared helpers before it (`:102-585`). Splitting lets an agent find a command's tests from its module path. It also lets vitest run the command groups in parallel (`maxWorkers: 6`). The cost is one `servedApp()` start per file instead of one in total. Measured block ranges:

| New file | Blocks from `ops.test.ts` |
| --- | --- |
| `tests/ops/index.test.ts` | the outer `it`s `:588-658` (parseSince, usage, before-the-journal) and "the slice-owned commands" `:843-959` |
| `tests/ops/erasure.test.ts` | replay-erasures `:659-842`, erasure-rehearsal `:1053-1327` |
| `tests/ops/sources.test.ts` | object-store-orphans `:960-1052`, reindex-connected-sources `:1574-1607` |
| `tests/ops/map.test.ts` | map-rebuild `:1328-1447`, map-counts `:1448-1480`, map-sweep `:1538-1573`, "the two sweeps by hand never overlap" `:1608-1641` |
| `tests/ops/answering.test.ts` | unmapped-passage-rate `:1481-1537` |
| `tests/ops/concepts.test.ts` | reconcile-watermark `:1642-1760`, import-bundle `:3547-4158` |
| `tests/ops/restore-checks.test.ts` | smoke `:1761-1804`, dump-grep `:1805-1903` |
| `tests/ops/workspaces.test.ts` | provision-workspace `:1904-2111`, add-member `:2112-2242`, add-person `:2243-2413`, rename-workspace `:2414-2582` |
| `tests/ops/llm.test.ts` | set-model-key `:2583-2837` (holds the `cwd ".."` spawn at `:2739`), set-spending-limit `:2838-2895`, set-model-price `:2896-2973`, set-decision-threshold `:2974-3074`, set-model-choice `:3075-3248` |
| `tests/ops/restore-sign-in.test.ts` | restore-sign-in `:3249-3546` |

`tests/operator.test.ts` moves whole to `tests/ops/operator.test.ts`. The block that tests `operatorCommand` stays there, and the console blocks come with it. `tests/ops-update-concept-body.test.ts` moves whole to `tests/ops/`.

**Helpers.** `tests/support/ops-run.ts` takes the helpers that two or more split files use: `Run`, `ioFor`, `doorsFrom`, `ops`, `opsWith`, `opsBeforeTheJournal`, `answered`, `mapped`, `ULID_SHAPE`, `BOOTSTRAP_ACTOR`, `idOnTheDoneLine`, `aShortName`, `provisioning`, `adding`, `membersOf`, `rowsOfAction`, `auditLogOf`, `principalOf`, `jobsOf`, `boundAndIndexed` and `whatAReplayReaches`. `doorsFrom` closes over the module-level `objects` (`:125,157`), so the support module exports a factory that takes the `objects` accessor (for example `opsRunner(objects)`), and each file names `objectStoreForSuite()` itself (risk 2). This reshapes test helpers only, not product code. Helpers with one user move into that file: the erasure dates and helpers (`:109-123,286-309,430-485`) to erasure.test, `replayedAfterTheWindow`, `restoreDrillNote` and `lostInTheWindow` (`:524-585`, used only at `:1704-1724`) to concepts.test, `SLICE_TABLES` to index.test, the job helpers to map/erasure, and `workspaceCountOf` and `workspacesWithShortName` to workspaces.test.

## Deviations from the design rules, stated

- **Rule 1.** GLOSSARY.md has no term for `timers/`, `deploy/` (tests), `restore-checks`, `job-wait` or `cli`. The names come from the RUNBOOK (`timers`), the repository's `deploy/` directory, and the usage text's own grouping.
- **Rule 3.** `tests/trpc/members/` groups 9 tests of one source file, `src/trpc/members.ts`. It is not a source folder, but without it `tests/trpc/` would hold 22. `tests/deploy/`, `tests/support/harness/`, `cimd-fetch.test.ts` (it tests `lifts/better-auth-cimd-node/`, which sits beside `src/`, so its test sits at the tests root), `lint-rules.test.ts` and `no-ambient-clock.test.ts` have no single source file.
- **Rule 2.** `tests/email/smtp.test.ts` is a one-file folder, which is what mirroring `src/email/` produces. The alternative is to leave `smtp.test.ts` at the tests root, which would make 15 there.
- **Rule 5.** No renames. Names like `auth/sign-in/sign-in-link.ts`, `tests/trpc/members/members-accept.test.ts` and `tests/support/harness/harness-control.ts` repeat their folder. Shortening them would rename 30+ files and every doc mention, so this plan does not.
- `src/ops/` lands at exactly 15 files and `tests/auth/` and `tests/support/` at 15, which is the limit.
