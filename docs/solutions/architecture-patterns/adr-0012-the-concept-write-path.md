---
title: "The api alone writes the bundle, one governed commit per action that the reconciler can replay"
date: 2026-09-27
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: high
applies_when:
  - "Writing any action that changes a workspace's bundle"
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

# The api alone writes the bundle, one governed commit per action that the reconciler can replay

## The decision

The bundle is a bare git repository per workspace (ADR 0024). Only the api writes it, through governed actions.

- Each action makes one commit, under the per-repository lock. The lock is held from the hash precondition through the Postgres COMMIT.
- The lock has two parts, taken in turn: a queue inside the process, then a Postgres advisory lock on the workspace (`hashtext('bundle')`, `hashtext(<workspace id>)`). The advisory lock makes it hold across processes. Every write and the reconciler hold it shared. A history rewrite holds it alone. The reconciler never waits for it: it skips a workspace whose lock is taken. A pool holds at most three at once, so the lock never takes the whole pool.
- The `audit_event` id is minted first and carried in the commit's `Audit:` trailer.
- The action's rows are written in one transaction the slice owns: the one whose member read admitted the commit, after git has the commit. So `bundle_commit` history is always a prefix of git history.
- Writing the manifest, `knowledge/manifest.yaml` inside the bundle, is such a commit too (`writeManifest`). It lands no concept row.
- A write that names no evidence keeps the concept's citations, and its visibility is derived from them. A write that names an empty list clears them. So an edit of a concept's text, such as the import's link pass, a suggestion's acceptance or `pnpm ops update-concept-body`, never drops what the concept cites. A concept the reconciler holds Restricted, because its file's sources disagree with its citations, refuses such an edit as `widening-refused`: keeping the citations through the edit would widen it at the next cascade.
- Platform-prepared changes wait as suggestions. Nothing platform-prepared reaches the bundle without acceptance.
- A person who may not commit a change prepares a suggestion of the kind *edit*: an edit to a concept's text from a guide page by anyone but the concept's owner or an Admin, an edit to a Brief by a reader who may not edit compositions, or a missing fact offered as a new concept. The suggestion records the proposer and the content hash it was written against, so an acceptance over a body that moved fails and returns to the proposer. The target's owner or an Admin decides it, in the guide page or the owner's Inbox, and the acceptance is the same governed write: one commit, the proposer as git author, the platform bot as committer, the accepter on the audit event. A *promotion* is decided by the `Answer` collection's owner or an Admin (ADR 0017). Every other kind is decided by an Admin. The owner's or an Admin's own edit from the page commits directly, after the page has stated the consequence and, where the concept is used in more than one place, asked once.
- A concept has two endings: deprecate, for anything that has been stable or is cited or linked, and discard, for the rest.
- The erasure routine rewrites git author lines, commit trailers and file text to the erasure pseudonym, never to a key of the member row. It rewrites history a second time once the member has ended (ADR 0020, ADR 0035).

The reconciler replays the missed commits, oldest first, under `process:better-answers-reconciler`. It is idempotent on the trailer id, and it writes its audit event under the commit's own `Audit:` id. The head check (every thirty seconds by default, in the api) and `pnpm ops reconcile-watermark` are two triggers of one function.

- A concept commit replays through the live handler.
- What the commit does not carry is recovered fail-closed. A file whose `sources[]` disagree with the standing citations lands Restricted, and stays Restricted through every cascade until the concept lands again.
- A manifest commit replays as its commit row alone.
- A commit the index refuses stops the replay there. It is reported, never skipped.
- A live write on an unrecorded head fails on the parent key (`bundle_commit_parent_fk`), and the next tick heals it.

The role is judged at time-of-action, finally by the member read that admits the commit. That transaction holds the member row from the read through the landing. A revocation or a member's end that arrives after the read waits for the landing, and the action is answered as landed. An action is answered as refused only when nothing reached git or the landing failed. A commit whose landing failed is still replayed, even when a revocation came after the read. Unwanted content is undone by a forward revert, never by a history rewrite.

Moving a ref back to its watermark is the operator's plumbing, written down on a runbook page: `docs/operations/RUNBOOK.md`, page 10, *A workspace is stuck behind a commit*. It is not a history rewrite, since it drops only commits no row recorded. It is not an ops command either. It is rehearsed on staging, against a made-up stuck bundle, before the first customer's data is on the box.

## Why

- The bundle is the company's asset, and the promise is trust per fact. A single committer makes every change attributable and revertible.
- Acceptance before landing keeps a bad producer run out of a history that is permanent.
- The row written at commit time is what makes a changed atom flag its write-ups now, not after a worker job.
- The id is minted first for the reconciler alone. An id minted after the commit would leave the trailer empty exactly when the row was never written. That is the one case the reconciler exists for.
- The lock spanning both stores gives the prefix invariant, so the replay reads from a watermark and never hunts for holes.
- The transport's own transaction is not used: a transaction held open across a git commit waits on a subprocess. The one exception is the member's transaction: it holds the member's row `FOR SHARE` across that member's commit, and writes the action's rows after it. So an erasure's member delete waits until the commit has landed. The commit's one-minute budget bounds the git step alone: a commit that overruns it fails, and the row is freed (ADR 0020).
- The landing shares the commit's transaction so the answer agrees with the outcome. When the landing had a transaction of its own, a revocation could land between the two. The person was answered `credentials-revoked`, and the reconciler landed the commit later.
- A widening is an Admin's recorded action, so a recovery never guesses a wider sensitivity.
- The commits after the watermark were never recorded, so no reader was ever served them. One ref moves and no object is rewritten. It stays a procedure because the question is whether to make the move at all, and no flag holds that judgement.

## Rejected

- Landing agent output on arrival as `status: draft`: every wrong atom becomes a clean-up commit in a permanent history.
- Rows written only by the worker after the commit: flagging stops being synchronous.
- No row at all: no filter for sensitivity or status, and no index.
- Admins clone and push, checked on arrival: rules in two places and a history the platform did not make.
- A read-only clone URL served by the api: a second authenticated endpoint before any customer asked.
- Deprecate only, never remove: mistakes filed as history forever. A governed remove for any concept: real knowledge can leave the tree.
- A `pnpm ops` command for the rewind: it could be run without the judgement the action turns on.

## History

The full record, with its amendments (ticket 19, ticket 24, ticket 74, ticket 79 applied by T-001, T-020, T-073, T-052, T-056, T-108, T-308, T-370, and a wording fix of 27/09/2026): `docs/archive/adr/0012-the-concept-write-path.md`. The *edit* kind and the owner's arm, the archived amendment of 27/08/2026, were missing from this doc until 20/10/2026, when the route's rewrite found S3 resting on them.

The promotion sentence was corrected on 20/10/2026, after a sample of the map tickets found it contradicting ADR 0017, which gives a *promotion* to the `Answer` collection's owner or an Admin.

On 21/10/2026 the landing moved into the commit's member transaction (BA-221). Until then, a revocation inside the action's window answered the action as refused, and the replay landed it.
