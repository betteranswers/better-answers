---
extends: shipping, babysit, opening-a-pr
when: Opening, verifying, triaging or landing a pull request in this repository, which Cubic, CodeRabbit and Codacy can review.
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
| Codacy (`codacy-production`) | The `Codacy Static Code Analysis` check run | Static analysis and a security pass over the same files as CodeRabbit | `.codacy.yaml` |

Cubic's PR bot and CodeRabbit are the AI reviewers. Codacy also runs an AI Reviewer that posts inline findings, but it leaves no check run besides `Codacy Static Code Analysis`, so the script cannot tell that it ran and Codacy stays out of the count. Triage its findings like any bot's.

No bot is a required check, so a bot's own result never blocks a merge. The verdict holds the rule instead, and it can fail a risky change that no AI reviewer reviewed.

The local review needs a model. `cubic auth connect claude-code` (or `codex`) links that subscription to the CLI and needs no Cubic seat. `cubic auth login` and `CUBIC_API_KEY`, a `cbk_` personal key (`docs/operations/SECRETS.md`), use Cubic's included model, which needs an active Cubic subscription. The script exits 0 when clean, 1 with findings and 2 when it could not run. A missing model, a lapsed subscription, a rate limit and a missing CLI all exit 2, and the output names the cause. It reviews `origin/main...HEAD`, so a branch behind `origin/main` is reviewed for its own changes. It refuses a tree with uncommitted tracked changes. Run it where the head is checked out and nothing else edits the tree.

Install the CLI with `CUBIC_DISABLE_GIT_AI=1`. Without it Cubic adds git-ai, which writes git notes under `refs/notes/ai`, pushes them to `origin` and installs a trace2 hook in the global gitconfig. `cubic stats disable` removes it. The script sets `CUBIC_DISABLE_GIT_AI`, `CUBIC_DISABLE_AUTOUPDATE` and `CUBIC_DISABLE_LSP_DOWNLOAD` for the CLI it runs.

- **After** "Run `/deslop` over the diff before commit and `/no-comments` before review." the author runs `pnpm run cubic-review` before opening the pull request. Fix each real finding, and dismiss a noise finding with a concrete reason in the pull request description. Exit 2 means the review did not run. Open the pull request anyway, because the check is advisory.
- **After** "Batch every known fix into one push wave." run `pnpm run cubic-review` over the wave before pushing it, and triage its findings the same way. The PR bot does not review a later push, so this is the only check it gets before verification.
- **In** "One verifier per PR", the verifier runs `pnpm run review-coverage <pr>` on the head it verifies and follows its `next:` line. The line names one step. The script exits 0 when an AI reviewer reviewed the head, 1 when none did, 2 when it cannot read the pull request and 3 while a bot is still running. The verifier does not run `pnpm run cubic-review`.
  - On exit 3, wait up to 20 minutes for the bot, then treat a bot still running as one that did not run. On exit 2, fix the cause and run it again.
  - The chain below stops at the first step that produces a review of this exact head.
    1. The PR bot or CodeRabbit reviewed the head. This is exit 0.
    2. Cubic reviewed an earlier commit of this pull request, its latest run says the line limit was reached, or it was already asked. Do not ask Cubic again. Add the label with `gh pr edit <pr> --add-label review:coderabbit`. CodeRabbit needs a few minutes to start after the label, so run `review-coverage` again for up to 10 minutes before you treat it as not run. Do not comment `@coderabbitai full review`. The label is the only way this repository asks CodeRabbit to review. CodeRabbit skips a pull request of over 100 files, so for one, go to step 4.
    3. Cubic never reviewed the pull request and was not asked. Comment `@cubic-dev-ai review this PR`, then wait and run `review-coverage` again. The script reads "Cubic reviewed" from the pull request's reviews. The PR bot posts one for every review it completes, a clean one included.
    4. The label is on the pull request and there is still no AI review. The verdict depends on the change. A change to a migration (`packages/schema/migrations/`), to sign-in, access or row-level security, to erasure, or to `contracts/` gets `FAIL` with the reason `no AI review`. Split the pull request until a reviewer runs, or ask the owner. Any other change gets `PASS+NOTES`, never `PASS`, and the notes name each reviewer that did not run and why.
  - The verdict's description names the reviewers of the head, for example `PASS+NOTES by v968; reviewed: cubic, codacy`.
- **In** "Bugbot is triaged skeptically, always.", the bots are the Cubic PR bot, CodeRabbit and Codacy. Codacy's `action_required` conclusion means it found something to triage. It is not a gate.
  - For a Cubic PR bot finding, read it with `get_pr_issues` on the `cubic` MCP and record the outcome with `update_pr_issue_status`. That posts the reply on the thread.
  - A local Cubic finding has no thread. The author fixes it or dismisses it in the pull request description, before the push.
  - For a CodeRabbit or Codacy finding, reply on its thread.
  - Do not press *Fix with cubic* or CodeRabbit's *Autofix* while a session pushes to the branch. Two writers on one branch undo each other's work.
