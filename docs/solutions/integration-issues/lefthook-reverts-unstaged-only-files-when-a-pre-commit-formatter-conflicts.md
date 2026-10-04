---
title: "lefthook 2.1.14 reverts unstaged-only files when a pre-commit formatter conflicts with a partially staged file"
date: 2026-10-04
category: integration-issues
module: repository
problem_type: integration_issue
component: development-workflow
severity: high
symptoms:
  - "git commit failed with: Unable to restore previously hidden unstaged changes ... conflict while merging unstaged changes"
  - "The commit did not happen"
  - "Seven files that carried only unstaged edits came back at HEAD content, with no stash entry and no patch file in .git"
  - "Partly staged files came back with their unstaged edits"
root_cause: logic_error
resolution_type: workflow_improvement
framework_version: "lefthook 2.1.14"
tags:
  - lefthook
  - pre-commit
  - partially-staged
  - oxfmt
  - unstaged-changes
  - data-loss
  - git-hooks
  - path-limited-commit
related_components:
  - tooling
---

# lefthook 2.1.14 reverts unstaged-only files when a pre-commit formatter conflicts with a partially staged file

## Problem

On 04/10/2026, during BA-29 U7 on `feat/ba-29-u7-page-area-menu`, a `git commit -F <msg>` failed in the pre-commit hook and took unstaged work with it. The index held a mechanical rename of 258 staged files. On top of that, 86 tracked files had unstaged edits: 79 were partially staged (a staged change and an unstaged change in the same file) and 7 had unstaged changes only. The hook failed and no commit was made. The 79 came back. The 7 were reset to their HEAD content.

The cause is in lefthook, not in this repository's hook commands. The installed version is 2.1.14 (`pnpm exec lefthook version`), pinned at `package.json:49`. When a pre-commit job rewrites a partially staged file so that lefthook cannot put its hidden unstaged changes back, lefthook resets the whole working tree with `git checkout .` and then replays a patch that covers only the partially staged files. Upstream reported this as evilmartians/lefthook#1480 and fixed it in 2.1.16 (#1483, released 01/10/2026).

Paths below that start `internal/`, `cmd/`, `docs/configuration/`, `docs/examples/` or `docs/usage/` are in lefthook's repository at tag `v2.1.14` unless marked otherwise (https://github.com/evilmartians/lefthook/tree/v2.1.14). They are not in this repository.

## Symptoms

- The commit failed with:

  ```
  Unable to restore previously hidden unstaged changes.
  This may happen when changes introduced by the hook conflict with your unstaged changes.
  Stage all changes with `git add -A` and try again.
  Error: failed to run the hook: conflict while merging unstaged changes
  ```

- No commit was made. The staged index was intact.
- 79 of the 86 files still had unstaged changes. The 7 missing were exactly the files with unstaged changes and nothing staged: `CONTEXT.md`, `apps/api/tests/old-words.ts`, `apps/api/tests/old-words-ratchet.json`, `apps/api/tests/kept-names.ts`, `apps/api/tests/avoid-words.test.ts`, `packages/design-system/guidelines/colors-neutral.card.html` and `packages/design-system/tokens/typography.css`. Each was back at HEAD content.
- `git stash list` showed no new entry. There was no `lefthook-unstaged.patch` in the common `.git/info` or in the worktree's git dir (`.git/worktrees/<name>/`).

## What Didn't Work

- **Looking for lefthook's backup.** lefthook does make one. Before hiding anything it runs `git stash create` and stores the result under the reflog message `lefthook auto backup` (`internal/git/repo.go:24`, `:248-272`), and it writes a patch to `lefthook-unstaged.patch` in the git info dir (`repo.go:25`, `:170`). After a conflict it still replays the partial patch, and when that replay succeeds it deletes the patch and drops the stash (`repo.go:358-379`, `:384-415`). So `git stash list` and `.git/info` were both empty. The dropped stash commit is still in the object store (see *Recovery, if it happens again*), but the session did not know that.
- **lefthook's own advice, `git add -A`.** It removes the hazard but stages everything, including work meant for a later commit. ce-work forbids that: "every implementation commit names only that unit's owned files. A bare `git commit` can absorb the user's pre-existing index, so it is forbidden" (the Compound Engineering plugin's ce-work skill, 3.29.0, `SKILL.md` line 48). It was not used.
- **Redoing the lost edits by hand** from the session's own record. It worked, but it was slow, and only as exact as the record.

## Solution

What the session did next, after which two commits went through with lefthook hiding nothing:

1. Save every tracked change first: `git diff HEAD --binary -M > /tmp/<name>.patch`. This covers staged and unstaged changes to tracked files. It does not cover untracked files.
2. Stage everything that belongs to the commit, so that no file in the commit has a staged part and an unstaged part.
3. For files held back for a later commit, run `git reset -q -- <paths>`, copy them aside, and confirm with `cmp` that the copies match.
4. Commit.

