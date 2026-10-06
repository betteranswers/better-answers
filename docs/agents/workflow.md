# The workflow: Compound Engineering, then the merge queue

How a change becomes merged code. The Compound Engineering plugin (CE) runs the loop in the session. Cubic reviews the pull request, and the merge queue merges it when CI's `check` is green.

## The loop

**`/lfg <what to do>`** runs a change end to end and never pauses for approval: a plan (`/ce-debug` for a bug), the work, a simplifying pass, `/ce-code-review` with its fixes, `/ce-compound`, a browser test of the pages the diff touches, `ce-commit-push-pr`, then `ce-babysit-pr` for up to three rounds of CI or review fixes. It asks a question only when what to build is unclear, and it never merges.

By hand, the same loop is three skills:

- `/ce-brainstorm` when what to build is still open. It asks one question at a time and writes the requirements to `docs/plans/`.
- `/ce-plan` writes the plan to `docs/plans/`, after searching `docs/solutions/` for what past work learned. A plan has no status field: git says what shipped.
- `/ce-work` builds a plan, unit by unit, and ends in a pull request.

A route block (`docs/specs/v01-route.md`) is one `/ce-brainstorm`, then `/ce-plan`, then one `/lfg` or `/ce-work` per plan. `/ce-dogfood` walks a branch's pages as the personas in `docs/personas/` and fixes the small breakages it finds. It is the way to judge a signed-in page's UX against its spec: it walks the change as the personas on its own build, beside the browser suite's behaviour and accessibility checks.

## What CE does not know about this repository

- Two kinds of change run alone until they merge: one that adds a migration, because the drizzle journal does not merge, and one that edits `contracts/`, because it moves both tiers' generated digest constants, which do not merge either.
- CE's review reads its rules from `CODING_STANDARDS.md`, plus the `CODING_STANDARDS.md` of each directory the change touches: `apps/api/`, `apps/web/`, `apps/worker/` and `deploy/`. A rule's `Reviewer:` line is the part no gate will catch.
- A worker prompt names each test scenario by the behaviour it checks, and a test's title is that behaviour (*Title a test by what the system does, in 10 words at most*, in `CODING_STANDARDS.md`).
- A change to a page a journey walks (`apps/web/journeys/`) changes that journey in the same pull request, and runs the journeys against the browser suite's api, with the harness code source, before it lands. Nothing else runs them before the release does: `check` never runs a journey, and the release runs the journeys of the commit its api image was built from, so a page that moved without its journey ends that night's run `fail`. The browser-suite skill's *The journeys* gives the run.
- `/mutation-testing` runs after the tests are green, on refactors and on changes to validation, parsing or auth. Skip it for UI, copy and config diffs.
- A change that moves an architecture decision edits its doc in `docs/solutions/architecture-patterns/` in the same commit, and a new decision lands there as a new doc with the code it decides. `docs/archive/adr/` is frozen.

## Merging

**Every commit reaches `main` through the merge queue.**

