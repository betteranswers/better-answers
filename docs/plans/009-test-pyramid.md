---
title: Test Pyramid - Plan
type: refactor
date: 2026-10-27
topic: test-pyramid
execution: code
---

# Test pyramid plan

This plan is not on the v0.1 route. It serves the owner's decision of 27/10/2026 that testing should match a standard repository. Most behaviour gets fast in-process unit tests. A test runs on real Postgres, git, the object store or an image only where that boundary is the claim. The browser layer stays thin.

Today 9,117 tests run in the merge queue. The longest leg is a browser shard at a median of 474s, and one merge-group run uses about 2,721 runner-seconds (n=11). The measurements found that the container is not the cost. The cost is in readings that assert nothing, in serial process launches, in seeding loops and in browser test count. So the program subtracts first and extracts pure functions after that.

The PRs, in order, are BA-268, BA-269, BA-270, BA-271, BA-272, BA-273, BA-274, BA-275, BA-276, BA-277 and BA-278.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

Appendix E holds the measurements, with each number's run count and limiter. Appendix F holds the target layering, the seams and the Testing rule as AGENTS.md should read afterwards. Read both before the first PR.

The program runs `skills/poteto-mode/playbooks/orchestrate.md` from the installed plugin. It is eleven PRs over several days, and most of them wait on a plan 008 PR that moves the same test tree. One coordinator holds the ledger, and a later session takes it up through `.agents/playbooks/session-pickup.md`. The coordinator merges every PR through the merge queue once an agent that did not write it posts `PASS` at its head SHA. No PR stops at merge-ready for the operator, and no PR changes an interaction.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Plan 008 owns the folder restructure and is moving files under `packages/*` and `apps/*` now. This plan names each module by its role and its path at `f59a9da35`. Each PR re-finds its paths in the tree it starts from.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, write this exact text into the standing orders and restate it in your todolist. "Plan `docs/plans/009-test-pyramid.md`. PRs in order BA-268, BA-269, BA-270, BA-271, BA-272, BA-273, BA-274, BA-275, BA-276, BA-277, BA-278. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. The coordinator merges each PR through the merge queue after an agent that did not write it posts `PASS` at its head SHA. A PR starts only after the plan 008 PR that moves its test tree has merged. Done when every PR has merged and Appendix E's after-table is filled from merge-group runs."
- [ ] Read these from the installed plugin at program start. Re-read them at every tick.
  - [ ] `skills/poteto-mode/playbooks/orchestrate.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] `.claude/skills/browser-suite/SKILL.md`, this repository's driver skill
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/principle-test-behavior-not-implementation/SKILL.md`, `skills/principle-explain-the-number/SKILL.md`, `skills/benchmark-checklist/SKILL.md` and `skills/show-me-your-work/SKILL.md`
- [ ] Arm the hourly audit tick as a real `/loop` in dynamic mode, which schedules its own wake-up rather than blocking on a sleep. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin and the standing objective. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every PR owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one PR owner for each PR, with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges.
  - [ ] BA-268 is first and depends on nothing. It branches from `main`.
  - [ ] BA-269 and BA-270 after BA-259, which moves `packages/core/test`.
  - [ ] BA-271 after BA-265, which splits the api's ops tests, and BA-262, which moves the worker's tests.
  - [ ] BA-272 after BA-268 and BA-266, which moves the web's tests and specs.
  - [ ] BA-273 after BA-259 and BA-265.
  - [ ] BA-274 after BA-265 and BA-270, since both edit the api's MCP surface test.
  - [ ] BA-275 after BA-261, BA-269 and BA-270.
  - [ ] BA-276 after BA-263 and BA-271.
  - [ ] BA-277 after BA-272.
  - [ ] BA-278 after BA-277.
- [ ] Hold the file boundaries.
  - [ ] BA-268 touches only `AGENTS.md`, `docs/solutions/architecture-patterns/`, `.agents/playbooks/verification.md`, `.claude/skills/survey-architecture/references/deepening.md`, `.claude/skills/browser-suite/` and `docs/operations/local-gates.md`.
  - [ ] BA-269, BA-270 and BA-275 touch `packages/core/` and, for BA-269, `.github/workflows/`. BA-270 also touches the worker's entry module and one api test.
  - [ ] BA-271 is the only PR that edits `.github/workflows/check.yml` before BA-278.
  - [ ] BA-272, BA-277 and BA-278 touch only `apps/web/`, `apps/api/tests/` for moved harness cases, `.claude/skills/browser-suite/` and, for BA-278, `.github/workflows/check.yml`.
- [ ] Hold the review gate. No PR changes an interaction, so none waits for the operator's review.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base main` or `gh pr create --base main` according to the resolved forge.
- [ ] Run `pnpm check:gates` and the touched workspace's `check` once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every review-bot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Before the code-ready report and babysit, and again after merge prep, record the base and head SHAs prepared by the topology owner under the execution playbook.
- [ ] Keep every case title a PR moves. Write `scripts/test-inventory.sh <dir>` output before and after, and paste the `diff` in the PR body. A title that leaves names the test that keeps its claim.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head. Run each full swarm per `skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues a clean PR with `gh pr merge <n> --match-head-commit <sha>`. A verdict carries over a rebase only when the patch-id rule in `playbooks/shipping.md` holds.
- [ ] After each merge, read the next merge-group run's job walls with `gh run view <id> --json jobs` and add a row to Appendix E's after-table.

### Boot recipe, for every live lane

Each live lane runs in its own worktree at the PR head. The surface under test is the suites themselves, so a lane drives them through `pnpm` and `uv` and saves the run's log. A lane that needs the served app drives it through `.claude/skills/browser-suite/SKILL.md`, *Running it*.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `pnpm install --frozen-lockfile` and `cd apps/worker && uv sync --frozen`. Confirm Docker answers `docker info`. Start one shared Postgres with `pnpm reap-containers` first, then export `TEST_POSTGRES_URI` per `docs/operations/local-gates.md`, so that interleaved runs do not each pay a container.
- [ ] Run suites only through the workspace scripts named in each lane. Read-only diagnostics are `vitest list`, `pytest --collect-only`, `--durations=30` and `gh run view --json jobs`.
- [ ] Save every log and screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>` and return the paths with the report.

## Write the test-pyramid rule into AGENTS.md, an ADR and the skills that restate it (BA-268)

**Depends on.** None.

**Files.**

- [ ] Edit `AGENTS.md`, the Testing section, to Appendix F's text.
- [ ] Create `docs/solutions/architecture-patterns/adr-0053.md`, "A test sits at the lowest layer that can see its claim, and a real store is used only where the store is the claim".
- [ ] Edit `.claude/skills/survey-architecture/references/deepening.md`, the store paragraph.
- [ ] Edit `.agents/playbooks/verification.md`, the two bullets that require an e2e spec for every web change and every web bug.
- [ ] Edit `.claude/skills/browser-suite/SKILL.md`, the sentence that a page "is never asserted against its source", and the harness paragraph.
- [ ] Edit `docs/operations/local-gates.md`, the Testcontainers sentence.

**Build.**