Step 2 and the `git reset` in step 3 together are what made it safe: between them no file is left partially staged. A held-back file that kept a staged half would still be partially staged, and lefthook would hide again. The copy in step 3 is insurance. After step 3 the held-back files have unstaged changes only, which is the state that lost the 7 files, but with no partially staged file lefthook does not hide or revert anything (see *Why This Works*).

To check before committing: lefthook counts a file as partially staged when both status columns of `git status --porcelain` are something other than a space or `?` (`internal/git/repo.go:231-246`). This lists them:

```
git status --porcelain | grep -E '^[^ ?][^ ?]'
```

Empty output means lefthook 2.1.14 will hide nothing on this commit.

### Recovery, if it happens again

This was not done in the session. It was checked afterwards, read-only, against the objects the failed run left behind. The `git stash create` commit that lefthook dropped is unreachable, not deleted, and `git fsck --no-reflogs --unreachable` in this worktree still lists it:

- A commit with the subject `WIP on feat/ba-29-u7-page-area-menu: …`, made at the minute of the failed commit. Its second parent, subject `index on feat/ba-29-u7-page-area-menu: …`, is the index as it stood then.
- The diff from HEAD to that index parent gave 258 files, the staged rename. The diff from the index parent to the WIP commit (index to working tree) gave 86 files, the unstaged set. 79 files are in both lists and 7 only in the second, and those 7 are exactly the lost files.

To find the commit: run `git fsck --no-reflogs --unreachable`, keep the `unreachable commit` lines, pass the ids to `git log --no-walk --stdin --format='%H %ci %P | %s'`, and pick the `WIP on <branch>:` commit from the time of the failed commit. Its subject is not `lefthook auto backup`. That was only the reflog message, and it went with the drop. There can be several of these pairs, because every pre-commit run that hid something leaves one (this branch had four), so confirm the right one by timestamp and by the file count of its index-to-working-tree diff.

To restore a file, run `git show <wip>:<path> > <path>`, or write `git diff <index-parent> <wip> -- <paths>` to a file and `git apply` it. Neither restore command was run here. `git stash create` covers tracked files only. The commit lasts until `git gc` prunes unreachable objects, which is two weeks by default, and automatic gc can run after any commit.

## Why This Works

**What lefthook's docs say.** The `stage_fixed` page says it "Works **only** for the `pre-commit` hook" and that "When set to `true` lefthook will automatically call `git add` on files after running the command or script". For a command without a `files` option, "`{staged_files}` template will be used". It also says: "If the `git add` call fails, the hook fails too. Otherwise the commit would silently go through with the unfixed content" (`docs/configuration/stage_fixed.md`). That page, the `stage_fixed` example page (`docs/examples/stage_fixed.md`) and the `lefthook run` page (`docs/usage/commands/run.md`) say nothing about hiding unstaged changes, a patch, a backup stash or `git checkout .`. That behaviour is visible only in the source.

**What the v2.1.14 source does.**

- Hiding is switched on for every `pre-commit` run, whether or not any job sets `stage_fixed`. The guard's switch is `!opts.NoStageFixed && config.HookUsesStagedFiles(hook.Name)` (`internal/run/controller/controller.go:97`), and `HookUsesStagedFiles` is `hook == "pre-commit"` (`internal/config/available_hooks.go:42-44`).
- If no file is partially staged, lefthook runs the jobs, runs `git add` on the fixed files and returns. It hides nothing and reverts nothing (`internal/run/controller/guard.go:79-88`).
- Otherwise it backs up with `git stash create`, writes an index-to-working-tree patch for the partially staged files only (`internal/git/repo.go:274-293`), and hides those files with `git checkout --force -- <files>` (`guard.go:92-106`, `repo.go:45`).
- After the jobs it runs `git apply --check` on that patch (`repo.go:309-336`). If the check passes, it stages the fixed files and replays the patch (`guard.go:118-122`, `:142-145`). If the check fails, it runs `git checkout .` across the whole tree (`guard.go:123-132`, `repo.go:46`, `:301-305`), prints the message above, and replays the partial patch onto the reset tree (`guard.go:142-145`).

That last branch is the whole incident. `git checkout .` reset all 86 files to their index content. The patch put back the 79 partially staged files. The 7 unstaged-only files were never in the patch, so they stayed at their index content, and for a file with nothing staged that is HEAD. Upstream's issue #1480 describes the same sequence and says the bug arrived with #1417, in 2.1.7.

`stage_fixed` itself is not what conflicts: its `git add` runs only on the branch where the check passed (`guard.go:118-122`). What conflicts is a job that writes to a partially staged file. Here that is `oxfmt`, which has no `glob` and is handed every staged file (`lefthook.yml:12-14`). The pre-commit hook runs its commands in parallel (`lefthook.yml:7-8`).