1. `ce-commit-push-pr` opens the pull request. Its title is the commit's subject, and its body is the commit's body, footer included (*The commit's form*, below). Repository settings make these the merge commit's subject and body.
2. Cubic reviews the head. When its check completes with success, `arm-merge.yml` arms the merge. A push disarms it, and Cubic's check on the new head arms it again, so the queue never takes a head Cubic has not read.
3. The `main` ruleset holds the merge until every review thread is resolved. `ce-babysit-pr` fixes or answers Cubic's threads, and Cubic resolves the ones it sees addressed.
4. The PR's own `check` reads only its title, so it goes green in a minute or two and the armed PR enters the **merge queue**. The queue runs the suites on the merge group and merges on green.

A check that completes neutral arms nothing. That happens when Cubic's allowance has run out, or when a push rewrote the branch and Cubic did not start. The workflow's summary names the reason. Comment `@cubic-dev-ai` on the pull request to have Cubic review it, or arm it by hand. `arm-merge.yml` arms with the `ARM_MERGE_TOKEN` secret, because a merge armed with `GITHUB_TOKEN` starts no workflow and the queue's `check` would never run. Without the secret, arm by hand: `gh pr merge <n> --auto --merge`.

A red merge group takes the PR out of the queue. Its timeline then ends in a `RemovedFromMergeQueueEvent` whose `reason` is `failed_checks`. The failure is in the merge group's run, not the PR's, so read that run's log and fix what it names:

```
gh run list --workflow check.yml --event merge_group --json databaseId,headBranch,conclusion \
  --jq '.[] | select(.headBranch | contains("/pr-<n>-"))'
gh run view <id> --log-failed
```

GitHub deletes the merged branch. Then run `node .gitnexus/run.cjs analyze` in the main checkout, so GitNexus reads the new `main`.

**The bypass is for an empty queue alone.** Read the queue before you use it:

```
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      mergeQueue(branch: "main") { entries(first: 1) { totalCount } }
    }
  }'
```

### Merge queue facts

- GitHub clears the auto-merge flag when a PR enters the merge queue. Do not read that as 'disarmed'.
- `gh pr view` has no `isInMergeQueue` field. Use GraphQL: `gh api graphql -f query='{repository(owner:"O",name:"R"){pullRequest(number:N){mergeQueueEntry{state position}}}}'`.
- Land sibling PRs that touch the same files one at a time, rebasing between merges.

### The commit's form

**Conventional Commits: a subject `type(scope): summary` of 90 characters at most. Then a blank line and the body: what changed and why, in plain prose. Then a blank line and the footer, `Refs: BA-N`, naming the Linear issue.**

```
docs: say how a task from before linear is read

The tracker note named the ordna refs but not how a fresh clone reads one. It now gives the fetch and the read.

Refs: BA-123
```

- The summary is imperative and lower-case, with no full stop. A name keeps its capitals in backticks: `` fix(api): refuse an `OKF` key with no prefix ``.
- The types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.
- The scope is optional and names a workspace or an area: `api`, `web`, `worker`, `core`, `schema`, `devtools`, `design-system`, `deploy`, `ci`, `docs`, `auth`, `people`, `ops`. `deps` is Renovate's.
- The issue goes in the footer, never in the subject. A change with no issue has no footer. Commits before Linear cite ordna tasks as `Refs: T-nnn`.

One commitlint config, `commitlint.config.mjs`, holds the form in two places. Each refusal names the rule it broke.

- lefthook's `commit-msg` hook checks every commit.
- The `pr-title` job in `check.yml` checks the pull request's title, which becomes the merge commit's subject. The job runs on the pull request and again in the merge queue. It reads the title when it runs, so a retitle is read before the merge, and a red `pr-title` goes green on `gh run rerun <run> --failed`.

The repository's `merge_commit_message` is `PR_BODY`. So the body and its footer reach `main` with the subject, instead of being dropped at the merge.

## What `check` runs where

| When | What | Who |
| --- | --- | --- |
| Before the pull request | Each touched workspace's `lint` and `typecheck` (the worker's `ruff` and `mypy`). The suites the ticket names or touched, by file (`pnpm --filter <workspace> run test <file>…`, which starts vitest through `node` rather than its `.bin` shim; `cd apps/worker && uv run --frozen pytest <file>…`), with `IMAGE_PROBE_DEFERRED=true`. The root gates that the root `package.json`'s `check:gates` names. For a change to a page a journey walks, the journeys by hand with the harness code source. | the agent |
| The PR | No suite (`.github/workflows/check.yml`). The `lane` job puts every pull request in the `pr` lane, where no leg runs, and `pr-title` checks the title. | CI |
| The merge group | The `lane` job diffs the group against `main`'s tip, not the event's `base_sha`: behind another entry that is the entry's group, and a green group merges every entry ahead of it. A change whose every path ends `.md` takes the docs lane: `docs-gates`, which runs the root `check:docs`. Anything else takes the full lane: `full-root` (the root gates, then `packages/schema`, `packages/devtools` and `packages/core`'s typecheck), `full-core` (`packages/core`'s suite, split by vitest's `--shard` over two jobs), `full-api`, `full-web` and `full-worker`. The shards are CI's alone: a local `pnpm check` or `check:tree` runs `packages/core`'s suite whole. The api and worker legs skip the image suites unless a changed path is an image input, such as a manifest, a lockfile, a Dockerfile or a path under `deploy/`; `scripts/docs-lane.mjs` holds the list. A run that `build.yml` calls is the same, except that it always skips them, because `build.yml` probes every image it pushes. | CI, the arbiter |

