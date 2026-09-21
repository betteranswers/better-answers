# The workflow: one goal over tickets, one agent per ticket

How a set of ordna tickets becomes merged code. One session — the **Coordinator** (`CONTEXT.md`, *The route*) — runs `/goal` over the tickets; each ticket is one agent's `/implement`, start to commit. `/to-spec` and `/to-tickets` run in sessions of their own before this one.

## The shape

route spec → `/to-spec` (a block) → `/to-tickets` (its tracer bullets, on the board) → `/goal` over the tickets → PR → the route's status table.

The Coordinator dispatches, reads and decides. It writes no code, since the context the loop lives in is the one thing it cannot spend.

## The goal

```
/goal T-130, T-132, T-134, T-135, T-136 and T-137 are done on the board — `ordna list -s todo` names none of them — each with a Progress entry naming the merge commit it landed on and the acceptance lines it met, built by the workflow in docs/agents/workflow.md.
```

Three parts: the **end state** the board can show, the **check** that shows it, the **turn clause** that bounds it. The evaluator is a small model that reads the transcript and runs nothing, which is why step 6 prints the board and the entry into the conversation. A subagent still running defers the evaluation; a turn ends on what came back, never on a wait.

## Per ticket, the Coordinator

1. **Pick** from the frontier: a `todo` ticket whose `depends_on` are all `done` (`ordna list -s todo`, then `ordna show`). Frontier tickets run in parallel. A ticket that adds a migration or bumps `contract_version` runs alone until it merges: the drizzle journal and the contracts manifest do not merge.
2. **Claim**: `ordna move T-nnn doing`, read the status line back, push the ref (`docs/agents/issue-tracker.md`).
3. **Dispatch** one agent with a context of its own. The brief is under ten lines: the ticket id; where it works — a worktree (`isolation: "worktree"`; the create hook provisions it) or the checkout, the Coordinator's call for the task; *run `/mattpocock-skills:implement` on the ticket, end to end*; and the report — five lines to the Coordinator: what changed, the commands run and their state, anything not run and why, the head commit.
4. **Read** the report against the ticket's acceptance lines. A line the report cannot show is the next attempt's brief, one paragraph carrying the gap, on the same branch. The third attempt that comes back short stops the goal and opens the conversation with the owner.
5. **Land**: push the branch and open the PR, its title the repository's prose sentence ending with the ticket id in brackets — a repository setting makes it the merge commit's subject. Then `gh pr merge <n>`, which adds it to `main`'s **merge queue**: the queue runs `check` on the merge group and merges on green. Run it as soon as the PR is open — before `check` is green it arms the merge, and the PR joins the queue when `check` passes. It prints nothing, so read it back: GraphQL's `pullRequest(number: <n>) { isInMergeQueue autoMergeRequest { enabledAt } }` has one of the two set when the PR is queued or armed. No session orders merges by hand, waits on a `build` run or asks another for a signal; an agent never pushes to `main`, the bypass being the owner's. GitHub deletes the merged branch; then `node .gitnexus/run.cjs analyze` in the main checkout.
6. **Record**: a Progress entry of three lines — where it landed (date, merge commit, PR number); the acceptance lines met, or the one that is not and why; anything seen that is not the ticket's. The PR body is the record of what landed, the suites and the review, and the entry restates none of it; a measurement the ticket asks for is the one allowed fourth line. Then the origin-first edit, `ordna move T-nnn done`, push the ref, print `ordna list -s todo` and the entry.

## Per task implementation

One agent owns the ticket end to end - `/mattpocock-skills:implement` is the process: `/tdd` at the seams the ticket names, the tier's skills (`AGENTS.md`, *Skills*), typecheck and single suites as it goes, the table below's first row at the end, then `/code-review` against the ticket, each finding fixed before the commit. The standards that review reads are the rules files — `CODING_RULES.md` and the `CODING_RULES.md` of every directory the change touches, `apps/api/`, `apps/web/`, `apps/worker/` and `deploy/` — and a rule's `Reviewer:` line is the part of it no gate will catch for you. An ADR amendment lands in the commit that changes what the ADR decides; its `docs/adr/README.md` row moves in that same commit when the live conclusion moves, and is left alone when it does not (the rule at the index's head).

Commits go on the ticket's branch, one message in the repository's prose shape ending with the ticket id in brackets, `detect_changes` clean before each.

## What `check` runs where

| When | What | Who |
| --- | --- | --- |
| The attempt's end | each touched workspace's `lint` and `typecheck` (the worker's `ruff` and `mypy`); the suites the ticket names or touched, by file (`pnpm --filter <workspace> exec vitest run <file>…`; `cd apps/worker && uv run --frozen pytest <file>…`), with `IMAGE_PROBE_DEFERRED=true` so neither tier's image-contents suite builds an image; and the root gates named ahead of `check:workspaces` in the root `package.json`, read there rather than restated here | the agent |
| The PR and the merge group | root `check` in full on the runner (`.github/workflows/check.yml`) — the one place a whole workspace suite runs. A change with at least one changed path, every one of them ending `.md`, takes the **docs lane** — the root `check:docs`, the format check and the prose gates; anything else, and anything the lane cannot resolve, is the full run | CI, the arbiter |

An acceptance line reading "`check` green" is that second row — CI's, on the PR — and so is `/implement`'s *full test suite once at the end*. The agent runs the first row and no more; a rebase that touches none of the ticket's files is followed by no local re-run.

## Environment

A Docker daemon (every suite starts a Testcontainers Postgres, the core suites a Garage), `uv`, `pnpm`, Playwright's Chromium for the web (`pnpm --filter @better-answers/web exec playwright install chromium`), a warm `HF_HOME` for the detector's weights, and `git-filter-repo` at the version `apps/api/Dockerfile` pins.
