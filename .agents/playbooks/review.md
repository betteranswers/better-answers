---
extends: shipping, babysit
when: Verifying, triaging or landing a pull request in this repository, where Cubic, CodeRabbit and Codacy review each head.
---

# Review

Three bots review each pull request. Each one reports a check run on the head.

| Bot | Check run | Reviews | Config |
| --- | --- | --- | --- |
| Cubic (`cubic-dev-ai`) | `cubic · AI code reviewer` | Source only. It skips tests, docs and skills, to save its monthly line allowance | `cubic.yaml` |
| CodeRabbit (`coderabbitai`) | `CodeRabbit` | Everything except the lockfiles, migration metadata, the Cubic wiki and third-party notices | `.coderabbit.yaml` |
| Codacy (`codacy-production`) | `Codacy Static Code Analysis` | Static analysis and a security pass over the same files as CodeRabbit | `.codacy.yaml` |

Cubic and CodeRabbit are the AI reviewers. Codacy does not count as one. No bot is a required check, so a bot's own result never blocks a merge. The verdict holds the rule instead, and it can fail a risky change that no AI reviewer reviewed.

- **In** "One verifier per PR", the verifier runs `pnpm run review-coverage <pr>` on the head it verifies, and reads every bot's findings before it decides.
  - The script exits 3 while a bot is still running. Wait for it to finish before you post the verdict.
  - If neither AI reviewer reviewed the head, ask for a full review: comment `@cubic review` and `@coderabbitai full review` on the pull request. Then wait and run the script again.
  - If neither AI reviewer reviews the head after that, the verdict depends on the change. A change to a migration (`packages/schema/migrations/`), to sign-in, access or row-level security, to erasure, or to `contracts/` gets `FAIL` with the reason `no AI review`. Split the pull request until a reviewer runs, or ask the owner. Any other change gets `PASS+NOTES`, never `PASS`, and the notes name each reviewer that did not run and why.
  - The verdict's description names the bots that reviewed the head, for example `PASS+NOTES by v968; reviewed: cubic, codacy`.
- **In** "Bugbot is triaged skeptically, always.", the bots are Cubic, CodeRabbit and Codacy. Codacy's `action_required` conclusion means it found something to triage. It is not a gate.
  - For a Cubic finding, read it with `get_pr_issues` on the `cubic` MCP and record the outcome with `update_pr_issue_status`. That posts the reply on the thread.
  - For a CodeRabbit or Codacy finding, reply on its thread.
  - Do not press *Fix with cubic* or CodeRabbit's *Autofix* while a session pushes to the branch. Two writers on one branch undo each other's work.
