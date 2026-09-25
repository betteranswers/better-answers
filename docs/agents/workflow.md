# The workflow: one goal over tickets, one agent per ticket

How a set of ordna tickets becomes merged code. One session, the **Coordinator** (`CONTEXT.md`, *The route*), runs `/goal` over the tickets. Each ticket is one agent's `/implement`, from start to commit. `/to-spec` and `/to-tickets` run earlier, in sessions of their own.

## The shape

route spec → `/to-spec` (a block) → `/to-tickets` (its tracer bullets, on the board) → `/goal` over the tickets → PR → the route's status table.

The Coordinator dispatches, reads and decides. It writes no code, because the loop lives in its context and that context is the one thing it cannot spend.

## The goal

```
/goal T-130, T-132, T-134, T-135, T-136 and T-137 are done on the board — `ordna list -s todo` names none of them — built by the workflow in `docs/agents/workflow.md`.
```

A goal has three parts:

- the **end state**, which the board can show;
- the **check** that shows it;
- the **turn clause** that bounds it.

The evaluator is a small model that reads the transcript and runs nothing. That is why step 6 prints the board and the entry into the conversation. While a subagent is still running, the evaluation waits. A turn ends on what came back, never on a wait.

## Per ticket, the Coordinator

1. **Pick** from the frontier: a `todo` ticket whose `depends_on` are all `done` (`ordna list -s todo`, then `ordna show`). Frontier tickets run in parallel. Two kinds of ticket run alone until they merge:
   - a ticket that adds a migration, because the drizzle journal does not merge;
   - a ticket that edits `contracts/`, because the edit moves both tiers' generated digest constants, which do not merge either.
2. **Claim**: run `ordna move T-nnn doing`, read the status line back, and push the ref (`docs/agents/issue-tracker.md`).
3. **Dispatch** one agent with a context of its own. The brief is under ten lines, and gives:
   - the ticket id;
   - where the agent works: a worktree (`isolation: "worktree"`, which the create hook provisions) or the checkout, as the Coordinator decides for the task;
   - *run `/mattpocock-skills:implement` on the ticket, end to end*;
   - the report, five lines to the Coordinator: what changed, the commands run and their state, anything not run and why, and the head commit.
4. **Read** the report against the ticket's acceptance lines. If the report cannot show a line, that gap is the next attempt's brief: one paragraph, on the same branch. If the third attempt comes back short, the goal stops and the conversation with the owner opens.
5. **Land**:
   - Push the branch and open the PR. Its title is the commit's subject, and its body is the commit's body, footer included (*The commit's form*, below). Repository settings make these the merge commit's subject and body.
   - Run `gh pr merge <n>` as soon as the PR is open. It adds the PR to `main`'s **merge queue**, which runs `check` on the merge group and merges on green. Before `check` is green, the command arms the merge instead, and the PR joins the queue when `check` passes.
   - The command prints nothing, so read it back. GraphQL's `pullRequest(number: <n>) { isInMergeQueue autoMergeRequest { enabledAt } }` has one of the two set when the PR is queued or armed.
   - *The queue*, below, is where every commit goes. GitHub deletes the merged branch; then run `node .gitnexus/run.cjs analyze` in the main checkout.
6. **Record** a Progress entry of three lines:
   - where it landed: the date, the merge commit and the PR number;
   - the acceptance lines met, or the one that is not and why;
   - anything seen that is not the ticket's.

   The PR body records what landed, the suites and the review, and the entry restates none of it. A measurement the ticket asks for is the one allowed fourth line. Then make the origin-first edit, run `ordna move T-nnn done`, push the ref, and print `ordna list -s todo` and the entry.

## Per task implementation

One agent owns the ticket end to end. `/mattpocock-skills:implement` is the process, and it takes in:

- `/tdd` at the seams the ticket names;
- the tier's skills (`AGENTS.md`, *Skills*);
- `/code-comments`;
- `/human-writing` for any doc a person reads;
- typecheck and single suites as it goes;
- the first row of the table below, at the end.

`/mutation-testing` runs in the review slot, after the tests are green.

- Run it on refactors, and on PRs that touch validation, parsing or auth.
- Never run it in the TDD inner loop.
- Skip it for UI, copy and config diffs.

Then `/code-review` runs against the ticket, and each finding is fixed before the commit. The review reads its standards from the rules files. Those are `CODING_RULES.md`, plus the `CODING_RULES.md` of each directory the change touches: `apps/api/`, `apps/web/`, `apps/worker/` and `deploy/`. A rule's `Reviewer:` line is the part no gate will catch for you.

An ADR amendment lands in the commit that changes what the ADR decides. If the live conclusion moves, the ADR's `docs/adr/README.md` row moves in that same commit. If it does not, the row is left alone (the rule at the index's head).