- [ ] Write AGENTS.md's Testing section as Appendix F gives it.
- [ ] Write the ADR with `applies_when` lines for writing a test, adding a store door, and adding a browser spec. Its Rejected list holds PGlite, in-memory store doors and module mocks, with Appendix A's evidence.
- [ ] In `deepening.md`, keep "never a stand-in" and "never mock this repository's own code". Add that a decision over rows already read is a pure function on its slice, tested in-process.
- [ ] In `verification.md`, a web bug is reproduced at the lowest layer that sees it. A component bug gets a Testing Library case, and a cross-page or api-wired bug gets a browser spec.

**You see.**

- [ ] `rg -n "Use the real Postgres, object store, git repository and map" AGENTS.md` prints nothing, and `rg -n "lowest layer" AGENTS.md .agents/playbooks/verification.md` prints both files.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/devtools/test/solutions-docs.test.ts` accepts the new ADR's frontmatter. Run `pnpm check:docs`.
- [ ] `apps/web/test/browser-suite-skill.test.ts` still finds every path the skill names. Run `pnpm check:docs:web`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm check:docs` at trunk and head. Save `docs-trunk-head.log`. Pass when both exit 0.
- [ ] Lane 2. Run `node scripts/docs-lane.mjs` over the PR's changed paths. Save `docs-lane.log`. Pass when it prints `lane=docs`.
- [ ] Lane 3. Run `node <plugin>/skills/poteto-mode/scripts/check-playbooks.mjs` from the repository root. Save `check-playbooks.log`. Pass when it prints no unanchored change for `verification.md`.
- [ ] Lane 4. Read AGENTS.md's Testing section and `deepening.md` side by side. Save `rule-read.md`. Pass when no sentence in one forbids what the other requires.
- [ ] Lane 5. Give a fresh agent only AGENTS.md and ten test files from Appendix E's slow table, and ask it to place each in a layer. Save `placement.md`. Pass when at least nine match Appendix F's placement.
- [ ] Lane 6. Check every link the ADR and the edited files add with jDocMunch `get_broken_links`. Save `links.log`. Pass when no new broken link appears.
- [ ] Lane 7. Read ADRs 0007, 0012, 0024, 0028, 0031 and 0032 against the new ADR. Save `adr-read.md`. Pass when each real-store test those ADRs name is still required by the new rule.
- [ ] Lane 8. Run `pnpm format:check`. Save `format.log`. Pass when it exits 0.
- [ ] Lane 9. Run `rg -n "Testcontainers" docs/operations/local-gates.md .claude/skills/browser-suite/SKILL.md`. Save `testcontainers.log`. Pass when each hit describes the integration layer only.
- [ ] Lane 10. Audit the diff for a rule that a later PR in this plan would break on landing. Save `audit.md`. Pass when there is none, or each is named with the PR that resolves it.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall seconds of `pnpm check:docs`.
- [ ] Probe. Run it at trunk and head, interleaved, three times each, with `/usr/bin/time -p`.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fails if the head median is more than 10% above the trunk median.

**Review gate.** None. BA-268 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Move the budget and recall readings out of the suite into a scheduled workflow (BA-269)

**Depends on.** BA-259.

**Files.**

- [ ] Create `packages/core/vitest.budgets.config.ts`, modelled on `vitest.readings.config.ts`, including `test/budgets/*.budget.ts`.
- [ ] Move the core write-budget, edit-budget, find-budget, map-budget and guide-seed-budget tests, the analysed-map test and recall's "reports each set's recall" case to `packages/core/test/budgets/`.
- [ ] Edit `packages/core/package.json` to add a `budgets` script.
- [ ] Create `.github/workflows/budgets.yml`, scheduled nightly with `workflow_dispatch`, modelled on `mutation.yml`.

**Build.**

- [ ] Classify each moved file. A file with a pass threshold stays a budget and fails the scheduled run. write-budget and edit-budget assert only lengths, so each either gains the threshold its BA-128 history names or becomes a reading that records figures to the job summary.
- [ ] Keep recall's reader cases in the suite. They are pure and need no seeded set.
- [ ] Have the scheduled run open or update a Linear issue on failure, the way `mutation.yml` reports.

**You see.**

