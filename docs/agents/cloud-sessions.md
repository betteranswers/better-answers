# Cloud sessions

## Platform: Claude Code on the web

- The shell is Linux with GNU userland.
- GitHub's GraphQL API is closed to cloud sessions. Use `gh api` or the GitHub MCP.
- Open the PR with the MCP's `create_pull_request`, or `gh api -X POST repos/{owner}/{repo}/pulls -f title=<subject> -f head=<branch> -f base=main -f body=<body>`.
- Queue it with the MCP's `enable_pr_auto_merge`, or `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/ccr/auto_merge`, in place of `gh pr merge <n>`.
- pstack is not installed from `.claude/settings.json` in a cloud session, which never shows the workspace trust dialog. `scripts/cloud-setup.sh` installs it.
- Read it back from the merge group's run, not `isInMergeQueue`:

  ```
  gh run list --workflow check.yml --event merge_group --json databaseId,headBranch,status,conclusion \
    --jq '.[] | select(.headBranch | contains("/pr-<n>-"))'
  ```
