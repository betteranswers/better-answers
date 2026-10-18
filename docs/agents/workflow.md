# The workflow: pstack, then the merge queue

How a change becomes merged code. pstack runs the work in the session. An agent that did not write the change gives it a verdict, the session puts it in the merge queue, and the queue merges it when CI's `check` is green.

## The loop

**`/poteto-mode <what to do>`** matches the task to a pstack playbook and runs it: Feature, Bug fix, Refactoring and the rest. Its Feature playbook explains the subsystem with `how`, settles the shape with `architect`, delegates the code, verifies it on the real surface, then opens the pull request. Name the goal and how to tell it is done, not the skills.

The project playbooks in `.agents/playbooks/` add this repository's steps to pstack's. `/poteto-mode` opens each one whose `extends` or `when` matches the task, after pstack's `check-playbooks.mjs` confirms their anchors.

- `/sharpen` or `/in-your-own-words` first when what to build is still open.
- A design question that a run can answer is settled by the Prototype playbook or `/architect`, not by asking the owner.
- Work one owner can build in one session runs under Feature, Refactoring or Bug fix with no plan, even when it lands as a short stack of pull requests. Work that needs more than one owner, or will outlast one session, gets a plan first. `/poteto-mode plan <the work> in docs/plans/` runs the Multi-phase plan playbook, which writes the plan and stops. Its `check-plan.mjs` holds the plan's shape. A plan has no status field: git says what shipped.

A route block (`docs/specs/v01-route.md`) that one owner can build in one session goes straight to `/poteto-mode`. A block that needs more than one owner, or will outlast one session, is planned first, then built under the plan's execution playbook. The personas in `docs/personas/` ground a design: read the ones a screen serves before shaping it.

## What pstack does not know about this repository

- Two kinds of change run alone until they merge: one that adds a migration, because the drizzle journal does not merge, and one that edits `contracts/`, because it moves both tiers' generated digest constants, which do not merge either.
- A review reads the rules from `CODING_STANDARDS.md`, plus the `AGENTS.md` of each directory the change touches: `apps/api/`, `apps/web/`, `apps/worker/`, `deploy/`, `packages/core/` and `packages/schema/`. Hand them to `/thermos` and to the verifier, since their rubrics do not load them.
- A worker prompt names each test scenario by the behaviour it checks, and a test's title is that behaviour, in 10 words at most.
- A change to a page a journey walks (`apps/web/journeys/`) changes that journey in the same pull request, and runs the journeys against the browser suite's api, with the harness code source, before it lands. Nothing else runs them before the release does: `check` never runs a journey, and the release runs the journeys of the commit its api image was built from, so a page that moved without its journey ends that night's run `fail`. The browser-suite skill's *The journeys* gives the run.
- `/mutation-testing` runs after the tests are green, on refactors and on changes to validation, parsing or auth. Skip it for UI, copy and config diffs.
- The rules that fire at a step of pstack's own playbooks live in `.agents/playbooks/`. `knowledge.md` holds the glossary entry, the decision doc edited in the same commit and the lesson routed through `/correct`. `plan.md` holds this repository's facts in a plan.

## Merging

**Every commit reaches `main` through the merge queue. Until v0.1 the session lands its own pull request, with no press from the owner, once the verdict is `PASS`.**

1. Open the pull request ready, never draft, under pstack's *Opening a PR* playbook. Its title is the commit subject the commit's form below states. Its body takes that playbook's sections, then the closing lines `AGENTS.md` states in *Workflow*.
2. An agent that did not write the change runs it the way a user would and posts its verdict on the pull request: `PASS`, `PASS+NOTES` or `FAIL`, with the head SHA it read. This is pstack's *Shipping* verdict. A pull request whose every change is a `.md` file gets a reviewer reading the diff against its intent instead of a run.
3. Once the pull request's own `check` is green, the session queues the verified head: `gh pr merge <n> --match-head-commit <sha>`. A push after the verdict needs a new verdict. The queue runs the suites on the merge group, squashes it and merges it. Read the pull request back (`gh pr view <n> --json state,mergedAt`): queued is not merged.
4. A red merge group takes the pull request out of the queue. Read the merge group's log before anything else, and fix what it names. Put a flake back in the queue once. The same failure twice is real.

```
gh run list --workflow check.yml --event merge_group --json databaseId,headBranch,conclusion \
  --jq '.[] | select(.headBranch | contains("/pr-<n>-"))'
gh run view <id> --log-failed
```

The `main` ruleset holds the merge until every review thread is resolved. A review bot's thread is triaged under pstack's bugbot triage: fix it, or answer why not and resolve it.

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

