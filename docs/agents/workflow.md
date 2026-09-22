# The workflow: one goal over tickets, one agent per ticket

How a set of ordna tickets becomes merged code. One session — the **Coordinator** (`CONTEXT.md`, *The route*) — runs `/goal` over the tickets; each ticket is one agent's `/implement`, start to commit. `/to-spec` and `/to-tickets` run in sessions of their own before this one.

## The shape

route spec → `/to-spec` (a block) → `/to-tickets` (its tracer bullets, on the board) → `/goal` over the tickets → PR → the route's status table.

The Coordinator dispatches, reads and decides. It writes no code, since the context the loop lives in is the one thing it cannot spend.

## The goal

```
/goal T-130, T-132, T-134, T-135, T-136 and T-137 are done on the board — `ordna list -s todo` names none of them — built by the workflow in `docs/agents/workflow.md`.
```

Three parts: the **end state** the board can show, the **check** that shows it, the **turn clause** that bounds it. The evaluator is a small model that reads the transcript and runs nothing, which is why step 6 prints the board and the entry into the conversation. A subagent still running defers the evaluation; a turn ends on what came back, never on a wait.

## Per ticket, the Coordinator

1. **Pick** from the frontier: a `todo` ticket whose `depends_on` are all `done` (`ordna list -s todo`, then `ordna show`). Frontier tickets run in parallel. A ticket that adds a migration or bumps `contract_version` runs alone until it merges: the drizzle journal and the contracts manifest do not merge.
2. **Claim**: `ordna move T-nnn doing`, read the status line back, push the ref (`docs/agents/issue-tracker.md`).
3. **Dispatch** one agent with a context of its own. The brief is under ten lines: the ticket id; where it works — a worktree (`isolation: "worktree"`; the create hook provisions it) or the checkout, the Coordinator's call for the task; *run `/mattpocock-skills:implement` on the ticket, end to end*; and the report — five lines to the Coordinator: what changed, the commands run and their state, anything not run and why, the head commit.
4. **Read** the report against the ticket's acceptance lines. A line the report cannot show is the next attempt's brief, one paragraph carrying the gap, on the same branch. The third attempt that comes back short stops the goal and opens the conversation with the owner.
5. **Land**: push the branch and open the PR, its title the commit's subject in the shape below (*The prose shape*) and its body the commit's paragraph — repository settings make the two the merge commit's subject and body. Then `gh pr merge <n>`, which adds it to `main`'s **merge queue**: the queue runs `check` on the merge group and merges on green. Run it as soon as the PR is open — before `check` is green it arms the merge, and the PR joins the queue when `check` passes. It prints nothing, so read it back: GraphQL's `pullRequest(number: <n>) { isInMergeQueue autoMergeRequest { enabledAt } }` has one of the two set when the PR is queued or armed. No session orders merges by hand, waits on a `build` run or asks another for a signal; *The queue*, below, is where every commit goes. GitHub deletes the merged branch; then `node .gitnexus/run.cjs analyze` in the main checkout.
6. **Record**: a Progress entry of three lines — where it landed (date, merge commit, PR number); the acceptance lines met, or the one that is not and why; anything seen that is not the ticket's. The PR body is the record of what landed, the suites and the review, and the entry restates none of it; a measurement the ticket asks for is the one allowed fourth line. Then the origin-first edit, `ordna move T-nnn done`, push the ref, print `ordna list -s todo` and the entry.

## Per task implementation

One agent owns the ticket end to end - `/mattpocock-skills:implement` is the process: `/tdd` at the seams the ticket names, the tier's skills (`AGENTS.md`, *Skills*), typecheck and single suites as it goes, the table below's first row at the end, then `/code-review` against the ticket, each finding fixed before the commit. The standards that review reads are the rules files — `CODING_RULES.md` and the `CODING_RULES.md` of every directory the change touches, `apps/api/`, `apps/web/`, `apps/worker/` and `deploy/` — and a rule's `Reviewer:` line is the part of it no gate will catch for you. An ADR amendment lands in the commit that changes what the ADR decides; its `docs/adr/README.md` row moves in that same commit when the live conclusion moves, and is left alone when it does not (the rule at the index's head).

Commits go on the ticket's branch, one message in the repository's prose shape (*The prose shape*, below), `detect_changes` clean before each. **NB:** `detect_changes` in `compare` scope against `main` reads the main checkout's stale index and is not evidence; the worktree-scoped `all` reading is.

## The queue

**Every commit reaches `main` through the merge queue.** A docs edit, a chore, a one-line fix and a dequeue followed by a merge are the same commit to GitHub: each moves `main` from outside the queue, which rebuilds every entry already in it and orphans the run each was halfway through. It also leaves no merge-group run for `build.yml`'s `already-checked` gate to find, so it pays a full `check` on `main` of its own — thirteen minutes, after the ones it just threw away.

A change too small for a ticket takes the lane rather than the bypass, from a tree standing on `main`:

```
pnpm land --message "The issue tracker's note says how a moved ref is pushed to origin"
```

