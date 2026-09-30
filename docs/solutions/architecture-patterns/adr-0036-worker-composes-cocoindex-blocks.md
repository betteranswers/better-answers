---
title: "The worker composes cocoindex's blocks and writes only what the engine has no block for"
date: 2026-09-23
module: apps/worker
problem_type: architecture_pattern
component: worker
severity: high
applies_when:
  - "Adding or changing a cocoindex pipeline, component, memo or target in apps/worker"
  - "Deleting a binding's chunk rows, for a wipe, an erasure or a rule change"
  - "Renaming or moving the detector's memoised function or the component it is mounted under"
  - "Deciding whether the worker builds a piece of run machinery or takes it from cocoindex"
tags:
  - adr-0036
  - cocoindex
  - pipeline
  - memo
  - withholding
  - emptying-a-binding
  - lmdb
---

# The worker composes cocoindex's blocks and writes only what the engine has no block for

## The decision

The worker composes cocoindex's building blocks and never rebuilds them: per-component commit, memoisation, stable ids, target sync, `mount_each`, timeouts, handlers, stats, and one `Environment` per binding.

It writes only what the engine has no block for: the run key, claim, lease, heartbeat and reaper, attempts and poison, the catalogue, retention, priced-versus-actual, outcome rows, the landing, one run per binding, and supervision.

- `use_state` is never called.
- `use_mount` never fans documents onto the critical path.
- `pipeline/` (`apps/worker/src/better_answers_worker/pipeline/`) is the one module that imports `cocoindex`.
- Every target is `managed_by="user"`, and the api owns all DDL.

**One memo, and no memo holds text.** The one memoised function is the detector's, `detected`, and it returns spans. Conversion and the withholding run on every run. Which documents were detected afresh is answered per document.

**Two stores per binding**, at sibling paths under the binding's directory:

- `binding/` holds the chunks app and its target-state tracking.
- `findings/` holds the landed app and the memo.
- The disk cap and `lmdb_bytes` are read from the directory above both.

**Any deletion of a binding's chunk rows is paired with `binding/`'s removal.** A rule-change reprocess is paired as much as a wipe; together they are *emptying a binding*. The rows are deleted in the api's transaction. The worker removes the store as the first statement of the run that deletion enqueued. `findings/` is spared.

**The memo's frozen identity is six**, held as one literal in the worker's suite (`apps/worker/tests/test_pipeline_landed.py`):

- module `better_answers_worker.pipeline.detected`
- qualified name `detected`
- version `1`
- mount path `a-document/the-seam`, declared rather than derived from a function's name
- the landed app's name, `landed`
- directory `findings`

`version=1` is what takes the function's body out of the set. Moving any of the six is a detection of every page the estate holds, so it is a reprocess somebody chooses.

A spike measured all of this on cocoindex 1.0.22. Conversion plus the withholding cost under a fifth of one percent of a detector pass over the same page.

## Why

- Rebuilding a block cocoindex provides is the failure this record exists to stop. The exit stays cheap: cocoindex types never cross a module seam, the catalogue and the run rows are the durable truth, and every LMDB is disposable.
- The engine's default `managed_by="system"` would let one binding's deletion drop the shared `index.chunk` and its index under every other binding.
- `binding/` is the target-state tracking. A run over a standing store re-upserts nothing it believes it has landed: the spike deleted ten rows, left the store, and got nought rows back. Without the pairing, a withdrawn document's chunks would stand, which ADR 0020's erasure promises cannot happen.
- The store sits on the worker's own volume and no other process reaches it, so the removal is the worker's. A run that opened the store first would answer out of the memo it was enqueued to throw away.
- A memo keyed on policy re-ran the detector on every keep, suppression or rule switch, and a cached withholding kept a fix from reaching standing entries. Keyed on the text alone, policy is part of no key, and a converter upgrade re-detects only a document whose normalised text moved.
- The findings store holds neither text nor target-state tracking, so a wipe can spare it. Its home was fixed before the first client's documents, because moving it later costs a detection of every page held.
- cocoindex derives a mount path from `fn.__name__`, so renaming an internal function would have been a silent detection of every page.

## Rejected

- The whole ours/theirs table as a coding rule: no code to check it against, and it would drift from the library unflagged.
- Inferring outcomes from `inspect` diffs: cocoindex has no per-item success hook.
- The checkpoint inside cocoindex's work: it ties the durable truth to a disposable store.
- One memo over conversion and detection returning redacted text: every policy change re-detected, and an erasure had to remove the store.
- Two nested memos: `landed` is mounted, so an inner memo lives in the binding's store and dies in every wipe.
- The `finding` table as the cache: a wipe deletes its unmarked rows, so a partial set reads as complete and a document goes silently un-redacted.

## History

The full record, with its five amendments (T-113, T-129, the architecture review of 21/09/2026, T-285, T-288): `docs/archive/adr/0036-worker-composes-cocoindex-blocks.md`.
