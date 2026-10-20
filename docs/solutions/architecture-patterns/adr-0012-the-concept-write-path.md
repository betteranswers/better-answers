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

- Each action makes one commit, under the per-repository lock. The lock is held from the hash precondition through the Postgres COMMIT. The action reads the concept's own row before it commits, and that read refuses a rename or a reclassification, so neither leaves a file behind.
- A person's own write commits directly, with the person as git author and the platform bot as committer.
- A commit carries the trailers `Actor:` and `Audit:`, and `Run:`, `Suggestion:` and `Projection: guides` where they apply. The trailer set is the replay's identity, so the suggestion and sync ids are minted before the commit too.
- The lock has two parts, taken in turn: a queue inside the process, then a Postgres advisory lock on the workspace (`hashtext('bundle')`, `hashtext(<workspace id>)`). The advisory lock makes it hold across processes. Every write and the reconciler hold it shared. A history rewrite holds it alone. The reconciler never waits for it: it skips a workspace whose lock is taken. A pool holds at most three at once, so the lock never takes the whole pool.
- The `audit_event` id is minted first and carried in the commit's `Audit:` trailer.
- The action's rows are written in one transaction the slice owns. So `bundle_commit` history is always a prefix of git history.
- Writing the manifest, `knowledge/manifest.yaml` inside the bundle, is such a commit too (`writeManifest`). It lands no concept row. It records `knowledge.manifest.written`, with the bundle's id as subject, lands on whatever head the bundle has, and renders the file in the platform's canonical form. A loader hands the action the manifest's values and never commits the file itself. Writing a manifest whose id already stands does nothing. A manifest with another id is refused `path-taken`, because it is the only path a bundle reserves.
- Platform-prepared changes wait as suggestions. Nothing platform-prepared reaches the bundle without acceptance. A sync yields one suggestion set. An Admin accepts it in bulk or item by item, and each acceptance is one governed write and one commit. A declined suggestion is recorded with its reason.
- An enrichment job reads committed concepts only, and submits its output as new suggestions through the same gate as any producer. A sync may enrich its own suggested concepts before it submits its one set.
- A person who may not commit a change prepares a suggestion of the kind *edit*: an edit to a concept's text from a guide page by anyone but the concept's owner or an Admin, an edit to a Brief by a reader who may not edit write-ups, or a missing fact offered as a new concept. The suggestion records the proposer and the content hash it was written against, so an acceptance over a body that moved fails and returns to the proposer. The target's owner or an Admin decides it, in the guide page or the owner's Inbox, and the acceptance is the same governed write: one commit, the proposer as git author, the platform bot as committer, the accepter on the audit event. A *promotion* is decided by the `Answer` collection's owner or an Admin (ADR 0017). Every other kind is decided by an Admin. The owner's or an Admin's own edit from the page commits directly, after the page has stated the consequence and, where the concept is used in more than one place, asked once.
- A concept has two endings: deprecate, for anything that has been stable or is cited or linked, and discard, for the rest.
- A rename keeps the IRI and moves the file to a new path through a governed move, and the same commit rewrites every inbound link.
- An en-masse verify is one batch commit, with a hash precondition on each document.
- An imported or hand-typed `verified` event, or a missing `iri`, is a fault. A fault is a signal on the concept's row and in Control Centre, never a mark in the file.
- The erasure routine rewrites git author lines, commit trailers and the actor ids in files to the erasure pseudonym, never to a key of the member row. It rewrites history a second time once the member has ended (ADR 0020, ADR 0035). It is the only history rewrite. Personal data that reaches the bundle unplanned is an incident procedure, never a product feature. An export already issued cannot be recalled, and the erasure report says so.

Decided and not yet in the tree: the owner's arm (an owner deciding an *edit* suggestion, which the code still admits to Admins alone), the governed move, the en-masse verify, the fault signal, enrichment, and the signals for bundle health, sync lag, reconciler hits and the suggestion backlog (ADR 0025).

