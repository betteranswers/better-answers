---
extends: shipping, babysit, opening-a-pr
when: Opening, verifying, triaging or landing a pull request in this repository, which Cubic and CodeRabbit review and CodeQL scans.
---

# Review

The goal is that every pull request gets a review from a vendor other than the session's model, without spending Cubic's monthly allowance of reviewed lines. The verdict rule below says what happens when no reviewer can run.

- Cubic's PR bot is the default AI reviewer. `cubic.yaml` sets `incremental_commits: false`, so it reviews a pull request once, when it opens, and again only when asked by comment. An ask reviews the whole pull request again and spends its lines a second time.
- CodeRabbit is free for this public repository. It reviews a pull request only when the pull request carries the label `review:coderabbit`.
- The local review, `pnpm run cubic-review`, is the author's check before a push. It runs on the model the CLI is connected to, which on the owner's machine is Claude Code, the session's own vendor. So it is advisory, no verdict counts it as an AI review, and its absence never fails a verdict.

| Reviewer | Where it reports | Reviews | Config |
| --- | --- | --- | --- |
| Cubic PR bot (`cubic-dev-ai`) | The `cubic · AI code reviewer` check run, and a review on the pull request | Source only, once on open and when asked by comment. It skips tests, docs and skills, to save its allowance | `cubic.yaml` |
| Cubic CLI | The output of `pnpm run cubic-review`. It leaves no check run | The branch against `origin/main`, with the repository's Cubic settings read from the default branch of `origin`. Advisory, for the author only | `cubic.yaml` |
| CodeRabbit (`coderabbitai`) | The `CodeRabbit` check run | A labelled pull request, in everything except the lockfiles, migration metadata, the Cubic wiki and third-party notices. It skips a pull request of over 100 files | `.coderabbit.yaml` |
| CodeQL (`github-advanced-security`) | The `CodeQL` check run, the `Analyze (actions)`, `Analyze (javascript-typescript)` and `Analyze (python)` jobs, and code scanning alerts on the pull request | Static analysis for security. It is not an AI reviewer | GitHub's default setup, in the repository's code security settings |

Cubic's PR bot and CodeRabbit are the AI reviewers. CodeQL never counts as one. The verifier reads its alerts on the pull request like any bot's finding, with `gh api "repos/{owner}/{repo}/code-scanning/alerts?ref=refs/pull/<pr>/merge&state=open"`.

No bot is a required check, so a bot's own result never blocks a merge. The verdict holds the rule instead, and it can fail a risky change that no AI reviewer reviewed.

The local review needs a model. `cubic auth connect claude-code` (or `codex`) links that subscription to the CLI and needs no Cubic seat. `cubic auth login` and `CUBIC_API_KEY`, a `cbk_` personal key (`docs/operations/SECRETS.md`), use Cubic's included model, which needs an active Cubic subscription. The script exits 0 when clean, 1 with findings and 2 when it could not run. On exit 2 it prints the CLI's own error, which names the fix. It reviews `origin/main...HEAD`, so a branch behind `origin/main` is reviewed for its own changes.

Install the CLI with `CUBIC_DISABLE_GIT_AI=1 npm install --global @cubic-dev-ai/cli`. Without the variable Cubic adds git-ai, which writes git notes under `refs/notes/ai`, pushes them to `origin` and installs a trace2 hook in the global gitconfig. `cubic stats disable` removes it. The script sets `CUBIC_DISABLE_GIT_AI`, `CUBIC_DISABLE_AUTOUPDATE` and `CUBIC_DISABLE_LSP_DOWNLOAD` for the CLI it runs.

- **After** "Run `/deslop` over the diff before commit and `/no-comments` before review." the author runs `pnpm run cubic-review` before opening the pull request. Fix each real finding, and dismiss a noise finding with a concrete reason in the pull request description. Exit 2 means the review did not run. Open the pull request anyway, because the check is advisory.
- **After** "Batch every known fix into one push wave." run `pnpm run cubic-review` over the wave before pushing it, and triage its findings the same way. The PR bot does not review a later push, so this is the only check it gets before verification.
- **In** "One verifier per PR", the verifier runs `pnpm run review-coverage <pr>` on the head it verifies and follows its `next:` line. The line names one step. The script reads check runs, reviews and comments, so it cannot see that a merge from `main` left a reviewed patch unchanged, which step 1 covers. It exits 0 when an AI reviewer reviewed the head, 1 when none did, 2 when it cannot read the pull request and 3 while it waits for a bot. The verifier does not run `pnpm run cubic-review`.
  - Exit 3 means a bot is still running, or Cubic was asked less than 10 minutes ago. A running CodeQL scan holds exit 3 only while no AI reviewer has reviewed the head. Run the script again after a few minutes. It stops returning 3 on its own, 20 minutes after a bot started or 10 minutes after the ask, and then gives the next step as if that bot had not run. On exit 2, fix the cause and run it again.
  - The chain below stops at the first step that produces a review of this exact head.
    1. The PR bot or CodeRabbit reviewed the head. This is exit 0. Cubic's `success: AI review not needed for merge commit`, which it posts on a head that is a merge from `main`, is not a review, so such a head goes on to step 2 or 3. When the head's `git patch-id` equals that of a commit Cubic reviewed, that review carries to the head under `playbooks/shipping.md` step 3. Name the commit in the verdict and skip the label.
    2. Cubic never reviewed the pull request, its run on the head does not say the line limit was reached, no reply of its says so, and nobody asked it. Comment `@cubic-dev-ai review this PR`, then run `review-coverage` again. The script waits up to 10 minutes for Cubic to start. When the line limit is the reason it cannot start, Cubic answers an ask within seconds with a comment that says so. The script reads "Cubic reviewed" from the pull request's reviews.
    3. Cubic reviewed an earlier commit of this pull request, its run on the head or its reply to an ask says the line limit was reached, or it was asked more than 10 minutes ago. Do not ask Cubic again. Add the label with `gh pr edit <pr> --add-label review:coderabbit`. CodeRabbit needs a few minutes to start after the label, so run `review-coverage` again for up to 10 minutes before you treat it as not run. Do not comment `@coderabbitai full review`. The label is the only way this repository asks CodeRabbit to review. For a pull request of over 100 files, which CodeRabbit skips, the line says `none` and the next step is 4.
    4. There is still no AI review, because the label is on the pull request and CodeRabbit did not review, or because CodeRabbit skips the pull request for its size. The verdict depends on the change. A change to a migration (`packages/schema/migrations/`), to sign-in, access or row-level security, to erasure, or to `contracts/` gets `FAIL` with the reason `no AI review`. Split the pull request until a reviewer runs, or ask the owner. Any other change gets `PASS+NOTES`, never `PASS`, and the notes name each reviewer that did not run and why.
  - The verdict's description names the reviewers of the head, for example `PASS+NOTES by v968; reviewed: cubic, coderabbit`.
- **In** "Bugbot is triaged skeptically, always.", the bots are the Cubic PR bot and CodeRabbit, and CodeQL's alerts are read the same way.
  - For a Cubic PR bot finding, read it with `get_pr_issues` on the `cubic` MCP and record the outcome with `update_pr_issue_status`. That posts the reply on the thread.
  - A local Cubic finding has no thread. The author fixes it or dismisses it in the pull request description, before the push.
  - For a CodeRabbit finding, reply on its thread. For a CodeQL alert, fix it or dismiss it on the code scanning alert with a concrete reason.
  - Do not press *Fix with cubic* or CodeRabbit's *Autofix* while a session pushes to the branch. Two writers on one branch undo each other's work.
