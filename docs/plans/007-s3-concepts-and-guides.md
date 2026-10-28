---
title: S3 concepts typed and edited, guides built from them - Plan
type: feat
date: 2026-10-21
topic: s3-concepts-and-guides
route_block: S3
---

# S3 concepts typed and edited, guides built from them, plan

This plan builds route block S3, whose brief is [`docs/specs/route/s3.md`](../specs/route/s3.md). An owner or an Admin types and edits concepts on Knowledge, and anyone else's edit waits as an *edit* suggestion for the owner to decide in their Inbox. A guide seeded from a template fills its sections from concepts and cites each by a footnote. Each collection has an owner, and owning one opens Knowledge's Curation pages.

The program holds the brief's rule. Only the owner or an Admin commits, and every commit names its person as git author.

The PRs, in order, are BA-230, BA-231, BA-12, BA-95, BA-144, BA-232, BA-233, BA-234, BA-235, BA-236, BA-237, BA-238 and BA-239.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists. Evidence is a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `skills/poteto-mode/playbooks/orchestrate.md` from the installed plugin. S3 is thirteen PRs over several days and several sessions, so one coordinator holds the ledger and a later session takes it up through this repository's `.agents/playbooks/session-pickup.md`. The coordinator session merges every PR. An agent that did not write the PR posts `PASS` at its head SHA, and the coordinator lands it with `gh pr merge <n> --squash --match-head-commit <sha>` once the PR's own `check` is green (`AGENTS.md`, *Workflow*). No PR stops at merge-ready for the operator, except that the review-gated PRs wait for the operator's review in chat before they are landed.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

The root, named in each **Merge.** block, is the coordinator session.

Each PR section lists the rules files and the Linear comments its planner read, in its **Rules and comments read.** paragraph, and cites each rule it acts on. Appendix D lists the rules files.

Appendix B's key technical decisions bind wherever an earlier note differs from them, `design.md` included. KTD8 is one such case. It compares two renders of a concept file, where `design.md` compared the stored bytes.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, write this exact text into the standing orders and restate it in your todolist. "Plan `docs/plans/2026-10-21-1721-feat-s3-concepts-and-guides-plan.md`. PRs in order BA-230, BA-231, BA-12, BA-95, BA-144, BA-232, BA-233, BA-234, BA-235, BA-236, BA-237, BA-238, BA-239. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. The coordinator lands each PR with `gh pr merge <n> --squash --match-head-commit <sha>` after an agent that did not write it posts `PASS` at its head SHA. A PR that adds a migration or edits `contracts/` runs alone until it merges. Done when every PR has merged, every Done when check in `docs/specs/route/s3.md` holds, and S3's row reads `done`."
- [ ] Read these from the installed plugin at program start. Re-read them at every tick.
  - [ ] `skills/poteto-mode/playbooks/orchestrate.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] `.claude/skills/browser-suite/SKILL.md`, this repository's driver skill
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/how/SKILL.md`, `skills/architect/SKILL.md`, `skills/interrogate/SKILL.md`, `skills/thermos/SKILL.md` and `skills/show-me-your-work/SKILL.md`
  - [ ] The mutation-testing skill, which is not in the plugin. It is `~/.claude/skills/synced/346a4f5f-03ca-49d6-a920-066649535294_409d7498-c5fc-4152-b2cc-fb60980effbe/mutation-testing/SKILL.md`. If that folder has moved, find it with `ls ~/.claude/skills/synced/*/mutation-testing/SKILL.md`.
- [ ] Arm the hourly audit tick as a real `/loop` in dynamic mode, which schedules its own wake-up rather than blocking on a sleep. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin and the standing objective. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every PR owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one PR owner for each PR, with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges.
  - [ ] BA-230 and BA-231 are independent and first. Both branch from `main`. BA-231 builds on BA-221, which merged as #869. BA-216's run has finished, and its three survivors are BA-230's tests.
  - [ ] BA-12 and BA-95 after BA-231.
  - [ ] BA-144 after BA-95.
  - [ ] BA-232 after BA-12.
  - [ ] BA-233 after BA-231, since both add a migration.
  - [ ] BA-234 after BA-233, since both add a migration.
  - [ ] BA-235 after BA-234.
  - [ ] BA-236 after BA-12, BA-235 and BA-144.
  - [ ] BA-237 after BA-236.
  - [ ] BA-238 after BA-12 and BA-237. Its guide export uses BA-237's renderer and `recordUsage`.
  - [ ] BA-239 after BA-12, since both change the navigation outline.
- [ ] Hold the file boundaries. Only BA-231, BA-233 and BA-234 add files under `packages/schema/migrations/`, one at a time. Only BA-233 may edit `contracts/`, and it runs alone while it does. Before a PR that adds a migration or edits `contracts/` opens, check every open PR's files with the loop in the session briefs' shared rules and wait until no other such PR is open.
- [ ] Hold the review gate. BA-12, BA-144, BA-232, BA-236, BA-237, BA-238 and BA-239 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base main` or `gh pr create --base main` according to the resolved forge.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every review-bot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Before the code-ready report and babysit, and again after merge prep, record the base and head SHAs prepared by the topology owner under the execution playbook.
- [ ] Hand the root `AGENTS.md` and the `AGENTS.md` of each touched directory to `/thermos` and to the verifier, since their rubrics do not load them.
- [ ] Run `/mutation-testing` on each PR that changes validation, parsing or admission, per `docs/agents/mutation-triage.md`.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behaviour, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head. Run each full swarm per `skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the PR owner, including a defect that a lane filed as a note. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] An agent that did not write the PR posts `PASS` at the head SHA. Once the PR's own `check` is green, the coordinator lands it with `gh pr merge <n> --squash --match-head-commit <sha>`. A push after the verdict needs a new verdict. The coordinator reads the PR back with `gh pr view <n> --json state,mergedAt`, then reads `main`'s next `build` run (`gh run list --workflow build.yml --branch main --limit 1`), where `check` tests the landed tree. After each merge, run `node .gitnexus/run.cjs analyze` in the main checkout.

### Boot recipe, for every live lane

Each live lane runs in its own worktree at the PR head. Drive each lane through the skill path or the exact commands this recipe records.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] `pnpm install --frozen-lockfile`. Confirm `docker ps` lists no other session's mutation run or whole browser suite, and wait if one is going (BA-190).
- [ ] A lane on a page drives the served build through `.claude/skills/browser-suite/SKILL.md`. Build with `pnpm --filter @better-answers/web run build`, then run the lane's spec with `pnpm --filter @better-answers/web exec playwright test e2e/<spec>.spec.ts --project chromium`. The api's test harness starts Postgres, the object store and the SPA, and seeds through its harness actions. Playwright's trace and the accessibility gate are the read-only diagnostics.
- [ ] A lane on a PR with no page drives the core interface on a migrated database and a bare repository, through the named vitest scenario with `pnpm --filter <workspace> exec vitest run <file> -t "<title>"`, or the MCP surface through the api's harness. Its screenshot is a capture of the terminal showing the command and its output. `psql` against the run's cloned database and `git log --format='%an <%ae>%n%b'` on the bare repository are the read-only diagnostics.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Pin the audience cascade on a re-write, and BA-216's survivors (BA-230)

**Depends on.** None. BA-216's scoped run on 21/10/2026, at main `63904175a`, settled which findings survive. Its evidence is on BA-216. Findings 1, 2 and 5 survive, and their tests are below. Findings 3, 4 and 6 are killed and closed on BA-216.

**Rules and comments read.** `CODING_STANDARDS.md`, *Tests* lines 7 to 9. The rows go through the concepts entry on real Postgres and a bare repository, and assert the rows before any returned value. `packages/schema/test/support/test-title.ts`. Each title is its behaviour in 10 words at most. Each new test is broken once in the line it guards. `docs/agents/mutation-triage.md`, *Controls* and *Staging*. Every verdict comes from `pnpm mutant-probe` with a positive and a negative control, decided on the whole suite, and the branch shows no `src` diff. `docs/agents/issue-tracker.md` line 11, so the PR says `Fixes BA-230` and `Refs: BA-216`, since BA-216's own deliverable is its run. Linear comments read. BA-216's comment of 21/10/2026 holds the run's verdicts, and BA-230's comment of the same day lists the three survivor tests. BA-221 has none that bears on this unit. BA-216's comment of 21/10/2026 holds the run's verdicts, with the controls and the commands. BA-230's description fixes the two cascade rows and their assertions.

**Files.**

- [ ] Edit `packages/core/test/access/invisibility.test.ts`.
- [ ] Edit `packages/core/test/fixtures/sourced-concept.ts`.
- [ ] Edit `packages/core/test/concepts/visibility.test.ts`.
- [ ] Edit `packages/core/test/concepts/writes/reconciler.test.ts`.
- [ ] Create `packages/core/test/concepts/concept-file-grammar.test.ts`.
- [ ] Edit `packages/core/test/runs/runs.test.ts`.

**Build.**

- [ ] Move `writeUpIncluding` from `packages/core/test/concepts/visibility.test.ts:247` into `packages/core/test/fixtures/sourced-concept.ts` as an export, and import it back in `visibility.test.ts`. Leave the one-IRI copy in `packages/core/test/concepts/sync-cascade.test.ts:118` alone.
- [ ] Add the audience-only row to `invisibility.test.ts`. An Editor writes a concept citing an Internal document under `everyone`. A write-up includes it. The Editor re-writes it through `rewriteCiting` to cite a document from `connectedSourceForGroups(..., [group], "Internal")` alone. The sensitivity stays Internal and only `audience` moves.
- [ ] Add the groups-only row to `invisibility.test.ts`. The concept first cites a document under groups A and B, then is re-written to cite one under group A alone, both Internal. Only `audienceGroups` moves.
- [ ] Each row asserts `visibilityHeld(db().pool, "write_up", ...)` with literal values, then `footnotesOf` for the outside Viewer answers `{ ok: true, value: undefined }`, then a Viewer in the group still reads the footnote.
- [ ] Add the three survivor tests named in **Verify, unit.**, one per finding BA-216's run left surviving. Each asserts literals, so no expectation is computed from the code it guards.

**You see.**

- [ ] `pnpm --filter @better-answers/core exec vitest run test/access/invisibility.test.ts` lists `takes the write-up along on an audience-only re-write` and `takes the write-up along on a groups-only re-write` as passed.
- [ ] `pnpm mutant-probe --file packages/core/src/concepts/import/landing.ts --line 185 --from 'one.audience === other.audience' --to 'true'` prints `verdict: killed`, and the failing test is the audience-only row, not `import-direction.test.ts` alone.
- [ ] `pnpm mutant-probe --file packages/core/src/concepts/import/landing.ts --line 186 --from '(one.audienceGroups ?? []).join(" ") === (other.audienceGroups ?? []).join(" ")' --to 'true'` prints `verdict: killed`, and the failing test is the groups-only row, not `import-direction.test.ts` alone.
- [ ] `git diff --stat origin/main..HEAD -- packages/core/src packages/schema/src` prints nothing.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/access/invisibility.test.ts` gains `takes the write-up along on an audience-only re-write`. Break `one.audience === other.audience` at `landing.ts:185` once and see it fail. Run `pnpm --filter @better-answers/core exec vitest run test/access/invisibility.test.ts -t "audience-only re-write"`.
- [ ] `packages/core/test/access/invisibility.test.ts` gains `takes the write-up along on a groups-only re-write`. Break the groups join at `landing.ts:186` once and see it fail. Run `pnpm --filter @better-answers/core exec vitest run test/access/invisibility.test.ts -t "groups-only re-write"`.
- [ ] Probe both lines with `pnpm mutant-probe --file packages/core/src/concepts/import/landing.ts --line 185 --from 'one.audience === other.audience' --to 'true'` and `--line 186 --from '(one.audienceGroups ?? []).join(" ") === (other.audienceGroups ?? []).join(" ")' --to 'true'`, at trunk and at head. A mutant to `true` is killed by the lint walk in `import-direction.test.ts` whatever the code does, so read each verdict from the other failing tests. Pass when trunk survives and head kills, by a row this PR adds.
- [ ] Finding 1, the crash window on the concept half. `packages/core/test/concepts/writes/reconciler.test.ts` gains `a narrowing skips a cited concept that has no row`, in the `a re-write whose rows were lost` block, which already builds a concept whose `concept_index` row is missing. A source narrowing over its evidence recomputes the cited concepts, and the test asserts the concepts recomputed, as literals, with the row-less concept absent. It kills `row === undefined` to `false` at `packages/core/src/concepts/visibility.ts:175` and `visibility !== undefined` to `true` at `:215`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/reconciler.test.ts -t "no row"`.
- [ ] Finding 2, the concept-file grammar's refusal lines. `packages/core/test/concepts/concept-file-grammar.test.ts` calls `parseConceptFile` (`packages/core/src/concepts/file.ts`) directly with three files, each one line away from a valid file, and asserts `{ ok: false, error: "malformed" }`. `refuses a file with junk before a quoted key` kills the dropped `^` of `FRONTMATTER_LINE` at `:113`. `refuses a file with a numeric list item` kills `typeof item === "string"` to `true` at `:180`. `refuses a file with no opening fence` kills `lines[0] === "---"` to `true` and `-1` to `+1` at `:238`. A valid file beside them parses, so each refusal differs from it in one line alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/concept-file-grammar.test.ts`.
- [ ] Finding 5, a person's queue action re-reading its member row. `packages/core/test/runs/runs.test.ts` gains `a person whose membership moved cannot queue a job`. The member is revoked after the principal resolves, and the queue action answers `credentials-revoked` with no job row. It kills `principal.kind === "platform"` to `true` at `packages/core/src/runs/index.ts:102`, which would skip `withMember`'s re-read. The same action for a member not revoked queues the job, so the refusal differs in the revocation alone. Run `pnpm --filter @better-answers/core exec vitest run test/runs/runs.test.ts -t "membership moved"`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe. Each lane drives the core interface on a migrated database and a bare repository, and its screenshot is a terminal capture.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm --filter @better-answers/core exec vitest run test/access/invisibility.test.ts` at trunk and head. Trunk lacks the rows, so record that its list names neither title, and gate the two rows at head. Save `ba230-regression.png`. Pass when every trunk case still passes at head and head adds exactly the two titles, both passed.
- [ ] Lane 2. Probe `landing.ts:185` (`one.audience === other.audience` to `true`) at head through `pnpm mutant-probe` on the whole core suite. Save `ba230-audience-probe.png`. Pass when the verdict is `killed` and the failing tests include the audience-only row.
- [ ] Lane 3. Probe `landing.ts:186` (the groups join to `true`) at head on the whole core suite. Save `ba230-groups-probe.png`. Pass when the verdict is `killed` and the failing tests include the groups-only row.
- [ ] Lane 4. Positive control. Probe `one.sensitivity === other.sensitivity` to `true` at `landing.ts:184` on the whole core suite. Save `ba230-positive-control.png`. Pass when the verdict is `killed` and `takes the write-ups along when a re-write narrows a concept` (`visibility.test.ts:562`) is among the failures.
- [ ] Lane 5. Negative control. Run the lane 2 probe at trunk on the whole core suite. Save `ba230-negative-control.png`. Pass when every failure is in `import-direction.test.ts`, so the mutant survives at trunk.
- [ ] Lane 6. Repeat the two new rows ten times in a shell loop over `vitest run test/access/invisibility.test.ts -t "re-write"` at head. Save `ba230-repeat.png`. Pass when all twenty runs pass.
- [ ] Lane 7. Run the whole core suite at head with `pnpm --filter @better-answers/core run test`. Save `ba230-core-suite.png`. Pass when it exits 0.
- [ ] Lane 8. Run `git diff --stat origin/main..HEAD -- packages/core/src packages/schema/src` and `git status --porcelain --untracked-files=all` at head. Save `ba230-src-diff.png`. Pass when both print nothing.
- [ ] Lane 9. Run `pnpm mutant-probe` on the whole core suite at trunk and head for the seven survivors on BA-216 (`visibility.ts:175` and `:215`, `file.ts:113`, `:180` and both mutants at `:238`, `runs/index.ts:102`). Save `ba230-survivors.png`. Pass when each survives at trunk, reading past a failure of the lint walk alone, and each is killed at head by a test this PR adds.
- [ ] Lane 10. Run `vitest run test/concepts/visibility.test.ts test/concepts/sync-cascade.test.ts` at head after the `writeUpIncluding` move. Save `ba230-moved-helper.png`. Pass when both files pass with the same case count as trunk.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The wall time of `pnpm --filter @better-answers/core exec vitest run test/access/invisibility.test.ts`, from vitest's `Duration` line, at trunk and head. No production line changes, so the work the diff adds is the new rows alone.
- [ ] Probe. Three runs interleaved trunk, head, trunk, head, trunk, head, in two worktrees on one Postgres container, with `docker ps` showing no other suite running.
- [ ] Baseline. The trunk median of its three runs, measured first and recorded in the PR body.
- [ ] Rule. Fail when the head median exceeds the trunk median by more than 5 seconds, or when lane 8 shows any `src` change.

**Review gate.** None. BA-230 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Record a concept's owner, and let the owner or an Admin write and decide (BA-231)

**Depends on.** BA-221, merged as #869 (e5825b417). Re-read its landing before the first commit (KTD17). BA-220 too, if it has not merged when BA-231 starts, since both add erasure families to `packages/core/src/erasure/map.ts`. BA-231 adds a migration and runs alone.

**Rules and comments read.** `packages/schema/AGENTS.md` lines 3 and 4. `concept_owner` is created `withRLS()` with its zero-rows test, and every privilege its migration installs lands with a refusal test. `packages/core/AGENTS.md`, *Principal* line 5. The owner check sits beside the data access, inside the act's own transaction. `packages/core/AGENTS.md`, *Audit* lines 9 to 15. Naming an owner writes `knowledge.owner.named` in the same transaction, its detail carries ids alone, and the actor is the kernel's `ActorId`. `CODING_STANDARDS.md` line 27. The owner is never a file key. `CODING_STANDARDS.md` lines 7 to 9. Author proofs go through the concepts entry on a bare repository. Root `AGENTS.md`, *Renames* and *From a worktree, two indexes*. `attachedByIri()` replaces `identityKey` through a GitNexus `rename` dry run applied by hand. The migration runs alone, and each refusal test differs from a valid input in one field. `.claude/skills/mutation-testing/SKILL.md`. `/mutation-testing` runs after green on admission. `docs/agents/code-review.md` line 16, so `/thermos` is not skipped. `.agents/playbooks/knowledge.md`. ADR 0012 and ADR 0014 move in this PR. BA-231, BA-221 and BA-220 have no Linear comments. BA-231's description sets the five criteria. BA-220's description names the `suggestion` and `concept_write_request` gaps this PR leaves to it. BA-221's description and lane 3's note of 21/10 give the landing's shape (KTD17).

**Files.**

- [ ] Edit `packages/schema/src/knowledge/concept-tables.ts`.
- [ ] Edit `packages/schema/src/knowledge/write-up-tables.ts`.
- [ ] Edit `packages/schema/src/table-ownership.ts`.
- [ ] Create `packages/schema/migrations/<next>_the-concept-owner.sql` and its `packages/schema/migrations/meta/` entries, generated.
- [ ] Edit `apps/worker/src/better_answers_worker/schema_view.py`, generated.
- [ ] Edit `packages/schema/test/rls.test.ts`.
- [ ] Create `packages/core/src/concepts/owners.ts`.
- [ ] Edit `packages/core/src/concepts/index.ts`.
- [ ] Edit `packages/core/src/concepts/import/landing.ts`.
- [ ] Edit `packages/core/src/concepts/import/manifest.ts`.
- [ ] Edit `packages/core/src/concepts/writes/suggestions.ts`.
- [ ] Edit `packages/core/src/kernel/vocabulary.ts`.
- [ ] Edit `packages/core/src/erasure/map.ts` and `packages/core/src/erasure/routine/routine.ts`.
- [ ] Edit `packages/core/src/audit/stored-names.ts` and `packages/core/src/audit/headlines.ts`.
- [ ] Edit `apps/web/src/shared/audit/audit-actions.ts` through `pnpm --filter @better-answers/core generate:audit-actions`.
- [ ] Edit `apps/web/src/shared/audit/audit-sentences.ts` and `apps/web/src/shared/audit/audit-details.ts`.
- [ ] Edit `packages/core/test/fixtures/workspace-with-bundle.ts`.
- [ ] Create `packages/core/test/concepts/owners.test.ts`.
- [ ] Edit `packages/core/test/concepts/writes/suggestions.test.ts`, `packages/core/test/concepts/concepts.test.ts`, `packages/core/test/concepts/import/import-bundle.test.ts`, `packages/core/test/concepts/import/manifest.test.ts`, `packages/core/test/erasure/routine/erasure-routine.test.ts` and `packages/core/test/erasure/erasure-map.test.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-knowledge.ts` and `apps/api/tests/ops/concepts.test.ts`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0012.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0014.md`.
- [ ] Edit `docs/specs/route/s3.md` where this unit moves a page. Edit `docs/solutions/architecture-patterns/adr-0051.md` only if the navigation-list decision itself changes.

**Build.**

- [ ] Run GitNexus `impact({target: "identityKey", direction: "upstream"})` and `impact({target: "BUNDLE_WRITERS", direction: "upstream"})`, re-run by `target_uid` if either answers ambiguous, and record the risk in the PR body.
- [ ] Rename `identityKey` to `attachedByIri` with GitNexus `rename` as a dry run, and export it from `packages/schema/src/knowledge/concept-tables.ts`. Apply each listed edit by hand with `Edit`, at `concept-tables.ts:239`, `:304`, `:336` and `:366`. The rename is done when a jCodeMunch `search_text` for `identityKey` comes back empty.
  - [ ] Replace the hand-written `foreignKey` named `write_up_include_identity_fk` at `write-up-tables.ts:38-42` with `attachedByIri(table, "write_up_include_identity_fk")`. The rename does not list this fifth site, because it is a copy and not a call.
  - [ ] Keep each constraint name and `ON DELETE CASCADE`, and add no index inside the helper, so no existing constraint's SQL changes.
- [ ] Add `conceptOwner` to `concept-tables.ts` as `withRLS("concept_owner", ...)` on the concepts slice. Its columns are `workspace_id`, `id`, `collection` (nullable), `iri` (nullable), `person_id` and `created_at`. KTD1 holds a row to one shape.
  - [ ] `concept_owner_one_subject_check` holds `(collection IS NULL) <> (iri IS NULL)`, so a row is a collection default or a per-concept override and never both.
  - [ ] A partial unique index on `(workspace_id, collection) WHERE collection IS NOT NULL` and one on `(workspace_id, iri) WHERE iri IS NOT NULL` give each collection and each concept one owner.
  - [ ] `attachedByIri(table, "concept_owner_identity_fk")` keys the override to `concept_identity`. Postgres skips the check for a collection default, whose `iri` is null.
  - [ ] Export the collection expression `CONCEPT_COLLECTION` (`concept-tables.ts:209`) so the owner read derives a path's collection by the same SQL as the generated column.
- [ ] Add `"public.concept_owner": "concepts"` to `TABLE_OWNERS` in `packages/schema/src/table-ownership.ts`, and a `CROSS_OWNER_TABLE_ACCESS` entry for the erasure slice's read and delete.
- [ ] Generate the migration with `pnpm --filter @better-answers/schema generate`. Grant `app_rt` `SELECT`, `INSERT`, `UPDATE` and `DELETE` on `concept_owner`, and nothing to the worker role. Regenerate the worker view with `pnpm --filter @better-answers/schema generate:worker-view`. Read the generated SQL and confirm it names `concept_owner` alone.
- [ ] Create `packages/core/src/concepts/owners.ts` with `ownerOf(tx, workspaceId, { iri, path })`. One statement answers the override for `iri`, else the default for the path's collection. It joins `member` on `(workspace_id, person_id)`, as `authorFor` (`index.ts:608-628`) does, so a person who left owns nothing and Admins decide. Export it from the concepts face, `packages/core/src/concepts/index.ts`, for BA-236's `knowledge.guide` route, which names a gap's owner.
- [ ] Add `nameOwner(principal, tx, input)` to `owners.ts`, declared `ADMIN_ALONE`. Its input names a collection or an IRI, and a member's person id or none. It upserts or deletes the row and writes `knowledge.owner.named` in the same transaction, its detail holding the subject and the person id. It refuses `not-a-member` for a person outside the workspace. Export it from the concepts face, `packages/core/src/concepts/index.ts`, for BA-12's page and the harness.
- [ ] Add the refusal word `owner-forbids` to `packages/core/src/kernel/vocabulary.ts`, class `forbidden`. A person refused by ownership is told the true reason, and `role-forbids` stays the role's word.
- [ ] Change `writeConceptAction` (`index.ts:276-294`) to admit any member at declaration. Read `ownerOf` inside the act's transaction, beside the member row held `FOR SHARE` (KTD2, ADR 0012 *judged at time of act*), and refuse `owner-forbids` unless the principal is an Admin or the owner. A new concept takes its collection's default owner, since `ownerOf` falls back by path.
  - [ ] Read the owner inside `commitAndLandAsMember`'s transaction (`packages/core/src/concepts/import/landing.ts`, from #869). It holds the member row `FOR SHARE` through the git commit and the landing, so the admission and the rows commit together.
  - [ ] An acceptance passes the same check, against the decider, not the proposer.
- [ ] Change `acceptSuggestionsAction` (`index.ts:641-645`) to read `ownerOf` per decision inside the loop, since a batch spans targets with different owners. A decision the principal does not own is refused `owner-forbids` through the refused-items shape (`packages/core/src/kernel/refused-items.ts`), and the others proceed.
- [ ] Change `declineSuggestionAction` (`suggestions.ts:258-262`) to admit the target's owner or an Admin, read inside its transaction. Widen `returnToProposer` (`suggestions.ts:338`) from `AdminUserPrincipal` to `UserPrincipal`.
- [ ] Delete `BUNDLE_WRITERS` (`manifest.ts:59`) after migrating its two other callers, so no Editor threshold survives. `writeManifestAction` (`manifest.ts:62`) and `importBundleAction` (`index.ts:793`) take `ADMIN_ALONE`. A write across the whole knowledge base names no single owner, and an Editor's import would refuse part-way at the first collection they do not own.
- [ ] Leave `authorFor` (`packages/core/src/concepts/index.ts:606`) and `landAcceptance` (`landing.ts:391-417`) as they are. The proposer stays git author of an accepted *edit*. `decider`, `Actor:` and `bundle_commit.actor` name the deciding owner or Admin (KTD3).
- [ ] Add the erasure family `concept-owner` to `ERASURE_FAMILIES` in `packages/core/src/erasure/map.ts`, category `actor-id`. Its finder selects the subject's `concept_owner` rows through `aboutTheMember`. `routine.ts` deletes them, since a row whose only content is the person has nothing left to keep, and the concept falls back to its collection default or to Admins. The pseudonymised `"user"` row is never deleted (`rls.test.ts:241-260`), so no foreign key does this.
- [ ] Add `knowledge.owner.named` to `STORED_ACT_NAMES` and `headlines.ts`. Regenerate `apps/web/src/shared/audit/audit-actions.ts` with `pnpm --filter @better-answers/core generate:audit-actions`, since its first line says it is generated and never edited. Add the act's sentence, detail keys and labels to `audit-sentences.ts` and `audit-details.ts`.
- [ ] Migrate the tests. `arrangeWorkspace` (`packages/core/test/fixtures/workspace-with-bundle.ts:69-91`) names `scenario.editor` the default owner of each collection the core suites write into, through `nameOwner` as `scenario.admin`, and adds `scenario.unowned`, an Editor who owns nothing.
  - [ ] Run the core suite. Each new failure is a write by an Editor outside those collections. Fix each by naming the owner in that test. Where the test's subject is the Editor, never switch the writer to Admin.
  - [ ] `import-bundle.test.ts` and `apps/api/tests/ops/concepts.test.ts` import as Admin. The case at `import-bundle.test.ts:1191`, "refuses an Editor asked to land the bundle Restricted", becomes the role refusal.
  - [ ] Check that every `seedConcepts` writer in `apps/web/e2e/` is an Admin, since `apps/api/tests/support/harness/harness-knowledge.ts:341` writes as that principal. If one is an Editor, name them owner in the harness seed.
- [ ] Amend ADR 0012. Direct write, accept and decline admit the owner or an Admin, read inside the act's transaction. The import and the manifest are Admin-only. An accepted *edit* commits with the proposer as author, and with the accepter once the proposer has left (`authorFor`'s fallback, now the rule). Replay records a non-Admin decider from `Actor:`.
- [ ] Amend ADR 0014. `concept_owner` is built as KTD1 says, with no row at mint. `attachedByIri()` is exported. The erasure union gains `concept-owner`, and `suggestion` and `concept_write_request` join through BA-220.
- [ ] Record in `docs/specs/route/s3.md` that hiding is navigation only and the api refuses by role or by ownership.

**You see.**

