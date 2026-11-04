# Cloud sessions

## Platform: Claude Code on the web

- The shell is Linux with GNU userland.
- GitHub's GraphQL API is closed to cloud sessions. Use `gh api` or the GitHub MCP.
- Open the PR with the MCP's `create_pull_request`, or `gh api -X POST repos/{owner}/{repo}/pulls -f title=<subject> -f head=<branch> -f base=main -f body=<body>`.
- A cloud session stops at merge-ready. GraphQL is closed and `gh pr merge --match-head-commit` is unavailable, so it cannot land under a head condition.
- `pnpm run cubic-review` is the author's optional check before a push (`.agents/playbooks/review.md`), and no verdict counts it. It needs the `cubic` CLI, which `scripts/cloud-setup.sh` does not install. Install it with `CUBIC_DISABLE_GIT_AI=1 npm install --global @cubic-dev-ai/cli`. Without the variable the install adds git-ai, which writes git notes under `refs/notes/ai`, pushes them to `origin` and installs a trace2 hook in the global gitconfig.
- The CLI also needs a model. `CUBIC_API_KEY` in the session's environment works only while the organisation's Cubic subscription is active. Without a subscription, `cubic auth connect claude-code` (or `codex`) links a provider, which needs a sign-in that a session with no browser usually cannot complete. When no model is available, skip the review. The script exits 2 and names the cause.
- pstack is not installed from `.claude/settings.json` in a cloud session, which never shows the workspace trust dialog. `scripts/cloud-setup.sh` installs it.