- [ ] `pnpm --filter @better-answers/core exec vitest list` lists none of the moved files, and `pnpm --filter @better-answers/core run budgets` runs all seven.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] The moved files pass under the budgets config. Run `pnpm --filter @better-answers/core run budgets`.
- [ ] The core suite passes without them. Run `pnpm check:core:suite`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm check:core:suite` at trunk and head. Save `core-trunk-head.log`. Pass when both pass and only the moved cases are absent at head.
- [ ] Lane 2. Run `vitest list --shard=1/2` and `--shard=2/2` at head and sum Appendix E's file times per shard. Save `shards.log`. Pass when neither shard's sum exceeds the other by more than 40%.
- [ ] Lane 3. Run the budgets config at head. Save `budgets.log`. Pass when every budget passes and every reading prints its figures.
- [ ] Lane 4. In a scratch edit, set find-budget's threshold to 1 ms and run the budgets config. Save `budget-breaks.log`. Pass when it fails naming find-budget.
- [ ] Lane 5. Run `pnpm lint:workflows`. Save `workflows.log`. Pass when actionlint, zizmor and shellcheck pass on `budgets.yml`.
- [ ] Lane 6. Dispatch `budgets.yml` on the branch with `gh workflow run budgets.yml --ref <branch>`. Save `dispatch.log`. Pass when the run is green and its summary holds the readings.
- [ ] Lane 7. Run recall's remaining reader cases. Save `recall.log`. Pass when they pass with no seeded set.
- [ ] Lane 8. Run `pnpm knip`. Save `knip.log`. Pass when no moved helper is reported unused.
- [ ] Lane 9. Diff each moved file's body against trunk with `git diff -M`. Save `moved-bodies.diff`. Pass when only paths and the added thresholds changed.
- [ ] Lane 10. Audit whether any moved case guarded a behaviour no other suite case asserts. Save `audit.md`. Pass when each such case is named and kept in the suite.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall seconds of `pnpm check:core:suite --shard=1/2` and `--shard=2/2`, summed.
- [ ] Probe. Run both shards at trunk and head, interleaved, three times each, against one shared Postgres.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. The moved files held 326s of CI file time. Fails if the head median is not at least 60s below trunk.

**Review gate.** None. BA-269 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Run one worker per cross-tier file instead of one per case (BA-270)

**Depends on.** BA-259.

**Files.**

- [ ] Edit the core worker-process test helper, today `packages/core/test/worker-process.ts`.
- [ ] Edit the core cross-tier-document test, today `packages/core/test/cross-tier-document.test.ts`.
- [ ] Edit the worker's entry module, today `apps/worker/src/better_answers_worker/loop.py` and its CLI, to take ticks on standard input.
- [ ] Delete `apps/api/tests/mcp-cross-tier.test.ts`.
- [ ] Edit `apps/api/tests/mcp-surface.test.ts` to add its MCP rendering case.

**Build.**

- [ ] Set `HF_HUB_OFFLINE=1` in the helper's child environment, as `deploy/platform.compose.yaml` already does.
- [ ] Start one worker per file. A test writes a tick line and awaits the worker's done line. The tick runs the real `loop.tick`, so the narrow-mid-sync race still waits for `claimed`.
- [ ] Drop each second back-to-back launch that only ran the nightly audit.
- [ ] Assert the MCP find-and-open rendering in mcp-surface over a passage built with the schema factory's `factory.passage`.

**You see.**

- [ ] The cross-tier-document run's log shows one worker start line where trunk shows sixteen.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] cross-tier-document keeps all seven cases. Run `pnpm --filter @better-answers/core exec vitest run test/cross-tier-document.test.ts`.
- [ ] The worker's tick mode has a test through its entry point. Run `pnpm check:worker`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run cross-tier-document at trunk and head and count worker start lines. Save `cross-tier-trunk-head.log`. Pass when both pass and head starts one worker.
- [ ] Lane 2. Run cross-tier-document five times at head. Save `repeat.log`. Pass when all five pass.
- [ ] Lane 3. Run the narrow-mid-sync case twenty times with `-t`. Save `race.log`. Pass when all twenty pass.
- [ ] Lane 4. Kill the worker from outside mid-file. Save `killed.log`. Pass when the next case fails with a message naming the dead worker within its timeout, and does not hang.
- [ ] Lane 5. Grep the worker log for `huggingface.co`. Save `offline.log`. Pass when there is no hit.
- [ ] Lane 6. In a scratch edit, stop withholding the sort code in the MCP rendering and run mcp-surface. Save `mcp-breaks.log`. Pass when the new case fails.
- [ ] Lane 7. Run analysed-map and rebuild-equivalence at head. Save `other-cross-tier.log`. Pass when both pass.
- [ ] Lane 8. Run `pnpm check:worker` at head. Save `worker.log`. Pass when it passes.
- [ ] Lane 9. Run `pnpm check:api` at head. Save `api.log`. Pass when it passes without mcp-cross-tier.
- [ ] Lane 10. Audit that the tick mode adds no path the deployed daemon takes. Save `audit.md`. Pass when the daemon's code path is unchanged.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall seconds of the cross-tier-document file.
- [ ] Probe. Run it at trunk and head, interleaved, three times each.
- [ ] Baseline. Record the trunk median first. It was 113s locally, n=1.
- [ ] Rule. Fails if the head median is above 50% of trunk's.

**Review gate.** None. BA-270 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Run the image, compose and process tests in their own job, and share one Postgres per worker job (BA-271)

**Depends on.** BA-265 and BA-262.

**Files.**

- [ ] Edit `.github/workflows/check.yml` to add a `full-images` job in the full lane, and to add it to the `check` job's legs.
- [ ] Move the api's backup-image, image, image-probe, test-postgres, local-database, restore and stop tests under `apps/api/tests/images/`, and add an api script that runs only that folder.
- [ ] Edit `apps/api/vitest.config.ts` to exclude that folder from `check`.
- [ ] Edit the worker's check script, today `apps/worker/src/better_answers_worker/check.py`, to deselect `test_image.py` by marker, and add a script that selects it.
- [ ] Edit the api's config module, today `apps/api/src/config.ts`, to read the stop deadline.

**Build.**

- [ ] Gate `full-images` on the lane's `images` word, as `IMAGE_PROBE_DEFERRED` is gated today.
- [ ] In `full-worker`, start one Postgres service and set `TEST_POSTGRES_URI`, so the four xdist processes share one server.
- [ ] Read `STOP_DEADLINE_MS` in the config module with today's 10,000 as the default. The stop test passes 500.

**You see.**

- [ ] A merge-group run on the branch lists `full-images` as its own job, and `full-api`'s log has no backup-image or image line.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] The image tests pass in their own script. Run `pnpm --filter @better-answers/api run images`.
- [ ] The stop test passes with the short deadline. Run `pnpm --filter @better-answers/api exec vitest run tests/images/stop.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm check:api` and `pnpm check:worker` at trunk and head. Save `suites-trunk-head.log`. Pass when both pass and head runs no image test.
- [ ] Lane 2. Run the api images script at head. Save `api-images.log`. Pass when every moved file passes.
- [ ] Lane 3. Run the worker image script at head. Save `worker-images.log`. Pass when `test_image.py` passes.
- [ ] Lane 4. Run both image scripts with `IMAGE_PROBE_DEFERRED=true`. Save `deferred.log`. Pass when each skips with its deferral reason.
- [ ] Lane 5. Run `pnpm lint:workflows`. Save `workflows.log`. Pass when it exits 0.
- [ ] Lane 6. Run `pnpm check:worker` with `TEST_POSTGRES_URI` set and count Postgres containers started with `docker ps -a`. Save `worker-shared.log`. Pass when no container starts.
- [ ] Lane 7. Start `node apps/api/src/main.ts` with no `STOP_DEADLINE_MS` and send SIGTERM while a request is held. Save `stop-default.log`. Pass when it waits up to 10s as trunk does.
- [ ] Lane 8. Dispatch `check.yml` on the branch through `workflow_call` or a test merge group. Save `ci-run.json`. Pass when `full-images` and the `check` job are green.
- [ ] Lane 9. On a throwaway branch, make one image test fail and dispatch again. Save `ci-red.json`. Pass when the `check` job is red.
- [ ] Lane 10. Audit that no image or compose behaviour lost its test. Save `audit.md`. Pass when every moved case title appears in the images run.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Job wall seconds of `full-api` and `full-worker` in merge-group runs.
- [ ] Probe. Read the five merge-group runs before the merge and the first five after it with `gh run view <id> --json jobs`. Before merge, time `pnpm check:api` locally at trunk and head, interleaved, three times each.
- [ ] Baseline. Record the trunk medians first. Merge-group medians were 287s for `full-api` and 272s for `full-worker`, n=11.
- [ ] Rule. Fails if the local `pnpm check:api` head median is not at least 60s below trunk's. Fails if `full-images` becomes the run's longest job.

**Review gate.** None. BA-271 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Delete the browser cases a unit or api test already asserts (BA-272)

**Depends on.** BA-268 and BA-266.

**Files.**

- [ ] Edit the people, people-invitations, sources, sign-in, frame, console, console-people, workspace-switcher, knowledge-search and ask-new-question specs under `apps/web/e2e/`.
- [ ] Edit `apps/web/playwright.config.ts` to add a project with no `webServer` for the accessibility-gate spec.
- [ ] Edit `apps/api/tests/harness-control.test.ts` to take sources' "tells a spec why the harness refused its seed" case.
- [ ] Edit `.claude/skills/browser-suite/SKILL.md` and its references wherever they name a deleted case.

**Build.**

- [ ] Delete each DUPLICATE case in Appendix E's browser table. Before deleting, run the named twin and record it in the PR body as `deleted case -> twin`.
- [ ] Move accessibility-gate to the new project. It needs Chromium for axe and nothing else.

**You see.**

- [ ] `pnpm check:web:e2e --list` counts about 70 fewer tests than trunk's 710.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Every named twin passes. Run `pnpm check:web:unit` and `pnpm check:api`.
- [ ] `apps/web/test/browser-suite-skill.test.ts` and core's environment-lint test pass. Run `pnpm check:docs:web` and `pnpm --filter @better-answers/core exec vitest run test/environment-lint.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the full browser suite at trunk and head per the browser-suite skill. Save `browser-trunk-head.log` and `people.png`. Pass when both pass and head has only the listed cases fewer.
- [ ] Lane 2. For five deleted cases chosen at random, break the behaviour in a scratch edit and run the twin. Save `twins-break.log`. Pass when each twin fails.
- [ ] Lane 3. Run the accessibility-gate project alone with no api running. Save `gate.log`. Pass when it passes.
- [ ] Lane 4. Run the moved harness-refusal case in the api suite. Save `harness.log`. Pass when it passes and asserts the 400 and its reason.
- [ ] Lane 5. Drive the people page by hand through the browser-suite skill and demote the last Admin. Save `last-admin.png`. Pass when the refusal names each Admin, as the api twin asserts.
- [ ] Lane 6. Drive workspace-switcher and fail the member read. Save `switcher.png`. Pass when the left workspace's name is dropped.
- [ ] Lane 7. Run `pnpm check:docs`. Save `docs.log`. Pass when it passes.
- [ ] Lane 8. Run `pnpm check:web:e2e --list` per spec at trunk and head. Save `per-spec.diff`. Pass when only listed cases differ.
- [ ] Lane 9. Read the latency budget and gate assertions left in each edited spec. Save `budgets-left.md`. Pass when every page that had a budget and a gate still has one.
- [ ] Lane 10. Audit each `deleted case -> twin` pair against principle-test-behavior-not-implementation. Save `audit.md`. Pass when each twin asserts the same observable outcome at a user-facing interface.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Summed per-test seconds of the browser suite, parsed from the Playwright list reporter.
- [ ] Probe. Run the full suite at trunk and head, interleaved, twice each, with three workers.
- [ ] Baseline. Record the trunk sum first. It was 2,878s in CI run 40599189016.
- [ ] Rule. Fails if the head sum is not at least 200s below trunk's.

