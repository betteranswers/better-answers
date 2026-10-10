---
title: Prune The Nested Skills - Plan
type: chore
date: 2026-10-10
topic: prune-nested-skills
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Prune The Nested Skills - Plan

## Goal Capsule

- **Objective:** A session that opens a file under an app loads only the skills this repository's code or its route gives work to, and it finds each one beside the files it serves.
- **Means:** `skills-lock.json` loses the 12 entries nothing here uses. The verdict table below names the folder each kept skill belongs under. `.gitignore` covers the one new folder, and `AGENTS.md` says where nested skills live.
- **Authority:** BA-66's acceptance criteria and the owner's ruling of 10/10/2026 on the four root skills, then the Key Technical Decisions, then the table.
- **Stop conditions:** a removal would need a tracked skill deleted, or a move would need the route spec, a C4 page or a workspace's `CODING_STANDARDS.md` rewritten. Neither happens here.
- **Execution profile:** one pull request, `Fixes BA-66`. It changes no product code and no skill's text. One line of gate tooling changes, with its test (U3).
- **Who finishes:** the build agent makes the tracked change, `ce-code-review` reviews it, and `ce-commit-push-pr` opens the pull request. The owner cleans the main checkout after the merge (*After the merge*, below).

---

## Product Contract

### Summary

Of the 51 entries in `skills-lock.json`, 12 go and 39 stay. Both tracked skills under `apps/api/.claude/skills/` stay. Eight installed skills belong under a different folder from the one they sit in today, and four kept entries are installed in no checkout.

### Problem Frame

A nested skill loads at the first `Read` or `Edit` under its app. `apps/api/.claude/skills/` holds 21, so each worktree subagent that reads an api file adds 21 entries to its parent session's skill list. Several of them describe frameworks this repository does not run. Others sit away from most of the files they serve: the Better Auth skills are under `apps/web/`, which holds the auth client, while `betterAuth(...)` and its plugins are configured in `apps/api/src/auth/`. The Coolify skills are under `apps/worker/`, while the compose files are under `deploy/`.

BA-62's test, finished on 06/10/2026, showed that loading nested skills early changes nothing in a plan. So each skill is judged on one question: does this repository's code, or a block of `docs/specs/v01-route.md` still to build, give it work?

### Requirements

- R1. Each of the 51 entries in `skills-lock.json`, and each tracked skill under `apps/api/.claude/skills/`, is kept or removed, with a one-line reason for each removal.
- R2. A tracked skill is removed through `ce-skill-work`.
- R3. Each kept skill has a named folder: the one whose files it serves.
- R4. `AGENTS.md` and every other tracked file name no skill that is gone.
- R5. `.claude/hooks/provision-skills.sh` still runs clean.
- R6. A gate reads the same lines on a developer's machine as in CI, whichever folder an installed skill sits in.

### Scope Boundaries

