# Cloud sessions

## Platform: Claude Code on the web

- The shell is Linux with GNU userland.
- GitHub's GraphQL API is closed to cloud sessions. Use `gh api` or the GitHub MCP.
- Open the PR with the MCP's `create_pull_request`, or `gh api -X POST repos/{owner}/{repo}/pulls -f title=<subject> -f head=<branch> -f base=main -f body=<body>`.
- A cloud session stops at merge-ready. GraphQL is closed and `gh pr merge --match-head-commit` is unavailable, so it cannot land under a head condition.
- `pnpm run cubic-review` is the author's optional check before a push, and no verdict counts it. It needs the `cubic` CLI and a model, and `scripts/cloud-setup.sh` sets up neither (`.agents/playbooks/review.md` says how). A session with no browser cannot link a provider, so only `CUBIC_API_KEY` works, and only while the organisation's Cubic subscription is active. Without one, skip the review. The script exits 2 and prints the CLI's own error.
- pstack is not installed from `.claude/settings.json` in a cloud session, which never shows the workspace trust dialog. `scripts/cloud-setup.sh` installs it.
