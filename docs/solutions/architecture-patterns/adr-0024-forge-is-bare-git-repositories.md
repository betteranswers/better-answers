---
title: "The forge is bare git repositories the api writes, on two 4 GB boxes"
date: 2026-09-23
module: repository
problem_type: architecture_pattern
component: stores
severity: high
applies_when:
  - "Writing to or reading from a workspace's git repository"
  - "Adding a service to either box, or changing the worker's memory cap"
  - "Changing the mirror on VPC 2 or the commands its key accepts"
  - "A workspace asks for a local embedding model choice"
tags:
  - adr-0024
  - forge
  - git-store
  - mirror
  - estate
  - staging
  - detector
---

# The forge is bare git repositories the api writes, on two 4 GB boxes

## The decision

The forge is bare git repositories the api writes, one per workspace directly under `GIT_STORE_DIR` (`/data/git` on the estate). No forge service runs.

- The api writes through the git binary in its own image, one commit per action, under the bundle lock (ADR 0012). Each commit names the person as its author and the platform bot as its committer.
- `openGit` (`packages/core/src/store/git/index.ts`) is the one place that checks the root: an absolute path to an existing directory, or the door refuses.
- The worker mounts the git store read-only. It is to read a repository at the commit hash recorded on the sync's row, which takes the place of a per-sync read token. No worker code reads git yet.
- A customer-hosted worker (v1.0) reads its repository over read-only git smart HTTP. The api serves it through `git http-backend` behind its principal check, under the sync's token. It is built when that worker is.
- Each night the `backup` service bundles each repository that holds a ref, and pushes the mirror to VPC 2 over SSH. A repository with no ref, a workspace not yet written to, is neither bundled nor mirrored, because git refuses both. A restore makes it again, empty, for each workspace the restored database names. The mirror key (`deploy/mirror-shell.sh`) takes three verbs, `init-repo`, `git-receive-pack` and `prune-repo`, and refuses everything else. It is a forced command under `restrict`, so it opens no shell and forwards no port. `prune-repo` takes one workspace id and no options, checks it as one path segment as `init-repo` does, refuses a mirror that does not exist, then runs `git reflog expire --expire=now --all` and `git gc --prune=now` on that repository. `deploy/backup.sh` calls `prune-repo` only after a push that replaced refs.

v0.1 runs on two boxes of 4 vCPU · 4 GB · 120 GB:

- VPC 1 runs all of production, with a 4 GB swap file as the safety net.
- VPC 2 runs Coolify, the git mirror and a restore target that exists only during a drill or a rehearsal. Staging is on demand.
- The growth steps, in order: A, split production across the two boxes over WireGuard if the swap-in signal says so; then E, a third contract, when the first customer pays or a workspace asks for a local embedding model choice, whichever comes first.
- Local embedding needs a model-host box first. The first workspace to ask for a local embedding model choice triggers it, as step E. Until then a hosted model choice is the default. `docs/operations/coolify.md` § The local embedding model choice carries the service.

The worker holds the detector's weights once, mapped from the file. It loads them through gliner's own `low_cpu_mem_usage=True` path, with torch's `load.mmap` set for the build alone. Neither gliner nor Presidio is forked or patched, and the worker's suite fails when gliner falls back to the load that holds the weights twice. On VPC 1 it swaps nothing and settles near 650 MB of anonymous memory. It keeps its 1.5 GB cap, one sync at a time, and 1.5 GB of spill for what an index adds. S4's first index reads that. The worker's memory signals are `anon`, `memory.swap.peak` and `pswpin`. A `memory.peak` at the cap is no failure on its own, because mapped weights and LMDB pages count as page cache. No code reads these figures yet (ADR 0025).

## Why

- The two IONOS contracts cannot be resized, and cash is tight before the first customer pays.
- The api is the only committer (ADR 0012), with no human accounts on the forge, so Forgejo's UI, SSH server, user model and schema ran for nobody.
- A 3–5 GB CPU embedding server does not fit on a 4 GB box beside production.
- A swap file lets a first index that outgrows the cap run slower rather than fail.
- A push that replaces refs leaves the old objects on VPC 2, so the mirror kept what production had erased. The verb sits on the key, not in a cron there, because only the push knows a rewrite happened.
- An unvalidated relative root once wrote a repository into the process's working directory.
- The default load held the 1.16 GB weights twice and used 85–98 % of the spill at every start. Mapped weights are file-backed, so the kernel drops them rather than swapping.

## Rejected

- A, splitting production over WireGuard now: a cross-box dependency on the box the drill wipes. Kept as the first growth step.
- C, Coolify off the estate: VPC 2's memory was never the problem.
- D, Supabase for Postgres: no more memory than the box, and every table moved to a new sub-processor.
- E, a third contract before go-live: money the effort does not have yet. Kept as the fallback.
- Keeping Forgejo: it fits, but it would be a service to patch, drill, back up and mirror for no one.
- No swap, hard caps only: the first customer's index must not fail.
- A git library inside the api: a customer-hosted worker cannot mount a shared volume. Read-only git smart HTTP answers that for v1.0.
- A smaller detector, or step E, for the worker's memory: the weights held once fit the box.
- `git-shell` as the mirror key's forced command: it accepts only `git-receive-pack`, so a workspace's first push to a mirror that does not exist yet would fail.

## History

The full record, with its five amendments (T-001, T-105, T-125, T-222 and T-347) and ADR 0025's note on the swap signal: `docs/archive/adr/0024-forge-is-bare-git-repositories.md`.

The record's rejection of Supabase also cited its lack of Apache AGE, a reason ADR 0032's plain tables removed. The commit's author and committer, the worker's read at a recorded commit, the smart-HTTP read for a customer-hosted worker, step E's payment trigger, the mirror key's `restrict` and `prune-repo`'s checks, the detector's load, and the memory signals were missing from this doc until 20/10/2026 (BA-215).