- [ ] An Editor who owns nothing calls `writeConcept` and is answered `{ ok: false, error: "owner-forbids" }`, and `git log --oneline` on the bare repository is unchanged.
- [ ] A Viewer's *edit* is accepted by the collection's owning Editor, and `git log -1 --format='%an <%ae>%n%b'` prints the Viewer's name and email, then `Actor: human:<owner's person id>`.
- [ ] `pnpm --filter @better-answers/schema generate` at head prints no new migration, and `git diff origin/main -- packages/schema/migrations` adds one SQL file naming `concept_owner` alone.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/schema/test/rls.test.ts` gains `returns none unscoped and only the tenant's owners`, under forced RLS and `app_rt`. Run `pnpm --filter @better-answers/schema exec vitest run test/rls.test.ts -t "the tenant's owners"`.
- [ ] `packages/schema/test/rls.test.ts` gains `refuses the worker every read and write of owners`. Run `pnpm --filter @better-answers/schema exec vitest run test/rls.test.ts -t "every read and write of owners"`.
- [ ] `packages/schema/test/rls.test.ts` gains `holds an owner row to one collection or one concept`, refusing a row with both and a row with neither. Run `pnpm --filter @better-answers/schema exec vitest run test/rls.test.ts -t "one collection or one concept"`.
- [ ] `packages/schema/test/rls.test.ts` gains `refuses a second owner for one collection or concept`. Run `pnpm --filter @better-answers/schema exec vitest run test/rls.test.ts -t "a second owner"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `commits an owning Editor's direct write with them as author`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "owning Editor's direct write"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `refuses an Editor owning nothing a direct write`. Its input equals the case above, and only the owner row differs. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "owning nothing a direct write"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `commits a Viewer's direct write on a concept they own`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "a concept they own"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `prefers the concept's own owner to its collection's`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "concept's own owner"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `takes a new concept's owner from its collection`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "new concept's owner"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `leaves a concept nobody owns to Admins`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "nobody owns"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `owns nothing once the owner leaves the workspace`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "leaves the workspace"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `refuses an owner cleared before the write lands`. An Admin clears the row while the owner's write waits on the repository lock, and the write is refused with no commit. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "cleared before the write lands"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `names an owner as Admin alone, with its audit event`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "Admin alone"`.
- [ ] `packages/core/test/concepts/writes/suggestions.test.ts` gains `commits an accepted Viewer edit with the Viewer as author`, beside `:417`, reading `commitFacts`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/suggestions.test.ts -t "Viewer as author"`.
- [ ] `packages/core/test/concepts/writes/suggestions.test.ts` gains `refuses acceptance by an Editor who does not own it`. Its input equals the owner's acceptance, and only the decider differs. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/suggestions.test.ts -t "does not own it"`.
- [ ] `packages/core/test/concepts/writes/suggestions.test.ts` gains `declines as owner, recording the owner as decider`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/suggestions.test.ts -t "owner as decider"`.
- [ ] `packages/core/test/concepts/writes/suggestions.test.ts` gains `decides each batched decision by its own target's owner`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/suggestions.test.ts -t "batched decision"`.
- [ ] `packages/core/test/concepts/import/import-bundle.test.ts` gains `refuses an Editor the import, by role`, and `packages/core/test/concepts/import/manifest.test.ts` gains `refuses an Editor the manifest write, by role`. Each input differs from the Admin's valid import or write in the principal's role alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/import/import-bundle.test.ts test/concepts/import/manifest.test.ts -t "by role"`.
- [ ] `packages/core/test/erasure/routine/erasure-routine.test.ts` gains `rewrites an accepted proposer's author line through the concept file`. Skip this box if BA-220 has merged with its own test of the same line, and cite that test. A Viewer's accepted *edit* is erased, and `authorLinesOf` (`packages/core/test/fixtures/bundle.ts:240-251`) shows the pseudonym in place of the Viewer through the `concept-file` family. Run `pnpm --filter @better-answers/core exec vitest run test/erasure/routine/erasure-routine.test.ts -t "proposer's author line"`.
- [ ] `packages/core/test/erasure/routine/erasure-routine.test.ts` gains `deletes an erased person's owner rows`, and `packages/core/test/erasure/erasure-map.test.ts` gains `finds the owner rows naming the subject`. Run `pnpm --filter @better-answers/core exec vitest run test/erasure/routine/erasure-routine.test.ts test/erasure/erasure-map.test.ts -t "owner rows"`.
- [ ] Break each new test once in the production line it guards, and see it fail. Then run `/mutation-testing` over `owners.ts` and the changed admission lines in `index.ts` and `suggestions.ts`, triaged per `docs/agents/mutation-triage.md`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe. Each lane drives the core interface on a migrated database and a bare repository, and its screenshot is a terminal capture with `git log --format='%an <%ae>%n%b'` and `psql` as the read-only diagnostics.

- [ ] Lane 1. Regression lane against trunk. An Editor who owns nothing writes a new concept at `knowledge/policy/` directly, at trunk and head. Trunk lacks ownership, so record that the write commits there, and gate the head behaviour. Save `ba231-regression.png`. Pass when trunk commits, and head answers `owner-forbids` with the bare repository's head unchanged, while the policy collection's owning Editor commits with their own name as `%an`.
- [ ] Lane 2. An outside Viewer submits an *edit* to a policy concept, and the collection's owning Editor accepts it. Save `ba231-viewer-author.png`. Pass when `%an <%ae>` is the Viewer, the committer is `PLATFORM_BOT`, `Actor:` names the owner, and `suggestion.decider` is the owner's actor id.
- [ ] Lane 3. An Admin names a Viewer owner of one concept by override, and the Viewer edits it directly. Save `ba231-override-owner.png`. Pass when one commit lands with the Viewer as author and an Editor owning that collection is refused `owner-forbids` on the same concept.
- [ ] Lane 4. The owning Editor creates a new concept in their collection, and the Editor who owns nothing tries the same in that collection. Save `ba231-new-concept.png`. Pass when the first commits and the second is refused, with one `concept_index` row in `psql`.
- [ ] Lane 5. A concept in a collection with no owner row. An Editor tries a direct write, then an Admin writes, then an Editor tries to accept a waiting *edit*. Save `ba231-nobody-owns.png`. Pass when both Editor acts are refused `owner-forbids` and the Admin's write commits.
- [ ] Lane 6. The Editor who owns nothing declines a waiting *edit*, then the owner declines it. Save `ba231-decline.png`. Pass when the first is refused and the row stays waiting, and the second sets `status = 'declined'` with `decider` the owner.
- [ ] Lane 7. Judged at time of act. The owner submits an acceptance while an Admin clears their ownership in another session. Save `ba231-time-of-act.png`. Run it ten times, five with the clear issued before the acceptance takes the repository lock and five with the clear issued after the acceptance's `FOR SHARE` read of the member row. Pass when every clear issued before the lock answers `owner-forbids` with no commit, as `refuses an owner cleared before the write lands` does, every clear issued after the read waits and the acceptance commits with the owner as decider, and no run shows a commit with its answer a refusal.
- [ ] Lane 8. The proposer is removed from the workspace before the owner accepts their *edit*. Save `ba231-proposer-left.png`. Pass when the commit's `%an` is the accepting owner, as ADR 0012 now records.
- [ ] Lane 9. Erase the Viewer of lane 2 and an owning Editor through the erasure routine. Save `ba231-erasure.png`. Pass when `git log --format='%an <%ae>'` no longer prints the Viewer's name or email, and `SELECT count(*) FROM concept_owner WHERE person_id = '<erased id>'` returns 0.
- [ ] Lane 10. Run `pnpm --filter @better-answers/schema generate`, then `\d concept_index` and `\d write_up_include` in `psql` at trunk and head, and import a knowledge base through `pnpm ops import-bundle` as an Editor and then as an Admin. Save `ba231-schema-and-import.png`. Pass when no new migration is generated, both tables' foreign keys read the same at trunk and head, the Editor's import is refused, and the Admin's lands.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The median wall time of one governed `writeConcept` re-write and one single-decision `acceptSuggestions`, at 250 concepts, at trunk and head. The work the diff adds is one indexed read of `concept_owner` inside the act.
- [ ] Probe. A case in `packages/core/test/concepts/map-budget.test.ts`, `times one governed write beside its owner read`, seeds 250 concepts with `seedingWith` and times 30 re-writes and 30 acceptances by the collection's Editor, recorded with `recordFigures` (`packages/core/test/support/figures.ts`). Copy the case into a trunk worktree, where any Editor writes, and run trunk, head, trunk, head, trunk, head.
- [ ] Baseline. The trunk medians, measured first, beside the readings row of about 0.9 s for one governed write (`docs/operations/readings.md`).
- [ ] Rule. Fail when either head median exceeds its trunk median by more than 50 ms, or when `EXPLAIN` of the `ownerOf` statement shows a sequential scan on `concept_owner`.

**Review gate.** None. BA-231 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Open the owner-visible pages from the recorded ownership, with Collections and Owners (BA-12)

**Depends on.** BA-231, merged first, for `concept_owner`, `ownerOf` and `nameOwner`.

**Rules and comments read.** `apps/web/AGENTS.md` lines 3 to 5. Collections and Owners meets WCAG 2.2 AA by keyboard and screen reader, naming an owner has a keystroke under `?`, and the page says the glossary's reader words. `packages/design-system/readme.md` section 2, British spelling and UK dates. `packages/core/AGENTS.md`, *Principal* line 5, so the collections read applies the read predicate beside the data, and *Audit* line 16, so the read writes no audit row. `CODING_STANDARDS.md` line 7, so web behaviour is proven on the served build. `.agents/playbooks/verification.md`. Existing specs pass with no assertion edits. The owning and the unowned Editor differ in ownership alone. `.agents/playbooks/knowledge.md`, so a decision this PR moves is edited in this PR. BA-12 has five Linear comments, all read. The owner's ruling of 09/10/2026 sets where an owner of any role decides, Inbox › Waiting on You and Knowledge › Curation, with Control Centre Admin-only. The backlog review of 19/10/2026 names what remains, `readerOf` giving `owns: []` (`navigation.ts:488`). The comments of 30/09, 01/10 and 09/10 record that a Viewer may own, that #493 shipped the role filter, and that BA-36's review found the declared shape. They change nothing beyond the ruling.

**Files.**

- [ ] Edit `packages/core/src/concepts/owners.ts` and `packages/core/src/concepts/index.ts`.
- [ ] Edit `packages/core/src/workspaces/index.ts`.
- [ ] Edit `packages/core/test/concepts/owners.test.ts`.
- [ ] Edit `apps/api/src/trpc/knowledge.ts`.
- [ ] Create `apps/api/tests/trpc/knowledge-owners.test.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-knowledge.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-control.ts`.
- [ ] Edit `apps/web/src/shared/navigation.ts`.
- [ ] Edit `apps/web/src/app/router.tsx` and `apps/web/src/app/shell/frame.tsx`.
- [ ] Edit `apps/web/src/shared/member/member.ts`.
- [ ] Create `apps/web/src/features/knowledge/collections-and-owners-page.tsx`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-api.ts` and `apps/web/src/features/knowledge/knowledge-words.ts`.
- [ ] Edit `apps/web/test/shared/navigation.test.ts`.
- [ ] Edit `apps/web/e2e/harness.ts`.
- [ ] Create `apps/web/e2e/knowledge/collections-and-owners.spec.ts`.
- [ ] Edit `.claude/skills/browser-suite/references/harness.md`.
- [ ] Edit `docs/specs/route/s3.md` where this unit moves a page. Edit `docs/solutions/architecture-patterns/adr-0051.md` only if the navigation-list decision itself changes.

**Build.**

- [ ] Name the data shape first. `Member` (`packages/core/src/workspaces/index.ts:647-651`) gains `owns: { readonly collections: readonly string[]; readonly concepts: number }`, the collections the person holds a default on and the count of concepts they own by override. Both are needed now. Curation opens on a collection, and BA-232's Waiting on You opens on either, so `session.member` takes its final shape once.
- [ ] Add `ownedBy(principal, tx)` to `packages/core/src/concepts/owners.ts`, exported from the concepts face, reading the principal's own `concept_owner` rows joined to `member`. `readMember` (`workspaces/index.ts:661-690`) calls it through `packages/core/src/concepts/index.ts`. `packages/devtools/src/scans/table-ownership-scan.ts` keeps every `concept_owner` read inside the concepts slice.
- [ ] `session.member` (`apps/api/src/trpc/router.ts:49-51`) carries `owns` with no route change. `memberOf` (`router.tsx:296-297`) and `WorkspaceFrame` (`frame.tsx:243`) read it synchronously from the same cached answer, so a page is decided when the person arrives and holds with no second query to wait on.
- [ ] In `apps/web/src/shared/member/member.ts`, add `ownsHeld(queryClient, api)` beside `roleHeld`. Change `readerOf` (`navigation.ts:488`) to take the role and the owns, and `Reader.owns` (`navigation.ts:483-486`) to the `Member` shape.
- [ ] Change `Page.owners` (`navigation.ts:31`) from `true` to `"of-a-collection" | "of-anything"`, and decide it in `sees` (`navigation.ts:501-502`) through one lookup from the arm to its predicate. Every Curation page takes `"of-a-collection"`, which ADR 0051 states as *by owning a collection it serves*. Waiting on You takes `"of-anything"`, so a person who owns one concept by override reaches it once BA-232 builds it (KTD4). Exports keeps `"of-a-collection"` until BA-238 drops the flag (KTD15).
- [ ] Set Collections and Owners (`navigation.ts:157-164`) `built: true` and add its `BUILT_PAGES` entry (`router.tsx:104`), so the Curation group exists for an Admin and for an owner of a collection.
- [ ] Add `collectionsAndOwners(principal, tx)` to `owners.ts`. It admits an Admin or an owner of a collection, and refuses anyone else `owner-forbids`. It lists each collection that holds a concept the reader may read, under `readableClause` on `concept_index`, with its default owner and its per-concept overrides. A collection whose every concept the reader cannot read is absent, so its name does not reach them. It writes no audit row.
- [ ] Add `knowledge.collections` (query) and `knowledge.nameOwner` (mutation over BA-231's `nameOwner`) to `knowledgeRouter` in `apps/api/src/trpc/knowledge.ts`. The members for the owner picker come from the members read the Members page already uses, which an Admin alone reaches.
- [ ] Build `collections-and-owners-page.tsx` under `PageHead`, as `apps/web/test/shared/page/page-head.test.tsx` requires. One list row per collection holds its name, its owner and its override count. The page's head holds the heading and summary, and the list's row holds the count and the primary action.
  - [ ] An Admin names or clears a collection's owner with a native select of every member, Viewers included, since a Viewer may own (ADR 0051). It applies optimistically, announces the outcome in a live region, and invalidates the member query so the Admin's own rail updates at their next move.
  - [ ] An owner who is not an Admin reads the same list with no picker.
  - [ ] The page serves the Founder-Operator, who hands domains off "until someone else takes them" (`docs/personas/personas.md:45`), so each row shows who owns it now and an unowned collection says Admins decide. It serves the Knowledge Curator, for whom "unclear who owns a concept" is a cut (`:205`), so each override count is on the row. It serves the Occasional Expert, a Viewer who owns (`:218`), so the picker lists Viewers and the read-only view uses no product word without its explanation.
- [ ] Add the harness action `nameOwners`, the program's one owner seed. It writes collection-default and per-concept owner rows. Its function goes in `apps/api/tests/support/harness/harness-knowledge.ts` and calls `nameOwner` as the workspace's Admin. Its route goes in `apps/api/tests/support/harness/harness-control.ts`, beside the routes at `harness-control.ts:161-177`, and its wrapper in `apps/web/e2e/harness.ts`. BA-232 and BA-236 reuse it. List it in `.claude/skills/browser-suite/references/harness.md`.
- [ ] An Editor who owns nothing sees no Curation group, and `/knowledge/collections-and-owners` shows the not-found page through `hides` (`navigation.ts:578-579`) and `Seen` (`router.tsx:346-349`). This is the brief's third Done when check.
- [ ] Record in `docs/specs/route/s3.md` that ownership has landed. A page is seen by role, by owning a collection, or, for Waiting on You, by owning any concept. An ownership change takes effect at the person's next move, like a role change. Hiding is navigation only, and the api refuses by role or by ownership.
- [ ] Leave `apps/web/e2e/app/frame.spec.ts:52` and `apps/web/test/shared/navigation.test.ts:60-80` unedited. Waiting on You stays unbuilt, so `shownOf` still drops Inbox from every rail, and no page is declared or renamed. `AREA_NAMES` changes in BA-232, and the outline in BA-239. The cases at `navigation.test.ts:240-270` and the `aPage` helper (`:48-55`) change, since `owns` and `owners` change shape.

**You see.**

- [ ] An Editor named owner of `policy` signs in. The Knowledge menu shows Browse with Search, then Curation with Collections and Owners.
- [ ] An Editor who owns nothing sees Knowledge with Browse alone. At `/knowledge/collections-and-owners` the frame shows the heading "Page Not Found", the breadcrumb names it, and the page offers their home, Ask › New Question.
- [ ] An Admin names a Viewer owner of `policy` on Collections and Owners. The row shows the Viewer's name at once, and the Audit Log shows the `knowledge.owner.named` sentence.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/web/test/shared/navigation.test.ts` gains `shows Curation to an owner of any collection`. Run `pnpm --filter @better-answers/web exec vitest run test/shared/navigation.test.ts -t "owner of any collection"`.
- [ ] `apps/web/test/shared/navigation.test.ts` gains `hides Curation from an Editor owning nothing`. Its reader equals the case above with `owns` emptied. Run `pnpm --filter @better-answers/web exec vitest run test/shared/navigation.test.ts -t "Editor owning nothing"`.
- [ ] `apps/web/test/shared/navigation.test.ts` gains `opens Waiting on you, not Curation, to a concept's owner`. Run `pnpm --filter @better-answers/web exec vitest run test/shared/navigation.test.ts -t "concept's owner"`.
- [ ] `apps/web/test/shared/navigation.test.ts` gains `shows the not-found page at Curation to the unowned`, through `hides`. Run `pnpm --filter @better-answers/web exec vitest run test/shared/navigation.test.ts -t "not-found page at Curation"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `answers the member's owned collections and concept count`, through `readMember`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "owned collections and concept count"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `lists only collections the reader may read`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "collections the reader may read"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains `refuses an Editor owning nothing the collections read`. Its reader differs from the owning Editor's valid read in ownership alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "owning nothing the collections read"`.
- [ ] `apps/api/tests/trpc/knowledge-owners.test.ts` gains `carries the owner's collections on the member read`, `refuses an Editor naming an owner, by role` and `names an owner and answers the new list`, through `server.request`. The refused call differs from the Admin's valid naming in the caller's role alone. Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/knowledge-owners.test.ts`.
- [ ] Break each new test once in the production line it guards, and see it fail. Run `/mutation-testing` over `sees` and `collectionsAndOwners`, since both decide visibility.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe. Every lane drives the served build through `apps/web/e2e/knowledge/collections-and-owners.spec.ts` unless it names another spec, seeding with `provision`, `addMember`, `seedConcepts` and the new `nameOwners`, and signing in with `signIn`.

- [ ] Lane 1. Regression lane against trunk. An Editor whom the seed names owner of `policy` signs in and opens the Knowledge menu, at trunk and head. Trunk lacks ownership and the page, so record that its menu shows Browse alone and `nameOwners` does not exist, and gate the head behaviour. Save `ba12-regression.png`. Pass when head's menu shows Curation with Collections and Owners and the page lists `policy` with the Editor as owner within one second.
- [ ] Lane 2. An Editor who owns nothing, in the same workspace, opens the Knowledge menu. Save `ba12-unowned-menu.png`. Pass when the menu shows Browse alone and the rail's aria snapshot equals the one at `apps/web/e2e/app/home.spec.ts:104-118`.
- [ ] Lane 3. The Editor who owns nothing types `/knowledge/collections-and-owners`. Save `ba12-unowned-not-found.png`. Pass when the frame shows the heading "Page Not Found", the breadcrumb names it, and the page offers Ask › New Question.
- [ ] Lane 4. An Admin opens Collections and Owners and names the Viewer owner of `policy` with the picker. Save `ba12-admin-names.png`. Pass when the row shows the Viewer's name within the action budget, through `theActionLandedWithinItsBudget`, and the Audit Log page shows the naming sentence.
- [ ] Lane 5. The Viewer named in lane 4 signs in. Save `ba12-viewer-owner.png`. Pass when the Viewer's rail shows Knowledge with Curation, the page lists `policy` with their own name as owner, and no picker is drawn.
- [ ] Lane 6. A collection `held` whose every concept is seeded Restricted. The owning Editor of `policy` and the Admin each open Collections and Owners. Save `ba12-predicate.png`. Pass when the Editor's list lacks `held` and the Admin's list shows it.
- [ ] Lane 7. The Admin names and clears an owner by keyboard alone, and opens `?`. Save `ba12-keyboard.png`. Pass when every step is reached by Tab and Enter, `listsItsKeystrokes` finds the naming keystroke, and the axe fixture passes in light and dark.
- [ ] Lane 8. An Admin clears the Editor's ownership of `policy` while the Editor is on Collections and Owners, and the Editor then moves to Search and back. Save `ba12-mid-visit.png`. Pass when the page stays drawn until the move, and after it the menu lacks Curation and the address shows "Page Not Found".
- [ ] Lane 9. The Editor who owns nothing calls `knowledge.collections` and `knowledge.nameOwner` directly through the Playwright request context. Save `ba12-api-refuses.png`. Pass when both answer forbidden, with `owner-forbids` and `role-forbids`, and no `concept_owner` row changes.
- [ ] Lane 10. Run `apps/web/e2e/app/frame.spec.ts`, `apps/web/e2e/app/home.spec.ts`, `apps/web/e2e/knowledge/concept-page.spec.ts` and `apps/web/e2e/knowledge/knowledge-search.spec.ts` at head. Save `ba12-existing-specs.png`. Pass when all pass with no assertion edited and `AREA_NAMES` still reads Ask, Knowledge, Control Centre.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Three figures. The first is the server time of `session.member` at trunk and head, since every page's arrival waits on it. The second is the time from arrival to the rendered list on Collections and Owners, under the one-second list budget. The third is the naming action's optimistic apply, under the 100 ms action budget.
- [ ] Probe. 200 `session.member` calls through `server.request` in the api harness, run trunk, head, trunk, head, trunk, head. The page's list timed as `knowledge-search.spec.ts:1015` times Search's, and the action by `theActionLandedWithinItsBudget`, on the served build.
- [ ] Baseline. The trunk median of `session.member`, measured first. Trunk has no page, so the list and the action take the absolute budgets.
- [ ] Rule. Fail when the head median of `session.member` exceeds trunk's by more than 5 ms, when the list renders in 1,000 ms or more with 20 collections seeded, or when the action's median reaches 100 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 3, 4 and 5 screenshots into `docs/plans/media/s3/ba12-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `docs/plans/media/s3/ba12-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Edit a concept from its raw file through one write route (BA-95)

**Depends on.** BA-231.