An acceptance line reading "`check` green" is CI's, and only the merge group's run tests anything. The agent runs the first row and no more. A rebase that touches none of the change's files needs no local re-run.

## Environment

You need:

- a Docker daemon, `uv` and `pnpm`;
- Playwright's Chromium for the web (`pnpm --filter @better-answers/web exec playwright install chromium`);
- a warm `HF_HOME` for the detector's weights;
- `git-filter-repo` at the version `apps/api/Dockerfile` pins.

### Platform: macOS

- The shell is macOS with bash 3.2 and BSD userland. Do NOT use GNU-only sed flags (use `sed -i ''` or perl), bash associative arrays, or other bash 4+ features in scripts.

### Platform: Claude Code on the web

- GitHub's GraphQL API is closed to cloud sessions, and no setting opens it. So `gh pr create`, `gh pr merge` and every GraphQL query in this document fail. REST works, through `gh api` or the GitHub MCP.
- **Open** the PR with the MCP's `create_pull_request`, or `gh api -X POST repos/{owner}/{repo}/pulls -f title=<subject> -f head=<branch> -f base=main -f body=<body>`.
- `arm-merge.yml` arms it as it arms any other. To arm by hand, use `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/ccr/auto_merge`, or the MCP's `enable_pr_auto_merge`, in place of `gh pr merge <n>`.
- CE is not installed from `.claude/settings.json` in a cloud session, which never shows the workspace trust dialog. `scripts/cloud-setup.sh` installs it.
- **Read it back** from the merge group's run, not `isInMergeQueue`:

  ```
  gh run list --workflow check.yml --event merge_group --json databaseId,headBranch,status,conclusion \
    --jq '.[] | select(.headBranch | contains("/pr-<n>-"))'
  ```

  A run that is queued or in progress means the PR is in the queue. A failed run is read with `gh run view <id> --log-failed`, as above.
- The bypass needs a GraphQL read of the queue, so a cloud session never uses it.
- A session pushes only the branches its prompt allows.
- The shell is Linux with GNU userland, and the macOS notes above do not apply.

### Multi-session coordination

Never write helper scripts to shared /tmp paths. Other sessions run in parallel and overwrite them. Use a session-scoped directory such as `$(mktemp -d)` or `.claude/tmp/<session-id>/`.

### Vitest

A vitest run starts its stores once, from `globalSetup`. It then gives each file its own share of them:

- Postgres, in every workspace: a database per file, cloned from a migrated template.
- Garage, in `packages/core` and `apps/api`: a bucket and a key per file, made through the admin API. Garage starts only where a selected file names `objectStoreForSuite`.

Every process that starts a container has a Ryuk of its own, testcontainers' reaper. Ten seconds after the process ends, killed or not, its Ryuk removes what the process started. Unpatched, the library hands every process on the machine one shared Ryuk, which clears nothing while any run is still going. `patches/testcontainers.patch` gives each process its own, and `packages/devtools/test/testcontainers-patch.test.ts` holds it.

Run `pnpm reap-containers` after the Docker daemon restarts mid-run, or when `docker ps --filter label=org.testcontainers=true` still lists stopped containers after your runs have ended. A restart stops every container and every Ryuk, and no Ryuk is left to clear what they stopped. The command removes a stopped container, from either tier, when no Ryuk still serves its session. `--dry-run` lists them without removing them.

The command never removes a running container, because a live run with Ryuk turned off looks the same as one whose Ryuk is gone. If you know its run is over, `docker stop` it, and the command will take it. Nor does it touch a container whose session's Ryuk is still running. That Ryuk clears it once the last process connected to it has ended. A checkout without the patch shares one such Ryuk among all its runs, so what those runs leave waits until every one of them has ended. `lsof -nP -iTCP:<the Ryuk's host port> -sTCP:ESTABLISHED` names the processes still connected.