- `gh pr view` has no `isInMergeQueue` field. Use GraphQL: `gh api graphql -f query='{repository(owner:"O",name:"R"){pullRequest(number:N){mergeQueueEntry{state position}}}}'`.
- A pull request that left the queue unmerged has no queue entry and is still `OPEN`. Its timeline ends in a `RemovedFromMergeQueueEvent` whose `reason` names why.
- Land sibling pull requests that touch the same files one at a time, rebasing between merges.

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
- The `pr-title` job in `check.yml` checks the pull request's title, which becomes the squash commit's subject. The job runs on the pull request and again in the merge queue. It reads the title when it runs, so a retitle is read before the merge, and a red `pr-title` goes green on `gh run rerun <run> --failed`.

The queue squashes each pull request into one commit. The repository's squash title is `PR_TITLE` and its message is `PR_BODY`, so the pull request's body becomes that commit's body on `main`, and its closing issue line is the link from `main` to Linear. The branch's own commits stay on the pull request page.

## What `check` runs where

| When | What | Who |
| --- | --- | --- |
| Before the pull request | Each touched workspace's `lint` and `typecheck` (the worker's `ruff` and `mypy`). The suites the ticket names or touched, by file (`pnpm --filter <workspace> run test <file>…`, which starts vitest through `node` rather than its `.bin` shim; `cd apps/worker && uv run --frozen pytest <file>…`), with `IMAGE_PROBE_DEFERRED=true`. The root gates that the root `package.json`'s `check:gates` names. For a change to a page a journey walks, the journeys by hand with the harness code source. | the agent |
| The PR | No suite (`.github/workflows/check.yml`). The `lane` job puts every pull request in the `pr` lane, where `pr-title` checks the title and `pr-lockfile` checks `pnpm-lock.yaml` against every manifest. A pull request that changes a `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or the worker's `pyproject.toml` or `uv.lock` also runs `dependency-typecheck`: every workspace's `typecheck` and the worker's mypy. Renovate runs nothing before its pull request, so without it a dependency break reached the queue untested. | CI |
| The merge group | The `lane` job diffs the group against `main`'s tip, not the event's `base_sha`: behind another entry that is the entry's group, and a green group merges every entry ahead of it. A change whose every path ends `.md` takes the docs lane: `docs-gates`, which runs the root `check:docs`. Anything else takes the full lane: `full-root` (the root gates, then `packages/schema`, `packages/devtools` and `packages/core`'s typecheck), `full-core` (`packages/core`'s suite, split by vitest's `--shard` over two jobs), `full-api`, `full-web-unit` (the SPA's typecheck and vitest suite), `full-web-browser` (the browser suite, split by Playwright's `--shard` over three jobs) and `full-worker`. The shards are CI's alone: a local `pnpm check` or `check:tree` runs `packages/core`'s suite whole, and `check:web` runs the browser suite whole. The api and worker legs skip the image suites unless a changed path is an image input, such as a manifest, a lockfile, a Dockerfile or a path under `deploy/`; `scripts/docs-lane.mjs` holds the list. A run that `build.yml` calls is the same, except that it always skips them, because `build.yml` probes every image it pushes. | CI, the arbiter |

An acceptance line reading "`check` green" is CI's, and only the merge group's run runs a suite. The agent runs the first row and no more. A rebase that touches none of the change's files needs no local re-run.

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
- **Queue** it with the MCP's `enable_pr_auto_merge`, or `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/ccr/auto_merge`, in place of `gh pr merge <n>`.
- pstack is not installed from `.claude/settings.json` in a cloud session, which never shows the workspace trust dialog. `scripts/cloud-setup.sh` installs it.
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

- Postgres, in every workspace: a database per file, cloned from a migrated template. With `TEST_POSTGRES_URI=shared`, the template and its clones live on a shared server for the pinned image instead of a container per run (`docs/operations/local-gates.md`, *The shared test Postgres*).
- Garage, in `packages/core` and `apps/api`: a bucket and a key per file, made through the admin API. Garage starts only where a selected file names `objectStoreForSuite`.

Every process that starts a container has a Ryuk of its own, testcontainers' reaper. Ten seconds after the process ends, killed or not, its Ryuk removes what the process started. Unpatched, the library hands every process on the machine one shared Ryuk, which clears nothing while any run is still going. `patches/testcontainers.patch` gives each process its own, and `packages/devtools/test/testcontainers-patch.test.ts` holds it.

Run `pnpm reap-containers` after the Docker daemon restarts mid-run, or when `docker ps --filter label=org.testcontainers=true` still lists stopped containers after your runs have ended. A restart stops every container and every Ryuk, and no Ryuk is left to clear what they stopped. The command removes a stopped container, from either tier, when no Ryuk still serves its session. `--dry-run` lists them without removing them.

The command never removes a running container, because a live run with Ryuk turned off looks the same as one whose Ryuk is gone. If you know its run is over, `docker stop` it, and the command will take it. Nor does it touch a container whose session's Ryuk is still running. That Ryuk clears it once the last process connected to it has ended. A checkout without the patch shares one such Ryuk among all its runs, so what those runs leave waits until every one of them has ended. `lsof -nP -iTCP:<the Ryuk's host port> -sTCP:ESTABLISHED` names the processes still connected.
