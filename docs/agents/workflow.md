# The workflow: one goal over tickets, one agent per ticket, one PR per ticket

How a set of ordna tickets becomes merged code. One session — the **Coordinator** (`CONTEXT.md`, *The route*) — runs `/goal` over the tickets; each ticket is one agent's `/implement`, start to commit; each ticket is one pull request into `main`. `/to-spec` and `/to-tickets` run in sessions of their own before this one, and `/triage` in one of its own after.

## The shape

route spec → `/to-spec` (a block) → `/to-tickets` (its tracer bullets, on the board) → **`/goal` over the tickets** → a PR per ticket → the route's status table.

A goal's scope is the session's to set: a block's remaining tickets, two named ids, the `backlog` tag. The Coordinator dispatches, reads and decides. It writes no code, since the context the loop lives in is the one thing it cannot spend.

## The goal

```
/goal T-130, T-132, T-134, T-135, T-136 and T-137 are done on the board — `ordna list -s todo` names none of them — each with a Progress entry naming the suites that passed and the review that ran, built by the workflow in docs/agents/workflow.md; or stop after 60 turns.
```

Three parts, each load-bearing: the **end state** the board can show, the **check** that shows it, the **turn clause** that bounds it. The evaluator is a small model that reads the transcript and runs nothing, so after every landing the Coordinator prints `ordna list -s todo` and the ticket's Progress entry into the conversation. A subagent still running defers the evaluation; a turn ends on what came back, never on a wait.

## Per ticket, the Coordinator

1. **Pick** from the frontier: a `todo` ticket whose `depends_on` are all `done` (`ordna list -s todo`, then `ordna show`). Frontier tickets run in parallel. A ticket that adds a migration or bumps `contract_version` runs alone until it merges: the drizzle journal and the contracts manifest do not merge.
2. **Claim**: `ordna move T-nnn doing`, read the status line back, push the ref (`docs/agents/issue-tracker.md`).
3. **Dispatch** one agent with a context of its own. The brief is under ten lines: the ticket id; where it works — a worktree (`isolation: "worktree"`; the create hook provisions it) or the checkout, the Coordinator's call for the task; *run `/mattpocock-skills:implement` on the ticket, end to end*; and the report — five lines to the Coordinator: what changed, the commands run and their state, anything not run and why, anything seen that the ticket does not cover, the head commit.
4. **Read** the report against the ticket's acceptance lines. A line the report cannot show is the next attempt's brief, one paragraph carrying the gap, on the same branch. The third attempt that comes back short stops the goal and opens the conversation with the owner.
5. **Land**: push the branch, open the PR, wait for CI — the root `check` runs on every pull request — merge on green, then `node .gitnexus/run.cjs analyze` in the main checkout.
6. **Record**: a Progress entry on the task — merged when and where, what landed, the suites, the review, a measurement if the ticket records one — through the origin-first edit; `ordna move T-nnn done`; push the ref; print `ordna list -s todo`.

## Per task implementation

One agent owns the ticket end to end - `/mattpocock-skills:implement` is the process: `/tdd` at the seams the ticket names, the tier's skills (`AGENTS.md`, *Skills*), typecheck and single suites as it goes, the checks below once at the end, then `/code-review` against the ticket, each finding fixed before the commit. Words land in `CONTEXT.md` before code names them; an ADR amendment and its `docs/adr/README.md` row land in the commit that changes what the ADR decides.

Commits go on the ticket's branch, one message in the repository's prose shape ending with the ticket id in brackets, `detect_changes` clean before each.

## What `check` runs where

`[CHECK9]` in `CODING_RULES.md`: a branch narrows its tests, never its gates.

| When | What | Who |
| --- | --- | --- |
| The attempt's end | each touched workspace's `check` (`pnpm --filter <workspace> check`; `cd apps/worker && uv run --frozen check`) and the root gates named ahead of `check:workspaces` in the root `package.json` (`node scripts/check.mjs format:check lint jscpd knip`), with `IMAGE_PROBE_DEFERRED=true` so neither tier's image-contents suite builds an image | the agent |
| The PR | root `check` in full on the runner (`.github/workflows/check.yml`) | CI, the arbiter |

## Environment

A Docker daemon (every suite starts a Testcontainers Postgres, the core suites a Garage), `uv`, `pnpm`, Playwright's Chromium for the web (`pnpm --filter @better-answers/web exec playwright install chromium`), a warm `HF_HOME` for the detector's weights, and `git-filter-repo` at the version `apps/api/Dockerfile` pins. The buildx cache is bounded by the builder's own garbage-collection policy, written where the builder reads it — where that is, and how to read the cache, is `docs/operations/BUILD_CACHE.md`.
