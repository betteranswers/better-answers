---
title: jCodeMunch and jDocMunch indexes go stale across the main checkout and Claude Code worktrees
date: 2026-09-30
module: .claude/hooks
problem_type: integration_issue
component: development-workflow
severity: medium
symptoms:
  - jCodeMunch's main-checkout index was four days stale after merges to main
  - jCodeMunch search in a worktree returned lines already edited or deleted
  - jDocMunch's main index held 91 deleted paths and 73 worktree paths
  - The jCodeMunch watcher crashed on every linked worktree with IdentityModeAmbiguous
root_cause: missing_tooling
resolution_type: tooling_addition
framework_version: jcodemunch-mcp 1.108.319
tags:
  - jcodemunch
  - jdocmunch
  - mcp
  - code-index
  - worktree
  - file-watcher
  - posttooluse-hook
  - launchd
retire_when: "a released jcodemunch-mcp carries upstream #893 (IdentityModeAmbiguous on linked worktrees), and a watcher runs on a worktree under the default identity mode"
---

# jCodeMunch and jDocMunch indexes go stale across the main checkout and Claude Code worktrees

## Problem

The jCodeMunch and jDocMunch indexes went stale without saying so. Neither server refreshes on its own. The only refresh was the Edit/Write PostToolUse hook in `~/.claude/settings.json`. On 30/09/2026 the main checkout's code index was four days old (indexed 26/09, with several merges since). A search from a worktree returned lines that had already been edited or deleted.

The fix was a login watcher for each server. Turning the watchers on exposed three more faults: a missing install extra, a crash loop on every linked worktree, and doc edits in worktrees landing in the main checkout's doc index.

Paths under `jcodemunch_mcp/` and `jdocmunch_mcp/` (and the short forms `cli/…`, `storage/…`, `tools/…`, `server.py`, `config.py`) are inside the installed packages, jcodemunch-mcp 1.108.319 and jdocmunch-mcp 1.145.0, under `~/.local/share/uv/tools/<package>/lib/python3.*/site-packages/`. They are not in this repository, and their line numbers are for those versions.

## Symptoms

- Code search returned edited or deleted lines. `list-repos` and `watch-status` still called the index "fresh". Only `resolve_repo`'s `indexed_at` showed its age.
- jDocMunch's `index_file` stamps `head_sha` with the current HEAD on every hook-driven edit (`jdocmunch_mcp/tools/index_file.py:210`, `:254`), so the index's commit can read as current while other files are stale. It also sets `source_dirty` and `sha_certified` (`:211-225`); whether any freshness label reads `head_sha` alone was not confirmed.
- After `watch-install`, `~/.code-index/logs/watch.err` logged, for every repo: `FATAL: cannot watch …: watchfiles is required … uv tool install --force 'jcodemunch-mcp[watch]'`.
- With `watchfiles` installed, every linked worktree crashed and restarted in a loop: `WatcherManager: task crashed for <worktree>: Both local and git identity indexes already match this path. Invalidate one of them before indexing or resolving this path.`
- `jdocmunch-mcp index-local --path <worktree>` refused with `multiple_equivalent_candidates`, and later `equivalent_corpus_stale`.
- The main doc index held 91 deleted paths and 73 paths under `.claude/worktrees/…` before a `--rebuild`.
- The worktree removal and sweep tests left empty `*.json.lock` files in the real `~/.doc-index`.

## What Didn't Work

- **Trusting the hook.** jCodeMunch's reindex hook reads `tool_input.file_path` and skips any extension outside `_CODE_EXTENSIONS` (`jcodemunch_mcp/cli/hooks/reindex.py:72-82`, set at `cli/hooks/_common.py:19`). It never sees a Bash edit, a delete, a rename, a checkout or a merge. It never sees Markdown either. AGENTS.md's old "Edited files are reindexed automatically" held only for Edit/Write on code files.
- **Trusting "fresh".** `list-repos` and `watch-status` said "fresh" for an index four days behind `main`.
- **Reading watch-install's "Unload failed: 5: Input/output error" as a failure.** That is `launchctl`'s output when the installer unloads a service that was not loaded yet. The service loaded and ran afterwards.
- **`jdocmunch-mcp index-local --name wt-<x>`.** The CLI refused it for the same lineage reason. Even if it had worked, the edit hook would never find an index named `wt-<x>` (see *Solution*, step 4).
- **The plain `uv tool install jcodemunch-mcp`.** It lacks the `watch` extra, so the watcher cannot start.

## Solution

1. **Install a watcher for each server as a login service.**

   ```bash
   jcodemunch-mcp watch-install
   jdocmunch-mcp watch-install --no-ai-summaries
   ```

   These are launchd services `us.gravelle.jcodemunch-watch` and `us.gravelle.jdocmunch-watch`. They log to `~/.code-index/logs/watch.err` and `~/.doc-index/logs/watch.err`.

2. **Install jCodeMunch with its `watch` extra, then restart its watcher.**

   ```bash
   uv tool install --force "jcodemunch-mcp[watch]==1.108.319"
   launchctl kickstart -k gui/$(id -u)/us.gravelle.jcodemunch-watch
   ```

