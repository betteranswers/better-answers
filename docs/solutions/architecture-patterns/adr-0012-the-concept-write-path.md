---
title: "The api alone writes the bundle, one governed commit per act that the reconciler can replay"
date: 2026-09-27
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: high
applies_when:
  - "Writing any act that changes a workspace's bundle"
  - "Adding a row that is written in a governed write's transaction"
  - "Changing the reconciler, the head check or `pnpm ops reconcile-watermark`"
  - "A workspace is stuck behind a commit the index refused"
tags:
  - adr-0012
  - governed-write
  - bundle-commit
  - reconciler
  - watermark
  - suggestion
  - audit-event
---

# The api alone writes the bundle, one governed commit per act that the reconciler can replay

## The decision

The bundle is a bare git repository per workspace (ADR 0024). Only the api writes it, through governed acts.

- Each act makes one commit, under the per-repository lock. The lock is held from the hash precondition through the Postgres COMMIT.
- The `audit_event` id is minted first and carried in the commit's `Audit:` trailer.
- The act's rows are written in one transaction the slice owns. So `bundle_commit` history is always a prefix of git history.
- The manifest, `knowledge/manifest.yaml` inside the bundle, is such a commit too (`writeManifest`). It lands no concept row.
- Platform-prepared changes wait as suggestions. Nothing platform-prepared reaches the bundle without acceptance.
- A concept has two endings: deprecate, for anything that has been stable or is cited or linked, and discard, for the rest.
- The erasure routine mailmaps git author lines to the erasure pseudonym, never to a key of the member row (ADR 0035).

The reconciler replays the missed commits, oldest first, under `process:better-answers-reconciler`. It is idempotent on the trailer id, and it writes its audit event under the commit's own `Audit:` id. The head check (every thirty seconds by default, in the api) and `pnpm ops reconcile-watermark` are two triggers of one function.

- A concept commit replays through the live handler.
- What the commit does not carry is recovered fail-closed. A file whose `sources[]` disagree with the standing citations lands Restricted, and stays Restricted through every cascade until the concept lands again.
- A manifest commit replays as its commit row alone.
- A commit the index refuses stops the replay there. It is reported, never skipped.
- A live write on an unrecorded head fails on the parent key (`bundle_commit_parent_fk`), and the next tick heals it.

A revocation inside the act's window does not stop the replay: the role is judged at time-of-act. Unwanted content is undone by a forward revert, never by a history rewrite.

Moving a ref back to its watermark is the operator's plumbing, written down on a runbook page: `docs/operations/RUNBOOK.md`, page 10, *A workspace is stuck behind a commit*. It is not that rewrite, since it drops only commits no row recorded. It is not an ops command either. It is rehearsed on staging, against a made-up stuck bundle, before the first customer's data is on the box.

## Why

- The bundle is the company's asset, and the promise is trust per fact. A single committer makes every change attributable and revertible.
- Acceptance before landing keeps a bad producer run out of a history that is permanent.
- The row written at commit time is what makes a changed atom flag its compositions now, not after a worker job.
- The id is minted first for the reconciler alone. An id minted after the commit would leave the trailer empty exactly when the row was never written, the one case the reconciler exists for.
- The lock spanning both stores gives the prefix invariant, so the replay reads from a watermark and never hunts for holes.
- The transport's own transaction is not used: a transaction held open across a git commit waits on a subprocess.
- A widening is an Admin's recorded act, so a recovery never guesses a wider class.
- The commits after the watermark were never recorded, so no reader was ever served them. One ref moves and no object is rewritten. It stays a procedure because the question is whether to make the move at all, and no flag holds that judgement.

## Rejected

- Landing agent output on arrival as `status: draft`: every wrong atom becomes a clean-up commit in a permanent history.
- Rows written only by the worker after the commit: flagging stops being synchronous.
- No row at all: no filter for sensitivity or status, and no index.
- Admins clone and push, checked on arrival: rules in two places and a history the platform did not make.
- A read-only clone URL served by the api: a second authenticated endpoint before any customer asked.
- Deprecate only, never remove: mistakes filed as history forever. A governed remove for any concept: real knowledge can leave the tree.
- A `pnpm ops` command for the rewind: it could be run without the judgement the act turns on.

## History

The full record, with its amendments (ticket 19, ticket 24, ticket 74, ticket 79 applied by T-001, T-020, T-073, T-052, T-056, T-108, T-308, T-370, and a wording fix of 27/09/2026): `docs/archive/adr/0012-the-concept-write-path.md`.
