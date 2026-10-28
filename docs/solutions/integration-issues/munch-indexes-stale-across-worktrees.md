---
title: jCodeMunch and jDocMunch indexes go stale across the main checkout and Claude Code worktrees
date: 2026-09-30
module: .claude/hooks
problem_type: integration_issue
component: development-workflow
severity: medium
applies_when:
  - "Searching code or docs with jCodeMunch or jDocMunch from a worktree and finding edited or deleted lines"
  - "Setting up or debugging the jCodeMunch and jDocMunch watchers or the PostToolUse reindex hook"
  - "A new Agent-tool worktree's resolve_repo names the main checkout instead of the worktree"
symptoms:
  - jCodeMunch's main-checkout index was four days stale after merges to main
  - jCodeMunch search in a worktree returned lines already edited or deleted
  - jDocMunch's main index held 91 deleted paths and 73 worktree paths
  - The jCodeMunch watcher crashed on every linked worktree with IdentityModeAmbiguous
  - 37 of the 48 surviving Agent-tool worktree branches made after 21/10 had no index of their own and resolved to the main checkout's
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
retire_when: "the jDocMunch CLI can index a worktree branch-local, and no installed tool's WorktreeCreate hook creates a worktree without indexing it"
---

# jCodeMunch and jDocMunch indexes go stale across the main checkout and Claude Code worktrees

## Problem

The jCodeMunch and jDocMunch indexes went stale without saying so. Neither server refreshes on its own. The only refresh was the Edit/Write PostToolUse hook in `~/.claude/settings.json`. On 30/09/2026 the main checkout's code index was four days old (indexed 26/09, with several merges since). A search from a worktree returned lines that had already been edited or deleted.

The fix was a login watcher for each server. Turning the watchers on exposed three more faults: a missing install extra, a crash loop on every linked worktree, and doc edits in worktrees landing in the main checkout's doc index.

On 28/10/2026 a second fault turned up. A user-level `WorktreeCreate` hook from jCodeMunch raced the project's own hook. When it won, the new worktree got no index, and both servers answered from the main checkout's index without saying so.

Paths under `jcodemunch_mcp/` and `jdocmunch_mcp/` (and the short forms `cli/…`, `storage/…`, `tools/…`, `server.py`, `config.py`) are inside the installed packages, jcodemunch-mcp 1.108.319 and jdocmunch-mcp 1.145.0, under `~/.local/share/uv/tools/<package>/lib/python3.*/site-packages/`. They are not in this repository, and each citation names a symbol, in its parentheses or in its sentence, as of those versions. The 28/10 findings were read from jcodemunch-mcp 1.108.370 and jdocmunch-mcp 1.146.0, and cite path and symbol only.

## Symptoms

- Code search returned edited or deleted lines. `list-repos` and `watch-status` still called the index "fresh". Only `resolve_repo`'s `indexed_at` showed its age.
- jDocMunch's `index_file` stamps `head_sha` with the current HEAD on every hook-driven edit (`jdocmunch_mcp/tools/index_file.py`), so the index's commit can read as current while other files are stale. It also sets `source_dirty` and `sha_certified`; whether any freshness label reads `head_sha` alone was not confirmed.
- After `watch-install`, `~/.code-index/logs/watch.err` logged, for every repo: `FATAL: cannot watch …: watchfiles is required … uv tool install --force 'jcodemunch-mcp[watch]'`.
- With `watchfiles` installed, every linked worktree crashed and restarted in a loop: `WatcherManager: task crashed for <worktree>: Both local and git identity indexes already match this path. Invalidate one of them before indexing or resolving this path.`
- `jdocmunch-mcp index-local --path <worktree>` refused with `multiple_equivalent_candidates`, and later `equivalent_corpus_stale`.
- The main doc index held 91 deleted paths and 73 paths under `.claude/worktrees/…` before a `--rebuild`.
- The worktree removal and sweep tests left empty `*.json.lock` files in the real `~/.doc-index`.
- In an Agent-tool worktree, `order resolve_repo` returned `betteranswers/better-answers` with the main checkout as `source_root`, and `doc_resolve_repo` returned `local/better-answers` with `match: source_root_containment`. Both reported `found: true`, so searches returned main's content with no warning. The branch's reflog read `Created from HEAD`, not `Created from origin/main`.

