# Cloud sessions

## Platform: Claude Code on the web

- The shell is Linux with GNU userland.
- GitHub's GraphQL API is closed to cloud sessions. Use `gh api` or the GitHub MCP.
- Open the PR with the MCP's `create_pull_request`, or `gh api -X POST repos/{owner}/{repo}/pulls -f title=<subject> -f head=<branch> -f base=main -f body=<body>`.
- A cloud session stops at merge-ready. GraphQL is closed and `gh pr merge --match-head-commit` is unavailable, so it cannot land under a head condition.
- pstack is not installed from `.claude/settings.json` in a cloud session, which never shows the workspace trust dialog. `scripts/cloud-setup.sh` installs it.
