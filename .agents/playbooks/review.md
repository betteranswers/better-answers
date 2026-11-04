---
extends: shipping, babysit, opening-a-pr
when: Opening, verifying, triaging or landing a pull request in this repository, where Cubic, CodeRabbit and Codacy review each head.
---

# Review

Every pull request gets a review from a vendor other than the session's model. Cubic is the default reviewer. It has two routes, and only the second spends Cubic's monthly allowance of reviewed lines.

- The local review, `pnpm run cubic-review`, runs Cubic's CLI over the branch. Cubic's docs say CLI reviews do not draw on the pull request line pool.
- The PR bot reviews the pull request on GitHub. `cubic.yaml` sets `incremental_commits: false`, so it reviews once when the pull request opens, and again only when asked.

CodeRabbit is the fallback. It reviews a pull request only when the pull request carries the label `review:coderabbit`.

| Reviewer | Where it reports | Reviews | Config |
| --- | --- | --- | --- |
| Cubic PR bot (`cubic-dev-ai`) | The `cubic · AI code reviewer` check run | Source only, once on open and when asked by comment. It skips tests, docs and skills, to save its allowance | `cubic.yaml` |
| Cubic CLI | The output of `pnpm run cubic-review`. It leaves no check run | The branch against `origin/main`, with the repository's Cubic settings read from the default branch of `origin` | `cubic.yaml` |
| CodeRabbit (`coderabbitai`) | The `CodeRabbit` check run | A labelled pull request, in everything except the lockfiles, migration metadata, the Cubic wiki and third-party notices | `.coderabbit.yaml` |
| Codacy (`codacy-production`) | The `Codacy Static Code Analysis` check run | Static analysis and a security pass over the same files as CodeRabbit | `.codacy.yaml` |

Cubic and CodeRabbit are the AI reviewers. Codacy also runs an AI Reviewer that posts inline findings, but it leaves no check run besides `Codacy Static Code Analysis`, so the script cannot tell that it ran and Codacy stays out of the count. Triage its findings like any bot's.

No bot is a required check, so a bot's own result never blocks a merge. The verdict holds the rule instead, and it can fail a risky change that no AI reviewer reviewed.

The local review needs a Cubic seat and a credential. Sign in with `cubic auth login`, or export `CUBIC_API_KEY`, a `cbk_` personal key, where there is no browser (`docs/operations/SECRETS.md`). It exits 0 when clean, 1 with findings and 2 when it could not run. A missing credential, a lapsed subscription, a rate limit and a missing CLI all exit 2, and the output names the cause. It reviews `origin/main...HEAD`, so a branch behind `origin/main` is reviewed for its own changes. It refuses a tree with uncommitted tracked changes. Run it where the head is checked out and nothing else edits the tree.

- **After** "Run `/deslop` over the diff before commit and `/no-comments` before review." the author runs `pnpm run cubic-review` before opening the pull request. Fix each real finding, and dismiss a noise finding with a concrete reason in the pull request description. Exit 2 means the review did not run. Open the pull request anyway, because the verifier reviews the head again.
- **After** "Batch every known fix into one push wave." run `pnpm run cubic-review` over the wave before pushing it. The PR bot reviews a pull request once, so a later push has no other reviewer.
- **In** "One verifier per PR", the verifier runs `pnpm run review-coverage <pr>` on the head it verifies and follows its `next:` line. The line names one step. A second line, `if it cannot run:`, names the step after it. The script exits 0 when an AI reviewer reviewed the head, 1 when none did, 2 when it cannot read the pull request and 3 while a bot is still running.
  - On exit 3, wait up to 20 minutes for the bot, then treat a bot still running as one that did not run. On exit 2, fix the cause and run it again.
  - The chain below stops at the first step that produces a review of this exact head.
    1. The PR bot reviewed the head. This is exit 0.
    2. The PR bot did not review the head. Run `pnpm run cubic-review` in the verifier's own worktree, checked out at the head it verifies. A local review counts as Cubic reviewing the head only when it ran on that head's SHA and completed, with exit 0 or 1. The first line of its output names the SHA, so compare it with the head under verification. Record the SHA and the finding count.
    3. The local review cannot run (exit 2, with no credential, a lapsed subscription, a rate limit, a missing CLI or a failure). Ask the PR bot: comment `@cubic-dev-ai review this PR`. Then wait and run `review-coverage` again.
    4. The PR bot is over its line limit, or still does not review. Add the label: `gh pr edit <pr> --add-label review:coderabbit`. CodeRabbit needs a few minutes to start after the label, so run `review-coverage` again for up to 10 minutes before you treat it as not run. Do not comment `@coderabbitai full review`. The label is the only way this repository asks CodeRabbit to review.
    5. There is still no AI review. The verdict depends on the change. A change to a migration (`packages/schema/migrations/`), to sign-in, access or row-level security, to erasure, or to `contracts/` gets `FAIL` with the reason `no AI review`. Split the pull request until a reviewer runs, or ask the owner. Any other change gets `PASS+NOTES`, never `PASS`, and the notes name each reviewer that did not run and why.
  - The verdict's description names the reviewers of the head, and names the local review `cubic-cli`, for example `PASS+NOTES by v968; reviewed: cubic-cli, codacy`.
- **In** "Bugbot is triaged skeptically, always.", the bots are the Cubic PR bot and CLI, CodeRabbit and Codacy. Codacy's `action_required` conclusion means it found something to triage. It is not a gate.
  - For a Cubic PR bot finding, read it with `get_pr_issues` on the `cubic` MCP and record the outcome with `update_pr_issue_status`. That posts the reply on the thread.
  - A local Cubic finding has no thread. Fix it, or write the reason you dismiss it in the verdict's notes.
  - For a CodeRabbit or Codacy finding, reply on its thread.
  - Do not press *Fix with cubic* or CodeRabbit's *Autofix* while a session pushes to the branch. Two writers on one branch undo each other's work.