**Review gate.** None. BA-272 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Test lint rules in-process, and sweep the code points once (BA-273)

**Depends on.** BA-259 and BA-265.

**Files.**

- [ ] Edit core's import-direction test, today `packages/core/test/import-direction.test.ts`.
- [ ] Edit the api's lint-rules test, today `apps/api/tests/lint-rules.test.ts`.
- [ ] Edit devtools' comment-only-the-why and knip tests, today under `packages/devtools/test/lint-rules/` and `packages/devtools/test/scans/`.
- [ ] Edit the throwaway-tree helper, today `packages/devtools/src/throwaway-tree.ts`, to lint many cases in one oxlint run.
- [ ] Edit core's erasure-match contract test, today `packages/core/test/erasure-match.contract.test.ts`.

**Build.**

- [ ] Call `directionFinding`, `catalogueFinding` and `placeOf` from the import-direction rule module, today `packages/devtools/lint-rules/rules/import-direction.ts`, directly for the per-case findings. Keep "lints every committed import clean" and one real oxlint spawn.
- [ ] In the other three files, lay every case into one tree, run oxlint or knip once, and split findings by folder. Keep one per-case spawn per rule.
- [ ] Sweep 0 to 0x10FFFF once per file and derive each case's table and digest from that pass.

**You see.**

- [ ] The import-direction file's log shows one oxlint start where trunk shows 131.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Every case title survives. Run `scripts/test-inventory.sh` on each folder at trunk and head and diff.
- [ ] All four lint files and the contract pass. Run `pnpm check:root` and `pnpm check:core:suite`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the four lint files and the contract at trunk and head. Save `lint-trunk-head.log`. Pass when both pass with the same titles.
- [ ] Lane 2. In a scratch edit, let import-direction allow a transport import into a slice. Save `direction-breaks.log`. Pass when the in-process cases fail.
- [ ] Lane 3. In a scratch edit, make comment-only-the-why accept a narrating comment. Save `comment-breaks.log`. Pass when the batched case fails.
- [ ] Lane 4. Plant an unused export in one knip case. Save `knip-breaks.log`. Pass when only that case fails.
- [ ] Lane 5. Compare the erasure-match digest at trunk and head. Save `digest.log`. Pass when the digests are equal.
- [ ] Lane 6. Run the worker's erasure-match contract test. Save `worker-contract.log`. Pass when it passes.
- [ ] Lane 7. Run `pnpm lint` on the repository at trunk and head. Save `repo-lint.log`. Pass when both give the same findings.
- [ ] Lane 8. Grep each lint test for a real spawn. Save `spawns.log`. Pass when each rule keeps exactly one.
- [ ] Lane 9. Run each file with `--reporter=verbose` and record per-file wall. Save `per-file.log`. Pass when each is below its trunk wall.
- [ ] Lane 10. Audit that the batched tree cannot let one case's finding mask another's. Save `audit.md`. Pass when findings are keyed by case folder.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Summed wall seconds of the four lint files and the contract.
- [ ] Probe. Run them at trunk and head, interleaved, three times each.
- [ ] Baseline. Record the trunk median first. CI file time was 211s.
- [ ] Rule. Fails if the head median is above 30% of trunk's.

**Review gate.** None. BA-273 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Test the ops parse, the pending-session table and the MCP listing in-process (BA-274)

**Depends on.** BA-265 and BA-270.

**Files.**

- [ ] Edit the api's ops module, today `apps/api/src/ops/`, to expose a pure argv-to-command parse.
- [ ] Edit the ops tests, today `apps/api/tests/ops*.test.ts`.
- [ ] Edit the api's pending-set test and the second-factor gate's tables, today `apps/api/src/second-factor-gate.ts`.
- [ ] Edit `apps/api/tests/mcp-surface.test.ts` and `apps/api/tests/ask.test.ts`.

**Build.**

- [ ] Expose `parseOpsArgs(argv)` returning a command or a usage refusal. Move flag, usage and exit-code cases to it. Keep one real `runOps` case per command group, and every erasure and lock case.
- [ ] Assert in-process that every router procedure is in `PENDING_PROCEDURES` or named as refused while pending. Keep one HTTP case per second-factor step.
- [ ] Test MCP listing and annotations through `createMcpSurface` with no session. Keep the lock and cap cases on the app.
- [ ] Test ask's verdict and preview rendering through `answerOutputWith` in core's answering boundary. Keep one end-to-end ask.

**You see.**