- The four root skills the owner ruled on stay where they are: `security-audit`, `repo-quality-sweep`, `ci-cd-and-automation`, `c4-architecture`.
- No tracked skill is removed, so no `.gitignore` exception, no line of `packages/devtools/test/ci/provision-skills.test.ts` and no `THIRD_PARTY_NOTICES.md` changes. R2 has nothing to act on.
- No installed skill folder in the main checkout or in another worktree is touched by this pull request. Other sessions are loading them.
- Skills on disk that the lock does not name are outside the 51. The table's last part gives their placement and nothing else: `cocoindex`, `coolify-compose`, `coolify-deploy`, `writing-react-effects`, `github-actions-templates`, `decision-clarity` and the six `gitnexus-*` skills.
- `provision-skills.sh` is not changed, and gains no placement manifest.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A removal is settled by the code or by the route's *Out of Scope*, never by a usage count alone.** The owner's caveat on BA-66 is that no use so far is weak evidence. So an entry goes only when no dependency, import, live decision or route block could call on it. Where that is a judgement, the entry stays and is listed for the owner (*Calls kept for the owner*). Governs R1.
- KTD2. **Placement of an installed skill is a move by hand in the main checkout, and this pull request records it.** `skills-lock.json` holds a source and a hash for each entry and no folder. The skills CLI (`skills@1.5.24`) has no option that names a target folder. `provision-skills.sh` copies whatever the main checkout holds into each new worktree. So the main checkout's layout is the layout, and no tracked file can move an installed folder. The tracked part of a placement is the table here, the `.gitignore` line for a new folder, and the sentence in `AGENTS.md`. Governs R3.
- KTD3. **`deploy/.claude/skills/` is the one new folder.** The Coolify skills serve `deploy/*.compose.yaml` and the release scripts beside them. The hook's walk already finds any `.claude/skills` up to four levels down, as it does for `.github/.claude/skills/`, so only the ignore line is new. Governs R3, R5.
- KTD4. **`client-setup` and `links` stay under `apps/api/`.** They also serve `apps/web/src/shared/api/`, which holds the link chain. But `apps/api/CODING_STANDARDS.md` (*Follow this tier's tRPC skills*), the route spec's *The api's skills are read first* and `docs/architecture/c4-components-api.md` all place the links skill under `apps/api/.claude/skills/`, and `apps/api/tests/web-client.ts` builds a client. Moving them means rewriting those three documents, which is a stop condition. `react-query-setup` has no such tie and only `apps/web` depends on `@trpc/tanstack-react-query`, so it moves. Governs R3.
- KTD5. **The Docker and knip skills stay at the root.** Dockerfiles sit in `apps/api/`, `apps/worker/` and `deploy/`, and `knip.config.ts` is at the root, so the root is the one folder above every file they serve. `first-principles` stays in `.agents/skills/` because `.claude/skills/survey-architecture/SKILL.md` reads it at that path. Governs R3.

- KTD6. **The Better Auth skills go under `apps/api/`, where most of their files are.** They serve both tiers: the server in `apps/api/src/auth/` and the client in `apps/web/src/features/auth/auth-client.ts`. A skill sits in one folder. The server holds the configuration, the plugins, the rate limits and the origins, which is most of what the skills cover, so that is the folder. The cost is in *Calls kept for the owner*. Governs R3.
- KTD7. **The density counter walks past a folder named `skills`.** `pnpm comment-density` measures `deploy/` and `.github/` as directories, YAML included, and cloc does not read `.gitignore`. The Coolify skills carry example compose files, so under `deploy/` they would be counted on a machine that holds them and not in CI. `packages/devtools/python/comment_gate.py` already skips `skills`, and the counter now does the same. Governs R6.

### The verdicts

*Folder* is where the skill belongs. *Now* is where the main checkout holds it on 10/10/2026 when that differs, and *nowhere* means no checkout holds it.

#### Removed (12)

| Skill | Now | Reason |
| --- | --- | --- |
| `adapter-aws-lambda` | nowhere | The api is one Node process under `@hono/node-server`. Nothing runs on Lambda. |
| `adapter-express` | nowhere | No workspace depends on Express. |
| `adapter-fastify` | nowhere | No workspace depends on Fastify. |
| `adapter-standalone` | `apps/api/` | Nothing imports `@trpc/server/adapters/standalone`. tRPC is mounted on Hono through `@hono/trpc-server` (`apps/api/src/trpc/mount.ts`). |
| `nextjs-app-router` | nowhere | No workspace depends on Next.js. The web app is a Vite single-page app. |
| `nextjs-pages-router` | nowhere | The same. |
| `react-query-classic-migration` | `apps/api/` | `apps/web` is already on `@trpc/tanstack-react-query`, and `@trpc/react-query` is in no manifest, so there is nothing to migrate. |
| `service-oriented-architecture` | `apps/api/` | One api deployable serves one router. No gateway splits calls between services. |
| `superjson` | nowhere | No transformer is set on the server or on any link. |
| `email-and-password-best-practices` | `apps/web/` | `apps/api/src/auth/auth.ts` never sets `emailAndPassword`. People sign in with an email code or a passkey. |
| `agent-auth-mcp` | nowhere | The route's *Out of Scope* names Agent Auth, which `VISION.md` holds for a stage after v0.1. The MCP surface authorizes through `@better-auth/oauth-provider`. |
| `mcp` | nowhere | It covers MCP Apps built on json-render. json-render is in no manifest, and the route's *Out of Scope* names MCP Apps. |

#### Kept (39)

| Skill | Folder | Now, if different | What gives it work |
| --- | --- | --- | --- |
| `c4-architecture` | root | | Owner's ruling. `AGENTS.md` names it for `docs/architecture/`. |
| `ci-cd-and-automation` | root | | Owner's ruling. |
| `security-audit` | root | | Owner's ruling. |
| `repo-quality-sweep` | root, tracked | | Owner's ruling. |
| `code-comments` | root, tracked | | Called in 3 of the 85 sessions since the move to Compound Engineering. |
| `complexity-gate` | root, tracked | | Called in 2 of the 85. |
| `mutation-testing` | root, tracked | | Called in 3 of the 85. `docs/agents/workflow.md` says when it runs. |
| `first-principles` | root | | Called in 4 of the 85, and `survey-architecture` reads it by path (KTD5). |
| `docker-patterns` | root | | Three Dockerfiles and three compose files (KTD5). |
| `multi-stage-dockerfile` | root | | The same. |
| `fix-knip-unused-exports` | root | | `pnpm knip` runs over `knip.config.ts`. |
| `knip-deadcode` | root | | The same. |
| `ban-type-assertions` | root | nowhere | `.oxlintrc.json` sets `typescript/consistent-type-assertions` to refuse every assertion. |
| `trpc-router` | `apps/api/` | | The entry to the tRPC skills. `apps/api/CODING_STANDARDS.md` binds the tier to them. |
| `server-setup` | `apps/api/` | | `initTRPC` in `apps/api/src/trpc/base.ts`. |
| `validators` | `apps/api/` | | Every procedure's input. Named by the route. |
| `error-handling` | `apps/api/` | | `TRPCError` and the error formatter in `base.ts`. Named by the route. |
| `middlewares` | `apps/api/` | | The base procedures in `base.ts` are built with `.use(...)`. |
| `auth` | `apps/api/` | | The context built in `mount.ts`, narrowed by the person and workspace procedures. |
| `caching` | `apps/api/` | | `responseMeta` in `mount.ts`. |
| `adapter-fetch` | `apps/api/` | | `@hono/trpc-server` mounts the router through the fetch adapter, and `apps/api/tests/trpc-roads.test.ts` calls `fetchRequestHandler` itself. BA-66 listed it as a candidate; the code keeps it. |
| `non-json-content-types` | `apps/api/` | | The upload is a mutation over `octetInputParser` (`apps/api/src/trpc/router.ts`). Named by the route. |
| `openapi` | `apps/api/` | | Nothing generates the document yet. The decision that outside callers get an OpenAPI document generated from the router is live (`docs/solutions/architecture-patterns/adr-0008-trpc-inside-openapi-and-mcp-outside.md`). BA-66 listed it as a candidate; the decision keeps it. |
| `subscriptions` | `apps/api/` | | No subscription exists yet. The route's answer stream is one, and `docs/architecture/c4-components-api.md` says so. |
| `server-side-calls` | `apps/api/` | | Nothing calls `createCaller` today. Kept for the owner (below). |
| `client-setup` | `apps/api/` | | `createTRPCClient` in `apps/api/tests/web-client.ts` and `apps/web/src/shared/api/trpc.ts` (KTD4). |
| `links` | `apps/api/` | | `apps/web/src/shared/api/link.ts`. Named by the route (KTD4). |
| `hono` | `apps/api/` | | Every route and middleware of the api. |
| `resend` | `apps/api/`, tracked | | The api sends through Resend's SMTP relay (`apps/api/src/smtp.ts`). `AGENTS.md` names it. |
| `email-best-practices` | `apps/api/`, tracked | | The emails the api sends. `AGENTS.md` names it. |
| `better-auth-best-practices` | `apps/api/` | `apps/web/` | `betterAuth(...)` in `apps/api/src/auth/auth.ts`. It also serves the client in `apps/web/src/features/auth/` (KTD6). |
| `better-auth-security-best-practices` | `apps/api/` | `apps/web/` | The rate limits, origins and cookies of `apps/api/src/auth/`. |
| `organization-best-practices` | `apps/api/` | `apps/web/` | The `organization` plugin in `auth.ts`. |
| `two-factor-authentication-best-practices` | `apps/api/` | `apps/web/` | The `twoFactor` plugin in `auth.ts`. |
| `create-auth` | `apps/api/` | `apps/web/` | Sign-in is built. P1's Microsoft sign-in adds a provider. Kept for the owner (below). |
| `react-query-setup` | `apps/web/` | `apps/api/` | `createTRPCContext` and `createTRPCOptionsProxy` in `apps/web/src/shared/api/trpc.ts` (KTD4). |
| `pii-detection-pipeline` | `apps/worker/` | nowhere | The redaction seam's detector is Presidio with GLiNER and spaCy (`apps/worker/pyproject.toml`). Kept for the owner (below). |
| `pii-in-unstructured` | `apps/worker/` | nowhere | The same. |
| `implementing-gdpr-data-subject-access-request` | `apps/api/` | nowhere | O1 builds the *Erasure and suppression* page and the subject request's first caller. The route says the erasure request is the api's. Kept for the owner (below). |

#### On disk, and not in the lock

| Skill | Folder | Now, if different |
| --- | --- | --- |
| `coolify-compose` | `deploy/` | `apps/worker/` |
| `coolify-deploy` | `deploy/` | `apps/worker/` |
| `cocoindex` | `apps/worker/` | |
| `writing-react-effects` | `apps/web/` | |
| `github-actions-templates` | `.github/` | |
| `decision-clarity`, the `gitnexus-*` skills | root | |

### Calls kept for the owner

Each of these stays because the code does not settle it.

- `server-side-calls`: no code calls `createCaller`, and the api's tests reach a procedure through `fetchRequestHandler`. It stays because a test that wants a procedure without the HTTP road would use it.
- `create-auth`: it scaffolds sign-in for a project that has none, and this one has it. It stays because P1's Microsoft sign-in adds a provider, which the skill also covers.
- `ban-type-assertions`: the rule it switches on is already on, the skill is user-invoked only, and no checkout holds it. It stays because it also covers how to clear a violation.
- `pii-detection-pipeline`, `pii-in-unstructured`, `implementing-gdpr-data-subject-access-request`: the owner added them for the architecture pass of 10/09/2026, and no checkout holds them now. S0, which they informed, is done. They stay because O1's personal-data pages and each later connector pass through the same seam.
- `fix-knip-unused-exports` and `knip-deadcode` overlap, and so do `docker-patterns` and `multi-stage-dockerfile`. Each has matching code, so all four stay. One of each pair may be enough.
- `client-setup` and `links` under `apps/api/` (KTD4): a session that edits `apps/web/src/shared/api/link.ts` and reads no api file does not load them.
- The Better Auth skills under `apps/api/` (KTD6): a session that edits `apps/web/src/features/auth/` and reads no api file does not load them. The owner put them under `apps/web/` on 04/10/2026, and leaving them there is the other defensible answer.
- The Better Auth move leaves `apps/api/` at 22 nested skills, one more than today: it loses four and gains five. The count BA-66 quotes falls only if the owner drops some of the calls above.

### After the merge

The main checkout is the copy every new worktree is made from, so the cleanup happens there once, when no session is mid-task under the folders it touches.

1. Delete the four removed folders: `adapter-standalone`, `react-query-classic-migration` and `service-oriented-architecture` under `apps/api/.claude/skills/`, and `email-and-password-best-practices` under `apps/web/.claude/skills/`.
2. Move `react-query-setup` from `apps/api/.claude/skills/` to `apps/web/.claude/skills/`.
3. Move the five Better Auth folders from `apps/web/.claude/skills/` to `apps/api/.claude/skills/`: `better-auth-best-practices`, `better-auth-security-best-practices`, `organization-best-practices`, `two-factor-authentication-best-practices`, `create-auth`.
4. Make `deploy/.claude/skills/` and move `coolify-compose` and `coolify-deploy` into it from `apps/worker/.claude/skills/`.
5. Run `.claude/hooks/provision-skills.sh .` and expect exit 0.

A worktree made before the cleanup keeps the old folders until it is removed. Running the hook on it copies back any folder the main checkout still holds, so the main checkout goes first.

### Risks

| Risk | Mitigation |
| --- | --- |
| `trpc-router` is the tRPC skills' entry, and its decision tree still points at eight siblings that are gone: four adapters, `superjson`, both Next.js skills and `service-oriented-architecture` | It is an installed skill kept as upstream wrote it, so its text is not edited. A pointer to a missing skill fails where the reader can see it. The pull request's report says so |
| A reinstall from the lock lands every entry at the root, whatever this table says | That is true today and this change does not make it worse. KTD2 and `AGENTS.md` now say that placement is by hand |
| A file under `deploy/.claude/skills/` reaches a gate that walks `deploy/`, or the backup image's build context | The density counter was the one gate that read it, and KTD7 closes that. `lint:workflows:shellcheck` finds `*.sh` under `deploy/` and neither Coolify skill holds one. The backup image copies two named scripts. The gates are run with the folder in place before the push (*Verification Contract*) |

### Follow-up, not done here

- `.claude/skills/ce-skill-work/references/new-skill.md` searches `apps/*/.claude/skills/` for a skill of the same name before a new one is made. It misses `.github/` today and will miss `deploy/`. It is a tracked skill, so the edit goes through `ce-skill-work` in its own change.

### Assumptions

- The four kept entries that no checkout holds stay uninstalled until the owner rules on them. Their folder in the table is where they go if they come back.

---

## Implementation Units

### U1. Drop the 12 entries and record the placement

- **Goal:** the lock names only kept skills, and the tracked files say where a nested skill lives.
- **Requirements:** R1, R3, R4; KTD1 to KTD6.
- **Dependencies:** none.
- **Files:**
  - `skills-lock.json`: the 12 entries removed, nothing else touched.
  - `.gitignore`: `deploy/.claude/skills/*`, beside the other nested folders.
  - `AGENTS.md` (*Skills*): the sentence on where the other skills live names each folder and says placement is by hand.
- **Approach:** remove the entries by key so the file's order and form hold. Search every tracked file for each removed name before and after.
- **Test expectation:** none — no code changes. The docs lane's `provision-skills.test.ts` runs the hook over planted trees and its fixtures name only kept skills.
- **Verification:** the lock's diff is deletions only and leaves 39 entries. No tracked file outside `skills-lock.json` and this plan names a removed skill.

### U2. Prove the layout in the worktree

- **Goal:** the layout the table describes passes the hook and the gates.
- **Requirements:** R5.
- **Dependencies:** U1.
- **Files:** none tracked. The build worktree's own git-ignored skill folders are deleted and moved as *After the merge* lists.
- **Approach:** apply the five steps in the worktree, with the main checkout left alone, then run the checks below.
- **Test expectation:** none — git-ignored files only.
- **Verification:** the hook exits 0, and the gates pass with `deploy/.claude/skills/` in place.

### U3. Keep installed skills out of the density count

- **Goal:** `pnpm comment-density` gives `deploy/` and `.github/` the same number with and without the skills installed under them.
- **Requirements:** R6; KTD7.
- **Dependencies:** none.
- **Files:**
  - `packages/devtools/src/comment-density.ts`: `skills` joins the folders the counter never walks.
  - `packages/devtools/test/comment-density.test.ts`: the case below.
- **Execution note:** write the case first and watch it fail.
- **Test scenarios:**
  - A YAML file under a directory's `.claude/skills/` is not counted, and the SQL beside it is.
- **Verification:** the devtools `check` passes, and `pnpm comment-density` passes on the real tree.

---

## Verification Contract

| Check | Proves | Applies to |
| --- | --- | --- |
| `git diff` on `skills-lock.json` shows 72 deleted lines and none added | R1: 12 entries gone, 39 left, no other edit | U1 |
| A search of tracked files for each removed name | R4 | U1 |
| `.claude/hooks/provision-skills.sh <worktree>` exits 0 | R5 | U2 |
| `pnpm check:gates` | Lint, shellcheck over `deploy/` and the comment gates, with the new folder present | U1, U2, U3 |
| `pnpm --filter @better-answers/devtools run check` | R6: the new case, types and the rest of the gate tooling's suites | U3 |
| `pnpm check:docs` | The docs lane: this plan's form, the words test, and the provisioning tests | U1 |

---

## Definition of Done

- `skills-lock.json` holds 39 entries, and each of the 12 removed has its reason in the table.
- Each kept skill has a folder in the table, and `.gitignore` covers every folder the table names.
- `AGENTS.md` names no skill that is gone and says where nested skills live.
- The density counter skips installed skills, and a test holds it.
- The hook exits 0 on the worktree, and `check:gates`, `check:docs` and the devtools `check` pass on the pushed head.
- The report to the owner lists the calls kept for them and the five steps for the main checkout.

---

## Appendix

### Sources

- Linear BA-66 and the owner's ruling in its comment of 10/10/2026. BA-62, whose test it follows.
- `.scratch/ce-evaluation-2026-10-06/usage-summary.md`, machine-local: the counts of sessions that called each skill.
- `docs/specs/v01-route.md`: *The api's skills are read first*, *Out of Scope*, and O1's block.
- `apps/api/CODING_STANDARDS.md`, *Follow this tier's tRPC skills*.
- `docs/operations/local-gates.md`, *Provisioning the skills*.