3. **Stop the worktree crash loop with local identity.** Add `"identity_mode": "local"` to `~/.code-index/config.jsonc`. Then, for each worktree, run `jcodemunch-mcp delete-index <repo>` and `jcodemunch-mcp index <path>`. The setting affects new indexes only, so the old ones must go.

   The cause is in the defaults. `git_root_identity` defaults to `True` (`jcodemunch_mcp/config.py:485`), and that alone makes the effective mode `git` (`storage/git_root.py:118`). The config template's comment calls `"local"` the default (`config.py:2211`), which is misleading. In git mode a linked worktree is keyed `local/<name>-<sha8>` but keeps `git_root` set to the worktree path (`storage/git_root.py:349-356`). The same index then matches both the local lookup and the git lookup by `git_root` (`storage/git_root.py:95-107`). `resolve_index_identity` raises `IdentityModeAmbiguous` when both match (`storage/git_root.py:179-183`). The watcher hits this on every tick. Indexes built in local mode have an empty `git_root` (`storage/git_root.py:209-215`) and watch cleanly.

   Upstream fixed this in jcodemunch-mcp #893, merged to its `main` on 26/09/2026. It reimplements the report and diagnosis in #882, which was closed unmerged. PyPI's 1.108.319 predates it. Revert `identity_mode` once a release carries #893.

   A running Claude Code session keeps its in-memory server from before the config change. That session's own worktree index got re-created with `git_root` set and kept crashing until the session ended.

4. **Give each worktree its own doc index, named after its folder.** jDocMunch keeps one index per worktree lineage by default: `worktree_mode="reuse_equivalent"` (`jdocmunch_mcp/tools/index_local.py:1641`). A per-worktree index needs `worktree_mode="branch_local"`. The MCP tool exposes it (`server.py:499-503`, passed through at `:2261`). The `index-local` CLI does not (`server.py:3049-3060` has `--path` and `--name` and no worktree flag). So `.claude/hooks/provision-worktree.sh:85-102` calls the Python API through the uv tool's own `python3`, with `worktree_mode="branch_local"`.

   The name matters. The edit hook finds the owning index by walking the file's parent folders and loading `local/<folder name>` for each (`jdocmunch_mcp/tools/index_file.py:37-53`). The default index name is the folder's name (`tools/index_local.py:1732`). Without a worktree index, the walk reached the main checkout's folder. Doc edits in a worktree were filed into the main index under `.claude/worktrees/…` paths. Those paths are git-ignored, so the watcher never removes them.

   `.claude/hooks/worktree-lib.sh:24-32` drops the index on removal with `jdocmunch-mcp delete-index --repo local/<basename>`. jDocMunch takes `--repo` (`server.py:3139`). jCodeMunch takes a positional id (`worktree-lib.sh:15`).

5. **Stub every indexer binary in the hook tests.** The worktree removal and sweep tests stubbed `jcodemunch-mcp` only. The new drop call ran the real `jdocmunch-mcp` against the real `~/.doc-index`. Both now stub it: `packages/devtools/test/ci/worktree-remove-hook.test.ts:40` and `packages/devtools/test/ci/sweep-worktrees.test.ts:58` (PR #488).

6. **Put `~/.local/bin` on the hook's PATH.** jDocMunch's PostToolUse hook spawns `jdocmunch-mcp` by bare name.

One related find: for this project, two unpinned "Local config" entries in `~/.claude.json` override `.mcp.json`'s version pins (`jcodemunch-mcp==1.108.319`, `jdocmunch-mcp==1.145.0`). While they exist, the pins do nothing.

## Why This Works

A watcher sees every change on disk, whatever made it: Bash, git, a merge, a delete. The Edit/Write hook sees only its own tool's writes, and jCodeMunch's version sees only code files. The watcher is the refresh. The hook only closes the gap between an edit and the next watch tick.

Local identity gives each worktree one index key with an empty `git_root`, so only one lookup can match it. A branch-local doc index named after the worktree folder is the first ancestor the edit hook finds, so a worktree's doc edits stay in its own index. The main index stays clean.

## Prevention

- After any install or upgrade of either server, run `watch-status` and read both `watch.err` logs. A healthy status line does not prove the watcher runs. Look for `FATAL` and `task crashed`.
- Install jCodeMunch as `jcodemunch-mcp[watch]`, never bare.
- Keep `"identity_mode": "local"` until a jcodemunch-mcp release carries #893. Then revert it, delete the worktree indexes, and re-index.
- Never `index-local` a worktree through the jDocMunch CLI. Use `provision-worktree.sh`, or the MCP tool with `worktree_mode="branch_local"`. Never name a worktree index anything but its folder name.
- In any hook test, stub every indexer binary the hook can call. An unstubbed one runs against the real home directory.
- Check staleness by date, not by the "fresh" label. Compare `resolve_repo`'s `indexed_at` with `git log -1 --format=%cd`. If the index is older than the last commit, it is stale.
- Remove unpinned "Local config" MCP entries from `~/.claude.json` so `.mcp.json`'s pins apply.

## Related Issues

- PR #488: the per-worktree doc index and its removal, the hook tests stubbing both indexers, and AGENTS.md's "After editing files" note.
- Upstream jcodemunch-mcp #893: the IdentityModeAmbiguous fix, merged to its `main` on 26/09/2026 and unreleased as of 30/09/2026. #882 is the original report and PR, closed unmerged.
