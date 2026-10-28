---
name: renovate-prs
description: Clears Renovate's dependency pull requests, one or a batch — lists the open ones, reads each red job's log, groups them by cause, fixes each cause by its path, re-checks and lands them under pstack's Shipping playbook, and hands the owner what is theirs. Use when a Renovate pull request is red or waiting, when asked to merge, batch or clear dependency updates, or when Renovate keeps proposing a version this repository refuses.
---

# Renovate's pull requests

Renovate's pull requests are labelled `deps`, on `renovate/<group>` branches. `renovate.json` holds the schedule, the groups, the limits, the age rule, every hold and every rule that turns an update off; read it rather than trusting a summary. The schedule and limits bound only what Renovate opens by itself: the owner can create pending updates from the Mend dependency dashboard, and its "Select All" opens every one at once. A batch made there is cleared like any other. `automerge` is off, so nothing of Renovate's lands until a session lands it under Shipping.

The unit of work is the **cause**, not the package. Five red pull requests are often two causes, and each cause is fixed once, by one of four paths. No ticket is needed for any of this unless the fix outgrows a pull request.

## 1. List the batch

```bash
gh pr list --author app/renovate --state open \
  --json number,title,headRefName,statusCheckRollup
```

For each, note what it moves (the body's table) and the conclusion of its `check`. Then:

- **Waiting, not failing**: a check still running, or `renovate/stability-days` pending (the release is under a day old; `renovate.json`'s age rule).
- **One package in two pull requests**: at two versions (a major on its own beside a minor inside a group), merge the higher; Renovate drops the lower on its next run. At one version split across workspaces, neither passes alone, and the cause is how the pull requests were cut: that is a rule (step 3).
- **Renovate's own comment**: `gh pr view <n> --comments`. An *Artifact update problem* means the lockfile was not regenerated, and the cause is usually a constraint this repository holds.

**Done when** every open Renovate pull request has a line: what it moves, green, red or waiting.

## 2. Read each red job's log

`check` is the fan-in; the red leg beside it (`full-worker`, `full-api`, …) is the one to read, in the pull request's own run, which runs the suites over the branch alone.

```bash
gh run list --workflow check.yml --branch <headRefName> --event pull_request \
  --json databaseId,headSha,conclusion
gh run view <run> --log-failed > /tmp/pr<n>.log
```

Find the first failing assertion or error line. A red whose only failure is a browser spec the pull request did not touch is a flake: one fresh build, per pstack's Babysit playbook.

A branch is tested alone, so a cause that `main` already carries shows on the branch too. Before attributing a red to the pull request, read `main`'s newest completed `build` run (`gh run list --workflow build.yml --branch main --status completed --limit 1`). When its `check` is red on the same line, the cause is on `main` and the path is *main first* (step 3).

**Done when** every red pull request has a cause quoted from a log line, never inferred from a check's name.

## 3. Group by cause and pick the path

| Path | When | Seen |
| --- | --- | --- |
| **Main first** | The fix passes on `main`'s current version too. Land it in a pull request of its own; the Renovate pull request goes green untouched | #238: pnpm 11.27 left Playwright's test server running, fixed by starting it with `node`. #245: pnpm 12's native binary baked into the api image. Both unblocked #215 |
| **On the branch** | The fix holds only with the new version: a test that asserts the old version, a re-dated reading | #187 and #248: `test_image.py` pins `pdf-inspector` |
| **A rule** | Renovate proposes something this repository refuses, or cuts its pull requests so that none can pass alone. A `packageRules` entry in `renovate.json`, its `description` saying why and naming the pull requests that showed it. A hold that follows what another package requires also gets a test in `packages/devtools/test/ci/dependency-versions.test.ts` that reads the requirement, so the hold cannot outlive it | #240: `requires-python` and the `python` image held below 3.14. #562 and #571: `pg` moved per workspace, fixed by the grouping in #582 |
| **A ticket** | The fix needs a migration, a production check or a person's review. Leave the pull request open and unlanded | #211: better-auth 1.7.5 refuses a column 1.7.3 dropped, so a migration rides with the bump in its issue |

The test between the first two: check the fix out on `main` and run the suite. Green there means main first.

**Done when** every cause has a path, and every pull request sits under one cause.

## 4. Fix, in this order

Order matters because Renovate **regenerates** a branch when its rebase box is ticked, force-pushing its own commit and dropping everyone else's.

1. **Main first and rules land.** A branch off `origin/main`, one commit in the form `commitlint.config.mjs` enforces, and a pull request under pstack's *Opening a PR* playbook, landed as in step 5 once its verdict is `PASS` or `PASS+NOTES`. Wait for each to merge.
2. **Tick the rebase box** on every pull request they touch, so Renovate regenerates it over the new `main`:

   ```bash
   gh pr view <n> --json body --jq .body \
     | sed 's/- \[ \] <!-- rebase-check -->/- [x] <!-- rebase-check -->/' \
     | gh pr edit <n> --body-file -
   ```

   Renovate acts on its next run. Wait for the head commit to change before going on.
3. **Branch fixes go last**, on the regenerated head: `git fetch origin <branch>`, `git switch -c <branch> --track origin/<branch>`, fix, commit, `git push origin HEAD:<branch>`. A branch behind `main` needs no rebase to land, because the ruleset does not require it up to date, and `main`'s `build` run tests the landed tree. Once a commit of ours is on it, Renovate stops rebasing that branch; tick its box again only to throw the fix away. A conflict after that is ours to rebase, onto `origin/main`, pushed with `--force-with-lease`.

What a fix owes, whichever path:

- **Every file still naming the old version**: `git grep -nF '<old version>' -- ':!*.lock' ':!pnpm-lock.yaml'`. jCodeMunch's index leaves Dockerfiles out, so its answer is not evidence here. A test comparing the manifest's pin to a literal moves with the pin; a literal handed to a function as input stays.
- **The comment above each moved pin** in `apps/worker/pyproject.toml` and the Dockerfiles. Many carry a dated reading (licence, wheel tags, digest) and say what a bump owes: a probe to re-run, a reading to re-date. Re-read the licence and wheels at the source (`curl -s https://pypi.org/pypi/<name>/<version>/json`), re-date, run what it names.
- **Review**: `impact` before an edit and `detect_changes` before each commit, then pstack's Shipping verdict from a verifier that did not write the change, recorded as the `verdict` commit status on the verified head (`AGENTS.md`, *Workflow*). GitNexus leaves test files out, so `impact` on a test answers *not found*, and the blast radius is the assertion itself. One commit per fix, in `commitlint.config.mjs`'s form; a branch fix has no `Refs:` footer.
- **An issue**, when the path says so: filed in Linear (`docs/agents/issue-tracker.md`), with the pull request's number and the log line in its Notes. When the fix cannot land ahead of the new version, the issue carries the bump too, and the Renovate pull request closes as redundant once it lands.

**Done when** every pull request on the first three paths has a head whose red leg's failing line is gone from a run of that suite.

## 5. Land and watch

Land each pull request under pstack's Shipping playbook. Renovate's force-push is a new head, so redo the verdict on it before landing. A cloud session stops at merge-ready (`docs/agents/cloud-sessions.md`).

This skill reads the pull request's own `check`, posts no verdict and merges nothing. The coordinator or the owner lands it with `gh pr merge <n> --squash --match-head-commit <verified-sha>`, after a `verdict` status of `success` on that head, and its state reads back with:

```bash
gh pr view <n> --json state,mergedAt,mergeStateStatus,headRefOid
```

GitHub refuses the merge of a head that conflicts with `main`. When a pull request that rewrote the lockfile merged ahead of this one, tick its rebase box (step 4), wait for the head to change and verify the new head. After each landing, read `main`'s newest `build` run as in step 2. A red `check` there is a *main first* fix, landed before the next pull request.

**Done when** every pull request is merged, closed by Renovate, or handed over in step 6.

## 6. Hand to the owner

Stop on these, leave the pull request open and unlanded, and say why in the report:

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
| better-auth 1.7.5 (#211) | Open | A database change first (its Linear issue) | Yes: a check on the live database before it ships |

Name any side effect a person would notice (a reprocess, a slower first run, a laptop step), and keep version numbers to the update's own.
