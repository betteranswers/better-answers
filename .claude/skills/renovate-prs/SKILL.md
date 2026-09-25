---
name: renovate-prs
description: Clears Renovate's dependency pull requests, one or a batch — lists the open ones, reads each red job's log, groups them by cause, fixes each cause by its route, re-checks and merges through the queue, and hands the owner what is theirs. Use when a Renovate pull request is red or waiting, when asked to merge, batch or clear dependency updates, or when Renovate keeps proposing a version this repository refuses.
---

# Renovate's pull requests

Renovate opens its pull requests at weekends (lock maintenance on Monday morning), labelled `deps`, on `renovate/<group>` branches. `renovate.json` holds the groups, the age rule and every rule that turns an update off; read it rather than trusting a summary. `automerge` is off, so nothing lands until a session arms it.

The unit of work is the **cause**, not the package. Five red pull requests are often two causes, and each cause is fixed once, by one of four routes. No ticket is needed for any of this unless the fix outgrows a pull request.

## 1. List the batch

```bash
gh pr list --author app/renovate --state open \
  --json number,title,headRefName,autoMergeRequest,statusCheckRollup
```

For each, note what it moves (the body's table), the `check` verdict and whether it is armed. Then:

- **Waiting, not failing**: a check still running, or `renovate/stability-days` pending (the release is under a day old; `renovate.json`'s age rule).
- **Superseded**: a minor and a major of the same package (#26 and #215, pnpm). Merge the higher; Renovate closes the lower itself.
- **Renovate's own comment**: `gh pr view <n> --comments`. An *Artifact update problem* means the lockfile was not regenerated, and the cause is usually a constraint this repository holds.

**Done when** every open Renovate pull request has a line: what it moves, green, red or waiting, armed or not.

## 2. Read each red job's log

`check` is the fan-in; the red leg beside it (`affected-worker`, `full-api`, …) is the one to read.

```bash
gh pr checks <n>                                   # the run and job ids are in each link
gh run view <run> --job <job> --log-failed > /tmp/pr<n>.log
```

Find the first failing assertion or error line. A merge-group failure whose only red is a browser spec the pull request did not touch is a flake to re-arm. A red that the latest queue run also shows (`gh run list --workflow check.yml --event merge_group --limit 3`) is not this pull request's.

**Done when** every red pull request has a cause quoted from a log line, never inferred from a check's name.

## 3. Group by cause and pick the route

| Route | When | Seen |
| --- | --- | --- |
| **Main first** | The fix passes on `main`'s current version too. Land it with `pnpm land`; the Renovate pull request goes green untouched | #238: pnpm 11.27 left Playwright's test server running, fixed by starting it with `node`. #245: pnpm 12's native binary baked into the api image. Both unblocked #215 |
| **On the branch** | The fix holds only with the new version: a test that asserts the old version, a re-dated reading | #187 and #248: `test_image.py` pins `pdf-inspector` |
| **A rule** | Renovate proposes something this repository refuses. A `packageRules` entry in `renovate.json`, its `description` saying why and naming the pull request that showed it | #240: `requires-python` and the `python` image held below 3.14 |
| **A ticket** | The fix needs a migration, a production check or a person's review. Leave the pull request open and unarmed | #211 → T-356: better-auth 1.7.5 refuses a column 1.7.3 dropped, so a migration rides with the bump |

The test between the first two: check the fix out on `main` and run the suite. Green there means main first.

**Done when** every cause has a route, and every pull request sits under one cause.

## 4. Fix, in this order

Order matters because Renovate **regenerates** a branch when its rebase box is ticked, force-pushing its own commit and dropping everyone else's.

1. **Main first and rules land.** `pnpm land --message "<type(scope): summary>\n\n<body>"` from a tree on `origin/main`, in the commit's form (`docs/agents/workflow.md`, *The commit's form*). Wait for each to merge.
2. **Tick the rebase box** on every pull request they touch, so Renovate regenerates it over the new `main`:

   ```bash
   gh pr view <n> --json body --jq .body \
     | sed 's/- \[ \] <!-- rebase-check -->/- [x] <!-- rebase-check -->/' \
     | gh pr edit <n> --body-file -
   ```

   Renovate acts on its next run. Wait for the head commit to change before going on.
3. **Branch fixes go last**, on the regenerated head: `git fetch origin <branch>`, `git switch -c <branch> --track origin/<branch>`, fix, commit, `git push origin HEAD:<branch>`. A branch behind `main` needs no rebase: the pull request's run tests its merge with `main`, and the queue tests the merge group. Once a commit of ours is on it, Renovate stops rebasing that branch; tick its box again only to throw the fix away. A conflict after that is ours to rebase, onto `origin/main`, pushed with `--force-with-lease`.

What a fix owes, whichever route:

- **Every file still naming the old version**: `git grep -nF '<old version>' -- ':!*.lock' ':!pnpm-lock.yaml'`. jCodeMunch's index leaves Dockerfiles out, so its answer is not evidence here. A test comparing the manifest's pin to a literal moves with the pin; a literal handed to a function as input stays.
- **The comment above each moved pin** in `apps/worker/pyproject.toml` and the Dockerfiles. Many carry a dated reading (licence, wheel tags, digest) and say what a bump owes: a probe to re-run, a reading to re-date. Re-read the licence and wheels at the source (`curl -s https://pypi.org/pypi/<name>/<version>/json`), re-date, run what it names.
- **Suites by file**: the first row of *What `check` runs where* in `docs/agents/workflow.md`. That row sets `IMAGE_PROBE_DEFERRED=true`, which skips the image suites; when the red line is in one (`apps/worker/tests/test_image.py`, `apps/api/tests/image.test.ts`), run the failing test by its node id without it. The suite builds its image by id, so it is safe beside other sessions, and the worker's takes about three minutes. CI's affected lane and the queue's full run are the arbiters.
- **Review**: `impact` before an edit and `detect_changes` before each commit (`docs/agents/code-review.md`; Cubic is paused). GitNexus leaves test files out, so `impact` on a test answers *not found*, and the blast radius is the assertion itself. One commit per fix, in the commit's form; a branch fix has no `Refs:` footer.
- **A ticket**, when the route says so: `ordna create`, pushed origin first (`docs/agents/issue-tracker.md`), with the pull request's number and the log line in its Notes. When the fix cannot land ahead of the new version, the ticket carries the bump too, and the Renovate pull request closes as redundant once it lands (T-356 carries #211's).

**Done when** every pull request on the first three routes has a head whose red leg's failing line is gone from a local run of that suite.

## 5. Arm and watch

```bash
gh pr merge <n> --auto --merge
gh api graphql -F owner='{owner}' -F name='{repo}' -F number=<n> -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        state isInMergeQueue autoMergeRequest { enabledAt } mergeQueueEntry { position state }
      }
    }
  }'
```

`gh pr merge` warns that the queue sets the merge method; that is expected. One of `isInMergeQueue` and `autoMergeRequest` is set when the pull request is armed or queued. A failed queue run disarms it, and so does any new head, Renovate's force-push included: re-arm after each and read it back. Watch every armed pull request with one background loop that ends on `MERGED`, `CLOSED`, disarmed or a red leg, and read the log of any red leg as in step 2. From a worktree, write the loop to a script with a name of its own under `/tmp`, since other sessions keep theirs there, and run that.

**Done when** every pull request is merged, closed by Renovate, or handed over in step 6.

## 6. Hand to the owner

Stop on these, leave the pull request open and unarmed, and say why in the report:

- a migration, a schema change or anything that needs a check against production data;
- a major of anything that signs people in or holds secrets (better-auth, the OAuth and token libraries, `cryptography`), or release notes naming a security fix that changes behaviour;
- a licence change: this repository takes the permissive arm of every licence (ADR 0027);
- a new interpreter or runtime line (Python 3.14, the next Node major): that is a rule, then a planned move;
- anything the owner must do on their own machine, such as a global pnpm update;
- a third attempt on one pull request that comes back red.

## 7. Report

The owner is not technical. One table, one line per pull request, in plain words, then what they need to do, if anything.

| Update | State | What it needed | Needs you? |
| --- | --- | --- | --- |
| pdf-inspector 1.24.0 (#248) | Merged | A test still expected the old version | No. Nothing is reprocessed; a PDF is checked again for personal data only if its text now reads differently |
| better-auth 1.7.5 (#211) | Open | A database change first (T-356) | Yes: a check on the live database before it ships |

Name any side effect a person would notice (a reprocess, a slower first run, a laptop step), and keep version numbers to the update's own.