- [ ] `vitest list` for the api shows the pending-set file with one in-process table case and one HTTP case per step, where trunk shows 220 HTTP cases.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] The parse, table and listing cases pass. Run `pnpm check:api`.
- [ ] Mutants in `parseOpsArgs` are killed. Run `pnpm mutant-probe` scoped to the ops parse.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm check:api` at trunk and head. Save `api-trunk-head.log`. Pass when both pass.
- [ ] Lane 2. Run `pnpm ops -- --help` and three bad invocations at trunk and head. Save `ops-cli.log`. Pass when output and exit codes match.
- [ ] Lane 3. In a scratch edit, add a router procedure without listing it. Save `pending-breaks.log`. Pass when the table case fails naming it.
- [ ] Lane 4. Sign in with a pending second factor through the browser-suite skill and open a gated page. Save `pending.png`. Pass when the page refuses as trunk does.
- [ ] Lane 5. List MCP tools from a real client against the served app. Save `mcp-list.log`. Pass when the list equals the in-process case's expectation.
- [ ] Lane 6. Run the lock and cap cases of mcp-surface ten times. Save `mcp-locks.log`. Pass when all pass.
- [ ] Lane 7. Ask a question end to end through the browser-suite skill. Save `ask.png`. Pass when the verdict renders.
- [ ] Lane 8. Run `pnpm table-ownership-scan` and `pnpm check:gates`. Save `gates.log`. Pass when both pass.
- [ ] Lane 9. Diff test titles at trunk and head. Save `titles.diff`. Pass when every removed title is named in the PR body with the case that keeps its claim.
- [ ] Lane 10. Audit that no moved case asserted something only Postgres could show. Save `audit.md`. Pass when none did.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall seconds of `pnpm check:api`.
- [ ] Probe. Run it at trunk and head, interleaved, three times each.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fails if the head median is not at least 40s below trunk's.

**Review gate.** None. BA-274 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Extract pure decide functions from erasure, concepts, guides and import (BA-275)

**Depends on.** BA-261, BA-269 and BA-270.

**Files.**

- [ ] Edit core's erasure slice, today `packages/core/src/erasure/`, and its routine test.
- [ ] Edit core's concepts slice write path, today `packages/core/src/concepts/write.ts` and `edit.ts`, and the concepts test.
- [ ] Edit core's guides slice and its test.
- [ ] Edit core's bundle import, today under `packages/core/src/bundle/`, and the import-bundle test.
- [ ] Edit `packages/core/package.json` `exports` only if a slice entry must name a new function.

**Build.**

- [ ] Erasure. Test the report and the pseudonym through `erasure/report.ts` and `erasure/identifiers.ts`, which are already pure. Keep the git-step and rewrite cases on real git.
- [ ] Concepts. Extract kind folding and the merge-key shape from the write path as pure functions. Keep commit authorship and no-partial-rows on Postgres and git.
- [ ] Guides. Extract coverage and marking as functions over rows already read. Share one seeded northgate fixture for the cases that stay.
- [ ] Import. Pass the analyse step to import as a function, so "reports a landed import when the analyse fails" runs with a failing step. Keep the lock-timeout case real.
- [ ] Delete each seeded case whose claim a new pure case now makes, and list it in the PR body.

**You see.**

- [ ] The erasure-routine file runs fewer than half of trunk's 115 seeded cases, and a new in-process file holds the moved claims.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Each extracted function has an in-process test through its slice entry. Run `pnpm check:core:suite`.
- [ ] Mutants in each extracted function are killed. Run a scoped Stryker run per the mutation-testing skill.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm check:core:suite` at trunk and head. Save `core-trunk-head.log`. Pass when both pass.
- [ ] Lane 2. Run an erasure rehearsal with `pnpm ops` against a seeded local database. Save `erasure.log`. Pass when the report matches trunk's for the same seed.
- [ ] Lane 3. Edit a concept with a folded kind through the browser-suite skill. Save `kind-fold.png`. Pass when the stored kind matches trunk's.
- [ ] Lane 4. Seed a guide from a template through the browser-suite skill. Save `guide.png`. Pass when coverage and marks match trunk's.
- [ ] Lane 5. Import a bundle with analyse held off. Save `import.log`. Pass when import reports landed, as trunk does.
- [ ] Lane 6. Run `pnpm check:gates`. Save `gates.log`. Pass when import-direction and table-ownership pass.
- [ ] Lane 7. Run `pnpm check:api`. Save `api.log`. Pass when it passes.
- [ ] Lane 8. Run `pnpm check:worker`. Save `worker.log`. Pass when the tier contract still passes.
- [ ] Lane 9. Diff titles at trunk and head. Save `titles.diff`. Pass when every removed seeded title names its pure replacement.
- [ ] Lane 10. Audit each extracted function for SQL or a door. Save `audit.md`. Pass when none takes a `Tx`, a pool or a door.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall seconds of `pnpm check:core:suite`, both shards summed.
- [ ] Probe. Run at trunk and head, interleaved, three times each.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fails if the head median is not at least 30s below trunk's.

**Review gate.** None. BA-275 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Inject the work loop's clock and read contract column sets from schema_view (BA-276)

**Depends on.** BA-263 and BA-271.

**Files.**

- [ ] Edit the worker's loop module, today `apps/worker/src/better_answers_worker/loop.py`, to take a clock.
- [ ] Edit `apps/worker/tests/test_work_loop.py`.
- [ ] Edit `apps/worker/tests/test_tier_contract.py` and `test_cost_ledger_contract.py`.

**Build.**

- [ ] Give the loop a clock with `sleep` and `now`, defaulting to the system clock. The three slowest work-loop cases pass a clock that advances on demand.
- [ ] Read the `llm_call` column set from the generated `schema_view` in-process. Keep the CHECK-constraint cases on Postgres.

**You see.**

- [ ] `uv run pytest tests/test_work_loop.py --durations=5` shows no case above 2s, where trunk shows 11.6s, 11.0s and 9.3s.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] The work loop's cases pass with the stepped clock. Run `pnpm check:worker`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pnpm check:worker` at trunk and head. Save `worker-trunk-head.log`. Pass when both pass.
- [ ] Lane 2. Run the worker daemon against a local database with the system clock and queue one job. Save `daemon.log`. Pass when it claims within its idle sleep.
- [ ] Lane 3. Try to monkeypatch the loop's sleep in a scratch test. Save `guard.log`. Pass when the conftest guard refuses it.
- [ ] Lane 4. In a scratch edit, drop a column from `schema_view`'s `llm_call`. Save `schema-breaks.log`. Pass when the column-set case fails.
- [ ] Lane 5. Run the CHECK-constraint cases. Save `check-constraint.log`. Pass when they pass on Postgres.
- [ ] Lane 6. Run `pnpm port-scan`. Save `port-scan.log`. Pass when it passes.
- [ ] Lane 7. Run ruff and pyright through the check script. Save `static.log`. Pass when both pass.
- [ ] Lane 8. Run cross-tier-document from core. Save `cross-tier.log`. Pass when it passes.
- [ ] Lane 9. Run the work-loop file twenty times. Save `repeat.log`. Pass when all pass.
- [ ] Lane 10. Audit that the default clock is the only one production code builds. Save `audit.md`. Pass when no production path passes a stepped clock.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall seconds of `pnpm check:worker` with image tests excluded.
- [ ] Probe. Run at trunk and head, interleaved, three times each, against one shared Postgres.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fails if the head median is not at least 20s below trunk's.

**Review gate.** None. BA-276 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Let the stubbed api hold a request, and move single-screen browser cases to Testing Library (BA-277)

**Depends on.** BA-272.

**Files.**

- [ ] Edit the web's stubbed api, today `apps/web/test/stubbed-api.ts`.
- [ ] Create component test files beside each feature's tests for people, people-invitations, sources, knowledge-search and sign-in.
- [ ] Edit those five specs under `apps/web/e2e/` to drop the moved cases.

**Build.**

- [ ] Let a test hold a stubbed procedure and resolve or reject it when it chooses. This replaces the `page.route` holds the browser cases use.
- [ ] Move each COMPONENT case in Appendix E's browser table for the five specs to Testing Library, keeping its title. About 110 cases move.

**You see.**