Commits go on the ticket's branch, each with one message in the commit's form (*The commit's form*, below). `detect_changes` is clean before each commit. **NB:** the worktree-scoped `all` reading of `detect_changes` is evidence. A `compare` reading against `main` is not, because it reads the main checkout's stale index.

## The queue

**Every commit reaches `main` through the merge queue.**

A change too small for a ticket goes through `pnpm land`, not the bypass. Run it from the main checkout or a worktree of it, with the change still uncommitted:

```
pnpm land --message "docs: say how a moved ref is pushed to origin"
```

The command:

- checks the message with commitlint;
- names a branch from the `Refs:` footer's ticket and the summary's first five words;
- commits the working tree over `origin/main`'s head, and pushes;
- opens the pull request with `gh pr create --fill`, and arms the merge;
- prints the pull request number, with the queue state read back.

`--message` takes the whole message: its first line is the subject, and the rest is the body and the footer. `--fill` makes the pull request's title the subject and its body the body.

**The bypass is for an empty queue alone.** If anything is in the queue, use `pnpm land` instead. Read the queue before you use the bypass:

```
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      mergeQueue(branch: "main") { entries(first: 1) { totalCount } }
    }
  }'
```

### The commit's form

**Conventional Commits: a subject `type(scope): summary` of 72 characters at most. Then a blank line and the body: what changed and why, in plain prose. Then a blank line and the footer, `Refs: T-nnn`.**

```
docs: say how a moved ticket ref is pushed to origin

The note said to push a moved ref but not how, and a plain push is refused because a blob ref never fast-forwards. It now gives the command, with --force.

Refs: T-123
```

- The summary is imperative and lower-case, with no full stop. A name keeps its capitals in backticks: `` fix(api): refuse an `OKF` key with no prefix ``.
- The types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.
- The scope is optional and names a workspace or an area: `api`, `web`, `worker`, `core`, `schema`, `devtools`, `design-system`, `deploy`, `ci`, `docs`. `deps` is Renovate's.
- The ticket goes in the footer, never in the subject. A change with no ticket has no footer.

One commitlint config, `commitlint.config.mjs`, holds the form in three places. Each refusal names the rule it broke.

- lefthook's `commit-msg` hook checks every commit.
- `pnpm land` checks its message.
- The `pr-title` job in `check.yml` checks the pull request's title, which becomes the merge commit's subject. The job runs on the pull request and again in the merge queue. It reads the title when it runs, so a retitle is read before the merge, and a red `pr-title` goes green on `gh run rerun <run> --failed`.

The repository's `merge_commit_message` is `PR_BODY`. So the body and its footer reach `main` with the subject, instead of being dropped at the merge.

## What `check` runs where

| When | What | Who |
| --- | --- | --- |
| The attempt's end | Each touched workspace's `lint` and `typecheck` (the worker's `ruff` and `mypy`). The suites the ticket names or touched, by file (`pnpm --filter <workspace> exec vitest run <file>…`; `cd apps/worker && uv run --frozen pytest <file>…`), with `IMAGE_PROBE_DEFERRED=true`. The root gates that the root `package.json`'s `check:gates` names. | the agent |
| The PR | The **affected lane** on the runner (`.github/workflows/check.yml`). A `lane` job picks the lane. Then three legs run at once: `affected-gates`, `affected-workspaces` and `affected-worker`. A change whose every path ends `.md` takes the docs lane instead: `docs-gates`, which runs the root `check:docs`. | CI |
| The merge group | `full-root` (the root gates, then `packages/core`, `packages/schema` and `packages/devtools`), `full-api`, `full-web` and `full-worker`. A run that `build.yml` calls is the same. | CI, the arbiter |

An acceptance line reading "`check` green" is CI's: on the pull request, and again in the queue. Those are the two rows below the agent's. The agent runs the first row and no more. A rebase that touches none of the ticket's files needs no local re-run.

## Environment

You need:

- a Docker daemon, `uv` and `pnpm`;
- Playwright's Chromium for the web (`pnpm --filter @better-answers/web exec playwright install chromium`);
- a warm `HF_HOME` for the detector's weights;
- `git-filter-repo` at the version `apps/api/Dockerfile` pins.

A vitest run starts its stores once, from `globalSetup`. It then gives each file its own share of them:

- Postgres, in every workspace: a database per file, cloned from a migrated template.
- Garage, in `packages/core` and `apps/api`: a bucket and a key per file, made through the admin API. Garage starts only where a selected file names `objectStoreForSuite`.