The reconciler replays the missed commits, oldest first, under `process:better-answers-reconciler`. It is idempotent on the trailer id, and it writes its audit event under the commit's own `Audit:` id. The head check (every thirty seconds by default, in the api) and `pnpm ops reconcile-watermark` are two triggers of one function.

- `bundle_commit` is unique on the workspace and the audit event id. A replayed commit that has already landed, by that id or by its sha, is skipped, never an error.
- Each replayed commit lands one audit event: `platform.reconciler.replayed`, actor `process:better-answers-reconciler`, subject the commit's sha, with the IRI, the sha and the content hash it landed as detail. The commit and its `bundle_commit` row stay the person's: the git author, the `Actor:` trailer and `bundle_commit.actor`. The person's own action gets no audit event, because the replay is recovery, not re-authorization.
- A concept commit replays through the live handler.
- What the commit does not carry is recovered fail-closed. A file whose `sources[]` disagree with the standing citations lands Restricted, and stays Restricted through every cascade until the concept lands again. The merge key is recovered from the acceptance's payload, else the concept's own row, else derived from the folded kind and the normalised title, and falls back to the IRI when another concept holds the derived key. A concept with a row keeps its sensitivity, and one without lands Restricted. A replay recovers no evidence rows.
- A commit with a `Suggestion:` trailer replays as the acceptance it was, decided from its payload with the `Actor:` trailer's Admin as decider. If the suggestion was declined in the meantime, the commit still lands and the decline stands.
- A manifest commit replays as its commit row alone. One whose manifest already stands is skipped, and one that does not parse stops the replay as `unreadable-commit`.
- A commit the index refuses stops the replay there. It is reported, never skipped.
- A live write on an unrecorded head fails on the parent key (`bundle_commit_parent_fk`), and the next tick heals it.

A revocation inside the action's window does not stop the replay: the role is judged at time-of-action. Unwanted content is undone by a forward revert, never by a history rewrite.

Moving a ref back to its watermark is the operator's plumbing, written down on a runbook page: `docs/operations/RUNBOOK.md`, page 10, *A workspace is stuck behind a commit*. It is not a history rewrite, since it drops only commits no row recorded. It is not an ops command either. It is rehearsed on staging, against a made-up stuck bundle, before the first customer's data is on the box.

## Why

- The bundle is the company's asset, and the promise is trust per fact. A single committer makes every change attributable and revertible.
- Acceptance before landing keeps a bad producer run out of a history that is permanent.
- The row written at commit time is what makes a changed atom flag its write-ups now, not after a worker job.
- The id is minted first for the reconciler alone. An id minted after the commit would leave the trailer empty exactly when the row was never written. That is the one case the reconciler exists for.
- The lock spanning both stores gives the prefix invariant, so the replay reads from a watermark and never hunts for holes.
- The transport's own transaction is not used: a transaction held open across a git commit waits on a subprocess. The one exception is the member's row, held `FOR SHARE` across that member's commit. So an erasure's member delete waits until the commit is in git, or until the commit's one-minute budget runs out and it fails (ADR 0020).
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

Two later decisions overturned rules of the record. The worker's derive-and-sync, woken by each `bundle_commit`, cross-checked the parse hash per sync, until the archived ADR 0023's amendment of 29/08/2026 put the map's delta in the commit transaction and ADR 0031 made the check a nightly audit. One api process held an in-process mutex, with multi-process locking left as a written trigger, until the cross-process lock plan (`docs/plans/2026-10-14-2130-fix-bundle-fence-across-processes-plan.md`) built the two-part lock above.

The pre-commit read, the person's own commit, the trailers, the manifest action's rules, the suggestion set, the decline's reason, enrichment, the governed move, the en-masse verify, the fault, the incident rule, the unrecalled export and the replay's rules were missing from this doc until 20/10/2026 (BA-215). The same reading found that the owner's arm is not built yet, and that erasure rewrites the actor ids in files, never a concept's text.