**Which file failed the check was not logged.** The session's guess was that the staged versions of some files were unformatted while their working-tree versions had since been formatted, so oxfmt's rewrite of the staged text no longer matched what the patch expected. A check made afterwards supports it. Of the 79 partially staged files, oxfmt with the repository's `.oxfmtrc.json` would rewrite the staged versions of 17 (taken from the index parent) and none of the working-tree versions (taken from the WIP commit). The 17 include `apps/web/src/app/frame.tsx`, `apps/web/src/app/router.tsx` and `packages/devtools/renames/page-area-menu.json`. That the apply check failed on these files is inferred, not observed.

**So on 2.1.14, losing work takes all three of these:**

1. at least one partially staged file, without which nothing is hidden;
2. a job that rewrites a partially staged file so its patch no longer applies: here `oxfmt` (`lefthook.yml:12-14`), and `ruff-format` (`lefthook.yml:20-24`) can do the same to Python files;
3. tracked files with unstaged changes and nothing staged, which are what `git checkout .` takes.

The session's recipe removed condition 1. Version 2.1.16 changes the conflict branch: it saves a patch of every unstaged change before the hook runs and replays that patch after `git checkout .` (`internal/run/controller/guard.go:118-153` at tag `v2.1.16`, `RestoreAllUnstagedChanges`). Once the pin moves to 2.1.16 or later, condition 3 should no longer lose work, though the commit still aborts when conditions 1 and 2 hold. The fix is upstream's claim and was not tested here.

## Prevention

- **Before a commit with mixed staged and unstaged work, list the partially staged files** with the `git status` command above. For each one, either stage the rest of the file if it belongs to the commit, or set its unstaged part aside. That second case is a file whose staged half belongs to this commit and whose unstaged half belongs to a later one, which is the shape ce-work's commits take. Save the unstaged half with `git diff -- <file> > /tmp/later.patch` (index to working tree), return the file to its staged content with `git restore -- <file>`, commit, then put the half back with `git apply /tmp/later.patch`.
- **Format before staging, and stage again after formatting.** A staged version that oxfmt would rewrite, under a working copy that is already formatted, is the conflict in this incident. Running the formatter on the working tree and then `git add` on the same files leaves oxfmt nothing to change.
- **Save a patch first** whenever the tree holds work you cannot recreate: `git diff HEAD --binary -M > /tmp/<name>.patch`. Copy untracked files separately.
- **ce-work's path-limited commits create condition 3 by design.** Its loop says "Stage only files related to this logical unit (not `git add .`)" and commits with `git commit -m "…" -- <files related to this logical unit>` (the plugin's ce-work 3.29.0, `references/implementation-loop.md` lines 100-104). Its setup says "Incremental commits stage only work-owned files and are path-limited, so untouched WIP never enters a commit" (`references/workspace-setup.md` line 24). On 2.1.14, any unrelated WIP left unstaged that way is at risk as soon as one file is also partially staged and a formatter rewrites it. The failing command in this session was `git commit -F`, not a pathspec commit. Whether `git commit -- <paths>`, which runs the hook against a temporary index, changes what lefthook sees as partially staged was not checked.
- **Skipping the hook avoids the hiding, at a cost.** `docs/operations/local-gates.md:15-19` gives the skips:

  | Command | What it skips |
  | --- | --- |
  | `LEFTHOOK=0 git commit …` | the whole hook, once |
  | `LEFTHOOK_EXCLUDE=oxlint git commit …` | one command |
  | `LEFTHOOK_EXCLUDE=oxfmt,oxlint git commit …` | several, comma-separated |

  Line 21 adds: "A deliberate skip is one of these; it is never a deleted hook file". `LEFTHOOK=0` skips the hiding along with every check. `LEFTHOOK_EXCLUDE=oxfmt` removes condition 2 but commits unformatted staged text, which the pre-push `format:check` gate (`lefthook.yml:79-81`) then refuses. The only switch lefthook has for the hiding itself is `lefthook run --no-stage-fixed`, described as "ignore 'stage_fixed: true' setting" (`cmd/run.go:83-86`), which also turns hiding off (`controller.go:97`). It is a flag on `lefthook run`, and the installed hook passes on only git's own arguments, so `git commit` cannot reach it. A code search found `NoStageFixed` set only in `cmd/run.go` and `internal/command/run.go`, both fed by the command line, so no config key turned up; and none of the environment variables documented under `docs/usage/envs/` at `v2.1.14` controls it.
- **Move the pin to lefthook 2.1.16 or later** (`package.json:49`). A title search on 04/10/2026 found no pull request bumping lefthook. After the bump, check the fix by setting up the three conditions in a throwaway repository, never in a worktree that holds real work.
- **`docs/operations/local-gates.md` does not mention the hiding.** Its pre-commit section (lines 5-35) describes each command and how to skip it, but not that lefthook hides unstaged changes during the hook and can revert them. One line there would reach the next session before a commit fails.