It names a branch from the message, commits the working tree over `origin/main`'s head, pushes, opens the pull request with `gh pr create --fill`, arms the merge, and prints the pull request number with the queue state read back. `--message` takes the whole message — the first line the subject, the rest the body — and `--fill` makes the title the subject and the pull request's body the body.

### The prose shape

**A subject of 72 characters at most: one clause saying what is now true, ending with the ticket id in brackets. Then a blank line, and the paragraph — what changed and why — as the body.** Said once, here.

Two things hold it. `pnpm land` refuses a subject over the ceiling, naming the length it saw, alongside the rest of its refusals; and lefthook's `commit-msg` hook holds the same ceiling over every commit, `pnpm land`'s or not (`LEFTHOOK=0` or `LEFTHOOK_EXCLUDE=subject-ceiling` to skip one deliberately). The number is written in both, and `packages/devtools/test/land.test.ts` fails when they disagree.

The ceiling is this repository's, and sits well under GitHub's own: a pull request title over 256 characters is refused outright by `gh pr create`, after the branch, the commit and the push have already happened. The repository's `merge_commit_message` is `PR_BODY`, so the paragraph goes to `main` with the subject rather than being dropped at the merge. What `pnpm land` will not take comes back naming the condition it missed, so no list of refusals is restated here to go stale.

Three things a queue run does that the session which opened the pull request has to answer:

- **A failed queue run takes the pull request out of the queue *and* disarms auto-merge** — `isInMergeQueue` and `autoMergeRequest` both go null — so `gh pr merge <n> --auto --merge` is run again after every queue failure, and read back again. Three re-arms went unmade on PR 128 because this was not written down.
- **Rebase onto `origin/main`, never the local `main`**, which may carry another session's unpushed commits: two agents that rebased onto a local one paid a failed `check` and a force-push for it.
- **A merge-group failure whose only red is a browser spec the pull request did not touch is a flake to re-arm**, not a fix to make.

**The bypass is the owner's, no agent's, and it is for an empty queue alone** — an empty queue has nothing to rebuild. Read the queue before using it, and take the lane above when anything is in it:

```
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      mergeQueue(branch: "main") { entries(first: 1) { totalCount } }
    }
  }'
```

## What `check` runs where

| When | What | Who |
| --- | --- | --- |
| The attempt's end | each touched workspace's `lint` and `typecheck` (the worker's `ruff` and `mypy`); the suites the ticket names or touched, by file (`pnpm --filter <workspace> exec vitest run <file>…`; `cd apps/worker && uv run --frozen pytest <file>…`), with `IMAGE_PROBE_DEFERRED=true` so neither tier's image-contents suite builds an image; and the root gates the root `package.json`'s `check:gates` names, read there rather than restated here. Those gates are the root's alone — a workspace's own `check` never runs one — so a branch can be green on its tier's whole suite and red on a root gate it never ran, and find out at the pull request. Tests narrow to a branch; gates do not | the agent |
| The PR | the **affected lane** on the runner (`.github/workflows/check.yml`), as **parallel legs and one verdict**. A `lane` job decides the lane, then three legs run at once: `affected-gates` (the root gates, which no change narrows), `affected-workspaces` (`check` in every workspace the change touched and every workspace that depends on one — `pnpm --filter "...[<base>]"` against the pull request's base, so a change to `packages/core` still pays for `apps/api` and `apps/web`) and `affected-worker` (the worker's `check`, when a path under `apps/worker/` or `contracts/` changed; the leg reports either way). A change whose every path ends `.md` takes the **docs lane** instead — one job, `docs-gates`, running the root `check:docs`: the format check and the prose gates. Anything the filter cannot resolve is the full run: a root file, a lockfile, `contracts/`, prose mixed with code | CI |
| The merge group | root `check` in full — `full-root` (the root gates, then `packages/core`, `packages/schema` and `packages/devtools`), `full-api`, `full-web` and `full-worker`, each installing only the toolchain its own gates ask for. Pre-merge checks as a subset and merge-time checks as the whole is the merge queue's own design, so the commit that is about to land is the one that pays for everything; a run `build.yml` calls is the same. A run costs the longest leg — the worker's — rather than the sum of them. In both rows the job named `check` is the fan-in: the ruleset's required context and `build.yml`'s gate, green only when every leg this run's lane names is green and every other leg stood down | CI, the arbiter |

An acceptance line reading "`check` green" is CI's, on the pull request and again in the queue — the two rows below the agent's — and so is `/implement`'s *full test suite once at the end*. The agent runs the first row and no more; a rebase that touches none of the ticket's files is followed by no local re-run.

## Environment

A Docker daemon (every suite starts a Testcontainers Postgres, the core suites a Garage), `uv`, `pnpm`, Playwright's Chromium for the web (`pnpm --filter @better-answers/web exec playwright install chromium`), a warm `HF_HOME` for the detector's weights, and `git-filter-repo` at the version `apps/api/Dockerfile` pins.