## What Didn't Work

- **Trusting the hook.** jCodeMunch's reindex hook reads `tool_input.file_path` and skips any extension outside `_CODE_EXTENSIONS` (`run_posttooluse` in `jcodemunch_mcp/cli/hooks/reindex.py`, set in `cli/hooks/_common.py`). It never sees a Bash edit, a delete, a rename, a checkout or a merge. It never sees Markdown either. AGENTS.md's old "Edited files are reindexed automatically" held only for Edit/Write on code files.
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
   uv tool install --force "jcodemunch-mcp[watch]"
   launchctl kickstart -k gui/$(id -u)/us.gravelle.jcodemunch-watch
   ```

3. **Local identity stopped the worktree crash loop until 21/10.** This step is history. Do not repeat it.

   On 30/09 the fix was `"identity_mode": "local"` in `~/.code-index/config.jsonc`, then `jcodemunch-mcp delete-index <repo>` and `jcodemunch-mcp index <path>` for each worktree, because the setting affects new indexes only. The cause was in the defaults of jcodemunch-mcp 1.108.319. `git_root_identity` defaulted to `True` in `config.py`, which made the effective mode `git`. In git mode a linked worktree was keyed `local/<name>-<sha8>` but kept `git_root` set to the worktree path, so the same index matched both the local lookup and the git lookup in `storage/git_root.py`. `resolve_index_identity` then raised `IdentityModeAmbiguous`, and the watcher hit it on every tick. An index built in local mode has an empty `git_root` and watched cleanly.

   Upstream fixed this in jcodemunch-mcp #893, merged to its `main` on 26/09/2026 and released in 1.108.364. On 21/10/2026, on 1.108.370, the setting was commented out with a note naming #882 and #893. The retire condition held on 28/10 (measured). Nine worktrees were watched under the default mode with `index_freshness: fresh` in `watch-status`. Worktree indexes are keyed `local/<name>-<hash>`, and the main checkout is keyed `betteranswers/better-answers`. `~/.code-index/logs/watch.err` has no timestamps, so its line numbers stand in for time. It holds 18234 `Both local and git identity indexes already match` lines: 18192 `WatcherManager: task crashed` lines, the crash loop, the last at line 293990, and 42 `WARNING: re-index failed` lines. The 24 lines after line 300000 are all `re-index failed`. The four of them that were checked each name a worktree that was being deleted at that moment, so they are noise during removal, not the crash loop.

4. **Give each worktree its own doc index, named after its folder.** jDocMunch keeps one index per worktree lineage by default: `worktree_mode="reuse_equivalent"` (the `worktree_mode` default of `index_local` in `jdocmunch_mcp/tools/index_local.py`). A per-worktree index needs `worktree_mode="branch_local"`. The MCP tool exposes it (the `worktree_mode` property in `_all_tools` in `server.py`, passed through in `call_tool`). The `index-local` CLI does not (`il_parser` in `server.py` has `--path` and `--name` and no worktree flag). So `.claude/hooks/worktree-create-hook.sh` calls the Python API through the uv tool's own `python3`, with `worktree_mode="branch_local"`.

   The name matters. The edit hook finds the owning index by walking the file's parent folders and loading `local/<folder name>` for each (`_find_owning_index` in `jdocmunch_mcp/tools/index_file.py`). The default index name is the folder's name (the `normalize_local_index_name` call in `index_local`, `tools/index_local.py`). Without a worktree index, the walk reached the main checkout's folder. Doc edits in a worktree were filed into the main index under `.claude/worktrees/…` paths. Those paths are git-ignored, so the watcher never removes them.

   Nothing drops the index on removal now. The `worktree-lib.sh` that ran `jdocmunch-mcp delete-index --repo local/<basename>` went with the worktree sweep, so a removed worktree leaves its indexes until someone deletes them. jDocMunch takes `--repo` (`di_parser` in `server.py`). jCodeMunch takes a positional id.

5. **Stub every indexer binary in the hook tests.** The worktree removal and sweep tests stubbed `jcodemunch-mcp` only. The new drop call ran the real `jdocmunch-mcp` against the real `~/.doc-index`. Both now stub it (PR #488). `packages/devtools/test/gates/worktree-create-hook.test.ts` stubs both servers for the same reason.

6. **Put `~/.local/bin` on the hook's PATH.** jDocMunch's PostToolUse hook spawns `jdocmunch-mcp` by bare name.

7. **Keep one `WorktreeCreate` hook: the project's.** `jcodemunch-mcp init` installs `WorktreeCreate: jcodemunch-mcp hook-event create` and `WorktreeRemove: jcodemunch-mcp hook-event remove` in `~/.claude/settings.json`. The jCodeMunch create hook runs `git worktree add` on the same `.claude/worktrees/<name>` folder as `.claude/hooks/worktree-create-hook.sh`, with no start point and no indexing. Claude Code takes the path from the first hook that succeeds and prints one. When the jCodeMunch hook won, the project hook either found the folder taken or failed its own `git worktree add`, and it exited before its indexers ran.

   From 21/10 22:24 to 28/10 the jCodeMunch hook won 37 of the 48 surviving `worktree-agent-*` branches (measured from each branch's reflog and `~/.code-index/jcodemunch-worktrees.jsonl`). The tipping point is probably commit 76513a867 on 21/10. It added `git fetch origin main` before the project hook's `git worktree add`, which made the project hook slower than the jCodeMunch hook's start. That the hooks run at the same time and race is inferred from timing and the reflog split. Their effect is measured.

   The `hook-event create` entry was removed from `~/.claude/settings.json` on 28/10/2026 at 15:07. The `hook-event remove` entry stays, because it is now the only `WorktreeRemove` hook and it only runs `git worktree remove --force` and `git branch -D`.

One related find: for this project, two unpinned "Local config" entries in `~/.claude.json` overrode `.mcp.json`'s version pins (`jcodemunch-mcp==1.108.319`, `jdocmunch-mcp==1.145.0`). The pins were dropped later on 30/09/2026, so `.mcp.json` now runs each server's latest release through `uvx`, as those entries do.

## Why This Works

A watcher sees every change on disk, whatever made it: Bash, git, a merge, a delete. The Edit/Write hook sees only its own tool's writes, and jCodeMunch's version sees only code files. The watcher is the refresh. The hook only closes the gap between an edit and the next watch tick.

Since #893, jCodeMunch resolves a linked worktree's index to that worktree alone, so the watcher no longer meets two matching indexes. One `WorktreeCreate` hook means every Agent-tool worktree goes through the project hook, which indexes it. A branch-local doc index named after the worktree folder is the first ancestor the edit hook finds, so a worktree's doc edits stay in its own index. The main index stays clean.

## Prevention

- After any install or upgrade of either server, run `watch-status` and read both `watch.err` logs. A healthy status line does not prove the watcher runs. Look for `FATAL` and `task crashed`.
- Install jCodeMunch as `jcodemunch-mcp[watch]`, never bare.
- Leave `identity_mode` unset. The default mode works on worktrees from jcodemunch-mcp 1.108.364.
- Do not rerun `jcodemunch-mcp init`. It merges the `WorktreeCreate` `hook-event create` entry back into `~/.claude/settings.json`. After any change to user-level hooks, confirm that `~/.claude/settings.json` has no `WorktreeCreate` entry.
- In a new worktree, check that `order resolve_repo` on `.` names the worktree as `source_root`. If it names the main checkout, the worktree has no index, and every jCodeMunch and jDocMunch answer describes `main`.
- Never `index-local` a worktree through the jDocMunch CLI. Use `worktree-create-hook.sh`, or the MCP tool with `worktree_mode="branch_local"`. Never name a worktree index anything but its folder name.
- In any hook test, stub every indexer binary the hook can call. An unstubbed one runs against the real home directory.
- Check staleness by date, not by the "fresh" label. Compare `resolve_repo`'s `indexed_at` with `git log -1 --format=%cd`. If the index is older than the last commit, it is stale.

## Related Issues

- PR #488: the per-worktree doc index and its removal, the hook tests stubbing both indexers, and AGENTS.md's "After editing files" note.
- Upstream jcodemunch-mcp #893: the IdentityModeAmbiguous fix, merged to its `main` on 26/09/2026 and released in 1.108.364. #882 is the original report and PR, closed unmerged.
- PR #921: cut the worktree hooks down to `.claude/hooks/worktree-create-hook.sh`.