- [ ] The five specs hold their journey, budget, gate and layout cases only.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Each moved case passes in jsdom. Run `pnpm check:web:unit`.
- [ ] A held procedure is observable while pending. Its own case in the stubbed api's test passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the browser suite and `pnpm check:web:unit` at trunk and head. Save `web-trunk-head.log` and `people.png`. Pass when both pass and every moved title is in the unit run.
- [ ] Lane 2. For five moved cases chosen at random, break the refusal words in a scratch edit. Save `moved-break.log`. Pass when each moved case fails.
- [ ] Lane 3. Drive the people page through the browser-suite skill with a slow member read. Save `people-pending.png`. Pass when the pending state matches the moved case's expectation.
- [ ] Lane 4. Drive sources upload through the browser-suite skill. Save `sources.png`. Pass when the source reaches indexed.
- [ ] Lane 5. Drive knowledge-search through the browser-suite skill as a Viewer. Save `search.png`. Pass when no Restricted match shows.
- [ ] Lane 6. Drive sign-in with a wrong code. Save `sign-in.png`. Pass when the refusal words match the moved case.
- [ ] Lane 7. Drive invitations with a 51st address. Save `invite.png`. Pass when it is held.
- [ ] Lane 8. Run `pnpm auth-seam-scan` and `pnpm check:docs:web`. Save `gates.log`. Pass when both pass.
- [ ] Lane 9. Run the accessibility gate on each of the five pages. Save `gate.log`. Pass when each page is audited clean.
- [ ] Lane 10. Audit each moved case against principle-test-behavior-not-implementation. Save `audit.md`. Pass when each asserts what a user sees, not a component's internals.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Summed per-test seconds of the browser suite, and wall seconds of `pnpm check:web:unit`.
- [ ] Probe. Run both at trunk and head, interleaved, twice each.
- [ ] Baseline. Record the trunk values first.
- [ ] Rule. Fails if the browser sum is not at least 400s below trunk's, or if web-unit's wall grows by more than 60s.

**Review gate.** None. BA-277 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Cut the browser suite to one spec per page plus the cross-page journeys, on one shard (BA-278)

**Depends on.** BA-277.

**Files.**

- [ ] Edit the remaining specs under `apps/web/e2e/`.
- [ ] Edit `apps/web/playwright.config.ts` to add a layout project that needs no api.
- [ ] Edit `apps/web/test/playwright-config.test.ts`.
- [ ] Edit `.github/workflows/check.yml`, the `full-web-browser` shard matrix.
- [ ] Edit `.claude/skills/browser-suite/SKILL.md` and `docs/specs/route/seams.md` if a named spec moves.

**Build.**

- [ ] Move the remaining COMPONENT cases to Testing Library.
- [ ] Keep one spec per page, about 30, each asserting its latency budget, the accessibility gate and keyboard reach.
- [ ] Keep about 12 journeys that cross pages through the real api, the ones Appendix F lists.
- [ ] Move the 320 and 390px layout cases to the layout project, served by `vite preview` over the stubbed api.
- [ ] Run one shard. Keep three workers.

**You see.**

- [ ] `pnpm check:web:e2e --list` shows about 45 tests in the api project plus the layout project, and `check.yml` has no shard matrix.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] The config test pins the new projects. Run `pnpm check:web:unit`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the browser suite at trunk and head. Save `browser-trunk-head.log` and `home.png`. Pass when both pass.
- [ ] Lane 2. List every page in `apps/web/src/shared/navigation.ts` and its spec. Save `pages.md`. Pass when every page has a spec with a budget and a gate.
- [ ] Lane 3. Run each journey alone. Save `journeys.log`. Pass when each passes.
- [ ] Lane 4. Run the layout project with no api. Save `layout.log` and `narrow.png`. Pass when it passes.
- [ ] Lane 5. Slow one page's procedure past its budget in a scratch edit. Save `budget-breaks.log`. Pass when that page's spec fails.
- [ ] Lane 6. Add a contrast fault to one page in a scratch edit. Save `gate-breaks.log`. Pass when the gate fails.
- [ ] Lane 7. Run `pnpm lint:workflows`. Save `workflows.log`. Pass when it passes.
- [ ] Lane 8. Dispatch `check.yml` on the branch. Save `ci-run.json`. Pass when `full-web-browser` runs as one job and is green.
- [ ] Lane 9. Run `pnpm check:docs`. Save `docs.log`. Pass when it passes.
- [ ] Lane 10. Audit that each deleted or moved case is named with the test that keeps its claim. Save `audit.md`. Pass when none is unaccounted for.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Job wall seconds of `full-web-browser`, the slowest shard at trunk and the single job at head.
- [ ] Probe. Locally, time `pnpm check:web:e2e` at trunk with `--shard=3/3` and at head unsharded, interleaved, twice each. After merge, read five merge-group runs.
- [ ] Baseline. Record the trunk value first. The merge-group median of the slowest shard was 474s, n=11.
- [ ] Rule. Fails if the head wall exceeds 240s.

**Review gate.** None. BA-278 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] The coordinator queues it with `gh pr merge <n> --match-head-commit <sha>`.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Appendix E's after-table holds five merge-group runs after BA-278, with the critical-path job and runner-seconds.
- [ ] Rerun `/tmp/tp009/classify.mjs` or its successor and fill Appendix E's after-row for in-process share.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

**PGlite as an in-process Postgres.** A throwaway prototype in `/tmp/tp009-pglite/` applied all 99 migrations to PGlite 0.5.12 (PostgreSQL 18.6, pgvector 0.8.7) with no failures. Row-level security held. As `app_rt` with a workspace scope, a cross-tenant select on `group` returned no rows, and a cross-tenant insert was refused with 42501. The verdict was works with caveats, and the plan rejects it.

- A fresh database per file cost a median of 274 ms by `clone()` (n=5, 245 to 325 ms), against 86 ms for the container's template clone (n=5, 71 to 178 ms). The machine's load average was 30 to 48 during the runs, so walls are inflated, but both sides ran under it.
- PGlite has one backend. Two `pg` clients over its socket shared a pid, a role and an advisory lock, so lock and race tests would pass without testing anything.
- A `pg.Pool` with `-c role=app_rt` over the socket came up as the superuser and saw both tenants' rows. A test that checks only its own tenant would pass while row-level security is bypassed.
- Core takes a `pg.Pool`. No adapter maps PGlite onto it.

**Cross-tier launch timing.** A local run of cross-tier-document took 113s (n=1) with 16 worker launches totalling 102.3s. A launch spends 0.4 to 0.6s reaching its job and about 4 to 6s loading the detector stack. The job itself is under 0.5s. This sets BA-270's design and rule.

**Browser shard arithmetic.** In CI run 40599189016, each shard boots in about 22s and then runs 280 to 400s. Step wall minus boot is within 5s of summed test time divided by three workers on every shard. The wall is bound by test count. Shard 3 runs about 100s long because shards split by count in alphabetical order and get the heavy tail of people and workspace-switcher.

**Worker suite, local.** With a shared Postgres and image tests in, 631 tests passed in 319s (n=1). `test_image.py` took 291s summed, all in one xdist group, so three processes idled. With Testcontainers and images deferred, 612 passed in 182s (n=1), and each of the four processes paid about 20s to start and migrate its own container.

**Unproven.** No PR's saving is measured yet. Each perf rule is set from the file times above and is checked at its PR.

## Appendix B. Alternatives rejected

- **PGlite for repository tests.** Slower per file than the container clone, unable to contend a lock, and silent about a lost role over a pool. See Appendix A.
- **In-memory store doors behind ports.** The doors are concrete today (`ObjectDoor` holds an S3 client, `GitDoor` a root). A fake Postgres door cannot reproduce RLS, recursive walks or locks, and slices write SQL inline in 93 of 165 source files. A port with one real adapter breaks `deepening.md`, and the triage found no slow test whose cost was the object store. ADR 0029 stays as it is.
- **Moving every suite to a nightly run.** It would make the queue fast by not testing. The owner asked for the tests to sit at the right layer, not to run less often.
- **Sharding wider.** More shards cut wall but pay boot and install per shard, and leave runner-seconds as they are. BA-278 goes the other way, to one shard.
- **Deleting the budget readings.** BA-128 and BA-228 show the owner reads these figures. They move to a schedule instead.
- **A module-mocking layer for unit tests.** The `anti-slop/no-module-mocking` lint and the worker's conftest guard ban it. Pure functions and the existing injected seams carry the unit layer.

