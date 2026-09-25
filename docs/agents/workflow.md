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

1. **Pick** from the frontier: a `todo` ticket whose `depends_on` are all `done` (`ordna list -s todo`, then `ordna show`). Frontier tickets run in parallel. A ticket that adds a migration or edits `contracts/` runs alone until it merges: the drizzle journal does not merge, and an edit under `contracts/` moves both tiers' generated digest constants, which do not merge either.
2. **Claim**: `ordna move T-nnn doing`, read the status line back, push the ref (`docs/agents/issue-tracker.md`).
3. **Dispatch** one agent with a context of its own. The brief is under ten lines: the ticket id; where it works — a worktree (`isolation: "worktree"`; the create hook provisions it) or the checkout, the Coordinator's call for the task; *run `/mattpocock-skills:implement` on the ticket, end to end*; and the report — five lines to the Coordinator: what changed, the commands run and their state, anything not run and why, the head commit.
4. **Read** the report against the ticket's acceptance lines. A line the report cannot show is the next attempt's brief, one paragraph carrying the gap, on the same branch. The third attempt that comes back short stops the goal and opens the conversation with the owner.
5. **Land**: push the branch and open the PR, its title the commit's subject and its body the commit's body, footer included (*The commit's form*, below) — repository settings make the two the merge commit's subject and body. Then `gh pr merge <n>`, which adds it to `main`'s **merge queue**: the queue runs `check` on the merge group and merges on green. Run it as soon as the PR is open — before `check` is green it arms the merge, and the PR joins the queue when `check` passes. It prints nothing, so read it back: GraphQL's `pullRequest(number: <n>) { isInMergeQueue autoMergeRequest { enabledAt } }` has one of the two set when the PR is queued or armed. *The queue*, below, is where every commit goes. GitHub deletes the merged branch; then `node .gitnexus/run.cjs analyze` in the main checkout.
6. **Record**: a Progress entry of three lines — where it landed (date, merge commit, PR number); the acceptance lines met, or the one that is not and why; anything seen that is not the ticket's. The PR body is the record of what landed, the suites and the review, and the entry restates none of it; a measurement the ticket asks for is the one allowed fourth line. Then the origin-first edit, `ordna move T-nnn done`, push the ref, print `ordna list -s todo` and the entry.

## Per task implementation

One agent owns the ticket end to end - `/mattpocock-skills:implement` is the process: `/tdd` at the seams the ticket names, the tier's skills (`AGENTS.md`, *Skills*), `/code-comments`, `/human-writing` for any doc a person reads, typecheck and single suites as it goes, and the table below's first row at the end. `/mutation-testing` runs in the review slot - after tests are green - never in the TDD inner loop; fire it on refactors and PRs touching validation/parsing/auth; skip UI/copy/config diffs. Then `/code-review` runs against the ticket, each finding fixed before the commit. The standards that review reads are the rules files — `CODING_RULES.md` and the `CODING_RULES.md` of every directory the change touches, `apps/api/`, `apps/web/`, `apps/worker/` and `deploy/` — and a rule's `Reviewer:` line is the part of it no gate will catch for you. An ADR amendment lands in the commit that changes what the ADR decides; its `docs/adr/README.md` row moves in that same commit when the live conclusion moves, and is left alone when it does not (the rule at the index's head).

Commits go on the ticket's branch, one message in the commit's form (*The commit's form*, below), `detect_changes` clean before each. **NB:** `detect_changes` in `compare` scope against `main` reads the main checkout's stale index and is not evidence; the worktree-scoped `all` reading is.

## The queue

**Every commit reaches `main` through the merge queue.**

A change too small for a ticket takes the lane rather than the bypass, from the main checkout or a worktree of it, with the change still uncommitted:

```
pnpm land --message "docs: say how a moved ref is pushed to origin"
```

It checks the message with commitlint, names a branch from the `Refs:` footer's ticket and the summary's first five words, commits the working tree over `origin/main`'s head, pushes, opens the pull request with `gh pr create --fill`, arms the merge, and prints the pull request number with the queue state read back. `--message` takes the whole message — the first line the subject, the rest the body and the footer — and `--fill` makes the title the subject and the pull request's body the body.

**The bypass is for an empty queue alone**. Read the queue before using it, and take the lane above when anything is in it:

```
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      mergeQueue(branch: "main") { entries(first: 1) { totalCount } }
    }
  }'
```

### The commit's form

**Conventional Commits: a subject `type(scope): summary` of 72 characters at most. Then a blank line and the body — what changed and why, in plain prose. Then a blank line and the footer, `Refs: T-nnn`.**

```
docs: say how a moved ticket ref is pushed to origin

The note said to push a moved ref but not how, and a plain push is refused because a blob ref never fast-forwards. It now gives the command, with --force.

Refs: T-123
```

- The summary is imperative and lower-case, with no full stop. A name keeps its capitals in backticks: `` fix(api): refuse an `OKF` key with no prefix ``.
- The types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.
- The scope is optional and names a workspace or an area: `api`, `web`, `worker`, `core`, `schema`, `devtools`, `design-system`, `deploy`, `ci`, `docs`. `deps` is Renovate's.
- The ticket goes in the footer and never in the subject. A change with no ticket has no footer.

One commitlint config, `commitlint.config.mjs`, holds the form in three places, and each refusal names the rule it broke:

- lefthook's `commit-msg` hook, over every commit;
- `pnpm land`, over its message;
- the `pr-title` job in `check.yml`, over the pull request's title, which becomes the merge commit's subject. It runs on the pull request and again in the merge queue, and reads the title when it runs, so a retitle is read before the merge and a red `pr-title` goes green on `gh run rerun <run> --failed`.

The repository's `merge_commit_message` is `PR_BODY`, so the body and its footer go to `main` with the subject rather than being dropped at the merge.

## What `check` runs where

| When | What | Who |
| --- | --- | --- |
| The attempt's end | each touched workspace's `lint` and `typecheck` (the worker's `ruff` and `mypy`); the suites the ticket names or touched, by file (`pnpm --filter <workspace> exec vitest run <file>…`; `cd apps/worker && uv run --frozen pytest <file>…`), with `IMAGE_PROBE_DEFERRED=true`; and the root gates the root `package.json`'s `check:gates` names. | the agent |
| The PR | the **affected lane** on the runner (`.github/workflows/check.yml`). A `lane` job decides the lane, then three legs run at once: `affected-gates`, `affected-workspaces`, and `affected-worker` . Docs lane for a change whose every path ends `.md` - `docs-gates`, running the root `check:docs`. | CI |
| The merge group | `full-root` (the root gates, then `packages/core`, `packages/schema` and `packages/devtools`), `full-api`, `full-web` and `full-worker`. A run `build.yml` calls is the same. | CI, the arbiter |

An acceptance line reading "`check` green" is CI's, on the pull request and again in the queue — the two rows below the agent's. The agent runs the first row and no more; a rebase that touches none of the ticket's files is followed by no local re-run.

## Environment

A Docker daemon, `uv`, `pnpm`, Playwright's Chromium for the web (`pnpm --filter @better-answers/web exec playwright install chromium`), a warm `HF_HOME` for the detector's weights, and `git-filter-repo` at the version `apps/api/Dockerfile` pins.

A vitest run starts its stores once, from `globalSetup`, and hands each file its own inside them: Postgres in every workspace, a database per file cloned from a migrated template; Garage in `packages/core` and `apps/api`, a bucket and a key per file through the admin API. Garage starts only where a selected file names `objectStoreForSuite`.