**Rules and comments read.** `CODING_STANDARDS.md` Tests line 7 (each proof goes through `@better-answers/core/concepts` or the api's `server.request`, never a git helper), line 8 (a real bare repository and a migrated database), line 9 (assert the refusal and the rows before any returned value), Code line 14 (every new function returns a `Result`), and Domain line 27 (the edit adds no owner, collection or projected key to the file). `packages/core/AGENTS.md` Principal line 5 (the owner read sits beside the data, inside the act's transaction), Audit lines 9, 12 and 14 (the commit's event, named `family.subject.verb`, with no email or body text in detail) and line 16 (by analogy, a save that writes nothing writes no audit row, inferred). `packages/schema/test/support/test-title.ts` (titles of 10 words at most). Each test is broken once, and a refusal input is one field from a valid one. `.claude/skills/mutation-testing/SKILL.md` (`/mutation-testing` on this parse and admission change). `.agents/playbooks/knowledge.md` (ADR 0012 moves in this PR). BA-95, BA-126 and BA-127 have no comments (`list_comments`, 21/10/2026), so their descriptions set the criteria. This PR closes all three with `Fixes BA-95`, `Fixes BA-126` and `Fixes BA-127`.

**Files.**

- [ ] Create `packages/core/src/concepts/writes/edit.ts`.
- [ ] Edit `packages/core/src/concepts/index.ts`.
- [ ] Edit `packages/core/src/concepts/import/landing.ts`.
- [ ] Edit `packages/core/src/concepts/writes/reconciler.ts`.
- [ ] Edit `packages/core/src/concepts/reading/read.ts`.
- [ ] Edit `packages/core/src/concepts/import/loader.ts`.
- [ ] Edit `packages/core/src/concepts/vocabulary.ts`.
- [ ] Edit `apps/api/src/trpc/knowledge.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-knowledge.ts`.
- [ ] Edit `packages/core/test/fixtures/sourced-concept.ts`.
- [ ] Create `packages/core/test/concepts/writes/concept-edit.test.ts`.
- [ ] Create `packages/core/test/concepts/writes/edit-budget.test.ts`.
- [ ] Edit `packages/core/test/concepts/reading/concept-read.test.ts`.
- [ ] Edit `packages/core/test/concepts/writes/reconciler.test.ts`.
- [ ] Edit `packages/core/test/concepts/writes/suggestions.test.ts`.
- [ ] Edit `packages/core/test/gates/refusal-words.test.ts`.
- [ ] Edit `apps/api/tests/trpc/knowledge-procedures.test.ts`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0012.md`.

**Build.**

- [ ] Add `conceptToEdit(principal, tx, asked)` to `packages/core/src/concepts/writes/edit.ts`, where `asked` is `{ iri }` or `{ collection }`. For an IRI it reads the raw row through `conceptByIri` (`index.ts:1235`) and resolves its sources through `resolvedSourcesOf` (`read.ts:175`) under the editing principal. It never calls `readConcept`, `open` or the tRPC read (KTD6). It answers the parts the client edits (title, kind, description, tags, body), each source entry whose `opens` is true as written, the count and labels of the entries whose `opens` is false, `base` (the row's `content_hash`), `standing` (`commits` or `suggests`, from the owner-or-Admin predicate BA-231 puts on `writeConceptAction`) and `usedIn` (the count the next box names). For a collection it answers `standing` against that collection's default owner (KTD2) and empty parts.
- [ ] Add `placesUsing(tx, iri)` to `edit.ts`. It counts `write_up_include` rows naming the IRI plus inbound `LINKS_TO_LABEL` edges in the live generation, with the shape of the query at `store/map/index.ts:296`, in one statement (KTD9). It counts every place, readable or not, and names none. `existingOf` (`index.ts:431`) calls it inside the act's own transaction, and `conceptToEdit` calls it for `usedIn`.
- [ ] Add `reuse?: "confirmed"` to `WriteConceptInput` (`index.ts:243`) and the word `reuse-unconfirmed` to `writeConceptAction.refuses`. A new row in `WRITE_REFUSALS` (`index.ts:464`) refuses a direct write when `placesUsing` exceeds one and `reuse` is absent. The write's own count is the one that decides. The read's `usedIn` only words the ask.
- [ ] Add `saveConcept(principal, doors, input)` to `edit.ts`, declared as `saveConceptAction` with `ANY_ROLE`. Its input holds the edited parts, the visible source list, `base`, `reuse` and either an `iri` or a `collection`. It holds no author. It reads the stored file with `fileAt` (`store/git/index.ts:573`) at the held `commit_sha`, parses it with the loader's `parsedConcept` (`loader.ts:248`, exported for this), and rebuilds `sources` with `mergedSources(stored, visible, opens)`. That walk keeps each entry the editor cannot open where it stood, fills the open slots from the client's list in order, and appends the client's extra entries. It signs with `authorOf(principal, tx, principal.userId)` (`loader.ts:343`).
- [ ] Fork inside `saveConcept` on the owner-or-Admin predicate, read in the act's transaction (KTD2). An owner or an Admin reaches `writeConcept` with `expects: { base }`. Anyone else reaches `submitSuggestionSet` (`suggestions.ts:182`) with one item of kind `edit`, whose payload is the merged raw file and whose `base_content_hash` is `base`. The answer is `{ outcome: "committed", iri, sha }`, `{ outcome: "unchanged", iri }` or `{ outcome: "suggested", suggestionId }`.
  - [ ] The fork's read only routes the save. `writeConcept` reads the owner again inside its own transaction (BA-231), and that read decides. When it answers `owner-forbids`, `saveConcept` sends the same merged file to `submitSuggestionSet` in the same act. A saver whose ownership an Admin clears between the two reads therefore gets a suggestion, never a refusal.
- [ ] Land a new concept from `{ collection }` at `newConceptPathOf(collection, title)` in `edit.ts`, which folds the title to a slug under `knowledge/<collection>/` and checks it against `conceptPathOf`'s rule (`loader.ts:240`). `path-taken` and `merge-key-taken` refuse as they do today. The collection is the path's first folder, as `CONCEPT_COLLECTION` (`packages/schema/src/knowledge/concept-tables.ts:209`) derives it, so no file key is added.
- [ ] Hold `sources` and the evidence rows to one list (KTD5, BA-127). Remove `WriteConceptInput.evidence` and `EvidenceInput` (`index.ts:225`). `commitConcept` (`index.ts:327`) derives the evidence rows from `hashedFileOf(...).sources` through a new `evidenceOfSources`, so a source naming a document becomes a row and `no-such-document` still refuses one the catalogue lacks. A source naming a concept stays a graph edge and never becomes a row. `landRows` (`landing.ts:318`) reads `Landing.sources`, which it ignores today. Migrate every caller that passes `evidence` into a write in this PR. Read on the worktree, they are `apps/api/tests/support/harness/harness-knowledge.ts:363`, where `citationsOf` feeds `evidence`, and the shared seed helper `packages/core/test/fixtures/sourced-concept.ts:257` and `:286`, which BA-230 also edits. `importBundle` (`index.ts:1003`, `:1085`) and `erasure/rehearsal.ts:171` call `writeConcept` without `evidence`, so they need no change. Confirm the list with a jCodeMunch `search_text` for `evidence:`, reading each hit in context, since most `evidence: [` literals in the core tests are expectations on read output, not write inputs.
- [ ] Replay a commit's evidence from its file. The reconciler (`reconciler.ts:333`) derives the rows the same way, and `fileCitesTheStandingEvidence` (`reconciler.ts:184-205`) goes, since the two lists can no longer differ.
- [ ] Recheck labels at write (KTD7, BA-126). `saveConcept` refuses with `source-label-refused` a string source whose whole text parses as a wire locator through `parseLocator` (`packages/core/src/sources/passages.ts`). It refuses with `body-locator-refused` a body that holds a passage locator outside `sources`. `labelOf` (`read.ts:118`) shows a fixed withheld label in place of a raw `resource` that is a concept IRI the reader cannot open. `placeOf` (`read.ts:141`) stays as it is, because the platform writer now refuses the shapes it would pass.
- [ ] Name no sharer for an unwritten concept (BA-127, third criterion). `resolvedOf` (`read.ts:154`) marks a concept source whose IRI `concept_identity` never minted as pointing at nothing, so `paneOf` (`read.ts:246`) leaves `sharedBeyondEvidence` undefined when that source is the only one unopened.
- [ ] Register `reuse-unconfirmed`, `source-label-refused` and `body-locator-refused` in `packages/core/src/concepts/vocabulary.ts` with the class `inapplicable`, and list them in `packages/core/test/gates/refusal-words.test.ts`.
- [ ] Write no commit for an unchanged direct save (KTD8). In `writeUnderLock` (`index.ts:386`), after `existingOf` and the `stale-precondition` check, compare `renderConceptFile(frontmatter, body)` (`concepts/file.ts:106`) with `renderConceptFile` of the stored file parsed by `parsedConcept`. When the two strings are equal, answer the held SHA as `unchanged` and write no commit, no audit row and no landing. The check runs only when `input.acceptance` is absent, so an acceptance still decides its suggestion.
- [ ] Check KTD8 against `renderConceptFile`. KTD8 says the serialised file equals the stored file byte for byte. `renderConceptFile` writes every key as JSON, so a hand-written imported file never equals its own render. Comparing two renders keeps KTD8's text equality and stops the first unchanged save of an imported concept from writing a commit. Record the finding in ADR 0012.
- [ ] Add `standingOn(principal, tx, iri)` to `edit.ts`, which answers `commits` or `suggests` from BA-231's owner-or-Admin predicate. The tRPC `knowledge.open` route in `apps/api/src/trpc/knowledge.ts` adds its answer as `standing` beside the core's answer, in the same transaction and the same counted read. Core's `open` and its `OpenResult` stay as the MCP surface reads them. A page view therefore costs one counted read, as it does today, and `says the reads' ceiling and asks no more` (`apps/web/e2e/knowledge/concept-page.spec.ts:720`) keeps its assertions.
- [ ] Add `conceptToEdit` as a query on `knowledgeReadProcedure` and `saveConcept` as a mutation on `ownTransactionProcedure` (`apps/api/src/trpc/base.ts:313`) in `apps/api/src/trpc/knowledge.ts`. The mutation takes its git door through `doorTold` (`apps/api/src/doors.ts:67`). Its input schema is a strict object with no author field, parsed with `parsedBy`, so the author always comes from the principal through `authorOf`.
- [ ] Edit ADR 0012's live doc to record KTD5 (one list), KTD6 (the raw seed and the kept withheld entries), KTD7 (labels at write), KTD8 (round-trip equality of two renders, direct writes only) and KTD9 (the count and the ask).

**You see.**

- [ ] `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts` passes, and `git log -1 --format='%an <%ae>'` on the scenario's bare repository names the saving person.
- [ ] An unchanged save answers `{ outcome: "unchanged" }`, and `git rev-list --count HEAD` reads the same before and after it.
- [ ] A Viewer's save on a concept they do not own answers `{ outcome: "suggested" }`, and `SELECT kind, status FROM suggestion` shows one `edit` row, `waiting`.
- [ ] A save of a concept used in two places without `reuse` answers the refusal `reuse-unconfirmed`, and the same save with `reuse: "confirmed"` commits.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `keeps a withheld source's locator through a save`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "keeps a withheld source's locator through a save"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `writes no commit and no audit for an unchanged save`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "writes no commit and no audit for an unchanged save"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `a body whitespace-only change still commits`. Its input differs from the unchanged save in one trailing space of the body, so it proves the two-render comparison keeps whitespace a reader sees. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "a body whitespace-only change still commits"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `writes no commit re-saving an imported file unchanged`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "writes no commit re-saving an imported file unchanged"`.
- [ ] `packages/core/test/concepts/writes/suggestions.test.ts` gains `still decides an acceptance whose payload equals the file`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/suggestions.test.ts -t "still decides an acceptance whose payload equals the file"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `derives evidence rows from the file's sources alone`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "derives evidence rows from the file's sources alone"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `refuses a bare wire locator as a string source`, whose input differs from a valid save in that one entry alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "refuses a bare wire locator as a string source"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `refuses a passage locator in the body outside sources`. Its input differs from a valid save in one locator added to the body alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "refuses a passage locator in the body outside sources"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `counts write-up includes and inbound links as places`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "counts write-up includes and inbound links as places"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `refuses a reused concept's save until confirmed`, whose input differs from the committing save in `reuse` alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "refuses a reused concept's save until confirmed"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `turns an outsider's save into an edit suggestion`, whose saver differs from the owner's case in ownership alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "turns an outsider's save into an edit suggestion"`.
- [ ] `packages/core/test/concepts/writes/concept-edit.test.ts` gains `lands a new concept at its collection's path`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/concept-edit.test.ts -t "lands a new concept at its collection's path"`.
- [ ] `packages/core/test/concepts/reading/concept-read.test.ts` gains `labels a withheld concept source with the withheld words`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/reading/concept-read.test.ts -t "labels a withheld concept source with the withheld words"`.
- [ ] `packages/core/test/concepts/reading/concept-read.test.ts` gains `names no sharer when only an unwritten concept is unopened`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/reading/concept-read.test.ts -t "names no sharer when only an unwritten concept is unopened"`.
- [ ] `packages/core/test/concepts/writes/reconciler.test.ts` gains `replays a commit's evidence rows from its file`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/reconciler.test.ts -t "replays a commit's evidence rows from its file"`.
- [ ] `apps/api/tests/trpc/knowledge-procedures.test.ts` gains `signs a save as the signed-in person, never the client`. Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/knowledge-procedures.test.ts -t "signs a save as the signed-in person, never the client"`.
- [ ] `apps/api/tests/trpc/knowledge-procedures.test.ts` gains `answers each reader's standing beside the concept read`, whose two readers differ in ownership alone. Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/knowledge-procedures.test.ts -t "answers each reader's standing beside the concept read"`.
- [ ] Break each new test once in the production line it guards and see it fail. Record the line and the failure in the PR body.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/concepts.test.ts test/concepts/writes/suggestions.test.ts test/concepts/import/import-bundle.test.ts test/concepts/writes/reconciler.test.ts test/erasure/erasure-rehearsal.test.ts` at trunk and at head. Trunk has no `saveConcept` and no `knowledge.saveConcept`, so record that and gate the save route's commit plus the end state the user waits for, a commit whose author line names the saving person. Save `ba-95-regression.png`. Pass when every case passes at both, and `git diff <trunk>..<head> -- packages/core/test/concepts/concepts.test.ts packages/core/test/concepts/writes/suggestions.test.ts packages/core/test/concepts/import/import-bundle.test.ts | grep -E '^[-+].*expect\('` prints only lines from cases that asserted rows written from the removed `evidence` input, each case named in the PR body.
- [ ] Lane 2. An Editor who owns the `policies` collection saves a title change on a concept that cites a Restricted passage they cannot open, through `saveConcept` on the core interface. Save `withheld-source-kept.png`. Pass when `git show HEAD:<path>` holds the withheld entry's `locator` and `resource` exactly as the previous commit did, and the title line is the new one.
- [ ] Lane 3. An Admin opens a concept with `conceptToEdit` and saves its parts back unchanged. Save `unchanged-save.png`. Pass when the answer is `unchanged`, `git rev-list --count HEAD` is the same before and after, and `SELECT count(*) FROM audit_event` is the same before and after.
- [ ] Lane 4. Import a hand-written concept with `pnpm ops import-bundle`, then an Admin saves it unchanged through `saveConcept`. Save `imported-unchanged.png`. Pass when the answer is `unchanged` and `git log --oneline -1` still shows the import's commit.
- [ ] Lane 5. An outside Viewer, who owns nothing, saves a body change to a concept in `policies`. Save `viewer-suggests.png`. Pass when the answer is `suggested`, `git rev-list --count HEAD` is unchanged, and `psql` shows one `edit` suggestion `waiting` whose `concept_write_request.base_content_hash` equals the `base` the Viewer read.
- [ ] Lane 6. An Admin accepts lane 5's suggestion with `acceptSuggestions`. Save `viewer-author.png`. Pass when `git log -1 --format='%an <%ae>%n%cn <%ce>'` names the Viewer as author and the platform bot as committer.
- [ ] Lane 7. Seed a concept that one write-up includes and one other concept links to, then an Admin saves a change without `reuse` and again with `reuse: "confirmed"`. Save `reuse-asked.png`. Pass when the first save answers `reuse-unconfirmed` with no commit, and the second answers `committed`.
- [ ] Lane 8. An Admin saves a string source whose whole text is a wire locator, then a body holding a passage locator outside `sources`. Save `labels-refused.png`. Pass when the answers are `source-label-refused` and `body-locator-refused`, and `git rev-list --count HEAD` is unchanged after both.
- [ ] Lane 9. An Admin saves a concept whose `sources` gain a document the catalogue holds, then the reconciler replays a copy of that commit into a fresh database. Save `evidence-one-list.png`. Pass when `SELECT source_document_id, locator FROM concept_evidence` lists exactly the file's document sources in both databases.
- [ ] Lane 10. Over tRPC through the api's test harness, an Editor who owns the collection calls `knowledge.saveConcept` once with an `author` field naming someone else and once without it. Save `author-from-principal.png`. Pass when the first call is answered `malformed`, the second commits, and `git log -1 --format='%an <%ae>'` names the Editor.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The median and p95 wall time, in ms, of one direct `writeConcept` edit on a knowledge base of 250 concepts at trunk and at head. At head alone, the `saveConcept` round trip and the `placesUsing` count, timed apart, because trunk has neither.
- [ ] Probe. `packages/core/test/concepts/writes/edit-budget.test.ts` seeds 250 concepts with `seedingWith` and a committed tree, as `seedWideMap` in `packages/core/test/answering/analysed-map.test.ts` does, then times 20 edits and reports through `recordFigures` (`packages/core/test/support/figures.ts`) under the heading `the governed edit at 250 concepts`. Copy its `writeConcept` case alone into the trunk worktree. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/edit-budget.test.ts` in the trunk worktree and the head worktree in turn, three times each.
- [ ] Baseline. Measure trunk first. Record its median beside the reading in `docs/operations/readings.md`, which puts one governed write at about 0.9 s.
- [ ] Rule. Fail when head's median `writeConcept` exceeds trunk's by more than 10%, when the median `saveConcept` exceeds 1,100 ms, or when the p95 of `placesUsing` exceeds 20 ms.

**Review gate.** None. BA-95 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Edit a concept on its own page (BA-144)

**Depends on.** BA-95.

**Rules and comments read.** `apps/web/AGENTS.md` line 3 (WCAG 2.2 AA, a named `textbox`, each outcome announced, GOV.UK warning text for the consequence), line 4 (each action has a keystroke listed under `?`) and line 5 (page text in the glossary's reader words). `packages/design-system/readme.md` section 2 (trust words verbatim, UK long-form dates). `.claude/skills/better-answers-design/readme.md`, *Disclosure, not layers* (a modal only for an irreversible action, so the editor and its ask draw in place). `CODING_STANDARDS.md` Dependencies lines 31 and 32 (Tiptap's and CodeMirror's versions from Context7, named in the PR, pinned once). `.agents/playbooks/verification.md` (the existing concept page specs pass with no assertion edits). `.claude/skills/browser-suite/SKILL.md`. ADR 0015 L38 with archived ADR 0015 L8, L19 and L27 (source mode, explicit save, a client draft, Tiptap 3 and CodeMirror 6). BA-144's comment of 20/10/2026 says criteria 1 and 2 shipped in #825 (`c537c16e6`) and that `apps/web/test/shared/page/page-head.test.tsx` refuses an `h1` outside `PageHead`. This PR closes criterion 3 and the issue with `Fixes BA-144`, and leaves that test unchanged. The same comment says Search has no primary action. This PR keeps it that way and offers a new concept from Search's no-match state instead. BA-144's comment of 19/10/2026 says criterion 3 waits on S3, which this PR is.

**Files.**

- [ ] Edit `apps/web/src/features/knowledge/concept-page.tsx`.
- [ ] Create `apps/web/src/features/knowledge/concept-editor.tsx`.
- [ ] Create `apps/web/src/features/knowledge/markdown-round-trip.ts`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-api.ts`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-state.ts`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-words.ts`.
- [ ] Edit `apps/web/src/features/knowledge/search-page.tsx`.
- [ ] Edit `apps/web/package.json`.
- [ ] Create `apps/web/e2e/knowledge/concept-editor.spec.ts`.
- [ ] Create `apps/web/test/knowledge/markdown-round-trip.test.ts`.
- [ ] Create `apps/web/test/knowledge/concept-actions.test.tsx`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0015.md`.
- [ ] Edit `docs/specs/route/s3.md` where this unit moves a page. Edit `docs/solutions/architecture-patterns/adr-0051.md` only if the navigation-list decision itself changes.

**Build.**

- [ ] Put the concept's actions on `Header` (`concept-page.tsx:100-128`), beside the `h2` that holds the concept's title, not on `PageHead`. The actions act on the concept, and `Header` is what names it, with its kind, its trust word and its title. `PageHead` (`apps/web/src/shared/page/page-head.tsx:9-28`) has no action slot, and its `h1` reads the group's name, "Browse", through `BROWSE.name` (`concept-page.tsx:396`), so actions there would sit beside a word that names no concept. A detail page's actions go on its own head, and the detail's own head is the concept's title block. `MemberHeader` (`apps/web/src/features/people/members/member-page.tsx:142-163`) already draws a detail's title block this way. The toolbar stays tabs alone, so no detail route gains `staticData` (`router.tsx:448`).
- [ ] Shape the editor for three personas from `docs/personas/personas.md`. The Occasional Expert finds that "flagging or suggesting takes more than one short step" is a cut (`:259`), so *Suggest an edit* is one press away from the concept. The Commercial Controller owns figures and is cut by "a figure shows no source" (`:401`), so the editor keeps every source in one list with the body and states the consequence before it commits. The Knowledge Curator types concepts and works suggestions (`:187`, `:203`), so the editor names what a save does in words.
- [ ] Draw one button in `Header` from the `standing` that `knowledge.open` now answers. It reads *Edit* when `standing` is `commits` and *Suggest an edit* when it is `suggests`. A Viewer who owns the concept sees *Edit*, because standing comes from ownership, not role. Fetch `knowledge.conceptToEdit` in `knowledge-api.ts` only when the button is pressed, so a page view stays one counted read.
- [ ] Add `ConceptEditor` in `concept-editor.tsx`. It opens in place below `Header`, as a region with no address, because `detailIn` in `apps/web/src/shared/navigation.ts` allows one detail segment and no deeper. Focus moves to its heading. It edits the title, kind, description, tags, body and the sources the reader can open. Sources the reader cannot open draw as one read-only line, `N sources you cannot open stay as they are`, and the client never holds them (KTD6).
- [ ] Draw visual mode with Tiptap 3 and its markdown extension, and source mode with CodeMirror 6 and `@codemirror/lang-markdown` (KTD13). Read each version from Context7 at build time, pin it once in `apps/web/package.json`, and name the source in the PR body. Load both through `React.lazy` when the editor opens, so the concept page's first chunk does not grow.
- [ ] Add `losesMarkdown(body)` to `markdown-round-trip.ts`. It parses and serialises the body through the Tiptap markdown extension and compares the result with the body. When they differ, the editor opens in source mode and says `This text uses markdown the visual editor would change, so it opens as markdown.`
- [ ] State the consequence before every save, as GOV.UK warning text inside the editor, never a modal. It reads `Saving changes this concept for everyone who reads it.` When `usedIn` exceeds one, it adds `It is used in N places, and each one will show the change.` and asks once, with *Save* and *Keep editing*. A confirmed save sends `reuse: "confirmed"`. A `reuse-unconfirmed` refusal, which means a place was added meanwhile, draws the ask again with the new count.
- [ ] Announce each outcome in a `status` region. `committed` reads `Saved.` and redraws the concept. `unchanged` reads `Nothing changed, so nothing was saved.` `suggested` reads `Your suggestion is waiting for the concept's owner to decide.` `stale-precondition` reads `This concept changed after you opened it.` and offers to reload it.
- [ ] Keep a client draft in `sessionStorage`, keyed by the IRI, restored when the editor reopens. Confirm before leaving with unsaved changes through `useBlocker` from `@tanstack/react-router` (KTD13).
- [ ] Add keys to open the editor, switch between visual and source mode, save, and leave a text field that captures Tab. Keep them apart from `CONCEPT_KEYSTROKES`' back, sources and links (`knowledge-state.ts:11`), and list them under `?`.
- [ ] Offer a new concept from Search's no-match state in `search-page.tsx`, as `Type it as a new concept`, with the query as the title. Search's address fields in `knowledge-state.ts` (beside `search`, `knowledge-state.ts:24`) gain `new` (the title), `collection`, `kind`, `tags` and `subject` (an IRI the body links on first render), which open the same editor, prefilled. `ConceptEditor` reads all five, so BA-236's **Add This Fact** can link a missing fact straight to it with its kind, tag, collection and subject. The collection is chosen from `readableCollections` (`packages/core/src/concepts/index.ts:1459`), and `standing` comes from `conceptToEdit({ collection })`.
- [ ] Edit ADR 0015's live doc to record KTD13. The editor is Tiptap 3 with CodeMirror 6 for source mode, a lossy body opens in source mode, a save is explicit, and a client draft confirms before leaving.
- [ ] Record that the concept page's actions sit on the concept's own header beside its title, the page head keeps the group's name, and the toolbar carries tabs alone. The rule of 10/10/2026 stands.

**You see.**

- [ ] An Admin on `/knowledge/search/<ulid>` sees *Edit* inside the concept's `header`, beside its `h2` title, and no toolbar region on the page.
- [ ] An Editor who owns nothing sees *Suggest an edit*, and after saving reads `Your suggestion is waiting for the concept's owner to decide.` in the status region.
- [ ] A concept whose body holds a table opens in source mode with the line that says why.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/web/test/knowledge/markdown-round-trip.test.ts` gains `finds a table the visual editor would lose`. Run `pnpm --filter @better-answers/web exec vitest run test/knowledge/markdown-round-trip.test.ts -t "finds a table the visual editor would lose"`.
- [ ] `apps/web/test/knowledge/markdown-round-trip.test.ts` gains `keeps plain paragraphs and lists in visual mode`. Run `pnpm --filter @better-answers/web exec vitest run test/knowledge/markdown-round-trip.test.ts -t "keeps plain paragraphs and lists in visual mode"`.
- [ ] `apps/web/test/knowledge/concept-actions.test.tsx` gains `draws Edit for a committer and Suggest for others`, whose two cases differ in `standing` alone. Run `pnpm --filter @better-answers/web exec vitest run test/knowledge/concept-actions.test.tsx -t "draws Edit for a committer and Suggest for others"`.
- [ ] `apps/web/test/knowledge/concept-actions.test.tsx` gains `asks once when the concept is used twice`. Run `pnpm --filter @better-answers/web exec vitest run test/knowledge/concept-actions.test.tsx -t "asks once when the concept is used twice"`.
- [ ] `apps/web/test/knowledge/concept-actions.test.tsx` gains `opens prefilled from the address`, which reads `new`, `collection`, `kind`, `tags` and `subject` into the editor's fields. Run `pnpm --filter @better-answers/web exec vitest run test/knowledge/concept-actions.test.tsx -t "opens prefilled from the address"`.
- [ ] `apps/web/test/shared/page/page-head.test.tsx` passes with no edit. Run `pnpm --filter @better-answers/web exec vitest run test/shared/page/page-head.test.tsx`.
- [ ] Break each new test once in the production line it guards and see it fail. Record the line and the failure in the PR body.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `e2e/knowledge/concept-page.spec.ts`, `e2e/knowledge/concept-body-links.spec.ts` and `e2e/knowledge/knowledge-search.spec.ts` at trunk and at head. Trunk has no editor, so record that and gate an Admin's edit through `e2e/knowledge/concept-editor.spec.ts` plus the end state the user waits for, `Saved.` and the new title after a reload. Save `ba-144-regression.png`. Pass when every existing test passes at both with no assertion edits, and the gated edit passes at head.
- [ ] Lane 2. An Admin, seeded with `provision`, `seedConcepts` and `signIn`, opens a concept page. Save `actions-on-head.png`. Pass when an inline `toMatchAriaSnapshot` shows *Edit* inside the concept's `header` beside its `h2`, the frame draws no toolbar region, and the `h1` still reads "Browse".
- [ ] Lane 3. The Admin edits the title and a paragraph in visual mode, reads the consequence line, and saves. They edit again and press Back. Save `admin-saves.png`. Pass when the status reads `Saved.`, a reload shows the new title and paragraph, and pressing Back with unsaved changes asks before leaving.
- [ ] Lane 4. The Admin opens the editor and saves with no change, then types a word, reloads, and reopens the editor. Save `nothing-saved.png`. Pass when the status reads `Nothing changed, so nothing was saved.`, `page.waitForResponse` shows `saveConcept` answered `unchanged`, and the reopened editor holds the typed word from the draft.
- [ ] Lane 5. Seed a concept that two other concepts link to, then the Admin saves a change to it. Save `asks-once.png`. Pass when `It is used in 2 places` appears once, one *Save* commits, and no second ask draws.
- [ ] Lane 6. An Editor who owns nothing, added with `addMember`, opens the same concept and saves a body change. Save `editor-suggests.png`. Pass when the button reads *Suggest an edit*, the status reads `Your suggestion is waiting for the concept's owner to decide.`, and a reload shows the old body.
- [ ] Lane 7. An outside Viewer opens a concept citing a Restricted passage they cannot open, and suggests an edit. Save `viewer-withheld.png`. Pass when the editor shows `1 source you cannot open stays as it is`, the page's DOM holds no text of that source's locator, and `saveConcept` answers `suggested`.
- [ ] Lane 8. The Admin opens a concept whose body holds a markdown table. Save `source-mode.png`. Pass when the editor opens in source mode with its reason line, the mode key switches it, and the accessibility gate passes in light and dark.
- [ ] Lane 9. By keyboard alone at 320 px wide, the Admin opens the editor, switches mode, leaves the source field by its listed key, and saves. Save `keyboard-only.png`. Pass when every step lands, focus is never hidden, and `listsItsKeystrokes` finds each new key under `?`.
- [ ] Lane 10. The Editor searches `Cyber Essentials Plus certificate`, gets no match, and picks `Type it as a new concept`. They choose `policies` and copy the address the page now shows. The lane adds a kind of `certification` and a tag of `cyber-essentials` to that address, as BA-236's **Add This Fact** will, and opens it in a second tab. Save `new-concept.png`. Pass when the first tab draws the editor with that title and `policies` chosen, the second tab draws it with the title, `policies`, the kind and the tag, and the save answers `suggested`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The concept page's render time from `renders within its budget, read by keyboard alone` (`apps/web/e2e/knowledge/concept-page.spec.ts:776`) at trunk and at head. At head alone, the save's acknowledgement time through `actionClocked` (`apps/web/e2e/locators.ts`) and the size of the build's entry chunk.
- [ ] Probe. Run `pnpm --filter @better-answers/web exec playwright test e2e/knowledge/concept-page.spec.ts -g "renders within its budget" --project chromium --repeat-each 5` in the trunk worktree and the head worktree in turn, three times each, on a local machine, since `HELD_TO_THE_BUDGET` is off under `CI` (`locators.ts:177`). At head, run the save case of `e2e/knowledge/concept-editor.spec.ts` five times through `theActionsLandedWithinTheirBudget`.
- [ ] Baseline. Measure trunk's render median and its entry chunk's gzip size from `pnpm --filter @better-answers/web run build` first.
- [ ] Rule. Fail when head's render median exceeds trunk's by more than 10% or reaches `LIST_BUDGET_MS` (1,000 ms), when the save's median acknowledgement reaches `ACTION_BUDGET_MS` (100 ms), or when the entry chunk grows by more than 5 kB gzip.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 6 and 10 screenshots into `docs/plans/media/s3/ba-144-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `docs/plans/media/s3/ba-144-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Decide an edit suggestion in Inbox › Waiting on You (BA-232)

**Depends on.** BA-12, BA-231.

**Rules and comments read.** `packages/core/AGENTS.md` Principal line 5 (the queue checks ownership beside its read) and Audit lines 9 and 10 (each accept and decline writes its event in its own transaction, and a bulk accept writes one row per item under one batch id). `packages/schema/AGENTS.md` line 5 (no new definer, since the queue reads `suggestion_set_summary` and `concept_write_request_for`, both already in `packages/schema/src/definer-reach.ts`). `apps/web/AGENTS.md` lines 3, 4 and 5 (each outcome announced, bulk work as select-then-command, reader words). The outsider's refusal differs from the owner's case in ownership alone. `.agents/playbooks/knowledge.md` (ADR 0012 and `CONCEPTS.md` move in this PR). BA-232 has no comments (`list_comments`, 21/10/2026). BA-12's owner's ruling of 09/10/2026 says an owner of any role decides in Inbox › Waiting on You, and that To decide stays in Control Centre with Inbox items pointing into it. This PR narrows that pointing to the Admin kinds (KTD4). BA-12's comment of 19/10/2026 says `readerOf` gives every reader `owns: []`. BA-12 fills it before this PR starts.

**Files.**

- [ ] Create `packages/core/src/concepts/waiting.ts`.
- [ ] Edit `packages/core/src/concepts/index.ts`.
- [ ] Create `apps/api/src/trpc/inbox.ts`.
- [ ] Edit `apps/api/src/trpc/router.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-knowledge.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-control.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-knowledge.test.ts`.
- [ ] Edit `apps/web/e2e/harness.ts`.
- [ ] Edit `apps/web/src/shared/navigation.ts`.
- [ ] Edit `apps/web/src/app/router.tsx`.
- [ ] Create `apps/web/src/features/inbox/waiting-on-you-page.tsx`.
- [ ] Create `apps/web/src/features/inbox/inbox-api.ts`.
- [ ] Create `apps/web/src/features/inbox/inbox-words.ts`.
- [ ] Create `apps/web/e2e/inbox/waiting-on-you.spec.ts`.
- [ ] Edit `apps/web/e2e/app/frame.spec.ts`.
- [ ] Edit `apps/web/test/shared/navigation.test.ts`.
- [ ] Create `packages/core/test/concepts/waiting-on-you.test.ts`.
- [ ] Create `apps/api/tests/trpc/inbox-procedures.test.ts`.
- [ ] Edit `docs/specs/route/s3.md` where this unit moves a page. Edit `docs/solutions/architecture-patterns/adr-0051.md` only if the navigation-list decision itself changes.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0012.md`.
- [ ] Edit `CONCEPTS.md`.

**Build.**

- [ ] Add `waitingOnYou(principal, tx)` to `packages/core/src/concepts/waiting.ts`, admitted for `ANY_ROLE`. One statement selects the waiting `edit` rows of `suggestion` and joins `suggestion_set_summary(set_id)` laterally, so the page costs one query. It keeps an item when the reader owns its concept, by the resolved IRI's override or else by the collection of the payload's path (KTD1). For an Admin it keeps every item. That holds the unowned concepts' items, which only an Admin decides, and every owned concept's item, since KTD2 admits an Admin to decide it (KTD4). It answers the title, the proposer's name, the date proposed, the resolved IRI, the concept's owner's name (none when unowned) and `base_moved` for each item.
- [ ] Add `waitingEdit(principal, tx, suggestionId)` to `waiting.ts`. It admits the concept's owner or an Admin, by the same rule as the list, and answers `not-found` to anyone else, the same word an absent suggestion gets. An Admin who opens an owned concept's edit from their list therefore reaches it, and BA-231 already admits an Admin to accept and decline it. It reads the proposed parts through `payloadFor` (`suggestions.ts:374`) and the concept's current parts through `conceptByIri`. It projects the payload's `sources` through `resolvedSourcesOf` and `projectedFrontmatter` (`read.ts:175`, `:222`) under the owner, because BA-95's payload keeps the entries the proposer could not open, and the owner may not open them either.
- [ ] Decide through the core's existing doors. Accept calls `acceptSuggestions` (`index.ts:647`) and decline calls `declineSuggestion` (`suggestions.ts:325`) with a required reason. BA-231 widened both from `ADMIN_ALONE` to owner-or-Admin (KTD2). Confirm that widening is on `main` before building, and add no admission of this PR's own. An acceptance whose base moved is returned to its proposer by `returnToProposer`, as today.
- [ ] Add `apps/api/src/trpc/inbox.ts` with the queries `waiting` and `item` and the mutations `accept` and `decline`. The mutations run on `ownTransactionProcedure` with the git door through `doorTold`. Mount it as `inbox` in `apps/api/src/trpc/router.ts`.
- [ ] Shape the page for four personas from `docs/personas/personas.md`. The Occasional Expert arrives "when a bid writer or curator asks them directly" (`:240`) and forgets the tool, so the page's summary says what is asked of them and what accepting does. The Commercial Controller "arrives through a verification request or a link" (`:399`), so each item has its own address. The Knowledge Curator works the inbox and wants bulk decisions where safe (`:187`, `:202`), so accepting is select-then-command. The Founder-Operator is cut by "counts but not what to do next" (`:85`), so each row names its next action.
- [ ] Draw `WaitingOnYouPage` in `waiting-on-you-page.tsx` through `PageHead` (heading `Waiting on you`) and one `ListHead` row holding the count and the primary action, `Accept selected`. Each row names the concept, the proposer, the date in UK long form, on an Admin's list the concept's owner or `No owner, so Admins decide`, and, when `base_moved` holds, `The concept changed after this was written.`
- [ ] Declare a detail address `/inbox/waiting-on-you/<suggestion>` on Waiting on You in `navigation.ts`, with its `detailOf` entry in `router.tsx`. The detail draws the current and the proposed title and body side by side, marks each changed paragraph with the word `Changed` rather than colour alone, and puts *Accept* and *Decline* on its own header beside the concept's title, as BA-144 does.
- [ ] Announce each outcome in a `status` region. Accepting reads `Accepted. The change is committed with <proposer> as its author.` Declining reads `Declined. <proposer> can read your reason.` A returned item reads `Returned to <proposer>, because the concept changed after they wrote this.`
- [ ] Export `INBOX` from `navigation.ts`, set Waiting on You to `built: true`, and add its `BUILT_PAGES` entry in `router.tsx` (`router.tsx:104`). Confirm that BA-12's ownership arm lights the page for a person who owns one concept by override and no collection (KTD4). Lane 5 proves it.
- [ ] Reuse BA-12's harness action `nameOwners` for every owner seed, and add two harness actions, both new. `seedEditSuggestion` posts to `${HARNESS_PREFIX}/suggestions` and submits one `edit` suggestion through `submitSuggestionSet` as the named proposer. `commitAuthorsOf` gets `${HARNESS_PREFIX}/commit-authors` and answers the author lines of a concept's commits through `authorLinesOf` (`packages/core/test/fixtures/bundle.ts:240`). Each has its function in `apps/api/tests/support/harness/harness-knowledge.ts`, its route in `apps/api/tests/support/harness/harness-control.ts` and its wrapper in `apps/web/e2e/harness.ts`.
- [ ] State (KTD4) that an owner decides the *edit* kind inline in Inbox › Waiting on You, and only the Admin kinds point into Control Centre › Suggestions › To decide. An Admin's Waiting on You lists every *edit*, each owned one with its owner named, so an Admin reaches an owned concept's edit from a page, as KTD2 lets them decide it.
- [ ] Edit ADR 0012's live doc. L35 names Inbox › Waiting on You as where the owner decides. The rule that nothing reads a payload but the acceptance path (archived ADR 0012 L54) now also admits the deciding owner's preview, projected under the owner's predicate.
- [ ] Edit `CONCEPTS.md`. Amend *To decide* and *area* so a person's Inbox decides the *edit* kind itself and points into To decide only for the Admin kinds. Add a *Waiting on you* entry for the page.

**You see.**

- [ ] A Viewer who owns the `policies` collection sees Inbox in the rail and one row on `/inbox/waiting-on-you`, and after *Accept* reads `Accepted. The change is committed with <proposer> as its author.`
- [ ] A Viewer who owns nothing sees no Inbox, and `/inbox/waiting-on-you` draws the not-found page.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/concepts/waiting-on-you.test.ts` gains `lists edit suggestions on concepts the reader owns`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/waiting-on-you.test.ts -t "lists edit suggestions on concepts the reader owns"`.
- [ ] `packages/core/test/concepts/waiting-on-you.test.ts` gains `lists none on concepts another person owns`, whose reader differs from the owner's case in ownership alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/waiting-on-you.test.ts -t "lists none on concepts another person owns"`.
- [ ] `packages/core/test/concepts/waiting-on-you.test.ts` gains `lists an unowned concept's suggestion for Admins alone`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/waiting-on-you.test.ts -t "lists an unowned concept's suggestion for Admins alone"`.
- [ ] `packages/core/test/concepts/waiting-on-you.test.ts` gains `lists every edit for an Admin, naming each owner`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/waiting-on-you.test.ts -t "lists every edit for an Admin, naming each owner"`.
- [ ] `packages/core/test/concepts/waiting-on-you.test.ts` gains `shows an override owner the suggestion on their concept`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/waiting-on-you.test.ts -t "shows an override owner the suggestion on their concept"`.
- [ ] `packages/core/test/concepts/waiting-on-you.test.ts` gains `withholds a source the owner cannot open from the preview`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/waiting-on-you.test.ts -t "withholds a source the owner cannot open from the preview"`.
- [ ] `apps/api/tests/trpc/inbox-procedures.test.ts` gains `commits an owner's acceptance with the proposer as author`. Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/inbox-procedures.test.ts -t "commits an owner's acceptance with the proposer as author"`.
- [ ] `apps/api/tests/trpc/inbox-procedures.test.ts` gains `records the decider and reason of a decline`. Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/inbox-procedures.test.ts -t "records the decider and reason of a decline"`.
- [ ] `apps/api/tests/trpc/inbox-procedures.test.ts` gains `answers an outsider's item as not found`. Its reader differs from the owner's valid read of the item in ownership alone. Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/inbox-procedures.test.ts -t "answers an outsider's item as not found"`.
- [ ] `apps/api/tests/support/harness/harness-knowledge.test.ts` gains `seeds an owner and a waiting edit suggestion`. Run `pnpm --filter @better-answers/api exec vitest run tests/support/harness/harness-knowledge.test.ts -t "seeds an owner and a waiting edit suggestion"`.
- [ ] `apps/web/test/shared/navigation.test.ts` gains `shows Waiting on you to an owner and Admins`. Run `pnpm --filter @better-answers/web exec vitest run test/shared/navigation.test.ts -t "shows Waiting on you to an owner and Admins"`.
- [ ] Break each new test once in the production line it guards and see it fail. Record the line and the failure in the PR body.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `e2e/app/frame.spec.ts`, `e2e/app/home.spec.ts` and `e2e/app/unknown-address.spec.ts` at trunk and at head. Trunk has no Waiting on You, so record that `/inbox/waiting-on-you` draws the not-found page for every role there, and gate an owner's accept through `e2e/inbox/waiting-on-you.spec.ts` plus the end state the user waits for, the commit authored by the proposer. Save `ba-232-regression.png`. Pass when every existing test passes at both, the only assertion edit is `AREA_NAMES` in `frame.spec.ts` gaining `Inbox` for an Admin, and the gated accept passes at head.
- [ ] Lane 2. A Viewer who owns `policies` by `nameOwners` opens Waiting on You, where `seedEditSuggestion` left an Editor's edit on a `policies` concept, and accepts it. Save `owner-accepts.png`. Pass when the status reads the accepted line, the row leaves the list, and `commitAuthorsOf` names the Editor as the newest author.
- [ ] Lane 3. An Editor who owns `policies` declines a waiting suggestion with the reason `The figure is from last year`. Save `owner-declines.png`. Pass when the row leaves the list and `psql` shows `status = 'declined'`, the Editor's actor as `decider` and that reason.
- [ ] Lane 4. A Viewer who owns nothing signs in and opens `/inbox/waiting-on-you` and an item's detail address. Save `outsider-not-found.png`. Pass when the rail shows no Inbox and both addresses draw the not-found page that offers their home.
- [ ] Lane 5. A Viewer who owns one concept by override, and no collection, signs in while two suggestions wait in that concept's collection. Save `override-owner.png`. Pass when Inbox is in their rail and Waiting on You lists the suggestion on their concept alone.
- [ ] Lane 6. An Admin opens Waiting on You while one suggestion waits on an unowned concept and one on a concept the Viewer of lane 2 owns. Save `admin-unowned.png`. Pass when the Admin's list holds both suggestions, the owned one naming the Viewer as its owner and the unowned one reading `No owner, so Admins decide`, the Viewer's list holds the owned one alone, and the Admin opens the owned one's detail address and declines it with the decline recorded.
- [ ] Lane 7. An Admin edits a concept after a suggestion on it was written, then its owner accepts the suggestion. Save `returned.png`. Pass when the status reads the returned line, `commitAuthorsOf` shows no new author, and `psql` shows the suggestion `returned`.
- [ ] Lane 8. An owning Viewer opens an item whose concept cites a Restricted passage they cannot open. Save `preview-withheld.png`. Pass when the preview shows that source as words alone and `page.content()` holds no text of its locator.
- [ ] Lane 9. By keyboard alone at 320 px wide, an owning Editor selects two rows and runs `Accept selected`. Save `bulk-keyboard.png`. Pass when both outcomes are announced in the status region, `listsItsKeystrokes` finds each key under `?`, and the accessibility gate passes in light and dark.
- [ ] Lane 10. An owning Viewer is sent an item's address, signs in from it, and lands on the item. Save `item-by-link.png`. Pass when the item draws after sign-in with its own breadcrumb part, and Back returns to the list with the row still focused.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk has no page, so time the work this PR adds on its own. That is the render time of Waiting on You holding 50 waiting suggestions across five collections, the accept's acknowledgement time through `actionClocked`, and the p95 time of `waitingOnYou` in core.
- [ ] Probe. Run `pnpm --filter @better-answers/web exec playwright test e2e/inbox/waiting-on-you.spec.ts -g "renders within its budget" --project chromium --repeat-each 5` on a local machine, since `HELD_TO_THE_BUDGET` is off under `CI`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/waiting-on-you.test.ts -t "answers 50 waiting suggestions within its budget"`, which reports through `recordFigures`.
- [ ] Baseline. At trunk, first time `suggestionSetSummary` (`suggestions.ts:116`) for one set, the cost the lateral join repeats, through the same `recordFigures` heading.
- [ ] Rule. Fail when the list's median render reaches `LIST_BUDGET_MS` (1,000 ms), when the accept's median acknowledgement reaches `ACTION_BUDGET_MS` (100 ms), when the p95 of `waitingOnYou` over 50 sets exceeds 100 ms, or when that p95 exceeds 50 times trunk's one-set `suggestionSetSummary` median.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 4, 5 and 10 screenshots into `docs/plans/media/s3/ba-232-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `docs/plans/media/s3/ba-232-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Create a concept without scanning the workspace (BA-233)

**Depends on.** BA-231, because both add a migration.

**Rules and comments read.** `packages/schema/AGENTS.md` lines 3 and 4. The new map table is a tenant table, so it ships its zero-rows test, and the worker's `INSERT` grant lands with a test of the `UPDATE` and `DELETE` it must refuse. This PR adds a migration and edits `contracts/links`, so it runs alone for both reasons. `contracts/README.md` line 15. Both suites learn the new fixture output in this PR, and both generated digests move in the same commit. `CODING_STANDARDS.md` lines 7 and 8. Tests drive the `@better-answers/core/store/map` entry and the concepts face against the real Postgres, git store and worker. `CODING_STANDARDS.md` line 15. Every timing in the probe carries `Ms` in its name. `packages/schema/test/support/test-title.ts`. Test titles run to 10 words at most. Each new test is broken once and seen to fail, and the probe lives in the tree, not in `/tmp`. `.claude/skills/mutation-testing/SKILL.md`. `/mutation-testing` runs over the derivation. BA-146, comment of 20/10/2026 (the owner's ruling). Keep #694's edge join and fix a moved target at the write, in `writeConceptDelta`, never with a second lookup in `bodyLinksOf`. This PR follows it. BA-146, comment of 21/10/2026 (triage). Criterion 1 moves here as "an unresolved path reference is a row, and a concept landing at a path settles every reference to it, new or moved". This PR builds that sentence. BA-146, comment of 19/10/2026. It bears on criteria 2 and 3, which stay on BA-146, and changes nothing here. BA-233 has no comments.

**Files.**

- [ ] Create `packages/schema/migrations/<NNNN>_the-unresolved-references.sql`. The number follows BA-231's migration.
- [ ] Edit `packages/schema/migrations/meta/` through `pnpm --filter @better-answers/schema generate`.
- [ ] Edit `packages/schema/src/knowledge/map-tables.ts`.
- [ ] Edit `packages/schema/src/table-ownership.ts`.
- [ ] Edit `packages/schema/test/support/factory.ts`.
- [ ] Edit `packages/schema/test/rls.test.ts`.
- [ ] Edit `apps/worker/src/better_answers_worker/schema_view.py` through `pnpm --filter @better-answers/schema generate:worker-view`.
- [ ] Edit `packages/core/src/store/map/index.ts`.
- [ ] Edit `apps/worker/src/better_answers_worker/concepts/links.py`.
- [ ] Edit `apps/worker/src/better_answers_worker/concepts/rebuild.py`.
- [ ] Edit `contracts/links/cases.json`.
- [ ] Edit `packages/schema/src/contract-stamp.ts` through `pnpm --filter @better-answers/schema run generate:contract-stamp`.
- [ ] Edit `apps/worker/src/better_answers_worker/contract_stamp.py` through `cd apps/worker && uv run --frozen generate-contract-stamp`.
- [ ] Edit `packages/core/test/store/map/links.contract.test.ts`.
- [ ] Edit `apps/worker/tests/concepts/test_links_contract.py`.
- [ ] Edit `apps/worker/tests/concepts/test_links.py`.
- [ ] Edit `packages/core/test/store/map/map.test.ts`.
- [ ] Edit `packages/core/test/concepts/rebuild-equivalence.test.ts`.
- [ ] Create `packages/core/test/concepts/writes/write-budget.test.ts`.
- [ ] Edit `docs/operations/readings.md`.
- [ ] Edit `docs/specs/route/s3.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0032.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0031.md`.
- [ ] Edit `CONCEPTS.md`.

**Build.**

- [ ] Every test and probe here writes concepts as the scenario's Editor only where BA-231's fixtures make that Editor the collection's owner, and as the Admin otherwise, because BA-231 refuses a direct write by an Editor who owns nothing (KTD2).
- [ ] Commit `packages/core/test/concepts/writes/write-budget.test.ts` first, alone, so the perf lane's trunk is `main` plus that one commit. It imports only `writeConcept`, `writeConceptDelta`, `seedingWith` and `recordFigures`, which trunk already has.
- [ ] Declare `mapUnresolvedReference` in `packages/schema/src/knowledge/map-tables.ts` as the table `map_unresolved_reference`, `withRLS` on `workspace_id`. Its columns are `workspace_id`, `gen` (not null), `from_uid` (the citing concept's IRI), `relation` (`link` or `lineage`, by CHECK), `ordinal` (an integer of 0 or more, by CHECK) and `target_path`. It is unique on `(workspace_id, gen, from_uid, relation, ordinal)` and indexed on `(workspace_id, gen, target_path)`. It carries no readable columns, because no person reads it. Only the delta and the rebuild do. KTD16's catalogue test therefore does not probe it.
- [ ] The row carries no `section` or `sentence`, unlike the unit sketch in the design (KTD19). Promotion re-derives the citing concept through `resolveOutgoing`, which computes both, so storing them would be a second copy that could disagree with the rebuild.
- [ ] Write the migration's hand-written tail. Add the `map_row_generation_guard` trigger `BEFORE INSERT` on the table, as `map_edge` has (`0067_the-map.sql:54`). Revoke all from `worker_rt`, then grant it `SELECT, INSERT`, on the precedent of `0022_the-queue-substrate.sql:94-95`.
- [ ] Add `"public.map_unresolved_reference": "concepts"` to `TABLE_OWNERS` in `packages/schema/src/table-ownership.ts`, and a `MAP_DOOR` read-and-write access entry beside `public.map_edge`'s, with a reason that names the delta and the rebuild as its only writers.
- [ ] Add `mapUnresolvedReference` to the factory in `packages/schema/test/support/factory.ts`.
- [ ] In `packages/core/src/store/map/index.ts`, make `resolveOutgoing` return the edges and the path references it left unresolved, each as `{ relation, ordinal, targetPath }`.
- [ ] Make `replaceOutgoingEdges` delete the citing concept's rows in `map_unresolved_reference` at the generation, beside the edges it deletes, and insert one row per unresolved path reference.
- [ ] Replace the scan in `writeConceptDelta` with a keyed lookup. On every landing, select the distinct `from_uid` of rows at the live generation whose `target_path` equals `delta.path`, read those concepts' `concept_index` rows, and re-derive each with `replaceOutgoingEdges`, which turns each row into an edge and deletes the row in the same transaction. The lookup runs on every write, new or not, so a concept landing at a path that older links name is answered at once, whether it is new or moved. It usually returns no rows.
- [ ] Delete `namePattern`, the `naming` query and the `mapped` and `isNew` lines that only gated the scan.
- [ ] Make `SWEEP` in `sweepNonLiveGenerations` delete the rows at non-live generations, and report their count beside the nodes and edges.
- [ ] In `apps/worker/src/better_answers_worker/concepts/links.py`, add `unresolved_references`, which returns the `(relation, ordinal, target_path)` of each path reference from `references_of` that `by_path` does not hold.
- [ ] In `apps/worker/src/better_answers_worker/concepts/rebuild.py`, make `run_rebuild` insert those rows at `outcome.generation` for every record it derives edges for, and count them on `RebuildOutcome`.
- [ ] `contracts/links/cases.json` gains an `unresolved` output on every case and new cases with path targets. These are a relative path, an absolute `/knowledge/` path, a path with a fragment and a `sources` entry naming a path. No concept holds any path in a case, so every path target is unresolved and neither tier looks anything up, which keeps the fixture's rule. Rewrite the fixture's `description` to say so. `links.contract.test.ts` and `test_links_contract.py` both read `unresolved`.
- [ ] Regenerate both contract stamps in the same commit as the fixture.
- [ ] No producer can move a concept today. `rename-refused` guards the governed write (`packages/core/src/concepts/index.ts:479`) and replay (`reconciler.ts:302`), and `importBundle` goes through `writeConcept`. The test therefore proves the moved case by driving `writeConceptDelta` directly, as `map.test.ts:611` does, and this PR builds no mover (BA-146's ruling of 20/10).
- [ ] The rows hold paths and IRIs and name no person, and the rebuild derives them again. No erasure family covers them.
- [ ] Add `map_unresolved_reference` to ADR 0032's list of map tables, with the rule that a landing settles the rows for its own path. Amend ADR 0031's `links` line to say the agreement also covers which path references stay unresolved.
- [ ] Add the perf lane's trunk and head figures to `docs/operations/readings.md` as new rows under *The governed write at 3,000 concepts*, beside the two archived probe rows of 2026-09-10. Date each row on the day it was measured and source it to `write-budget.test.ts`.
- [ ] In `docs/specs/route/s3.md`, point *Creation without a scan*'s link at those rows. A table row has no anchor, so the link keeps `#the-governed-write-at-3000-concepts` and the sentence names the rows by their date and `write-budget.test.ts`. The brief then measures "no slower than today's reading" against a figure the tree can reproduce.
- [ ] Add a `CONCEPTS.md` entry, *unresolved reference*, marked `_Internal._`. It is a link or a `sources` entry in a concept that names a path no concept holds yet, kept so the concept that lands there settles it.

**You see.**

- [ ] After a write whose body links `/knowledge/later.md`, `psql` on `SELECT relation, ordinal, target_path FROM map_unresolved_reference` prints one row, `link | 0 | knowledge/later.md`.
- [ ] After the concept at `knowledge/later.md` lands, the same query prints `(0 rows)`, and `map_edge` holds `links_to:<citing iri>:0` to the new IRI.
- [ ] The probe prints `The governed write at 3,000 concepts: ...` with a whole-write and a backfill median, at trunk and at head.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/store/map/map.test.ts` gains "stores a link to a path no concept holds". Run `pnpm --filter @better-answers/core exec vitest run test/store/map/map.test.ts -t "stores a link to a path no concept holds"`.
- [ ] `packages/core/test/store/map/map.test.ts` gains "settles every reference when a concept lands at its path". Run `pnpm --filter @better-answers/core exec vitest run test/store/map/map.test.ts -t "settles every reference when a concept lands at its path"`.
- [ ] `packages/core/test/store/map/map.test.ts` gains "answers a moved concept at the path older links name". The test moves the concept's `concept_index` row with the seeding pool, as a mover's `landRows` would, runs `writeConceptDelta` with the new path, and reads the citing concept through `readConcept`. Run `pnpm --filter @better-answers/core exec vitest run test/store/map/map.test.ts -t "answers a moved concept at the path older links name"`.
- [ ] `packages/core/test/store/map/map.test.ts` gains "settles a sources path into lineage once it lands". Run `pnpm --filter @better-answers/core exec vitest run test/store/map/map.test.ts -t "settles a sources path into lineage once it lands"`.
- [ ] `packages/core/test/store/map/map.test.ts` gains "drops a rewritten link's unresolved row". Run `pnpm --filter @better-answers/core exec vitest run test/store/map/map.test.ts -t "drops a rewritten link's unresolved row"`.
- [ ] The existing "backfills a link written before its target landed, however deep" passes unchanged. Run `pnpm --filter @better-answers/core exec vitest run test/store/map/map.test.ts -t "backfills a link written before its target landed, however deep"`.
- [ ] `packages/core/test/concepts/rebuild-equivalence.test.ts` reads `map_unresolved_reference` at both generations beside `nodesAt` and `edgesAt`, and `buildTheMap` adds a link to a path nothing ever lands at. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/rebuild-equivalence.test.ts -t "reproduces the live generation exactly from the bundle and records"`.
- [ ] `packages/core/test/store/map/links.contract.test.ts` checks every case's `unresolved`. Run `pnpm --filter @better-answers/core exec vitest run test/store/map/links.contract.test.ts`.
- [ ] `apps/worker/tests/concepts/test_links.py` gains `test_a_path_no_concept_holds_is_an_unresolved_reference`, and `test_links_contract.py` checks `unresolved`. Run `cd apps/worker && uv run --frozen pytest tests/concepts/test_links.py tests/concepts/test_links_contract.py`.
- [ ] `packages/schema/test/rls.test.ts` lists `map_unresolved_reference` among the zero-rows tables, and gains "refuses the worker an update or delete of references". The refused statement differs from the worker's allowed `INSERT` in its verb alone. Run `pnpm --filter @better-answers/schema exec vitest run test/rls.test.ts`.
- [ ] `packages/schema/test/migrations/worker-schema-view.test.ts` and `packages/schema/test/table-ownership.test.ts` pass. Run `pnpm --filter @better-answers/schema exec vitest run test/migrations/worker-schema-view.test.ts test/table-ownership.test.ts`.
- [ ] Break each new test once in the production line it guards and see it fail. Break the promotion lookup's `target_path` match, the row insert in `replaceOutgoingEdges`, and the worker's `unresolved_references`.
- [ ] Run `/mutation-testing` scoped to `packages/core/src/store/map/index.ts` per `docs/agents/mutation-triage.md`. Kill or triage every survivor with a probe.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. As the Editor who owns the collection, write concept A whose body links `/knowledge/later.md`, then write concept B at `knowledge/later.md`, through the `map.test.ts` case "backfills a link written before its target landed, however deep", at trunk and at head. Trunk has no row table, so record that, and gate the edge and the end state. Save `ba-233-regression.png`. Pass when the case passes at both, `psql` shows `links_to:<A>:0` to B's IRI at both, and at head `map_unresolved_reference` holds no row for `knowledge/later.md`.
- [ ] Lane 2. As the owning Editor, write concept A linking `/knowledge/later.md` while no concept holds that path, through the case "stores a link to a path no concept holds". Save `ba-233-row-stored.png`. Pass when `psql` prints one row `link | 0 | knowledge/later.md` for A at the live generation and no `LINKS_TO` edge from A.
- [ ] Lane 3. Continue lane 2's workspace by writing concept B at `knowledge/later.md`, through the case "settles every reference when a concept lands at its path", with two citing concepts. Save `ba-233-settled.png`. Pass when both citers have an edge to B, the row query prints `(0 rows)`, and the edges and the deletions share one transaction (`xmin` of the new edges equals the landing row's).
- [ ] Lane 4. Drive the case "answers a moved concept at the path older links name". Concept C sits at `knowledge/old.md`, and A links `/knowledge/new.md`. The case moves C to `knowledge/new.md` and runs the delta. Save `ba-233-moved.png`. Pass when `readConcept` for A as the scenario's Viewer lists the link answered to C's IRI at `knowledge/new.md`, with no map rebuild in between.
- [ ] Lane 5. As the owning Editor, write concept A whose `sources` names `/knowledge/policy.md`, then land a deprecated concept of A's kind at that path, through the case "settles a sources path into lineage once it lands". Save `ba-233-lineage.png`. Pass when `psql` shows a `SUPERSEDES` edge from A to the new IRI and no row left for the path.
- [ ] Lane 6. Run both contract suites against the new `contracts/links/cases.json`, with `pnpm --filter @better-answers/core exec vitest run test/store/map/links.contract.test.ts` and `cd apps/worker && uv run --frozen pytest tests/concepts/test_links_contract.py`. Save `ba-233-contract.png`. Pass when both pass, and `generate:contract-stamp` and `generate-contract-stamp` rerun leave `git status` clean.
- [ ] Lane 7. Run the rebuild-equivalence case with the worker. Save `ba-233-rebuild.png`. Pass when the case passes, and `psql` on `SELECT gen, count(*) FROM map_unresolved_reference GROUP BY gen` shows the same count at generation 1 and generation 2.
- [ ] Lane 8. After lane 7, run the map sweep through `sweepNonLiveGenerations` as the platform principal. Save `ba-233-sweep.png`. Pass when the sweep reports the old generation's reference count, and the row query shows rows at the live generation alone.
- [ ] Lane 9. In `psql` on the run's database, as `app_rt` scoped to another workspace, select the rows. Then, as `worker_rt`, insert a row, update it and delete it. Save `ba-233-privileges.png`. Pass when the cross-tenant select prints `(0 rows)`, the insert succeeds, and the update and the delete each print `permission denied for table map_unresolved_reference`.
- [ ] Lane 10. As the Admin, write a Restricted concept R linking `/knowledge/later.md`, then land `knowledge/later.md` as the owning Editor. Save `ba-233-withheld-citer.png`. Pass when the new edge carries R's Restricted sensitivity, and `walkTo` from the landed concept as the scenario's Viewer does not reach R.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Two figures at 3,000 concepts, at trunk and at head. The whole write is the wall time of one `writeConcept` that lands a concept at a path three seeded bodies link, as median and p95 over 20 writes per run. The backfill is the wall time of one `writeConceptDelta` for a newly landed concept at such a path, inside a transaction the probe rolls back, as the median over 20 calls. At trunk the backfill holds the regex scan, and at head the keyed lookup. Both re-derive the same three citers. Seeding is the same code at both trees. The probe seeds 3,000 `concept_index` rows with `seedingWith`, 300 of them with forward links, then runs `writeConceptDelta` for each seeded row, untimed, so each tree reaches the timed writes over the map its own delta built. At trunk each seeding delta scans every body, so the seed takes minutes. The case sets its own timeout, `WRITE_BUDGET_TIMEOUT_MS = 600_000`, as `map-budget.test.ts` sets `REBUILD_BUDGET_MS`.
- [ ] Probe. `packages/core/test/concepts/writes/write-budget.test.ts`, case "records the governed write at 3,000 concepts". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/write-budget.test.ts` in a trunk worktree at `main` plus the probe commit, and in the head worktree, alternately, trunk first, five runs each. Each run records through `recordFigures` under `The governed write at 3,000 concepts`. Each timed write asserts that its concept has three inbound `LINKS_TO` edges at the live generation, so a run that skipped the backfill fails instead of reporting a fast number.
- [ ] Baseline. The five trunk runs, measured first, give the trunk medians. The readings row of 2026-09-10 (about 0.9 s, scan 31 to 42 ms) is context only, because it came from an unmerged probe.
- [ ] Rule. Fail when head's median whole write exceeds trunk's by more than 5%, or head's median backfill exceeds trunk's. Vet the figures with `pstack:benchmark-checklist` before reporting them. Write the trunk and head figures as the new readings rows the Build box names, and keep the two archived probe rows.

**Review gate.** None. BA-233 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Declare the guide schema in one migration (BA-234)

**Depends on.** BA-233, because both add a migration. BA-231, for `attachedByIri()` and the erasure union it extends.

**Rules and comments read.** `packages/schema/AGENTS.md` line 3. Every new table is `withRLS` and ships its zero-rows test. Line 4. Each revoked `UPDATE` and `DELETE` lands with its refusal test. Line 5. The erasure definer guards its arguments against the transaction's scope, pins `search_path`, schema-qualifies every object, revokes `EXECUTE` from `PUBLIC`, grants `app_rt` alone and has its `definer-reach.ts` entry. This PR adds a migration and runs alone. It edits no `contracts/` file, because `contracts/erasure-match` lists no families. `CODING_STANDARDS.md` line 26. *Expected fact* gets its `CONCEPTS.md` entry here. `packages/core/AGENTS.md` line 13. A version's actor is the kernel's `ActorId`, never an email. ADR 0035, *The decision*. Erasure rewrites `human:<person id>` on the records that keep it, and the audit log alone is never rewritten. ADR 0045 line 32. The hand-written SQL beside the `REVOKE`s may carry comments. `docs/agents/code-review.md` line 16. `/thermos` runs, because this is a migration and an erasure change. BA-234 has no comments.

**Files.**

- [ ] Create `packages/schema/migrations/<NNNN>_the-guide-records.sql`. The number follows BA-233's migration.
- [ ] Edit `packages/schema/migrations/meta/` through `pnpm --filter @better-answers/schema generate`.
- [ ] Edit `packages/schema/src/column-helpers.ts`.
- [ ] Create `packages/schema/src/knowledge/guide-tables.ts`.
- [ ] Edit `packages/schema/src/knowledge/write-up-tables.ts`.
- [ ] Create `packages/schema/src/knowledge/usage-tables.ts`.
- [ ] Edit `packages/schema/src/schema.ts`.
- [ ] Edit `packages/schema/src/table-ownership.ts`.
- [ ] Edit `packages/schema/src/definer-reach.ts`.
- [ ] Edit `packages/schema/test/support/factory.ts`.
- [ ] Edit `packages/schema/test/rls.test.ts`.
- [ ] Edit `packages/schema/test/support/rls-probes.ts`.
- [ ] Create `packages/schema/test/knowledge/guide-tables.test.ts`.
- [ ] Edit `apps/worker/src/better_answers_worker/schema_view.py` through `pnpm --filter @better-answers/schema generate:worker-view`.
- [ ] Edit `packages/schema/src/knowledge/concept-tables.ts`.
- [ ] Edit `packages/core/src/concepts/trust.ts`.
- [ ] Edit `packages/core/src/erasure/map.ts`.
- [ ] Edit `packages/core/src/erasure/routine/routine.ts`.
- [ ] Create `packages/core/src/erasure/records.ts`.
- [ ] Edit `packages/core/test/erasure/erasure-map.test.ts`.
- [ ] Edit `packages/core/test/erasure/routine/erasure-routine.test.ts`.
- [ ] Create `packages/core/test/guides/guide-read-budget.test.ts`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0014.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0015.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0035.md`.
- [ ] Edit `CONCEPTS.md`.

**Build.**

- [ ] Commit `packages/core/test/guides/guide-read-budget.test.ts` first, alone, so the perf lane's trunk is `main` plus that commit. It uses only `footnotesOf`, `erasureMapOf` and factory entries that trunk has.
- [ ] Add `versionColumns()` to `packages/schema/src/column-helpers.ts`. It returns `version` (an integer of 1 or more), `actor` (an `ActorId`, not null), `at` (`stamp`, not null, default now) and `note` (nullable). Each version table declares its own key and its typed content beside it.
- [ ] Every version table carries no status and no current flag. The latest `version` is the current one (ADR 0014, *a version table with a mutable flag is not append-only*).
- [ ] The migration revokes `UPDATE` and `DELETE` on `write_up_version` and `guide_definition_version` from `app_rt`, and all privileges on every new table from `worker_rt`, on the precedent of `0009_ledger-substrate.sql`.
- [ ] Declare `guide_definition` in `packages/schema/src/knowledge/guide-tables.ts`. It holds `workspace_id`, `id`, `kind`, `collection`, `template` (the template id it was seeded from), `subject_iri` (nullable, through `attachedByIri()`) and `created_at`. It carries no readable columns, because a guide's readers are roles, never an audience.
- [ ] Declare `guide_role`. One row per role the guide serves holds `role` (`Admin`, `Editor` or `Viewer`, the platform's three roles from `ROLES` in `packages/schema/src/people/roles.ts`, by CHECK), `default_layer` (`assembled` or `quoted`, by CHECK) and `action_threshold` (a trust tier, by CHECK). A unique index on `(workspace_id, guide_id, role)` gives each role one row. Live ADR 0004 L33 says a guide's readers are roles and roles are levels, so a reader's row is found from `principal.role`, and a free label such as *bid writer* could not be.
- [ ] Move `TRUST_TIERS` from `packages/core/src/concepts/trust.ts` into `packages/schema/src/knowledge/concept-tables.ts`, so the CHECK and core read one list. `trust.ts` re-exports it.
- [ ] Declare `guide_section`. It holds `id`, `guide_id`, `parent_id` (nullable, so a section nests), `ordinal`, `prompt`, `role_label` (`know`, `say`, `show` or `do`, by CHECK), `usage_note`, `layers` (a non-empty subset of `assembled` and `quoted`, by CHECK) and `hidden`. A composite foreign key ties `parent_id` to a section of the same guide.
- [ ] Declare `guide_expected_fact`, the rows of a section's expectation. Each holds `section_id`, `ordinal`, `name` (what a gap is listed by), `kind` (a folded kind, as `foldKind` in `packages/core/src/concepts/import/landing.ts:72` folds it), `tags` (text array, every tag required, default empty), `collection` (nullable, meaning the guide's own) and `at_least` (an integer of 1 or more, default 1). Rows, not a JSON column, so coverage is one SQL statement over the expectation and the includes (ADR 0014, *rows, never saved lists*). BA-235 parses its templates into exactly these columns.
- [ ] Declare `guide_definition_version` with `versionColumns()` and `content` (jsonb, the definition as the skeleton projection renders it), keyed on `(workspace_id, guide_id, version)`.
- [ ] Add `WRITE_UP_HOMES = ["section", "response"] as const` to `packages/schema/src/knowledge/write-up-tables.ts`. `write_up` gains `home`, `guide_id` and `section_id` for the section home, and `question_id` for the response home. The CHECK `write_up_home_check` admits a section home with `guide_id` and `section_id` set and `question_id` null, or a response home the other way round. A composite foreign key ties `(guide_id, section_id)` to `guide_section`, and a partial unique index keeps one write-up per section.
- [ ] `question_id` has no foreign key yet, because no question table exists. The migration that creates the question table adds the key. `home` and the CHECK stay as they are, so the response home adds a writer and changes no home column.
- [ ] `write_up` gains `needs_review`, null when the write-up is not marked, else its reason. The CHECK admits `concept-changed`, `concept-removed`, `expectation-unmet` and `review-finding`, the glossary's four causes. One column holds the mark and its reason, so a mark with no reason cannot exist.
- [ ] `write_up` keeps `readableRecordColumns()`. It is the only readable table here, and BA-217's catalogue test already probes `write_up_audience_check`.
- [ ] `write_up_include` gains `content_hash` (not null, the concept's hash at generation), `expected_fact_id` (nullable, a foreign key to `guide_expected_fact`, naming the fact the include meets), `wording_heading` and `wording_hash`. The fact id lets coverage count each fact's includes by a join, never by matching kind and tags a second time. A CHECK requires both wording columns or neither. The include table has no writer on `main`, so it holds no rows and a not-null column adds cleanly. The migration asserts that `write_up` and `write_up_include` are empty before it adds `home` and `content_hash`, and stops if either holds a row.
- [ ] Declare `write_up_version` with `versionColumns()`, `markdown` (the Brief as saved, never normalised) and `includes` (jsonb, the include rows as they stood at that version). The live include list stays rows in `write_up_include`. The snapshot is history, so a copied version can name what it drew on.
- [ ] Declare `usage` in `packages/schema/src/knowledge/usage-tables.ts` on the answering slice. It holds `workspace_id`, `id`, `actor`, `at`, `act` (`copied`, `exported` or `submitted`, by CHECK), and either `write_up_id` with `write_up_version`, or `iri` through `attachedByIri()`. A CHECK requires exactly one target. An index on `(workspace_id, write_up_id, write_up_version)` serves BA-237's `usageOf` and BA-238's records export, which read by write-up.
- [ ] Give the factory in `packages/schema/test/support/factory.ts` entries for every new table. `writeUp` defaults to home `section` and mints a guide definition and a section when none is given, as `writeUpInclude` mints a `conceptIdentity`. `writeUpInclude` defaults `content_hash`. Every existing `seed.writeUp` caller (`visibility.test.ts`, `invisibility.test.ts`, `review.test.ts`, `sync-cascade.test.ts`, `rls.test.ts` and `apps/api/tests/support/harness/harness-sources.ts`) then runs unchanged. The raw `A_WRITE_UP_INCLUDE` in `packages/schema/test/support/rls-probes.ts:115` gains `content_hash`.
- [ ] Map every new table in `TABLE_OWNERS`. The guide tables and `write_up_version` go to `guides`, and `usage` to `answering`.
- [ ] Add the definer `public.pseudonymise_record_actors(workspace_id, actors, pseudonym)` to the migration. It is the only path that rewrites `actor` on the two version tables. It refuses a workspace other than the transaction's, pins `search_path`, schema-qualifies each table and touches `actor` alone. `EXECUTE` is revoked from `PUBLIC` and granted to `app_rt`. Name it in `packages/schema/src/definer-reach.ts`.
- [ ] Add the families `write-up-version`, `guide-definition-version` and `usage` to `ERASURE_FAMILIES` in `packages/core/src/erasure/map.ts`, each with the category `actor-id` and a finder by actor. A version's prose is company knowledge, like a concept body, so erasure rewrites the actor and keeps the text.
- [ ] Add `sweepTheRecordActors` in `packages/core/src/erasure/records.ts`. It calls the definer for the version tables and updates `usage.actor` directly. `routine.ts` runs it as one action per family, as `question-asked` is run.
- [ ] Update the exhaustive family lists in `erasure-map.test.ts` (lines 171, 196, 369 and 432) in the same commit.
- [ ] Mark ADR 0014's three *decided for S3* lines as built, and record the definer as the erasure path through an append-only table and the response home's deferred foreign key. Mark ADR 0015's include columns as built. Add the version tables and `usage` to ADR 0035's list of records erasure rewrites, with the definer named.
- [ ] Add a `CONCEPTS.md` entry, *expected fact*, marked `_Internal._`. It is one named part of a section's expectation, the kind, tags and collection it selects and how many concepts it wants. A gap names it.

**You see.**

- [ ] As `app_rt`, `UPDATE write_up_version SET note = 'x'` prints `permission denied for table write_up_version`.
- [ ] Inserting a section write-up with `section_id` null prints `violates check constraint "write_up_home_check"`.
- [ ] After an erasure, `psql` shows `human:<erasure pseudonym>` as the actor of the subject's version and usage rows, and the version's `markdown` unchanged.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/schema/test/rls.test.ts` lists every new table among the zero-rows tables. Run `pnpm --filter @better-answers/schema exec vitest run test/rls.test.ts`.
- [ ] `packages/schema/test/knowledge/guide-tables.test.ts` gains "refuses update and delete on every version table". It finds the tables by the `versionColumns()` column set in the catalogue, so a future version table without the revoke fails it. Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses update and delete on every version table"`.
- [ ] `guide-tables.test.ts` gains "refuses a section home without its section". The input differs from a valid section write-up in `section_id` alone. Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses a section home without its section"`.
- [ ] `guide-tables.test.ts` gains "refuses a response home carrying a guide". The input differs from a valid response write-up in `guide_id` alone. Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses a response home carrying a guide"`.
- [ ] `guide-tables.test.ts` gains "refuses a needs review reason outside the four". The input differs from a valid mark in the `needs_review` value alone. Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses a needs review reason outside the four"`.
- [ ] `guide-tables.test.ts` gains "refuses a wording heading without its hash". The input differs from a valid worded include in `wording_hash` alone. Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses a wording heading without its hash"`.
- [ ] `guide-tables.test.ts` gains "refuses usage naming both a write-up and a concept". The input differs from a valid write-up usage row in `iri` alone. Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses usage naming both a write-up and a concept"`.
- [ ] `guide-tables.test.ts` gains "refuses a second row for one guide role". The input differs from the first `guide_role` row in `default_layer` alone. Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses a second row for one guide role"`.
- [ ] `guide-tables.test.ts` gains "refuses the actor definer another workspace's rows". The call differs from the allowed one in its workspace argument alone. Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses the actor definer another workspace's rows"`.
- [ ] `guide-tables.test.ts` gains "refuses the worker every guide record". Run `pnpm --filter @better-answers/schema exec vitest run test/knowledge/guide-tables.test.ts -t "refuses the worker every guide record"`.
- [ ] `packages/core/test/erasure/erasure-map.test.ts` gains "lists a subject's versions and usage by actor". Run `pnpm --filter @better-answers/core exec vitest run test/erasure/erasure-map.test.ts -t "lists a subject's versions and usage by actor"`.
- [ ] `packages/core/test/erasure/routine/erasure-routine.test.ts` gains "rewrites a version's actor and keeps its prose". Run `pnpm --filter @better-answers/core exec vitest run test/erasure/routine/erasure-routine.test.ts -t "rewrites a version's actor and keeps its prose"`.
- [ ] `packages/schema/test/migrations/worker-schema-view.test.ts` and `table-ownership.test.ts` pass. Run `pnpm --filter @better-answers/schema exec vitest run test/migrations/worker-schema-view.test.ts test/table-ownership.test.ts`.
- [ ] Write each refusal and erasure test first and see it fail before its migration line or family exists. Then break each once in its production line, the `REVOKE`, the CHECK and the definer's scope guard, and see it fail again.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm --filter @better-answers/schema exec vitest run test/rls.test.ts` and `pnpm --filter @better-answers/core exec vitest run test/erasure/erasure-map.test.ts test/erasure/routine/erasure-routine.test.ts` at trunk and at head. Trunk has no guide records, so record that, and gate the new tables' zero rows and the erasure of a version actor. Save `ba-234-regression.png`. Pass when every case passes at both trees and head lists the seven new tables among the zero-rows tables.
- [ ] Lane 2. In `psql` on the migrated database, as `app_rt` scoped to workspace B, select from each new table after the factory seeded rows in workspace A. Save `ba-234-tenancy.png`. Pass when every select prints `(0 rows)`.
- [ ] Lane 3. As `app_rt` scoped to the row's workspace, update one `write_up_version` row and then one `guide_definition_version` row. Save `ba-234-no-update.png`. Pass when each prints `permission denied for table` with its table's name.
- [ ] Lane 4. As `app_rt`, delete one row from each version table, then insert version 2 of the same write-up. Save `ba-234-no-delete.png`. Pass when both deletes print `permission denied`, and the insert succeeds.
- [ ] Lane 5. As `app_rt`, insert a section write-up with `section_id` null, then a response write-up carrying a `guide_id`. Save `ba-234-homes.png`. Pass when both print `violates check constraint "write_up_home_check"`, and a well-formed section write-up inserts.
- [ ] Lane 6. As `app_rt`, set `needs_review` to `stale`, then to `concept-changed`. Save `ba-234-needs-review.png`. Pass when the first prints the CHECK's name and the second succeeds.
- [ ] Lane 7. As `app_rt`, insert an include with `wording_heading` and no `wording_hash`, then one with neither. Save `ba-234-wording.png`. Pass when the first is refused by its CHECK and the second inserts with its `content_hash`.
- [ ] Lane 8. Through the core erasure face, run the erasure routine for an owning Editor who holds two write-up versions and one usage row. Save `ba-234-erased.png`. Pass when `psql` shows `human:<erasure pseudonym>` on all three rows, the versions' `markdown` unchanged, and a direct `UPDATE` of `actor` as `app_rt` still refused.
- [ ] Lane 9. Through `erasureMapOf`, read the access answer for the same Editor before the erasure. Save `ba-234-access-answer.png`. Pass when the answer lists `write-up-version`, `guide-definition-version` and `usage` with the three rows' locations and the `actor-id` category.
- [ ] Lane 10. As `worker_rt`, select from `guide_definition`, `write_up_version` and `usage`. Then run `pnpm --filter @better-answers/schema generate:worker-view` and `git status`. Save `ba-234-worker.png`. Pass when each select prints `permission denied`, and `git status` shows no change to `schema_view.py`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Two figures at trunk and head. The first is the median time of `footnotesOf` as the scenario's Viewer, for one write-up with 25 includes over 3,000 seeded concepts, over 50 calls per run. The include row grows by three columns, so this is the read the change can slow. The second is the median time of `erasureMapOf` for a subject who holds nothing in the new families, over 20 calls per run. That isolates the three finders the diff adds.
- [ ] Probe. `packages/core/test/guides/guide-read-budget.test.ts`, case "records the footnote read and the erasure map". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guide-read-budget.test.ts` in a trunk worktree at `main` plus the probe commit and in the head worktree, alternately, trunk first, five runs each. Each run records through `recordFigures` and asserts `footnotesOf` returned 25 footnotes.
- [ ] Baseline. The five trunk runs, measured first.
- [ ] Rule. Fail when head's median `footnotesOf` exceeds trunk's by more than 10%, or head's median `erasureMapOf` exceeds trunk's by more than 5 ms. Vet the figures with `pstack:benchmark-checklist`.

**Review gate.** None. BA-234 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Seed a guide from a template and project its skeleton (BA-235)

**Depends on.** BA-234.

**Rules and comments read.** `packages/core/AGENTS.md` line 5. `seedGuide` and `coverageOf` take a `Principal` first, and coverage reads under the reader's predicate. Lines 9 and 12. The seeding act writes its audit event, `knowledge.guide.seeded`, in the same transaction as its rows. Line 15. The audit id is minted before the skeleton commit, so the event and the commit join on it. `CODING_STANDARDS.md` lines 7 and 8. Tests drive the guides and concepts faces against a real bare repository and Postgres. Line 14. The git commit path returns a `Result`. `CODING_STANDARDS.md` line 27. The skeleton is not a concept file and adds no key to one. `apps/worker/AGENTS.md` line 3. The api writes the skeleton, and the worker never holds a git credential. The Editor refusal differs from the Admin's seed in the role alone. `.claude/skills/mutation-testing/SKILL.md`. `/mutation-testing` runs over expectation matching and admission. `docs/agents/mutation-triage.md`, *Staging*. Expected template and skeleton values are literals. ADR 0029 rules 2 and 4, with `packages/core/test/gates/import-direction.test.ts`. A store door imports no other door, and the slice graph stays acyclic, so the helpers that write the knowledge base move to a new slice. BA-235 has no comments.

**Files.**

- [ ] Create `packages/core/src/bundle/index.ts`.
- [ ] Edit `packages/core/package.json`.
- [ ] Delete `packages/core/src/concepts/fence.ts`.
- [ ] Edit `packages/core/src/concepts/import/manifest.ts`.
- [ ] Edit `packages/core/src/concepts/import/loader.ts`.
- [ ] Edit `packages/core/src/erasure/routine/routine.ts`.
- [ ] Create `packages/core/src/guides/templates/index.ts`.
- [ ] Create `packages/core/src/guides/templates/bid-library.ts`.
- [ ] Create `packages/core/src/guides/seed.ts`.
- [ ] Create `packages/core/src/guides/coverage.ts`.
- [ ] Create `packages/core/src/guides/include.ts`.
- [ ] Create `packages/core/src/guides/skeleton.ts`.
- [ ] Edit `packages/core/src/guides/index.ts`.
- [ ] Edit `packages/core/src/concepts/import/landing.ts`.
- [ ] Edit `packages/core/src/concepts/index.ts`.
- [ ] Edit `packages/core/src/concepts/writes/reconciler.ts`.
- [ ] Edit `packages/core/src/audit/headlines.ts`.
- [ ] Edit `packages/core/src/audit/stored-names.ts`.
- [ ] Edit `apps/web/src/shared/audit/audit-actions.ts` through `pnpm --filter @better-answers/core generate:audit-actions`.
- [ ] Edit `apps/web/src/shared/audit/audit-sentences.ts`.
- [ ] Edit `apps/web/src/shared/audit/audit-details.ts`.
- [ ] Edit `packages/schema/src/table-ownership.ts`.
- [ ] Create `packages/core/test/fixtures/northgate.ts`.
- [ ] Create `packages/core/test/guides/guides.test.ts`.
- [ ] Create `packages/core/test/guides/templates.test.ts`.
- [ ] Edit `packages/core/test/concepts/writes/reconciler.test.ts`.
- [ ] Edit `packages/core/test/erasure/routine/erasure-routine.test.ts`.
- [ ] Edit `packages/core/test/gates/face-admission.test.ts`.
- [ ] Edit `packages/core/test/concepts/writes/write-budget.test.ts`.
- [ ] Create `packages/core/test/guides/guide-seed-budget.test.ts`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0004.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0012.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0029.md`.

**Build.**

- [ ] Lift the helpers that write the knowledge base first, in a commit of their own before any guides code. BA-235 is the first PR in which a second slice needs them. Create the slice `packages/core/src/bundle/`. Its face, `packages/core/src/bundle/index.ts`, holds `withBundleWrite`, `withBundleFenceAs` and `tryBundleFenceAs` from `packages/core/src/concepts/fence.ts`, `commitAndLandAsMember` and `landBundleCommit` from `packages/core/src/concepts/import/landing.ts` as #869 merged them, and `authorOf` from `packages/core/src/concepts/import/loader.ts:343-359`. Delete `fence.ts`. Migrate every importer of the six in the same commit, found with jCodeMunch `check_references` on each name. They include `concepts/index.ts`, `manifest.ts`, `reconciler.ts`, `landing.ts`, BA-95's `edit.ts`, and `erasure/routine.ts`, which takes `withBundleFenceAs` through the concepts face today (`concepts/index.ts:133`). Drop that re-export.
  - [ ] The helpers go to a new slice because no store door can hold them. The lock and fence hold both the git door and the Postgres door, and the import-direction rule refuses a store door that imports another door, so `store/git/` cannot hold them. The rule, `packages/devtools/lint-rules/rules/import-direction.ts`, reads any top-level directory under `packages/core/src` other than kernel, access, store, the refusal catalogue and the two layers as a slice (line 127). A slice may import another slice's face, and `import/no-cycle` (`.oxlintrc.json:31`) holds the slice graph acyclic, as ADR 0029's rule 4 requires. A `bundle` slice that imports only kernel and the doors, and that concepts, guides and erasure import, therefore needs no change to the rule. A layer would need `LAYERS` in the rule and ADR 0029's rule 3 changed.
  - [ ] Add `"./bundle": "./src/bundle/index.ts"` to `exports` in `packages/core/package.json`. Add `bundle` to ADR 0029's list of today's slices, as the slice that owns the knowledge base's write. That is the repository lock and fence, the commit held in the member's transaction, and its `bundle_commit` row.
  - [ ] Keep `public.bundle_commit` on `concepts` in `TABLE_OWNERS`, and add one `CROSS_OWNER_TABLE_ACCESS` entry `by: "bundle"`, access `write`, for `landBundleCommit`'s insert. Give `authorOf`'s read of `user` and `member` the `by: "bundle"` entries the table-ownership scan asks for, and drop any `by: "concepts"` entry the scan then reports as stale.
  - [ ] The lift changes no behaviour. `pnpm --filter @better-answers/core run test` passes before and after it with the same case count, and no test changes but its imports.
- [ ] The guides slice imports nothing from concepts. `writeSkeleton`, `seedGuide` and `includeAvailable` take the lock, the commit and the author through `@better-answers/core/bundle`. Coverage and the seed read `concept_index` by SQL under the cross-owner read the guides slice declares. Concepts keeps importing the guides face, as `landing.ts:23` does today, for `recomputeWriteUpsIncluding` and now `flagWriteUpsCiting`. BA-236 composes a gap's owner in the api for the same reason.
- [ ] Declare `Template` in `packages/core/src/guides/templates/index.ts`. A template has an `id`, a `kind`, its `roles` and a tree of `sections`. Its `roles` hold one entry per platform role it serves, typed by the kernel's `Role` (`packages/core/src/kernel/principal/principal.ts:17`), each with a default layer and an action threshold, as BA-234's `guide_role` holds them. Each section has a `key`, a `prompt`, a `roleLabel`, a `usageNote`, its `layers`, `hidden`, its `expects` and nested `sections`. Each expected fact has a `name`, a `kind`, `tags` and an optional `collection` and `atLeast`. These are BA-234's `guide_expected_fact` columns one for one. `TEMPLATES` maps each id to its template.
- [ ] Ship the first template in `bid-library.ts`, synthetic and shaped like a bid library, as KTD11 and bid-shape section 3 set out. It has seven sections and one nested section, *Security testing* under *Information security*, with the role labels and expected facts the fixture table below gives. Every prompt and fact name is generic, and no customer text, name or figure appears.
- [ ] Each expected fact names one thing a gap can list. *Insurance and financial standing* expects three facts of kind `insurance policy`, tagged `public-liability`, `professional-indemnity` and `employers-liability`, and one `company fact` tagged `accounts`. A bare "any `insurance policy`" is never written, because it cannot say what is missing.
- [ ] Add `packages/core/test/fixtures/northgate.ts`, the fictional *Northgate Example Ltd*. It holds the concepts that meet the template, written through `writeConcept` and through `importBundle`. It follows the fixture table below, whose numbers BA-236 and BA-237 quote.
- [ ] Write the template and the fixture to this table. It gives 24 includes at the seed and 25 once the absent policy is typed and included. The Admin and the Bid Writer, an Editor, belong to the group `finance`, and the outside Viewer does not. The template's roles are Admin and Editor, with default layer `assembled` and action threshold `unverified`, and Viewer, with default layer `quoted` and action threshold `machine-confirmed`.

| Section | Title | Role label | Expected facts, each one concept unless stated | Includes at seed | Fixture notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Company overview | know | `company fact` tagged `registration`, `headcount`, `founded` and `office` | 4 | None |
| 2 | What we offer | say | `service`, at least 2, and `sector` tagged `served` | 3 | None |
| 3 | Insurance and financial standing | show | `insurance policy` tagged `public-liability` (*Public liability insurance*), `professional-indemnity` (*Professional indemnity insurance*) and `employers-liability` (*Employers' liability insurance*), and `company fact` tagged `accounts` (*Filed accounts*) | 4 | *Employers' liability insurance* has no concept, so 3 of 4 facts are met. *Filed accounts* selects two concepts, the 2024 and the 2025 accounts. The professional indemnity concept is Restricted to `finance`. Every concept here is verified by a person, so section 3 meets the Viewer's action threshold |
| 4 | Certifications | show | `certification` tagged `iso-27001` and `certification` tagged `cyber-essentials-plus` | 2 | The Cyber Essentials Plus certificate is the concept cited from two sections |
| 5 | Data protection | know | `registration` tagged `data-protection`, `policy` tagged `privacy` and `company fact` tagged `data-location` | 3 | None |
| 6 | Information security | know | `practice` tagged `security`, at least 2, and `certification` tagged `cyber-essentials-plus` | 3 | Cites the certificate section 4 cites |
| 6.1 | Security testing, nested under 6 | know | `practice` tagged `testing`, at least 2 | 2 | None |
| 7 | Support and service levels | do | `service level` tagged `severity`, `company fact` tagged `support-hours` and `practice` tagged `escalation` | 3 | No concept here is verified. Like every section but 3, section 7 is below the Viewer's action threshold |

- [ ] Add `seedGuide(principal, doors, { templateId, collection, subjectIri })` in `packages/core/src/guides/seed.ts`, admitted `ADMIN_ALONE` through a declared action.
- [ ] `seedGuide` takes `withBundleWrite` from the `bundle` face and mints the audit id first. From the template and one read of `concept_index`, it computes the guide's rows and each section's includes.
  - [ ] Each expected fact selects the readable `concept_index` rows in its collection (or the guide's) whose folded kind matches and whose tags hold every fact tag. Each selected concept becomes a `write_up_include` row with the concept's `content_hash` and the fact's `expected_fact_id`, ordered by fact, then title, then IRI.
- [ ] `seedGuide` renders the skeleton from those rows and hands it to `writeSkeleton` with a `land` callback. The callback runs in the commit's own member transaction (KTD17). It writes the `guide_definition`, its `guide_role`, `guide_section` and `guide_expected_fact` rows, `guide_definition_version` 1, one `write_up` per section with home `section`, the include rows, and the event `knowledge.guide.seeded`.
  - [ ] Each write-up gets `write_up_version` 1 in the same callback, with empty `markdown` and its include snapshot, so the first Brief save has a latest version to compare against (KTD8).
  - [ ] A section with any fact below its `atLeast` is marked `needs_review = 'expectation-unmet'`.
  - [ ] After the includes, the callback calls `recomputeWriteUpsIncluding` for the included IRIs, so each write-up's visibility follows its concepts.
- [ ] A concept write never adds an include. An include records what a write-up's prose draws on, and every include change moves the skeleton. Includes therefore change only by a person's act on the guide, which is this seed or `includeAvailable` below. A concept typed after the seed appears in coverage as available until someone includes it.
- [ ] Add `coverageOf(principal, tx, guideId)` in `coverage.ts`, admitted `ANY_ROLE`. In one statement, it answers each section's expected facts as `met`, `available` (a readable concept matches but is not included) or `missing`, each with its `name`. It counts a fact's includes by `expected_fact_id`, and names the matching readable concepts of each available fact. It also answers the guide's collection, so a page can name who owns it.
- [ ] Coverage reads under the reader's predicate. A fact met only by a concept the reader may not read reads as missing to that reader, as if nothing matched, so coverage never reveals a withheld concept.
- [ ] Add `includeAvailable(principal, doors, { writeUpId })` in `packages/core/src/guides/include.ts`, declared through `includeAvailableAction`, which admits Editors and Admins, the Brief's gate (KTD12). It takes `withBundleWrite`, mints the audit id, and re-runs the section's expectation match under the principal's predicate. Each `available` concept becomes an include row with its `content_hash` and `expected_fact_id`. When no fact is available it answers `{ included: 0 }` and writes nothing.
  - [ ] It re-renders the skeleton and hands it to `writeSkeleton`, which commits, because the included IRIs changed. Its `land` callback writes the include rows, a `write_up_version` whose `markdown` is the latest version's and whose snapshot holds the new include list, and the event `knowledge.guide.included`. It clears `expectation-unmet` when every fact of the section is met, and calls `recomputeWriteUpsIncluding` for the new IRIs.
  - [ ] This is the second render the brief's *skeleton regenerated on a guide definition change* needs. Lane 4 shows it, and BA-236's **Include** action calls it.
- [ ] Add `renderSkeleton(definition, includes)` in `skeleton.ts`, a pure function. It renders the kind, subject, roles, and the ordered sections with their prompts, role labels, expected fact names and included IRIs, and no prose, as JSON-compatible YAML in a fixed key order. Equal input gives byte-equal output.
- [ ] Add `writeSkeleton(principal, doors, { guideId, content, auditEventId, land })` in `skeleton.ts`, on the shape of `writeManifest` (`packages/core/src/concepts/import/manifest.ts:88-137`) as #869 merged it. It runs inside its caller's `withBundleWrite`. It reads `guides/<guide id>.yaml` at head and, when the file already holds `content`, answers `{ written: false }` and runs nothing. Otherwise it commits through the `bundle` face's `commitAndLandAsMember` with `trailers.projection = "guides"`, the actor and the audit id. Its landing runs the caller's `land`, then `landBundleCommit`, in the commit's own member transaction (KTD17).
  - [ ] `writeSkeleton` is the one writer of a skeleton commit's `bundle_commit` row. `seedGuide` and `includeAvailable` never write one, so the row cannot land twice.
- [ ] The skeleton's git author is the person whose definition change caused it, looked up from the principal through the `bundle` face's `authorOf`, never taken from a caller.
- [ ] Run `pnpm --filter @better-answers/core generate:audit-actions`, and add `knowledge.guide.seeded` and `knowledge.guide.included` to `headlines.ts` and `stored-names.ts`, and their sentences and details to `audit-sentences.ts` and `audit-details.ts`, as `knowledge.manifest.written` is.
- [ ] Make `trailerFactsOf` in `packages/core/src/concepts/writes/reconciler.ts` read the `Projection` trailer.
- [ ] Add `replayProjectionCommit` beside the `BUNDLE_MANIFEST_PATH` arm in `replayCommit`, keyed on `trailers.projection === "guides"`. It records the commit and its `bundle_commit` row as `replayManifestCommit` does, and derives nothing.
- [ ] A projection commit left by a crash names a definition change whose rows never landed. The Postgres rows stay the truth, and the next definition change renders the skeleton again.
- [ ] Add `flagWriteUpsCiting(principal, tx, { iri, contentHash })` to `packages/core/src/guides/index.ts`. It sets `needs_review = 'concept-changed'` on every write-up with an include of `iri` whose `content_hash` differs from the new hash, where the mark is null or `expectation-unmet`. A verification leaves the hash alone, so it marks nothing (ADR 0015).
- [ ] Call `flagWriteUpsCiting` from `landRows` in `packages/core/src/concepts/import/landing.ts`, in the same transaction, beside `recomputeWriteUpsIncluding` (KTD14, live ADR 0004). Every governed write, replay and import goes through `landRows`, so all three mark.
- [ ] Exempt `flagWriteUpsCiting` in `packages/core/test/gates/face-admission.test.ts` beside `recomputeWriteUpsIncluding`. `seedGuide`, `includeAvailable` and `coverageOf` are declared actions.
- [ ] Add the guides slice's cross-owner access to `table-ownership.ts`. It reads `concept_index` (already listed). The skeleton's `bundle_commit` row is written through the `bundle` face, under the entry the lift added.
- [ ] Amend live ADR 0004 to put the skeleton at `guides/<guide id>.yaml`, outside `knowledge/`, with the role label and expected fact names it carries. Amend live ADR 0012 to name the projection path beside the manifest's as the second path a knowledge base reserves, with the reconciler's projection arm (KTD10).

**You see.**

- [ ] `git log -1 --format='%an <%ae>%n%b' -- guides/` on the bare repository prints the seeding Admin's author line, `Projection: guides`, `Actor: human:<admin person id>` and `Audit: <ulid>`.
- [ ] `coverageOf` on the seeded Northgate guide lists *Employers' liability insurance* as missing in *Insurance and financial standing*.
- [ ] `psql` on `SELECT needs_review FROM write_up` after a concept edit prints `concept-changed` on each write-up that includes it.
- [ ] After the employers' liability concept is typed and `includeAvailable` runs on section 3, `git rev-list --count HEAD -- guides/` reads one more than before, and `coverageOf` reads all four of section 3's facts as met.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/guides/templates.test.ts` gains "parses every shipped template into expected fact rows". Run `pnpm --filter @better-answers/core exec vitest run test/guides/templates.test.ts -t "parses every shipped template into expected fact rows"`.
- [ ] `packages/core/test/guides/guides.test.ts` gains "fills sections from typed and imported concepts alike". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "fills sections from typed and imported concepts alike"`.
- [ ] `guides.test.ts` gains "lists each missing fact by name". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "lists each missing fact by name"`.
- [ ] `guides.test.ts` gains "includes one concept in two sections' write-ups". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "includes one concept in two sections' write-ups"`.
- [ ] `guides.test.ts` gains "refuses a seed by an Editor". The input differs from the Admin's seed in the principal's role alone. Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "refuses a seed by an Editor"`.
- [ ] `guides.test.ts` gains "writes version one of every section's write-up". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "writes version one of every section's write-up"`.
- [ ] `guides.test.ts` gains "reads a withheld fact as missing to an outside Viewer". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "reads a withheld fact as missing to an outside Viewer"`.
- [ ] `guides.test.ts` gains "commits the skeleton outside knowledge with its trailer". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "commits the skeleton outside knowledge with its trailer"`.
- [ ] `guides.test.ts` gains "writes no skeleton commit when nothing changed". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "writes no skeleton commit when nothing changed"`.
- [ ] `guides.test.ts` gains "includes an available concept and re-commits the skeleton". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "includes an available concept and re-commits the skeleton"`.
- [ ] `guides.test.ts` gains "refuses an include by a Viewer". The input differs from the Editor's include in the principal's role alone. Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "refuses an include by a Viewer"`.
- [ ] Run `npx madge --circular --extensions ts packages/core/src` at trunk and at head. On the plan's worktree at `84756f2c9`, on 21/10/2026, it listed seven cycles, each inside one directory (`kernel/`, `concepts/` or `llm/`). Pass when no cycle in head's list names files in two slice directories, so guides and concepts hold no cycle. Record both lists in the PR body. `import/no-cycle` under root `check:gates` is the gate, and this run is its evidence.
- [ ] `guides.test.ts` gains "marks citing write-ups when a concept's content changes". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "marks citing write-ups when a concept's content changes"`.
- [ ] `guides.test.ts` gains "leaves write-ups unmarked when a verification lands". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guides.test.ts -t "leaves write-ups unmarked when a verification lands"`.
- [ ] `packages/core/test/concepts/writes/reconciler.test.ts` gains "replays a projection commit its rows never reached". The test commits a skeleton through the git door with the trailer and no rows, then runs `replayMissed`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/reconciler.test.ts -t "replays a projection commit its rows never reached"`.
- [ ] `reconciler.test.ts` gains "replays concept commits past a projection commit". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/reconciler.test.ts -t "replays concept commits past a projection commit"`.
- [ ] `packages/core/test/erasure/routine/erasure-routine.test.ts` gains "rewrites the author line of a skeleton commit". Run `pnpm --filter @better-answers/core exec vitest run test/erasure/routine/erasure-routine.test.ts -t "rewrites the author line of a skeleton commit"`.
- [ ] `face-admission.test.ts`, `import-direction.test.ts`, `audit-actions.test.ts` and `rebuild-equivalence.test.ts` pass. The rebuild ignores `guides/`, because `concepts_at_head` walks `knowledge/` alone. Run `pnpm --filter @better-answers/core exec vitest run test/gates/face-admission.test.ts test/gates/import-direction.test.ts test/audit/audit-actions.test.ts test/concepts/rebuild-equivalence.test.ts`.
- [ ] Break each new test once in the production line it guards and see it fail. Break the tag match, the reader predicate in `coverageOf`, the `content_hash` comparison, the trailer read and the unchanged-file check.
- [ ] Run `/mutation-testing` scoped to `packages/core/src/guides/` per `docs/agents/mutation-triage.md`. Kill or triage every survivor with a probe.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. As the owning Editor, edit a concept through `writeConcept` and run the reconciler's `replayMissed`, through `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/reconciler.test.ts`, at trunk and at head. Trunk cannot seed a guide, so record that, and gate the seeded guide's sections and the replay past a projection commit. Save `ba-235-regression.png`. Pass when the suite passes at both, and at head the seeded Northgate guide has eight write-ups and the replay lands every commit after a projection commit.
- [ ] Lane 2. As the Admin, seed the bid-library template over the Northgate fixture through `seedGuide`. Save `ba-235-seeded.png`. Pass when `psql` shows one `guide_definition`, eight `guide_section` rows (one with a `parent_id`), eight section write-ups and 24 `write_up_include` rows, the full 25 less the absent policy, each with its concept's `content_hash`.
- [ ] Lane 3. After lane 2, read `coverageOf` as the Admin. Save `ba-235-missing-fact.png`. Pass when *Insurance and financial standing* lists *Employers' liability insurance* as missing by name, and every other expected fact reads met.
- [ ] Lane 4. As the owning Editor, type a concept of kind `insurance policy` tagged `employers-liability`, then read `coverageOf` again. Then the owning Editor calls `includeAvailable` on section 3's write-up. Save `ba-235-available.png`. Pass when the fact first reads available with the section's include rows unchanged and no new skeleton commit, and after the include reads met, the section holds five include rows, `git rev-list --count HEAD -- guides/` has risen by one, `git show HEAD:guides/<guide id>.yaml` names the new concept's IRI under section 3, and section 3's `needs_review` is null.
- [ ] Lane 5. After lane 2, read the bare repository with `git log --format='%an <%ae>%n%b' -- guides/` and `git show HEAD:guides/<guide id>.yaml`. Save `ba-235-skeleton.png`. Pass when one commit names the Admin as author with `Projection: guides`, and the file holds the eight sections' prompts and included IRIs and no prose.
- [ ] Lane 6. After lane 2, call `writeSkeleton` again for the same guide id with the same rendered content, as the Admin. Save `ba-235-no-op.png`. Pass when `git rev-list --count HEAD -- guides/` is unchanged, the call answers that nothing was written, and no second `bundle_commit` row exists for the guide.
- [ ] Lane 7. Commit a skeleton through the git door with the projection trailer and no rows, then commit a concept the same way, then run `replayMissed` as the reconciler. Save `ba-235-crash-replay.png`. Pass when both commits get `bundle_commit` rows, the concept lands in `concept_index`, and no `unreadable-commit` refusal appears.
- [ ] Lane 8. As the owning Editor, change the body of the certification included in two sections. Save `ba-235-needs-review.png`. Pass when `psql` shows `needs_review = 'concept-changed'` on both write-ups and on no other.
- [ ] Lane 9. As the Admin, verify a concept included in a section, which changes no content hash. Save `ba-235-verified-unmarked.png`. Pass when that section's `needs_review` is unchanged.
- [ ] Lane 10. As an outside Viewer, read `coverageOf` for the guide and `footnotesOf` for section 3's write-up. Section 3's professional indemnity concept is Restricted to `finance`, which the Viewer is not in (the fixture table). Save `ba-235-withheld.png`. Pass when the fact that concept meets reads missing to the Viewer, `footnotesOf` omits it with no gap, and nothing in either answer names its IRI or title.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. One figure at trunk and head, and two absolute budgets for what trunk lacks. The governed write at 3,000 concepts, from BA-233's probe, now runs with eight seeded write-ups including the written concept, so the head pays the `needs_review` update. The absolute budgets are the median time of `seedGuide` for the bid-library template over the Northgate fixture among 3,000 concepts, skeleton commit included, and the median time of `coverageOf` for that guide.
- [ ] Probe. `packages/core/test/concepts/writes/write-budget.test.ts` gains the case "records the governed write over citing write-ups", committed first, alone, so trunk is `main` plus that commit. `packages/core/test/guides/guide-seed-budget.test.ts`, case "records seeding a guide and reading its coverage", is new and runs at head alone, over ten seeds and 50 coverage reads. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/writes/write-budget.test.ts` at trunk and head alternately, trunk first, five runs each, then `pnpm --filter @better-answers/core exec vitest run test/guides/guide-seed-budget.test.ts` five times at head. Each timed write asserts the eight write-ups it touched, and each seed asserts 24 includes.
- [ ] Baseline. The five trunk runs of the write case, measured first.
- [ ] Rule. Fail when head's median write exceeds trunk's by more than 5%, when the median seed exceeds 1.5 s, or when the median coverage read exceeds 50 ms. Vet the figures with `pstack:benchmark-checklist`.

**Review gate.** None. BA-235 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Read and edit a guide on Knowledge › Guides (BA-236)

**Depends on.** BA-12, BA-235 and BA-144. Lane 5 uses BA-12's harness action `nameOwners`.

**Rules and comments read.** `CODING_STANDARDS.md` Tests lines 7 to 9 (test through the caller's interface on a real Postgres and a real bare repository, and assert a refusal before any returned value), which shape the no-op save tests. `packages/core/AGENTS.md` Principal line 5 (every read takes a `Principal` and checks the read predicate beside the data), Audit lines 9, 12 and 16 (a Brief save that writes is audited as `knowledge.guide.brief_saved`, and a read or a no-op save writes no audit row). `apps/web/AGENTS.md` lines 3 to 5 (WCAG 2.2 AA with keyboard and screen reader, a keystroke for every common action, and the glossary's reader words). `packages/design-system/readme.md` section 2 (trust words written verbatim from the closed set). `packages/schema/test/support/test-title.ts` (test titles). Each test is broken once. `.claude/skills/mutation-testing/SKILL.md` (`/mutation-testing` on the round-trip equality check). `.agents/playbooks/knowledge.md` (a page word with no entry gets one, so *coverage* gains its entry). `.agents/playbooks/verification.md` (the page is proven by an `apps/web/e2e/` spec on the served build). BA-236 has no Linear comments.

**Files.**

- [ ] Edit `apps/web/src/shared/navigation.ts`.
- [ ] Edit `apps/web/src/app/router.tsx`.
- [ ] Create `apps/web/src/features/knowledge/guides-page.tsx`.
- [ ] Create `apps/web/src/features/knowledge/guide-page.tsx`.
- [ ] Create `apps/web/src/features/knowledge/brief-editor.tsx`.
- [ ] Create `apps/web/src/features/knowledge/guide-words.ts`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-api.ts`.
- [ ] Edit `apps/api/src/trpc/knowledge.ts`.
- [ ] Create `packages/core/src/guides/read.ts`.
- [ ] Create `packages/core/src/guides/brief.ts`.
- [ ] Create `packages/core/src/guides/renderer.ts`.
- [ ] Edit `packages/core/src/guides/index.ts`.
- [ ] Create `packages/core/test/guides/guide-read.test.ts`.
- [ ] Create `packages/core/test/guides/brief-save.test.ts`.
- [ ] Create `packages/core/test/guides/brief-renderer.test.ts`.
- [ ] Edit `apps/api/tests/trpc/knowledge-procedures.test.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-knowledge.ts`.
- [ ] Edit `apps/web/e2e/harness.ts`.
- [ ] Create `apps/web/e2e/knowledge/guides.spec.ts`.
- [ ] Create `apps/web/test/knowledge/brief-editor.test.tsx`.
- [ ] Edit `apps/web/test/shared/navigation.test.ts`.
- [ ] Edit `CONCEPTS.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0004.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0015.md`.

**Build.**

- [ ] Before any code, read BA-235's merged `coverageOf` and `includeAvailable` and BA-144's merged concept editor. Confirm that `includeAvailable` adds an include row for each available concept and re-commits the skeleton, and that BA-144's address fields `new`, `collection`, `kind`, `tags` and `subject` prefill the editor. If either is missing, stop and raise it with the coordinator before building the gap actions.
- [ ] Name the personas in the PR body. The page serves the Occasional Expert, who forgets the tool between visits and reads a guide for context (`docs/personas/personas.md:233`, `:246`), so each section opens on its role's default layer with the Brief first and coverage in plain words. It serves the Founder-Operator, whose cut is "counts but not what to do next" (`:85`), so a gap names the missing fact and its action. It serves the Knowledge Curator, who reviews coverage (`:190`). It serves the Bid Writer, whose trust breaks when citations go missing (`:143`), so every claim keeps its footnote. "Trust is shown by colour alone" is a cut (`:88`), so each section wears its trust word as text.
- [ ] In `packages/core/src/guides/read.ts`, add `readGuide(principal, tx, { guideId })`, declared through `readGuideAction` (`ANY_ROLE`). It reads the guide definition, its section tree in order, each section's latest `write_up_version`, its include rows and the reader's footnotes in one joined query per table, never per row. It returns, per section, the prompt, the role label, the layers it renders, the shown trust word, `needs_review` with its reason, the Brief markdown, the Detail atoms of the concepts the reader may read, and coverage from BA-235's `coverageOf`. A hidden section comes back marked for an Admin and is absent for anyone else, and coverage counts it either way (ADR 0004 Live L34).
- [ ] `readGuide` computes no coverage of its own. It calls `coverageOf` and returns its three states, `met`, `available` and `missing`, per expected fact by name, so one number has one source. The guides slice imports nothing from concepts (BA-235), so the `knowledge.guide` route in `apps/api/src/trpc/knowledge.ts` reads the guide's collection's owner through the concepts face's `ownerOf` in the same transaction, and answers it beside each gap, so a reader who cannot answer it knows who can.
- [ ] Add `readGuides(principal, tx)` beside it for the Guides list, one row per guide with its subject, kind and the count of sections that need review.
- [ ] In `packages/core/src/guides/renderer.ts`, add the pure `renderBrief(markdown, footnotes, profile)` with one profile, `"page"`. It resolves each `[^<include id>]` marker to the reader's footnote from `footnotesOf`, numbers them from 1 in order of first appearance, and drops a marker whose include the reader cannot read with no gap in the numbers. BA-237 adds the clipboard profile to this function.
- [ ] In `packages/core/src/guides/brief.ts`, add `saveBrief(principal, door, { writeUpId, markdown, base })`, declared through `saveBriefAction`, which admits Editors and Admins (KTD12). It refuses a marker naming no include row of the write-up (`marker-without-include`) and a `base` that is not the latest version (`stale-precondition`), both before any write.
- [ ] In `saveBrief`, compare the submitted markdown byte for byte with the latest version's stored markdown, and the write-up's include rows with that version's rows (KTD8). When both are equal, return `{ saved: false, version }` and write no version, no audit row and no skeleton commit. Otherwise write one `write_up_version` row and one `knowledge.guide.brief_saved` audit event in the same transaction, then run `pnpm --filter @better-answers/core generate:audit-actions`.
- [ ] The Brief editor places and removes footnote markers and never changes include rows. Deleting a marker keeps its row, which then reads "not placed" (ADR 0015). A Brief save therefore never regenerates the skeleton projection, and the test proves the knowledge base's head does not move.
- [ ] Export `readGuide`, `readGuides`, `saveBrief`, `renderBrief` and their actions from the `./guides` face in `packages/core/src/guides/index.ts`.
- [ ] In `apps/api/src/trpc/knowledge.ts`, add `knowledge.guides`, `knowledge.guide`, `knowledge.saveBrief` and `knowledge.includeAvailable` beside `find` and `open`, each answering a refusal through the refusal catalogue. `knowledge.includeAvailable` is a mutation over BA-235's `includeAvailable`.
- [ ] In `apps/web/src/shared/navigation.ts`, set the Guides entry to `built: true` and give it `detail: { param: "guide" }`, as Search has for the concept page. In `apps/web/src/app/router.tsx`, add its `BUILT_PAGES` entry and its detail, so a guide opens at `/knowledge/guides/<guide id>` with no toolbar.
- [ ] In `apps/web/src/features/knowledge/guides-page.tsx`, draw the list under `ListHead` with its count, one row per guide, and the row opening the guide.
- [ ] In `apps/web/src/features/knowledge/guide-page.tsx`, draw the head through `PageHead`, then the guide's subject and kind, then each section in tree order. A section shows its prompt as a heading, its trust word as text, and "Needs review" with its reason, such as "Cites a concept that changed" (KTD14). Its Brief comes first with numbered footnotes, then a **Show Detail** disclosure that opens the included concepts' own words in place under the Brief (ADR 0004 A L42), drawn with `ConceptBody`, each linking to its concept page.
- [ ] Under each section, draw coverage as "3 of 4 expected facts recorded", counting the `met` facts. Then draw each fact that is not met by name, in its state.
  - [ ] A `missing` fact reads, for example, "Employers' liability insurance not yet recorded. Owner Dana Example.", with an **Add This Fact** action. It opens BA-144's concept editor at an address carrying `new`, `collection`, `kind`, `tags` and `subject`, prefilled with the fact's kind and tag, the guide's collection and a link to the subject. For the collection's owner or an Admin it commits once the page states the consequence. For anyone else it becomes an *edit* suggestion.
  - [ ] An `available` fact reads, for example, "Employers' liability insurance is recorded but not in this section.", with an **Include** action for Editors and Admins. It calls `knowledge.includeAvailable`, announces "Included in section 3." in the `status` region, and redraws the section with the concept in its Detail.
- [ ] In `apps/web/src/features/knowledge/brief-editor.tsx`, build the Brief editor on BA-144's Tiptap 3 editor (KTD13), in place under the section, for Editors and Admins only. A footnote is an inline chip atom named by its concept's title. The arrow keys reach it, cut and paste move it, and typing never enters it (ADR 0015 Live L37). The editor is a named `textbox`, every target is at least 24 px, and Escape leaves the Tab capture, listed under `?` (ADR 0015 A L27).
- [ ] Save is explicit, by **Save Brief** or its keystroke. A client draft survives a reload through `apps/web/src/shared/browser-storage.ts`, and leaving with an unsaved draft asks once to confirm (KTD13). The save waits on the server, which alone knows whether anything changed, so the `status` region says "Saving the Brief." at once, then the result, either "Saved version 3." or "No changes to save. Version 2 stands." A stale save reads "Someone saved this Brief after you opened it." and keeps the draft.
- [ ] In `apps/web/e2e/knowledge/guides.spec.ts`, add "renders the seeded guide within its budget", modelled on `e2e/knowledge/concept-page.spec.ts:776`, which times the last section heading against 1,000 ms. Add "acknowledges a Brief save within its budget", which clocks the keystroke to "Saving the Brief." with `clockTheNextKey` and `theActionLandedWithinItsBudget(page, "save the Brief")`, then times "Saved version" against 1,000 ms.
- [ ] Put every page word in `apps/web/src/features/knowledge/guide-words.ts`, in the glossary's reader words. Give **Show Detail**, **Edit Brief**, **Save Brief** and **Add This Fact** keystrokes, listed under `?`.
- [ ] In `apps/api/tests/support/harness/harness-knowledge.ts` and `apps/web/e2e/harness.ts`, add the new harness action `seedGuide`. It seeds BA-235's synthetic template over the Northgate fixture for one collection, as BA-235's fixture table sets out. The employers' liability concept is absent from section 3, the Cyber Essentials Plus certificate is cited from sections 4 and 6, and section 3's professional indemnity concept is Restricted to `finance`. It then writes a prose Brief as version 2 over BA-235's empty version 1 for each section, with markers for every include. Version 2 therefore stands in a fresh lane worktree, and lane 8 holds without lane 7.
- [ ] In `apps/web/test/shared/navigation.test.ts`, replace `/knowledge/guides` in the unbuilt-page loop (`:486`) with `/knowledge/conflicts`, which stays unbuilt through S3.
- [ ] Add a `CONCEPTS.md` entry for *coverage*, the reader word the page shows. Edit ADR 0004 to record that Detail opens in place under its Brief. Edit ADR 0015 to record that the Brief editor never changes include rows and that the renderer's page profile renumbers past a withheld include.

**You see.**

- [ ] An Editor opens Knowledge › Guides, sees "1 Guide", opens the Northgate guide and sees eight sections in tree order, each with its trust word and its Brief footnoted from 1.
- [ ] Section 3 reads "3 of 4 expected facts recorded" to the Editor, who is in `finance`, and lists "Employers' liability insurance not yet recorded", as BA-235's fixture table gives.
- [ ] An unchanged save announces "No changes to save. Version 2 stands." and `write_up_version` keeps its count.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/guides/guide-read.test.ts` gains "coverage names each expected fact not yet included". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guide-read.test.ts -t "coverage names each expected fact not yet included"`.
- [ ] `packages/core/test/guides/guide-read.test.ts` gains "a hidden section counts toward coverage" and "a reader never sees a hidden section". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guide-read.test.ts -t "hidden section"`.
- [ ] `packages/core/test/guides/brief-renderer.test.ts` gains "renumbers markers after a withheld include, leaving no gap". Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-renderer.test.ts -t "renumbers markers after a withheld include, leaving no gap"`.
- [ ] `packages/core/test/guides/brief-save.test.ts` gains "an unchanged Brief save writes no version". Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-save.test.ts -t "an unchanged Brief save writes no version"`.
- [ ] `packages/core/test/guides/brief-save.test.ts` gains "a whitespace-only change writes a new version", which differs from the unchanged save in one trailing space. Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-save.test.ts -t "a whitespace-only change writes a new version"`.
- [ ] `packages/core/test/guides/brief-save.test.ts` gains "a changed Brief save writes one version and event". Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-save.test.ts -t "a changed Brief save writes one version and event"`.
- [ ] `packages/core/test/guides/brief-save.test.ts` gains "a Brief save leaves the bundle head unmoved", read with `head` on the bare repository. Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-save.test.ts -t "a Brief save leaves the bundle head unmoved"`.
- [ ] `packages/core/test/guides/brief-save.test.ts` gains three refusals, each one field from a valid save. "a Viewer's Brief save is refused" differs in role. "a marker naming no include row is refused" differs in one marker. "a save on a stale version is refused" differs in `base`. Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-save.test.ts -t "refused"`.
- [ ] `apps/api/tests/trpc/knowledge-procedures.test.ts` gains "saves a Brief through the knowledge router". Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/knowledge-procedures.test.ts -t "saves a Brief through the knowledge router"`.
- [ ] `packages/core/test/guides/guide-read.test.ts` gains "reads coverage from coverageOf in all three states". Run `pnpm --filter @better-answers/core exec vitest run test/guides/guide-read.test.ts -t "reads coverage from coverageOf in all three states"`.
- [ ] Run `pnpm --filter @better-answers/core exec vitest run test/gates/import-direction.test.ts`, since this PR creates `guides/renderer.ts`, a path the import-direction lint fixtures name (lines 64, 87 and 88).
- [ ] `apps/web/test/knowledge/brief-editor.test.tsx` gains "moves past a footnote chip with one arrow key" and "announces an unchanged save in the status region". Run `pnpm --filter @better-answers/web exec vitest run test/knowledge/brief-editor.test.tsx`.
- [ ] Break each new test once in the production line it guards and see it fail. Then run `/mutation-testing` over `packages/core/src/guides/brief.ts` per `docs/agents/mutation-triage.md`, since round-trip equality is validation.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. An Editor opens `/knowledge/guides` at trunk and at head. Trunk lacks the page and shows the not-found page, so record that and gate the head. At head the Editor opens the guide seeded by `seedGuide` in the new `e2e/knowledge/guides.spec.ts`, and `e2e/knowledge/concept-page.spec.ts` and `e2e/knowledge/knowledge-search.spec.ts` pass with no assertion edits. Save `guides-regression.png`. Pass when trunk shows the not-found page, head shows eight sections with footnotes numbered from 1, and both existing specs pass.
- [ ] Lane 2. An outside Viewer opens the guide, reads section 1's Brief, and opens **Show Detail** by keyboard alone. Save `guides-viewer-read.png`. Pass when the Detail opens under the Brief with focus moved into it, each section shows its trust word as text from the closed set, and no **Edit Brief** action exists for the Viewer.
- [ ] Lane 3. The Viewer, outside `finance`, reads section 3, whose four includes hold the Restricted professional indemnity concept (BA-235's fixture table). Save `guides-withheld.png`. Pass when the footnotes read 1, 2 and 3 with no gap, and neither the Brief nor the Detail names the withheld concept.
- [ ] Lane 4. The Editor, in `finance`, reads section 3's coverage. Save `guides-coverage.png`. Pass when it reads "3 of 4 expected facts recorded", lists "Employers' liability insurance not yet recorded", names the collection's owner, and offers **Add This Fact**.
- [ ] Lane 5. The owning Editor, made owner through `nameOwners`, chooses **Add This Fact** on the gap, finds the editor prefilled with kind, tag and collection, and commits after the consequence statement. The section then shows the fact as available, and the Editor chooses **Include**. Save `guides-gap-filled.png`. Pass when the fact first reads "Employers' liability insurance is recorded but not in this section.", and after **Include** the status region reads "Included in section 3.", the guide reads "4 of 4 expected facts recorded", and the new concept is in section 3's Detail.
- [ ] Lane 6. An Editor owning nothing chooses **Add This Fact** on the same gap and submits. Save `guides-gap-suggested.png`. Pass when the outcome says the fact waits for the owner as a suggestion, and the gap still reads "not yet recorded".
- [ ] Lane 7. The Editor opens **Edit Brief** on section 1, moves a footnote chip with cut and paste by keyboard, and saves. Save `guides-brief-saved.png`. Pass when the status region announces "Saved version 3." over the harness's version 2, and a reload shows the chip at its new place.
- [ ] Lane 8. The Editor opens **Edit Brief** on section 1 and saves with no change. Save `guides-no-op-save.png`. Pass when the status region announces "No changes to save. Version 2 stands.", `psql` counts the same `write_up_version` rows before and after, and `git rev-parse main` on the bare repository is unchanged.
- [ ] Lane 9. A concept cited by section 4 is edited by its owner, then the Viewer reads section 4. Save `guides-needs-review.png`. Pass when section 4 shows "Needs review" with "Cites a concept that changed" as text.
- [ ] Lane 10. The guide page under the accessibility gate. Run the axe fixture in light and dark, a keyboard traversal, an inline `toMatchAriaSnapshot`, and `listsItsKeystrokes` with the page's keys, then leave with an unsaved draft. Save `guides-accessible.png`. Pass when axe reports no violation, every action is reached by keyboard, `?` lists the four keystrokes, and leaving asks once to confirm.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The time from opening the guide's address to its last section heading showing, in ms, for the eight-section guide with 25 footnotes. The time from the **Save Brief** keystroke to "Saving the Brief.", from `theActionLandedWithinItsBudget(page, "save the Brief")`, and to "Saved version". The concept page's render time as the runner's control.
- [ ] Probe. In two lane worktrees, one at trunk and one at head, run `pnpm --filter @better-answers/web exec playwright test e2e/knowledge/concept-page.spec.ts e2e/knowledge/guides.spec.ts -g "within its budget" --project chromium`, five rounds, alternating trunk and head, with `CI` unset so the action budget is held.
- [ ] Baseline. Measure trunk first. The control is the median of trunk's "renders within its budget, read by keyboard alone" in `e2e/knowledge/concept-page.spec.ts`. Trunk lacks the Guides page, so the guide's render and save carry absolute budgets.
- [ ] Rule. Fail when the guide's render median reaches 1,000 ms (the list budget), when the save's acknowledgement median reaches 100 ms (its action budget), when the saved result's median reaches 1,000 ms, or when the concept page's median at head exceeds trunk's by more than 10%.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 4, 5, 7 and 8 screenshots into `docs/plans/media/s3/BA-236-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `docs/plans/media/s3/BA-236-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Copy a section's Brief with resolvable footnotes and record its usage (BA-237)

**Depends on.** BA-236.

**Rules and comments read.** `CODING_STANDARDS.md` Data and secrets line 20 (no prompt or completion content reaches a row), so a `usage` row holds ids and a version, never the copied text. `CODING_STANDARDS.md` Tests line 7, so the renderer is proven through the `./guides` face. `packages/core/AGENTS.md` Principal line 5 (the copy reads under the reader's read predicate) and Audit lines 9 and 16 (a copy is not an Admin action, a governed write or a platform action, so it writes a usage row and no audit event). `apps/web/AGENTS.md` lines 3 and 4 (the outcome is announced, and copying has a keystroke). `packages/schema/test/support/test-title.ts` (titles of 10 words at most). Each new test is broken once and seen to fail, and a refusal test differs from a valid input in one field. `docs/agents/mutation-triage.md` Staging lines 41 to 47 (the renderer's expected output is a literal). `.agents/playbooks/verification.md` (what a paste keeps is proven on the served build). BA-237 has no Linear comments.

**Files.**

- [ ] Edit `packages/core/src/guides/renderer.ts`.
- [ ] Create `packages/core/src/guides/copy.ts`.
- [ ] Edit `packages/core/src/guides/index.ts`.
- [ ] Create `packages/core/src/answering/usage.ts`.
- [ ] Edit `packages/core/src/answering/index.ts`.
- [ ] Edit `packages/core/test/guides/brief-renderer.test.ts`.
- [ ] Create `packages/core/test/guides/brief-copy.test.ts`.
- [ ] Edit `apps/api/src/trpc/knowledge.ts`.
- [ ] Edit `apps/api/tests/trpc/knowledge-procedures.test.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-knowledge.ts`.
- [ ] Edit `apps/web/e2e/harness.ts`.
- [ ] Edit `apps/web/src/features/knowledge/guide-page.tsx`.
- [ ] Edit `apps/web/src/features/knowledge/guide-words.ts`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-api.ts`.
- [ ] Create `apps/web/src/features/knowledge/brief-clipboard.ts`.
- [ ] Create `apps/web/test/knowledge/brief-clipboard.test.ts`.
- [ ] Create `apps/web/e2e/knowledge/guide-copy.spec.ts`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0015.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0014.md`.

**Build.**

- [ ] Name the personas in the PR body. The copy serves the Bid Writer, whose trust breaks when "copying loses the citations" (`docs/personas/personas.md:143`), so every number in a paste resolves to a source. It serves the Occasional Expert, who forgets the tool (`:233`), so the outcome says in words what was copied and that numbers start at 1 in each copy.
- [ ] In `packages/core/src/guides/renderer.ts`, add the `"clipboard"` profile to `renderBrief`. It takes the markdown and the footnotes `footnotesOf` already filtered by the reader's predicate, never the predicate itself. It returns `{ html, text }`. The HTML has superscript numbers and a trailing **Sources** list naming each concept's title, its source and locator, and the wording used. The text has bracketed numbers and the same list. Neither carries a trust word or a platform link (ADR 0015 A L25). A marker with no footnote is dropped and the rest renumbered, so every number has a definition.
- [ ] In `packages/core/src/answering/usage.ts`, add `recordUsage(principal, tx, { subject, act })` on the `usage` table BA-234 created, declared through `recordUsageAction` so `packages/core/test/gates/face-admission.test.ts` holds. `act` is `copied` or `exported`. The row names the write-up id and the version copied, the act, the time and `human:<person id>` (ADR 0014 Live L45), and never any text. Export it from the `./answering` face.
- [ ] In `packages/core/src/guides/copy.ts`, add two acts through the `./guides` face. `briefCopy(principal, tx, { writeUpId })` reads the latest version and `footnotesOf` and returns the clipboard rendering with its version, writing nothing. `recordCopy(principal, door, { writeUpId, version })` checks the reader may read that version and calls `recordUsage` with `copied`.
- [ ] Gate both acts on the action threshold the guide definition sets for the reader's role, whatever layer is shown (ADR 0004 A L42). Read the `guide_role` row for the guide and `principal.role`, which BA-234 keys on the three platform roles. The threshold names a trust rung a paste must stand on (archived ADR 0004, amendment of 27/08/2026), so a section whose concepts fall below the reader's role's rung is refused with `below-action-threshold`, and the page says why instead of offering **Copy**. In BA-235's fixture table a Viewer may copy section 3 and no other section.
- [ ] In `apps/api/src/trpc/knowledge.ts`, add `knowledge.briefCopy` as a query and `knowledge.recordCopy` as a mutation.
- [ ] In `apps/web/src/features/knowledge/brief-clipboard.ts`, write the clipboard inside the keystroke or click that asked for it. Call `navigator.clipboard.write` with one `ClipboardItem` whose `text/html` and `text/plain` blobs are promises resolved from `knowledge.briefCopy`, so the write keeps the user gesture. Call `knowledge.recordCopy` only after the write resolves, so a refused clipboard writes no usage row.
- [ ] On the guide page, add **Copy** to each section with a Brief, with its keystroke listed under `?`. The `status` region says "Copying section 3." at once, then the outcome, either "Copied section 3 with 4 footnotes. Numbers start at 1 in each copy." or "Your browser did not allow copying. Nothing was copied."
- [ ] In `apps/web/e2e/knowledge/guide-copy.spec.ts`, add "acknowledges a copy within its budget", which clocks the keystroke to "Copying section 3." with `clockTheNextKey` and `theActionLandedWithinItsBudget(page, "copy")`, then times "Copied section 3" against 1,000 ms.
- [ ] In `apps/api/tests/support/harness/harness-knowledge.ts` and `apps/web/e2e/harness.ts`, add the new harness action `usageOf`, which reads a write-up's `usage` rows for a lane's predicate.
- [ ] Edit ADR 0015 to record the clipboard profile, the restart of numbers per copy, and the paste matrix's split between the browser suite and the operator. Edit ADR 0014 to record that a copy writes one `usage` row per write-up version and no audit event.

**You see.**

- [ ] A Bid Writer, an Editor in `finance`, copies section 3 and hears "Copied section 3 with 4 footnotes. Numbers start at 1 in each copy." Section 3's four includes are BA-235's fixture table's.
- [ ] The clipboard's `text/plain` ends with a **Sources** list numbered 1 to 4, and `usageOf` returns one row with act `copied` and the version copied.
- [ ] The operator's paste into Word desktop, Word on the web and Google Docs keeps the superscripts and the Sources list, and **Keep Text Only** keeps the bracketed numbers.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/guides/brief-renderer.test.ts` gains "the clipboard profile carries no trust word", with the expected HTML and text as literals. Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-renderer.test.ts -t "the clipboard profile carries no trust word"`.
- [ ] `packages/core/test/guides/brief-renderer.test.ts` gains "every clipboard number has a Sources entry". Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-renderer.test.ts -t "every clipboard number has a Sources entry"`.
- [ ] `packages/core/test/guides/brief-copy.test.ts` gains "a recorded copy writes one usage row naming the version". Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-copy.test.ts -t "a recorded copy writes one usage row naming the version"`.
- [ ] `packages/core/test/guides/brief-copy.test.ts` gains "a usage row holds no copied text". Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-copy.test.ts -t "a usage row holds no copied text"`.
- [ ] `packages/core/test/guides/brief-copy.test.ts` gains "a copy below the role's threshold is refused", whose reader differs from an admitted one in role alone. Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-copy.test.ts -t "a copy below the role's threshold is refused"`.
- [ ] `packages/core/test/guides/brief-copy.test.ts` gains "a recorded copy writes no audit event". Run `pnpm --filter @better-answers/core exec vitest run test/guides/brief-copy.test.ts -t "a recorded copy writes no audit event"`.
- [ ] `apps/api/tests/trpc/knowledge-procedures.test.ts` gains "copies a Brief, then records its usage". Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/knowledge-procedures.test.ts -t "copies a Brief, then records its usage"`.
- [ ] `apps/web/test/knowledge/brief-clipboard.test.ts` gains "a refused clipboard records no usage", using `apps/web/test/support/clipboard-stand-in.ts`. Run `pnpm --filter @better-answers/web exec vitest run test/knowledge/brief-clipboard.test.ts`.
- [ ] Run `pnpm --filter @better-answers/core exec vitest run test/gates/face-admission.test.ts`, since `recordUsage` and both copy acts are declared actions.
- [ ] Break each new test once in the production line it guards and see it fail.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. An Editor opens the seeded guide at trunk and at head. Trunk lacks **Copy**, so record that and gate the copy and its usage row at head in the new `e2e/knowledge/guide-copy.spec.ts`. `e2e/knowledge/guides.spec.ts` passes at head with no assertion edits. Save `copy-regression.png`. Pass when trunk shows no **Copy**, head copies section 3 with one `usage` row written, and `e2e/knowledge/guides.spec.ts` passes.
- [ ] Lane 2. The Bid Writer, an Editor in `finance`, copies section 3, whose four includes BA-235's fixture table gives, and the lane reads the clipboard with `navigator.clipboard.read()` under `clipboard-read`, as `e2e/app/home.spec.ts:167` reads text. Save `copy-html.png`. Pass when `text/html` holds superscripts 1 to 4 and a Sources list of four entries, each with the concept's title and its source.
- [ ] Lane 3. The same copy's `text/plain`. Save `copy-text.png`. Pass when it holds the bracketed numbers 1 to 4 with a matching Sources list, and none of the closed set of trust words appears.
- [ ] Lane 4. An outside Viewer, not in `finance`, copies section 3, which cites the Restricted professional indemnity concept. Save `copy-withheld.png`. Pass when the numbers run 1 to 3 with no gap, no marker is left without a Sources entry, and the withheld title appears nowhere in either format.
- [ ] Lane 5. The Editor copies section 3, then `usageOf` reads its rows. Save `copy-usage.png`. Pass when exactly one row names the write-up, its latest version, the act `copied` and the Editor's person id, and no column holds the Brief's text.
- [ ] Lane 6. The Editor copies section 4, then section 6, which both cite the Cyber Essentials Plus certificate (BA-235's fixture table). Save `copy-reused.png`. Pass when each copy numbers from 1, each resolves the certification in its own Sources list, and two usage rows exist.
- [ ] Lane 7. A Viewer opens section 7, which BA-235's fixture table puts below the Viewer's action threshold. Save `copy-threshold.png`. Pass when **Copy** is replaced by the reason in words, `knowledge.briefCopy` called through the harness answers `below-action-threshold`, and `usageOf` returns no row.
- [ ] Lane 8. The lane pastes the copy into a `contenteditable` region and into a `textarea` on a blank page in the same browser. Save `copy-paste-browser.png`. Pass when the region keeps the superscripts and the Sources list, and the `textarea` keeps the bracketed numbers.
- [ ] Lane 9. The lane denies `clipboard-write` and the Editor copies section 3. Save `copy-refused.png`. Pass when the status region says the browser did not allow copying and `usageOf` returns no new row.
- [ ] Lane 10. The guide page under the accessibility gate after this change. Run the axe fixture in light and dark, a keyboard traversal and `listsItsKeystrokes` with the copy keystroke. Save `copy-accessible.png`. Pass when axe reports no violation, **Copy** is reached and run by keyboard, and the outcome is announced in the `status` region.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The time from the **Copy** keystroke to "Copying section 3.", through `theActionLandedWithinItsBudget(page, "copy")`, and to "Copied section 3". The guide page's render time at trunk and head, since the copy action is added to every section.
- [ ] Probe. In a trunk and a head lane worktree, run `pnpm --filter @better-answers/web exec playwright test e2e/knowledge/guides.spec.ts e2e/knowledge/guide-copy.spec.ts -g "within its budget" --project chromium`, five rounds, alternating trunk and head, with `CI` unset.
- [ ] Baseline. Measure trunk first. Trunk has the Guides page from BA-236, so its render median is the baseline. Trunk lacks the copy, so the copy carries an absolute budget.
- [ ] Rule. Fail when the acknowledgement's median reaches 100 ms (the action budget), when the copied outcome's median reaches 1,000 ms (the read budget, since the copy waits on a read), or when the guide page's render median at head exceeds trunk's by more than 10%.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 4 and 8 screenshots into `docs/plans/media/s3/BA-237-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `docs/plans/media/s3/BA-237-review.mp4`.
- [ ] The operator pastes the section 3 copy by hand into Word desktop, Word on the web, Google Docs, and Word with **Keep Text Only**, and saves one screenshot per cell as `docs/plans/media/s3/BA-237-review-paste-<cell>.png`. The browser suite cannot reach these four cells.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Build All Knowledge, Kinds and Exports on Knowledge's Curation pages (BA-238)

**Depends on.** BA-12 and BA-237. The guide snapshot uses BA-237's renderer and `recordUsage`, so this PR starts after BA-237 merges, not after BA-12 alone.

**Rules and comments read.** `packages/core/AGENTS.md` Principal line 5 (each read runs under the read predicate, so a count never reveals a withheld concept), and Audit lines 9, 10, 12 and 16 (each export is an Admin action with one audit event, and a bulk owner change is N events sharing a batch id). `CONCEPTS.md` *export* (an Admin action with an audit row) and *usage* (a guide snapshot takes write-ups out). `apps/web/AGENTS.md` lines 3 to 5 (bulk work is select-then-command, and pages say *knowledge base*, never *bundle*). `packages/design-system/readme.md` section 2 (UK long-form dates in the review table). `.claude/skills/mutation-testing/SKILL.md` (the owner admission on these reads gets `/mutation-testing`). `.agents/playbooks/knowledge.md` (the route spec moves in the same PR). BA-238 has no Linear comments.

**Files.**

- [ ] Edit `apps/web/src/shared/navigation.ts`.
- [ ] Edit `apps/web/src/app/router.tsx`.
- [ ] Create `apps/web/src/features/knowledge/all-knowledge-page.tsx`.
- [ ] Create `apps/web/src/features/knowledge/kinds-page.tsx`.
- [ ] Create `apps/web/src/features/knowledge/exports-page.tsx`.
- [ ] Create `apps/web/src/features/knowledge/curation-words.ts`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-api.ts`.
- [ ] Edit `apps/api/src/trpc/knowledge.ts`.
- [ ] Create `packages/core/src/concepts/curation.ts`.
- [ ] Create `packages/core/src/concepts/knowledge-export.ts`.
- [ ] Edit `packages/core/src/concepts/owners.ts`.
- [ ] Edit `packages/core/test/concepts/owners.test.ts`.
- [ ] Edit `packages/core/src/concepts/index.ts`.
- [ ] Edit `packages/core/src/store/git/index.ts`.
- [ ] Edit `packages/core/src/guides/renderer.ts`.
- [ ] Create `packages/core/test/concepts/curation.test.ts`.
- [ ] Create `packages/core/test/concepts/knowledge-export.test.ts`.
- [ ] Create `packages/core/test/concepts/curation-budget.test.ts`.
- [ ] Edit `apps/api/tests/trpc/knowledge-procedures.test.ts`.
- [ ] Create `apps/web/e2e/knowledge/all-knowledge.spec.ts`.
- [ ] Create `apps/web/e2e/knowledge/kinds.spec.ts`.
- [ ] Create `apps/web/e2e/knowledge/exports.spec.ts`.
- [ ] Edit `apps/web/test/shared/navigation.test.ts`.
- [ ] Edit `docs/specs/route/s3.md` where this unit moves a page. Edit `docs/solutions/architecture-patterns/adr-0051.md` only if the navigation-list decision itself changes.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0026.md`.
- [ ] Edit `docs/solutions/architecture-patterns/adr-0014.md`.

**Build.**

- [ ] Name the personas in the PR body. All Knowledge serves the Knowledge Curator, who wants a filter that survives moving between views and to see who owns a concept and who checked it and when (`docs/personas/personas.md:202-206`), and the Founder-Operator, who wants what to do next (`:85`). Kinds serves the Curator, who maintains the kinds (`:183`), so it is a full sortable table. Exports serves the Founder-Operator, who takes knowledge out weekly at most (`:67`) and is cut by a technical word in a setting (`:86`), so it offers three choices with plain names and says *knowledge base*.
- [ ] In `packages/core/src/concepts/curation.ts`, add `readAllKnowledge(principal, tx, { collections, kind, cursor })` and `readKinds(principal, tx)`. Both read `concept_index` under `readableClause` and admit an Admin or an owner, through the owner admission BA-12 adds. An Editor who owns nothing is refused with `owner-forbids`, BA-231's word for a refusal by ownership. `readAllKnowledge` returns a page of 50 rows with title, kind, collection, trust word, owner, and last verification with its person and UK long-form date, in one joined query. `readKinds` returns one row per kind with its count and its count per collection.
- [ ] On All Knowledge, a non-Admin owner opens filtered to the collections they own, and can clear the filter. The filter, sort and page live in the address through `apps/web/src/shared/address/list-address.ts`, so they survive a visit to a concept and back.
- [ ] Selection on All Knowledge serves one command in S3, **Set Owner**, for Admins. It sets a per-concept owner override on every selected concept through `nameOwnerOfEach`, the next box. An owner who is not an Admin sees no selection. Rows are selected by keystroke and the command runs from `apps/web/src/shared/list/selection-bar.tsx`.
- [ ] Add `nameOwnerOfEach(principal, tx, { iris, personId })` to `packages/core/src/concepts/owners.ts`, declared `ADMIN_ALONE`. In one transaction it upserts each concept's override and writes one `knowledge.owner.named` event per concept, all sharing one batch id (`packages/core/AGENTS.md`, *Audit*). BA-231's `nameOwner` names one subject and carries no batch id, so it cannot serve a bulk command. Add `knowledge.setOwners` over it to `apps/api/src/trpc/knowledge.ts`.
- [ ] Kinds is read-only (KTD15, S7 renames kinds). It draws a sortable `GridTable` (`apps/web/src/shared/list/grid-table.tsx`) with one row per kind, its count, and a disclosure listing its count per collection. A filter shows the kinds with two or fewer concepts (ADR 0026 A L30). It offers no rename and no merge.
- [ ] In `packages/core/src/store/git/index.ts`, add `bundleSnapshot(principal, door)`, which returns a zip of `knowledge/` at the knowledge base's head through `git archive`, so `guides/` stays out.
- [ ] In `packages/core/src/concepts/knowledge-export.ts`, add three acts declared with `ADMIN_ALONE`, each behind `requireFreshConfirmation` (`packages/core/src/kernel/principal/freshness.ts`) and each writing one audit event after its read, as `exportAuditLog` does (`packages/core/src/members/audit-log/audit-export.ts`).
  - [ ] `exportBundleSnapshot` returns the zip and records `knowledge.bundle.exported` with the head SHA and the file count. It writes no `usage` row, since a snapshot of every file takes no one concept into a document.
  - [ ] `exportRecords` returns one CSV per records family the tree holds, at least owners (collection defaults and overrides), verifications and usage, and records `knowledge.records.exported` with the families named.
  - [ ] `exportGuideSnapshot` renders every section's Brief through a new `"snapshot"` profile of `renderBrief`, with trust words, labelled with the date and "Not maintained" (ADR 0004 A L21). It writes one `usage` row with act `exported` per write-up version, and records `knowledge.guide.exported`.
- [ ] In `apps/web/e2e/knowledge/all-knowledge.spec.ts`, add "renders All knowledge's first page within its budget", modelled on `e2e/knowledge/concept-page.spec.ts:776`, which times the first page's last row against 1,000 ms.
- [ ] Run `pnpm --filter @better-answers/core generate:audit-actions`. Add `knowledge.allKnowledge`, `knowledge.kinds`, `knowledge.exportBundle`, `knowledge.exportRecords` and `knowledge.exportGuide` to `apps/api/src/trpc/knowledge.ts`.
- [ ] In `apps/web/src/shared/navigation.ts`, set All Knowledge, Kinds and Exports to `built: true`, and drop `owners: "of-a-collection"`, which BA-12 gave Exports, so it is Admin-only (KTD15). Add their `BUILT_PAGES` entries in `apps/web/src/app/router.tsx`.
- [ ] Each page opens through `PageHead`, then one `ListHead` row with the list's count. The Exports page lists its three exports as rows, named **Knowledge Base Snapshot**, **Records** and **Guide Snapshot**, each with a sentence on what it holds and a download action. A stale confirmation opens the reconfirm step and then resumes the download. Put every word in `apps/web/src/features/knowledge/curation-words.ts`, and give each action a keystroke listed under `?`.
- [ ] Record in `docs/specs/route/s3.md` that Exports is Admin-only with no owner flag, that S3's Kinds is read-only counts with the tail filter, and what the records export holds in S3 and that a knowledge base snapshot is not usage.

**You see.**

- [ ] An owning Editor's Curation menu lists All Knowledge, Kinds and Collections and Owners, and no Exports.
- [ ] An Admin's Exports page lists **Knowledge Base Snapshot**, **Records** and **Guide Snapshot**, and the snapshot downloads a zip holding `knowledge/manifest.yaml`.
- [ ] An Editor owning nothing meets the not-found page at `/knowledge/all-knowledge`, `/knowledge/kinds` and `/knowledge/exports`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/concepts/curation.test.ts` gains "an Editor owning nothing is refused All knowledge", whose reader differs from an owning Editor in ownership alone, and asserts `owner-forbids`. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/curation.test.ts -t "an Editor owning nothing is refused All knowledge"`.
- [ ] `packages/core/test/concepts/curation.test.ts` gains "kind counts leave out a concept the reader cannot read". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/curation.test.ts -t "kind counts leave out a concept the reader cannot read"`.
- [ ] `packages/core/test/concepts/curation.test.ts` gains "All knowledge names each concept's owner and last checker". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/curation.test.ts -t "All knowledge names each concept's owner and last checker"`.
- [ ] `packages/core/test/concepts/owners.test.ts` gains "names one owner of many under one batch id". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/owners.test.ts -t "names one owner of many under one batch id"`.
- [ ] `packages/core/test/concepts/knowledge-export.test.ts` gains "an owning Editor is refused every export", whose reader differs from an Admin in role alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/knowledge-export.test.ts -t "an owning Editor is refused every export"`.
- [ ] `packages/core/test/concepts/knowledge-export.test.ts` gains "an export past its confirmation window is refused". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/knowledge-export.test.ts -t "an export past its confirmation window is refused"`.
- [ ] `packages/core/test/concepts/knowledge-export.test.ts` gains "the snapshot holds every concept file and no skeleton", read from a real bare repository. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/knowledge-export.test.ts -t "the snapshot holds every concept file and no skeleton"`.
- [ ] `packages/core/test/concepts/knowledge-export.test.ts` gains "a guide snapshot writes one usage row per write-up" and "each export writes one audit event". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/knowledge-export.test.ts -t "writes one"`.
- [ ] `apps/api/tests/trpc/knowledge-procedures.test.ts` gains "reads Kinds through the knowledge router". Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/knowledge-procedures.test.ts -t "reads Kinds through the knowledge router"`.
- [ ] `apps/web/test/shared/navigation.test.ts` gains "shows an owning Editor Curation without Exports". Run `pnpm --filter @better-answers/web exec vitest run test/shared/navigation.test.ts -t "shows an owning Editor Curation without Exports"`.
- [ ] Break each new test once in the production line it guards and see it fail. Then run `/mutation-testing` over `packages/core/src/concepts/curation.ts` and `knowledge-export.ts`, since each carries admission.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. An Admin opens `/knowledge/all-knowledge`, `/knowledge/kinds` and `/knowledge/exports` at trunk and at head. Trunk shows the not-found page for all three, so record that and gate the three pages at head in the new `e2e/knowledge/all-knowledge.spec.ts`, `e2e/knowledge/kinds.spec.ts` and `e2e/knowledge/exports.spec.ts`. `e2e/app/frame.spec.ts` and `e2e/app/home.spec.ts` pass with no assertion edits. Save `curation-regression.png`. Pass when trunk shows not-found three times, head draws all three pages, and both existing specs pass.
- [ ] Lane 2. An owning Editor opens All Knowledge, moves to a concept and back. Save `all-knowledge-owner.png`. Pass when the table opens filtered to the owned collection, names each concept's owner and last checker with a UK long-form date, and the filter survives the visit.
- [ ] Lane 3. An Admin selects three rows by keystroke and runs **Set Owner** to a Viewer. Save `all-knowledge-set-owner.png`. Pass when the three rows name the Viewer as owner and System › Audit Log shows three events sharing one batch id.
- [ ] Lane 4. An Editor owning nothing opens each of the three addresses. Save `curation-not-found.png`. Pass when each shows the not-found page offering their home, and the rail shows no Curation group.
- [ ] Lane 5. An owning Editor opens Kinds on a fixture with a Restricted concept outside their audience. Save `kinds-counts.png`. Pass when each kind's count and per-collection counts match the fixture's readable concepts, and the Restricted concept is counted nowhere.
- [ ] Lane 6. The owning Editor turns on the two-or-fewer filter and looks for an action. Save `kinds-read-only.png`. Pass when only kinds with two or fewer concepts show, and the inline aria snapshot holds no rename, merge or editable cell.
- [ ] Lane 7. An owning Editor opens `/knowledge/exports` directly and calls `knowledge.exportBundle` through the harness. Save `exports-owner-refused.png`. Pass when the page is not found, Exports is absent from the menu, and the api answers `role-forbids`.
- [ ] Lane 8. An Admin downloads **Knowledge Base Snapshot**. Save `exports-snapshot.png`. Pass when the zip holds `knowledge/manifest.yaml` and every seeded concept file, holds no `guides/` path, and the audit log shows one `knowledge.bundle.exported` event.
- [ ] Lane 9. An Admin whose confirmation is older than the window downloads **Guide Snapshot** and **Records**, confirming through `reconfirmedOn`. Save `exports-guide-records.png`. Pass when the reconfirm step shows first, the guide's markdown carries its date and "Not maintained", `usageOf` returns one `exported` row per section, and the records download holds the owner rows.
- [ ] Lane 10. The three pages under the accessibility gate. Run the axe fixture in light and dark, a keyboard traversal, an inline `toMatchAriaSnapshot` and `listsItsKeystrokes` on each. Save `curation-accessible.png`. Pass when axe reports no violation, selection and every download are reached by keyboard, and no page text says "bundle".

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. In the new `packages/core/test/concepts/curation-budget.test.ts`, the time in ms for `readAllKnowledge`'s first page, for `readKinds`, and for `exportBundleSnapshot`, at 3,000 concepts. The index rows are seeded with `seedingWith` as `seedWideMap` does in `packages/core/test/concepts/map-budget.test.ts`, and the snapshot runs on a bare repository of 3,000 files. Each figure is written by `recordFigures`. In the browser, the All Knowledge first page's render time.
- [ ] Probe. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/map-budget.test.ts test/concepts/curation-budget.test.ts` in a trunk and a head lane worktree, five rounds, alternating. Run `pnpm --filter @better-answers/web exec playwright test e2e/knowledge/all-knowledge.spec.ts -g "within its budget" --project chromium` at head, five rounds.
- [ ] Baseline. Measure trunk first. The control is `map-budget.test.ts`'s recorded figures at trunk. Trunk lacks the three reads, so they carry absolute budgets.
- [ ] Rule. Fail when the All Knowledge first page or Kinds reaches 200 ms at 3,000 concepts, when the snapshot reaches 5,000 ms, when the page's render median reaches 1,000 ms, or when any `map-budget.test.ts` figure at head exceeds trunk's by more than 10%.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 5, 8 and 9 screenshots into `docs/plans/media/s3/BA-238-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `docs/plans/media/s3/BA-238-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Browse the knowledge base beside Search (BA-239)

**Depends on.** BA-12.

**Rules and comments read.** `packages/core/AGENTS.md` Principal line 5 (the browser reads the concept index under the read predicate, so neither a row nor a count shows a withheld concept). `apps/web/AGENTS.md` lines 3 to 5 (a tree needs a role, a name and a focus order, every action has a keystroke, and the page says *knowledge base*, never *bundle*, per `CONCEPTS.md` *bundle*). `CODING_STANDARDS.md` Dependencies lines 31 and 32 (a new dependency names its version source), which composing avoids. `apps/api/AGENTS.md` line 3 (a lift carries `THIRD_PARTY_NOTICES.md` and a refresh test), which does not apply, because the prototype chose to compose. `.agents/playbooks/knowledge.md` (the page is named in the same PR). BA-239 has no Linear comments.

**Files.**

- [ ] Edit `apps/web/src/shared/navigation.ts`.
- [ ] Edit `apps/web/src/app/router.tsx`.
- [ ] Edit `apps/web/src/shared/icon.tsx`.
- [ ] Create `apps/web/src/features/knowledge/knowledge-base-page.tsx`.
- [ ] Create `apps/web/src/features/knowledge/knowledge-tree.tsx`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-words.ts`.
- [ ] Edit `apps/web/src/features/knowledge/knowledge-api.ts`.
- [ ] Edit `apps/api/src/trpc/knowledge.ts`.
- [ ] Create `packages/core/src/concepts/reading/browse.ts`.
- [ ] Edit `packages/core/src/concepts/index.ts`.
- [ ] Create `packages/core/test/concepts/reading/browse.test.ts`.
- [ ] Create `packages/core/test/concepts/reading/browse-budget.test.ts`.
- [ ] Edit `apps/api/tests/trpc/knowledge-procedures.test.ts`.
- [ ] Edit `apps/api/tests/support/harness/harness-knowledge.ts`.
- [ ] Edit `apps/web/e2e/harness.ts`.
- [ ] Create `apps/web/e2e/knowledge/knowledge-base.spec.ts`.
- [ ] Create `apps/web/test/knowledge/knowledge-tree.test.tsx`.
- [ ] Edit `apps/web/test/shared/navigation.test.ts`.
- [ ] Edit `CONCEPTS.md`.
- [ ] Edit `docs/specs/route/s3.md` where this unit moves a page. Edit `docs/solutions/architecture-patterns/adr-0051.md` only if the navigation-list decision itself changes.

**Build.**

- [ ] Compose the tree from the app's own parts, as Appendix A and KTD18 settled. The prototype's composed tree added 3,810 B of initial JavaScript and failed no axe rule, where the Finder added 142,004 B, failed four axe rules and crashed the page until forked. Add `@tanstack/react-virtual` only if a spec shows expand-all at 3,000 concepts past the perf rule below.
- [ ] Name the personas in the PR body. The page serves the Knowledge Curator, who watches coverage to find gaps (`docs/personas/personas.md:182`), and the Founder-Operator, who wants to see what the company knows and what it is missing (`:95`). The Occasional Expert "Searches for a specific topic. Does not browse" and does not know how things are classified (`:231`, `:238`), so the page stays light, sits after Search and Guides, and never replaces Search as Browse's first page.
- [ ] In `packages/core/src/concepts/reading/browse.ts`, add `readKnowledgeTree(principal, tx)`, declared with `ANY_ROLE`, returning each collection with its count and each kind under it with its count, read from `concept_index` under `readableClause`. A concept directly under `knowledge/` falls under "No collection" (`CONCEPTS.md` *collection*). A collection holding only concepts the reader cannot read is absent.
- [ ] Add `readKnowledgeBranch(principal, tx, { collection, kind, cursor })` beside it, returning a page of 50 concepts with title, kind and trust word, under the same predicate, ordered by title.
- [ ] Add `knowledge.tree` and `knowledge.branch` to `apps/api/src/trpc/knowledge.ts`.
- [ ] In `apps/web/src/features/knowledge/knowledge-tree.tsx`, build a WAI-ARIA tree view from the app's own parts. It has `role="tree"` named "Collections and kinds", `treeitem` nodes with `aria-expanded`, `aria-level`, `aria-setsize` and `aria-posinset`, and one roving `tabIndex`. Arrow keys move and open, Home and End jump, and a typed letter moves to the next item starting with it. It uses Phosphor's `caret-right` and `caret-down` through `Icon`, and Tailwind classes in the blueprint register (square corners, hairlines, no shadow at rest). It adds no npm dependency and no registry item.
- [ ] In `apps/web/src/features/knowledge/knowledge-base-page.tsx`, draw the page head through `PageHead`, the tree, and beside it the open kind's concepts in `GridTable` (`apps/web/src/shared/list/grid-table.tsx`) with its count. Enter on a row opens the concept page at Search's detail address. The open collection and kind live in the address through `apps/web/src/shared/address/address-query.ts`, so Back returns to the same node. Below the wide breakpoint the list stacks under the tree, and focus is never hidden.
- [ ] In `apps/web/src/shared/navigation.ts`, add the page **Knowledge Base** to Browse after Guides, at `/knowledge/knowledge-base`, `built: true`, `seenBy: EVERY_ROLE`, with the new icon name `knowledge-base`. Add that name to `IconName` and `GLYPHS` in `apps/web/src/shared/icon.tsx`, mapped to Phosphor's `TreeStructure`. Add its `BUILT_PAGES` entry in `apps/web/src/app/router.tsx`.
- [ ] Put the page words in `apps/web/src/features/knowledge/knowledge-words.ts`. The page says *knowledge base* and *collection* and never *bundle*. Code names follow the page (`KnowledgeBasePage`, `readKnowledgeTree`), never the brief's *bundle browser*.
- [ ] In `apps/api/tests/support/harness/harness-knowledge.ts` and `apps/web/e2e/harness.ts`, add the new harness action `seedConceptIndex`. It writes `concept_index` rows directly through the schema factory, as `seedWideMap` does, so a lane reaches 3,000 concepts without 3,000 governed writes. Its concepts have no file, so a lane on them never opens a concept page.
- [ ] Add **Knowledge Base** to Browse beside Search and Guides, seen by every role, reading the concept index under the read predicate. State that it is not the map explorer under Next, since it lists the index and walks no links. Add to the *knowledge base* entry in `CONCEPTS.md` that Knowledge › Knowledge Base lists it by collection and kind.
- [ ] Edit the outline in `apps/web/test/shared/navigation.test.ts:60-80` so Browse reads Search, Guides and Knowledge Base.
- [ ] In `apps/web/e2e/knowledge/knowledge-base.spec.ts`, add "renders the knowledge tree within its budget", modelled on `e2e/knowledge/concept-page.spec.ts:776`, which times the tree and the open kind's first page against 1,000 ms on the 3,000-concept seed.

**You see.**

- [ ] A Viewer opens Knowledge › Knowledge Base and sees a tree named "Collections and kinds" listing each collection with its count.
- [ ] Opening a kind lists its concepts beside the tree, and Enter on one opens its concept page.
- [ ] No text on the page says "bundle".

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/core/test/concepts/reading/browse.test.ts` gains "counts only the concepts the reader may read". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/reading/browse.test.ts -t "counts only the concepts the reader may read"`.
- [ ] `packages/core/test/concepts/reading/browse.test.ts` gains "an outside Viewer never sees a withheld concept", whose reader differs from an inside Viewer in group alone. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/reading/browse.test.ts -t "an outside Viewer never sees a withheld concept"`.
- [ ] `packages/core/test/concepts/reading/browse.test.ts` gains "a concept outside every collection falls under No collection". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/reading/browse.test.ts -t "a concept outside every collection falls under No collection"`.
- [ ] `packages/core/test/concepts/reading/browse.test.ts` gains "lists a kind's concepts fifty at a time". Run `pnpm --filter @better-answers/core exec vitest run test/concepts/reading/browse.test.ts -t "lists a kind's concepts fifty at a time"`.
- [ ] `apps/api/tests/trpc/knowledge-procedures.test.ts` gains "reads the knowledge tree through the knowledge router". Run `pnpm --filter @better-answers/api exec vitest run tests/trpc/knowledge-procedures.test.ts -t "reads the knowledge tree through the knowledge router"`.
- [ ] `apps/web/test/knowledge/knowledge-tree.test.tsx` gains "moves focus between tree items by arrow keys", "opens a collection with the right arrow" and "a typed letter moves to the next match". Run `pnpm --filter @better-answers/web exec vitest run test/knowledge/knowledge-tree.test.tsx`.
- [ ] Break each new test once in the production line it guards and see it fail.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. A Viewer opens `/knowledge/knowledge-base` at trunk and at head. Trunk lacks the page and shows the not-found page, so record that and gate the head in the new `e2e/knowledge/knowledge-base.spec.ts`. `e2e/knowledge/knowledge-search.spec.ts` and `e2e/app/jump-to.spec.ts` pass at head with no assertion edits. Save `knowledge-base-regression.png`. Pass when trunk shows not-found, head draws the tree, and both existing specs pass.
- [ ] Lane 2. A Viewer works the tree by keyboard alone, with arrows, Home, End and a typed letter. Save `knowledge-base-keyboard.png`. Pass when each key moves focus as the WAI-ARIA tree pattern says, and one Tab leaves the tree for the list.
- [ ] Lane 3. The Viewer opens the Company collection's `insurance policy` kind, opens a concept with Enter, then goes Back. Save `knowledge-base-open.png`. Pass when the concept page shows that concept, and Back returns with the same kind open and focused.
- [ ] Lane 4. An outside Viewer opens a collection holding a Restricted concept, and one holding only Restricted concepts. Save `knowledge-base-withheld.png`. Pass when the Restricted concept appears nowhere, the first collection's count leaves it out, and the second collection is absent.
- [ ] Lane 5. A concept seeded directly under `knowledge/`. Save `knowledge-base-no-collection.png`. Pass when it is listed under "No collection".
- [ ] Lane 6. An Admin, an Editor owning nothing and a Viewer each open Knowledge's menu and jump-to. Save `knowledge-base-every-role.png`. Pass when each sees **Knowledge Base** in Browse after Search and Guides, and jump-to lists it.
- [ ] Lane 7. `seedConceptIndex` seeds 3,000 concepts across ten collections, and a Viewer opens a kind of 400 and pages through it. Save `knowledge-base-3000.png`. Pass when the tree's counts sum to 3,000, the kind shows 50 rows with "400 concepts", and each page renders within 1,000 ms.
- [ ] Lane 8. The page's words. Run a text scan of the page and an inline `toMatchAriaSnapshot`. Save `knowledge-base-words.png`. Pass when the heading names the Browse group, the page is named "Knowledge Base", and no text holds "bundle".
- [ ] Lane 9. The page under the accessibility gate. Run the axe fixture in light and dark, a keyboard traversal and `listsItsKeystrokes`. Save `knowledge-base-accessible.png`. Pass when axe reports no violation, the tree is announced as "Collections and kinds", and every keystroke is listed under `?`.
- [ ] Lane 10. A narrow window of 375 px wide. Save `knowledge-base-narrow.png`. Pass when the list stacks under the tree, no content scrolls sideways, and the focused item is never hidden under the top band.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. In the new `packages/core/test/concepts/reading/browse-budget.test.ts`, the time in ms for `readKnowledgeTree` and for one page of `readKnowledgeBranch` at 3,000 concepts, seeded as `seedWideMap` does and written by `recordFigures`. The page's render time in the browser at 3,000 concepts. The web build's gzipped JavaScript size at trunk and head, which proves composition added no dependency weight.
- [ ] Probe. Run `pnpm --filter @better-answers/core exec vitest run test/concepts/map-budget.test.ts test/concepts/reading/browse-budget.test.ts` in a trunk and a head lane worktree, five rounds, alternating. Run `pnpm --filter @better-answers/web run build` at trunk and at head and sum the gzipped sizes of `apps/web/dist/assets/*.js`. Run `pnpm --filter @better-answers/web exec playwright test e2e/knowledge/knowledge-base.spec.ts -g "within its budget" --project chromium` at head, five rounds.
- [ ] Baseline. Measure trunk first. The controls are `map-budget.test.ts`'s figures and the build's gzipped size at trunk. Trunk lacks the page and its reads, so they carry absolute budgets.
- [ ] Rule. Fail when `readKnowledgeTree` or a branch page reaches 200 ms at 3,000 concepts, when the page's render median reaches 1,000 ms, when the build grows by more than 15 kB gzipped, or when any `map-budget.test.ts` figure at head exceeds trunk's by more than 10%.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 4 and 7 screenshots into `docs/plans/media/s3/BA-239-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `docs/plans/media/s3/BA-239-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator lands the PR with `gh pr merge <n> --squash --match-head-commit <sha>` once its own `check` is green, and reads it back with `gh pr view <n> --json state,mergedAt`.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Every Done when check in `docs/specs/route/s3.md` holds, each with the spec or test run that shows it.
- [ ] S3's row in `docs/specs/v01-route.md` reads `done`, its brief is deleted from `docs/specs/route/`, and its Block cell is unlinked, in the last PR.
- [ ] BA-95, BA-126, BA-127, BA-12, BA-144 and BA-146's first criterion are closed with the PR that met each.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

**The knowledge base browser composes a tree from the app's own parts.** The brief left one question open. Does the browser, which the brief calls the *bundle browser*, lift the Finder from `extend-hq/jevbox`, or compose the registries? A throwaway prototype on 21/10/2026 built both over 3,000 synthetic concept rows. Its scratch Vite app copied the versions in `apps/web/package.json` (React 19.3.1, Vite 8.3.4, Tailwind 4.3.3, `radix-ui` 1.8.1, Phosphor 2.1.10) and eight of the app's shadcn primitives. It lived in a `mktemp -d` directory outside the repository and was not kept, so it has no branch or SHA. Its screenshots are in `docs/plans/media/s3/`.

| What | Finder, lifted | Composed tree |
| --- | --- | --- |
| Initial JavaScript added, gzip | 142,004 B, or 139,409 B with its document viewers cut | 3,810 B |
| All JavaScript added, gzip | 2,155,969 B in 23 lazy chunks, plus 6,532,908 B of wasm | 3,810 B |
| axe rules failed, at the suite's tags | 4, two of them critical | 0 |
| Keyboard actions passed, of 9 | 9, reached after 10 Tabs | 9, reached after 3 Tabs |
| First rows, collapsed, median of 5 | 75.6 ms | 18.8 ms |
| Install | 31 files, 37 packages, a second primitive library, a Preact beta | 184 lines, no package |

- The Finder is written for shadcn's base-ui primitives, and this app uses the radix ones. Its Columns view crashed the page until a 13-line fork, and one of its menu buttons drew empty. `prototype-browser-finder-columns.png` shows the view after the fork.
- With all 3,000 rows handed in, the Finder painted its first rows at 107.6 ms and the tree at 116.5 ms. The two figures do not compare, because the Finder virtualises its rows and the tree paints all 3,080. The tree gains virtualisation by adding `@tanstack/react-virtual` if expand-all ever matters.
- `prototype-browser-composed.png` and `prototype-browser-finder.png` show each with a collection open and a concept selected.

**Unproven.** The Finder's development-mode warnings under React 19.3, whether both Preact copies are bundled, the rest of the Finder's fork, its gallery and icons views by keyboard, either variant under a screen reader, and the tree with a virtualiser. None of these could change the verdict, because each adds to the Finder's cost or is a later addition to the tree.

## Appendix B. Key technical decisions and the alternatives they reject

These key technical decisions (KTD) bind the program. Each names what lost and why.

- **KTD1. Ownership resolves from one table.** `concept_owner` holds either a collection's default owner or a concept's override, held apart by a CHECK. The owner of a concept is its override, else its collection's default, else nobody, and then Admins decide. A row written for every concept at mint was rejected. It copies what the collection default already answers, so the two can disagree.
- **KTD2. The owner or an Admin writes and decides.** Direct write, accept and decline admit the concept's owner or an Admin, read inside the act's own transaction beside the member row it holds `FOR SHARE`. A role threshold was rejected, because ownership is per concept and a Viewer may own one. `BUNDLE_WRITERS` goes. Its two other callers, the manifest write and the knowledge base import, become Admin-only, because neither has one concept's owner, and an Editor's import would be refused part-way at the first collection they do not own. So an Editor no longer runs `pnpm ops import-bundle`. A refusal reads `owner-forbids`.
- **KTD3. The proposer authors an accepted edit.** `authorFor` already makes the proposer the git author. If the proposer is no longer a member, the accepter is. Writing the erasure pseudonym, or the platform bot, was rejected, because the person who acted stays the one git names until an erasure rewrites them. The `Actor:` trailer and `bundle_commit.actor` name the decider. The `bundle-commit` erasure family reaches the decider (`packages/core/src/erasure/map.ts:132-140`), and the `concept-file` family rewrites the proposer's author line (`packages/core/src/store/git/index.ts:453-462`, `:701-749`). BA-220 carries `suggestion` and `concept_write_request` into the erasure, and pins the author-line rewrite with a test. The `suggestion` table needs a migration before an erasure can rewrite it, and BA-220 waits on that migration.
- **KTD4. The owner decides an *edit* in their Inbox.** Deciding in Control Centre › Suggestions › To decide was rejected for the *edit* kind, because that page is Admin-only and a Viewer may own a concept. Only the Admin kinds point into To decide. An Admin's Waiting on You lists every *edit*, the unowned ones that only an Admin decides and each owned one with its owner named, because KTD2 lets an Admin decide any of them and no other S3 page reaches an owned concept's edit. Listing only the unowned ones for an Admin was rejected, because an Admin could then accept an owned concept's edit through the api but from no page until S5.
- **KTD5. The file's `sources` are the one list.** `concept_evidence` is derived from them at commit, and the separate `evidence` input goes. Refusing a write whose two lists differ was rejected, because it keeps two inputs a writer must fill in step. A `sources` entry naming a concept is a map edge, never an evidence row.
- **KTD6. The server seeds an edit from the raw file.** The client sends only the parts it edits, and the server applies them to the file read through `conceptByIri` or `fileAt`, keeping each withheld source entry as written. Sending the raw file to the client was rejected, because a reader would see the locators of sources they may not open.
- **KTD7. Labels are checked at write.** The writer refuses a string source that is a bare wire locator and a passage locator in the body outside `sources`. A withheld concept's label never falls back to its IRI. Checking at read alone was rejected, because a platform writer now writes `sources`.
- **KTD8. An unchanged save writes nothing.** A concept save whose render equals the render of the stored file writes no commit. Comparing the submitted file with the stored bytes was rejected, because `renderConceptFile` writes every key as JSON, so an imported file never equals its own render. Comparing content hashes was rejected, because the hash normalises whitespace a reader sees. A Brief save whose markdown and include rows equal the latest version writes no version and no skeleton commit. Only a direct write short-circuits, so an acceptance still decides its suggestion.
- **KTD9. "Used in more than one place" counts includes and inbound links.** The count is the concept's include rows plus its inbound `LINKS_TO` edges, read in the act's transaction. The editor states the consequence and asks once when the count is more than one.
- **KTD10. The skeleton is a projection commit outside `knowledge/`.** One file per guide at `guides/<guide id>.yaml`, written by a governed act with the repository lock, an audit event, a `bundle_commit` row and a `Projection: guides` trailer. The reconciler's projection arm records the commit and derives nothing. A skeleton under `knowledge/` was rejected, because both concept readers walk that folder.
- **KTD11. Templates are shipped data.** They live in `packages/core/src/guides/templates/`. A platform table was rejected, because a template changes only with a release. The first template is synthetic and shaped like a bid library. Its expectations name each expected fact, so a gap is listed by name, which a count per kind cannot do.
- **KTD12. Editors and Admins edit a Brief.** A Viewer's Brief suggestion needs a payload of its own and is deferred to S5 as BA-240.
- **KTD13. Tiptap 3 and CodeMirror 6.** The visual editor is Tiptap 3 with its markdown extension, and source mode is CodeMirror 6, one keystroke away, as archived ADR 0015 chose. A body opens in source mode when visual mode would lose any of it. A source-only editor was rejected, because the Expert and the Commercial Controller type prose, not markdown.
- **KTD14. A concept write flags its citing write-ups.** The flag is set in the same transaction, and Guides shows "cites a concept that changed". A nightly sweep was rejected, because live ADR 0004 makes the flag synchronous.
- **KTD15. Exports is Admin-only and Kinds is read-only.** The brief gives Exports to an Admin, so Exports is seen by an Admin alone. S7 renames kinds.
- **KTD16. The readable columns are not folded.** Card 11 of the review before S2 proposed one helper for every readable table. `concept_index` has no audience default, and `concept_sensitivity_override` has no published-at and no sensitivity default, so folding them needs a migration that changes their SQL for no change in behaviour. New readable tables use `readableRecordColumns` and `readableUnitChecks`, and #868's catalogue test probes each from its first day.
- **KTD17. The landing is in the commit's transaction.** BA-221 merged as #869 (e5825b417). `commitAndLandAsMember` in `packages/core/src/concepts/import/landing.ts` runs the landing in the same `withMember` transaction as the git commit, holding the member row `FOR SHARE` through both. A revocation after that read waits for the landing, and the act is answered as landed. Refusing the act and blocking its replay was rejected, because it needed a migration and a revert, and an answer the platform later contradicts is not true. ADR 0012 keeps "judged at time of act". The reconciler still calls `landRows` and `landBundleCommit` directly.
- **KTD18. The knowledge base browser composes a WAI-ARIA tree.** It is a page in Browse beside Search, with its own address, seen by every role, reading the concept index under the read predicate. It is built on the app's radix primitives, shadcn styles and Phosphor icons. Lifting `extend-hq/jevbox`'s Finder was rejected on the prototype in Appendix A. It added 142 kB of initial JavaScript as shipped (139 kB with its document viewers cut), a second primitive library and a Preact beta, failed four axe rules, and crashed the page until forked.
- **KTD19. An unresolved reference stores no section or sentence.** BA-233's `map_unresolved_reference` row holds the citing concept, the relation, the ordinal and the target path, and nothing more. `design.md`'s unit 7 sketched a `section` and a `sentence` on the row. Storing them was rejected, because promotion re-derives the citing concept through `resolveOutgoing`, which computes both, so a stored copy is a second truth that could disagree with the rebuild.

## Appendix C. Risks to the program

- **BA-230 and BA-231 may land in either order.** BA-230 waits on BA-216's survivors. Its rows write as an Editor, so whichever PR lands second fits the other's fixture. The PR owner watches BA-231's owner requirement against BA-230's writer.
- **BA-231's test migration is the largest unplanned item.** Every Editor write across the core suites, and every Editor writer of `seedConcepts` under `apps/web/e2e/`, needs an owner row. BA-231's PR owner budgets for it before the first push.
- **BA-231 builds on #869's landing.** The race tests in `concepts.test.ts` and `manifest.test.ts`, with their helper `packages/core/test/concepts/revocation-race.ts`, must stay green once the owner read joins the transaction.
- **BA-231 changes who may import.** `pnpm ops import-bundle` becomes Admin-only (KTD2). The PR owner says so in the PR body and in `docs/operations/`.
- **BA-232 needs BA-231 to widen the acceptance branch.** `writeConceptAction`'s acceptance branch and `declineSuggestionAction` admit the owner, not only the direct write. BA-232's PR owner checks it before building.
- **Harness actions are named in several sections.** BA-12, BA-232, BA-236, BA-237 and BA-239 each add harness actions (`nameOwners`, `seedEditSuggestion`, `commitAuthorsOf`, `seedGuide`, `usageOf`, `seedConceptIndex`). BA-12 defines `nameOwners`, the one owner seed, with its function in `apps/api/tests/support/harness/harness-knowledge.ts` and its route in `harness-control.ts`. BA-232 and BA-236 reuse it and add no owner seed of their own.
- **Five PRs edit the navigation and the router.** BA-12, BA-232, BA-236, BA-238 and BA-239 change `apps/web/src/shared/navigation.ts` or `router.tsx`, so each rebases on the last. `AREA_NAMES` in `frame.spec.ts` changes in BA-232 alone.
- **BA-233 shares `contracts/links` with BA-146.** BA-146's fourth criterion adds cases to the same fixture. Whichever lands second rebases the fixture and both tiers' digest files, and runs alone.
- **BA-233 settles a moved concept's new path only.** A link to the old path stays unanswered, because an edge carries no path. BA-146's first criterion asks only for the new path. The old-path case stays on BA-146.
- **BA-233's perf seed is slow.** Seeding 3,000 concepts at trunk takes minutes, so the probe sets its own timeout and runs five times per side, interleaved.
- **BA-234's new not-null columns break existing seeds.** `home` and `content_hash` need factory defaults, or every `seed.writeUp` caller fails.
- **BA-234 defers two expectation selectors.** Selecting by relation to the subject or by feed needs a column and a migration later. The threshold's origin is also left out.
- **The guides and concepts import cycle is settled.** Concepts already imports the guides face (`packages/core/src/concepts/import/landing.ts:23`), so guides must never import concepts. BA-235's first Build boxes lift the repository lock and fence, `commitAndLandAsMember`, `landBundleCommit` and `authorOf` into a new `bundle` slice that both import, and BA-236 composes a gap's owner in the api. BA-235's madge run shows no cycle across two slices, and `import/no-cycle` holds it after.
- **BA-235 shows a Viewer a withheld fact as missing.** A Viewer may then offer a duplicate concept. The suggestion's merge key catches a duplicate title, and the owner decides the rest.
- **BA-237's paste matrix needs a person.** The browser suite proves the clipboard's HTML and plain text, and a paste into an editable region. In the review gate the operator pastes by hand into Word desktop, Word on the web, Google Docs, and Word with **Keep Text Only**.
- **The surfaces with no page have no driver skill.** BA-230, BA-231, BA-95, BA-233, BA-234 and BA-235 drive the core interface or the api harness, and their screenshots are terminal captures. A verifier reads the command in each capture.
- **A wait on the server shows its state within 100 ms.** BA-236's save and BA-237's copy say "Saving" or "Copying" within 100 ms and show the result within 1,000 ms. The browser suite's action budgets hold both limits.
- **The `suggestion` table's erasure migration belongs to BA-220.** No S3 PR adds it. BA-231 builds on BA-220 if it has merged, and otherwise records in its PR body that a proposer's `suggestion` rows still name them.
- **Two erasure limits on an accepted edit's author line, inferred by lane 3 and untested.** A request naming only the person id misses the author line in the access answer and the found count, though the rewrite still happens. An address the person has since changed is rewritten only if the request names it. BA-220 carries the author-line test. BA-231 adds its own only if BA-220 has not merged when BA-231 starts.

## Appendix D. What to read before building

- The brief, `docs/specs/route/s3.md`, and the route, `docs/specs/v01-route.md`.
- The decisions S3 rests on, under `docs/solutions/architecture-patterns/`. ADR 0004, 0012, 0014, 0015 and 0026.
- The archived records checked against them, `docs/archive/adr/0004`, `0012`, `0014`, `0015`, `0026` and `0046`.
- `CODING_STANDARDS.md` and the `AGENTS.md` of `packages/schema/`, `packages/core/`, `apps/api/`, `apps/web/` and `apps/worker/`.
- The *Workflow* section of `AGENTS.md`, `docs/agents/mutation-triage.md` and `docs/agents/issue-tracker.md`.
- `docs/personas/personas.md`, for every page.
- `.claude/skills/browser-suite/SKILL.md` and `.claude/skills/better-answers-design/SKILL.md`.
- The body-link plan, `docs/plans/2026-10-10-1629-feat-body-link-targets-plan.md`, for KTD1 of that plan, which BA-233 keeps.
- BA-231, BA-233, BA-234 and BA-235 run `skills/how/SKILL.md` before code and `skills/interrogate/SKILL.md` before merge. Each PR keeps a decision trail per `skills/show-me-your-work/SKILL.md`.