## Appendix C. Risks

- **Plan 008 collides with every PR but BA-268.** It moves `packages/core/test` (BA-259), splits core's postgres store (BA-261), moves and splits the api's tests (BA-264, BA-265), moves the worker's tests (BA-262, BA-263) and the web's (BA-266). Each PR starts after the matching 008 PR merges. The owner watches the 008 ledger before spawning.
- **A budget regression lands before the nightly run sees it** (BA-269). The scheduled run opens an issue. An owner who touches a budgeted path dispatches `budgets.yml` on the branch.
- **The worker's tick mode reaches production** (BA-270). The audit lane checks the daemon's path is unchanged.
- **A deleted browser case was the only guard** (BA-272, BA-277, BA-278). Each deletion names its twin, and lane 2 breaks the behaviour to prove the twin fails.
- **No pull-request CI runs suites.** `check.yml` runs suites only in the merge queue. The brief describes a sibling PR moving the full suites onto pull-request CI. None was open at `f59a9da35`. This plan does not depend on it, and its perf rules measure locally and in the merge queue.
- **`insert-scan`'s factory list moves in plan 008.** A PR that adds a seeding helper adds it to that list in the tree it starts from.

## Appendix D. Links and reading list

- Read before editing. `AGENTS.md` Testing, `docs/okf-v02.md`, ADRs 0007, 0012, 0024, 0028, 0029, 0031, 0032 and 0049, `.claude/skills/survey-architecture/references/deepening.md`, `.agents/playbooks/verification.md`, `.claude/skills/browser-suite/SKILL.md`, `docs/specs/route/seams.md`, `docs/plans/008-folder-restructure.md` and its maps.
- BA-270, BA-274 and BA-275 get `skills/how/SKILL.md` before code and `skills/interrogate/SKILL.md` before merge-ready, since each changes a seam another tier or transport crosses.
- Keep the trail per `skills/show-me-your-work/SKILL.md` in `.audit/test-pyramid.tsv`.
- Measurement scripts are in `/tmp/tp009/`. `jobs.mjs` and `steps.mjs` read job and step walls, `files.mjs` and `specs.mjs` read per-file and per-spec times from a run log, and `classify.mjs` classifies test files by the infrastructure they reach.

## Appendix E. What the suites cost today

All CI numbers come from the merge queue on `main`, the `full` lane of `.github/workflows/check.yml`. Job medians use the eleven successful runs from 40532633967 to 40599189016. Per-file and per-spec times come from run 40599189016, and the slowest-file order was checked against runs 40570111529 and 40544684929.

**Tests and walls per job.**

| Job | Runs | Tests | Files | Median job wall | Test step | Vitest split |
| --- | --- | --- | --- | --- | --- | --- |
| full-web-browser, 3 shards | apps/web e2e | 710 | 47 | 474s, 456s, 371s | 329 to 430s | test-bound, 22s boot |
| full-api | apps/api | 1,852 | 88 | 287s | 232s | tests 72%, import 25% |
| full-root | schema, devtools | 1,043 and 1,204 | 46 and 55 | 277s | 246s | gates, then two suites |
| full-worker | apps/worker | 631 | 40 | 272s | 213s | pytest, 4 processes |
| full-core, shard 2 | packages/core | 1,770 | 62 | 261s | 220s | tests 80%, import 17% |
| full-core, shard 1 | packages/core | 975 | 63 | 184s | 142s | tests 73%, import 24% |
| full-web-unit | apps/web jsdom | 932 | 98 | 139s | 121s | import 45%, environment 21% |

9,117 tests in all. The critical path is browser shard 3 at 474s, and one run costs about 2,721 runner-seconds. Spread is wide. Shard 1 ranged from 345s to 928s.

**Why not half.** Each job runs on a 4 vCPU runner. Vitest's summed file time is about 3.2 times the core shard's wall, so six workers share four cores with the Postgres container. A core shard is bounded by its longest file. cross-tier-document took 185s of shard 2's 239s. The browser shards are bounded by test count. full-api and full-worker carry image builds on their critical paths.

**Files per infrastructure reached.** This is a static estimate from each test file's import closure, made by `/tmp/tp009/classify.mjs`. It over-counts in places. `config.test.ts` matches the object store on string mentions, and `test_pipeline_landed.py` names a Postgres URI it never reaches.

| Workspace | In-process | Postgres | Object store only | Git only | Worker process | Docker image | Browser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| apps/api | 10 | 70 | 1 | 1 | 1 | 5 | 0 |
| apps/web | 97 | 0 | 0 | 0 | 0 | 0 | 48 |
| apps/worker | 29 | 9 | 1 | 1 | 0 | 0 | 0 |
| packages/core | 25 | 95 | 0 | 1 | 4 | 0 | 0 |
| packages/devtools | 51 | 0 | 1 | 0 | 2 | 1 | 0 |
| packages/schema | 12 | 34 | 0 | 0 | 0 | 0 | 0 |
| **all 499** | **224, 45%** | **208** | **3** | **3** | **7** | **6** | **48** |

Of the 215 files that reach Postgres, 126 also reach git through the api harness or core's arrange helpers.

**Where the time goes.** A migrated database per file is not the cost. The template clone measured 86 ms (n=5), and no slow file makes a database per case. Four things are.

1. Readings that assert no threshold, or budgets that belong on a schedule. Write-budget 88s, recall 65s, map-budget 59s, analysed-map 47s, find-budget 43s, edit-budget 37s and guide-seed-budget 18s, 326s of core file time in all.
2. Process launches in series. cross-tier-document 185s for 16 worker launches. backup-image 94s and image 82s for image builds. Four lint-rule files, 164s, for one oxlint or knip process per case. `test_image.py` 291s locally in one xdist group.
3. Seeding loops. erasure-routine 58s at about 0.5s per case for an arrange and a git rewrite. guides 29s for a northgate import per case. ops 53s over 199 cases through the real app.
4. Browser test count. 710 tests at a mean of 4.05s, of which the triage marks about 70 as duplicates and about 150 in the ten slowest specs as single-screen.

**Slowest files, with class.** BOUNDARY means the real store is the claim. INCIDENTAL means the logic reaches it only through the harness. READING means a figure with no threshold or a budget for the schedule.

