# Cloud sessions

## Platform: Claude Code on the web

- The shell is Linux with GNU userland.
- GitHub's GraphQL API is closed to cloud sessions. Use `gh api` or the GitHub MCP.
- Open the PR with the MCP's `create_pull_request`, or `gh api -X POST repos/{owner}/{repo}/pulls -f title=<subject> -f head=<branch> -f base=main -f body=<body>`.
- A cloud session stops at merge-ready. GraphQL is closed and `gh pr merge --match-head-commit` is unavailable, so it cannot land under a head condition.
- `pnpm run cubic-review` needs the `cubic` CLI (`npm install --global @cubic-dev-ai/cli`) and `CUBIC_API_KEY` in the session's environment. `scripts/cloud-setup.sh` installs neither. Without them the script exits 2 and names what is missing, and the verifier asks the PR bot instead (`.agents/playbooks/review.md`).
- pstack is not installed from `.claude/settings.json` in a cloud session, which never shows the workspace trust dialog. `scripts/cloud-setup.sh` installs it.