| File | CI s | Dominated by | Class | Unit |
| --- | --- | --- | --- | --- |
| core cross-tier-document | 185 | 16 serial worker launches | BOUNDARY | BA-270 |
| api backup-image | 94 | image build and container | BOUNDARY | BA-271 |
| core write-budget | 88 | 3,000-row seed, asserts lengths | READING | BA-269 |
| core import-direction | 88 | 131 oxlint spawns | INCIDENTAL | BA-273 |
| api image | 82 | image build | BOUNDARY | BA-271 |
| core recall | 65 | recall set written concept by concept | READING | BA-269 |
| schema warm-postgres | 64 | own containers | BOUNDARY | stays |
| core map-budget | 59 | dense-map seed | READING | BA-269 |
| core erasure-routine | 58 | arrange plus git rewrite per case | mixed | BA-275 |
| api ops | 53 | 199 cases through the app | mixed | BA-274 |
| core analysed-map | 47 | 250-node seed and a worker rebuild | READING | BA-269 |
| core erasure-match contract | 47 | a full code-point sweep per case | BOUNDARY, algorithmic | BA-273 |
| devtools mutation-shards | 43 | three Stryker runs | mixed | stays |
| core find-budget | 43 | corpus seed | READING | BA-269 |
| api test-postgres | 38 | compose up and down | BOUNDARY | BA-271 |
| core edit-budget | 37 | 20 timed edits, asserts lengths | READING | BA-269 |
| core import-bundle | 37 | two 5s lock-timeout waits | mixed | BA-275 |
| api ask | 31 | provision, seed and connect per case | INCIDENTAL | BA-274 |
| api lint-rules | 30 | oxlint per case | INCIDENTAL | BA-273 |
| core guides | 29 | northgate import per case | INCIDENTAL | BA-275 |
| api mcp-cross-tier | 28 | one worker launch | duplicate | BA-270 |
| api local-database | 28 | container restarts | BOUNDARY | BA-271 |
| api stop | 28 | a fixed 10s deadline | BOUNDARY | BA-271 |
| devtools comment-only-the-why | 27 | 74 oxlint spawns | INCIDENTAL | BA-273 |
| api restore | 26 | pg_restore in docker | BOUNDARY | BA-271 |
| api pending-set | 20 | 220 HTTP cases | INCIDENTAL | BA-274 |
| devtools knip | 19 | knip per case | INCIDENTAL | BA-273 |

**Slowest browser specs, summed seconds and triage.** The triage classed each case from its title and a sampled body, so the counts are estimates.

| Spec | Summed s | Tests | Journey | Component | Duplicate | Browser-only layout |
| --- | --- | --- | --- | --- | --- | --- |
| people | 421 | 73 | 6 | 40 | 10 | 15 |
| sources | 202 | 40 | 4 | 15 | 10 | 10 |
| knowledge-search | 184 | 45 | 2 | 26 | 4 | 7 |
| people-invitations | 141 | 36 | 2 | 18 | 8 | 5 |
| sign-in | 137 | 37 | 6 | 12 | 8 | 10 |
| frame | 135 | 37 | 2 | 3 | 8 | 20 |
| console-people | 113 | 24 | 3 | 9 | 6 | 6 |
| console | 111 | 19 | 2 | 5 | 8 | 4 |
| workspace-switcher | 97 | 16 | 3 | 9 | 4 | 0 |
| ask-new-question | 91 | 27 | 3 | 13 | 4 | 5 |

The triage's named duplicates include people's "refuses demoting both Admins" against the api's members-procedures case, people-invitations' "sends 50 at once, holding a 51st" against members-invitations, and workspace-switcher's "drops the left workspace's name when the member read fails" against the web's member-change test. BA-272 lists every pair.

**After-table.** Each merged PR adds a row with the five merge-group runs that follow it.

| After | Runs | Critical-path job and wall | Runner-seconds | In-process file share |
| --- | --- | --- | --- | --- |
| trunk, `f59a9da35` | 11 | full-web-browser shard 3, 474s | about 2,721 | 45% |

**Targets.** The critical path falls to 240s or less, set by BA-278's rule. Runner-seconds fall to 1,600 or less. The in-process share of test files rises to 65% or more. These targets are estimates from the file times above. Each PR's perf rule checks its own share.

## Appendix F. The target layering, the seams and the rule

**Layers.**

1. **Unit, in-process.** No store, no process, no network. A pure function's test calls it through the entry its package's `exports` map names. Web components run through Testing Library over the stubbed api. Lint rules run through their finding functions. This is most of the suite.
2. **Integration, real store.** The real Postgres, git repository, object store or map, used only where the store is the claim. That covers row-level security and zero-rows, migrations and DDL (ADR 0007), the SQL a slice runs for visibility, walks, ranking and sensitivity folds (ADRs 0023, 0032, 0044), locks and races, governed git commits and history rewrites (ADRs 0012, 0024), the erasure rehearsal, boundary-schema parity (ADR 0028) and the tier contract's SQL agreements (ADR 0031). Each transport keeps one case per route or command through its real entry.
3. **Process and image.** Images, compose scripts, process lifecycles and the cross-tier worker. These run in their own CI job (BA-271) or with one worker per file (BA-270).
4. **Browser.** One spec per page, about 30, with its latency budget, the accessibility gate and keyboard reach. About 12 journeys cross pages through the real api. They are code sign-in to the picker to the shell, two-workspace scoping, invite then accept, consent and OAuth, passkey enrol and sign-in, workspace switch, self-removal to the chooser, source upload to indexed and published, ask with its stream and a flag, console end-sessions, the second factor, and recovery. Layout at 320 and 390px runs in a project with no api.
5. **Readings and budgets.** Figures and performance budgets run on a schedule (BA-269), like the readings and mutation runs today.

**Seams.** Every seam is a pure function or an injected seam that exists already. No store door becomes a port.

- Pure decide functions per slice, over rows already read. Today's examples are `kernel/admission.ts`, `concepts/trust.ts`, `erasure/identifiers.ts`, `concepts/file.ts` and `members/sets.ts`. BA-275 adds kind folding, the merge key, guide coverage and marking, and import's analyse step. BA-274 adds `parseOpsArgs`.
- The injected seams that exist today. `Clock`, `fetchModel` (ADR 0049), `sendEmail`, the Better Auth seam (ADR 0009) and `Doors`. BA-276 adds a clock to the worker loop.
- The web's stubbed api, which BA-277 lets hold a request.
- A rule's finding functions, which BA-273 calls directly.

**Decisions moved.** No ADR under `docs/solutions/architecture-patterns/` is superseded. ADR 0029's concrete doors stay. The rules that move are AGENTS.md's second Testing bullet, the browser-spec-per-change rule in `.agents/playbooks/verification.md`, and the browser-suite skill's "never asserted against its source". `deepening.md` keeps "never a stand-in" and gains the pure-function sentence. BA-268 records the decision as ADR 0053.

**The AGENTS.md Testing section as it should read.**

```markdown
## Testing

- Test at the lowest layer that can see the claim. A pure function's test calls it in-process through the entry its package's `exports` map names. A transport's test crosses its interface: `apps/api` through `server.request(...)`, `apps/worker` through the job or module entry point. A page's single-screen behaviour is a component test through Testing Library.
- Use the real Postgres, object store, git repository or map only where that store is the claim: row-level security and zero-rows, migrations, the SQL a slice runs, locks and races, governed commits and history rewrites, the erasure rehearsal, and the tier contract's SQL agreements. Each route or command keeps one case through its real entry.
- A decision over rows already read is a pure function on its slice. Never mock this repository's own code, and never add an in-memory stand-in for a store the platform runs. An in-memory adapter replaces only a third-party service, such as an LLM provider, behind its injected seam.
- The browser suite holds one spec per page, with its latency budget, the accessibility gate and keyboard reach, and the journeys that cross pages through the real api. A bug's regression test sits at the lowest layer that reproduces it.
- Images, compose scripts and process lifecycles run in the image job. A test that records figures, or a performance budget, runs on the schedule, not in `check`.
- Postgres aborts the transaction after a failed statement, even a caught one. Assert the rejection or the rows before any returned value if the intention is for a test to provoke a failure.
```
