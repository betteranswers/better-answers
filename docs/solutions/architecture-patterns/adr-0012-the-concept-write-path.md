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
- The file's `sources` are the concept's one list of evidence. A write takes no separate evidence: each source whose locator addresses a passage cites that passage's document, and a write citing a document the catalogue lacks is refused `no-such-document`. A source naming a concept is a map edge, never an evidence row. So an edit of a concept's text keeps what the concept cites exactly when it keeps the file's sources, as the import's link pass, a suggestion's acceptance and `pnpm ops update-concept-body` do. A concept held narrower than its sources refuses an edit that would widen it as `widening-refused`.
- An edit seeds from the stored file, never the projected read. `conceptToEdit` reads the raw row and shows the editor each source they may open as written, and only the count and labels of the rest. `saveConcept` takes the parts the client edits (title, kind, description, tags, body and the visible sources) and lays them over the file at the bundle's head, keeping each source the editor cannot open where it stood. `pnpm ops update-concept-body` is a caller of the same route: it seeds from the same stored file and commits through the same commit, with only the body changed.
- A direct write whose file renders as the stored file, and which moves no row field the file does not hold (merge key, title, kind), writes nothing: no commit, no audit event, no rows. It answers `unchanged`. An acceptance never answers `unchanged`, so it still decides its suggestion.
- A direct edit of a concept used in more than one place, counted as the write-ups including it plus the concepts linking to it in the live map, readable or not, is refused `reuse-unconfirmed` until the save says `reuse: "confirmed"`. The write's own count decides. The count `conceptToEdit` answers only words the ask.
- A save refuses a string source whose whole text is a passage locator (`source-label-refused`) and a passage locator in the body that no source cites (`body-locator-refused`). A reader shown a concept source they cannot open sees fixed words in place of its IRI, and a concept IRI never minted points at nothing.
- A concept's direct write commits only for the concept's owner or an Admin. The owner is the concept's own owner, else its collection's, else nobody, and then only an Admin writes it (ADR 0014, `concept_owner`). A new concept takes its collection's owner, so an owner of a collection creates in it. A concept directly under `knowledge/` is in no collection, so only its own owner or an Admin writes it. The owner may be of any role, a Viewer included. Anyone else is refused `owner-forbids`, the word that names the true reason, and `role-forbids` stays the role's word.
- The manifest write and the knowledge base import are an Admin's alone. Each writes across the whole knowledge base, which no one owner answers for, and an Editor's import would be refused part-way at the first collection they do not own.
- Platform-prepared changes wait as suggestions. Nothing platform-prepared reaches the bundle without acceptance.
- A person who may not commit a change prepares a suggestion of the kind *edit*: an edit to a concept's text from a guide page by anyone but the concept's owner or an Admin, an edit to a Brief by a reader who may not edit compositions, or a missing fact offered as a new concept. The suggestion records the proposer and the content hash it was written against, so an acceptance over a body that moved fails and returns to the proposer. The target's owner or an Admin decides it, in the guide page or the owner's Inbox, and the acceptance is the same governed write: one commit, the proposer as git author, the platform bot as committer, the accepter on the audit event, in the `Actor:` trailer and on `bundle_commit.actor`. If the proposer is no longer a member when it is accepted, the accepter is the git author. Declining an *edit* admits the same people. A *promotion* is decided by the `Answer` collection's owner or an Admin (ADR 0017). Every other kind is decided by an Admin. The owner's or an Admin's own edit from the page commits directly, after the page has stated the consequence and, where the concept is used in more than one place, asked once.
- A concept has two endings: deprecate, for anything that has been stable or is cited or linked, and discard, for the rest.
- The erasure routine rewrites git author lines, commit trailers and file text to the erasure pseudonym, never to a key of the member row. It rewrites history a second time once the member has ended (ADR 0020, ADR 0035).

The reconciler replays the missed commits, oldest first, under `process:better-answers-reconciler`. It is idempotent on the trailer id, and it writes its audit event under the commit's own `Audit:` id. The head check (every thirty seconds by default, in the api) and `pnpm ops reconcile-watermark` are two triggers of one function.

- A concept commit replays through the live handler. It records the decider the `Actor:` trailer names, an owner who is no Admin included, and judges no ownership again: the act was judged when it was committed.
- What the commit does not carry is recovered fail-closed. The replay derives the evidence rows from the commit's file, the way the write does. A file citing a document the catalogue no longer holds lands the rows it can and lands Restricted, flagged `evidenceAgrees: false` in its event, and stays Restricted through every cascade until the concept lands again.
- A manifest commit replays as its commit row alone.
- A commit the index refuses stops the replay there. It is reported, never skipped.
- A live write on an unrecorded head fails on the parent key (`bundle_commit_parent_fk`), and the next tick heals it.

The role and the ownership are judged at time-of-action, finally by the member read that admits the commit. The owner row is read in that transaction, before git has the commit, and held `FOR SHARE` with the member row and the concept's identity row, so an owner named or cleared before the read is the one judged, and one named or cleared after it waits for the landing. A batch of acceptances reads each decision's owner on its own, so one decision the person does not own is refused and the rest proceed. That transaction holds the member row from the read through the landing. A revocation or a member's end that arrives after the read waits for the landing, and the action is answered as landed. An action is answered as refused only when nothing reached git or the landing failed. A commit whose landing failed is still replayed, even when a revocation came after the read. Unwanted content is undone by a forward revert, never by a history rewrite.

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
- One list of evidence leaves a writer nothing to keep in step, and a replay nothing to disagree with.
- The editor never receives the locators of sources they may not open, so the server keeps those entries and the client sends only what it was shown.
- The unchanged test compares two renders of the file, `renderConceptFile` of the save and of the stored file parsed. A render writes every key as JSON, so a hand-written file never equals its own bytes; comparing renders keeps a re-save of an imported concept from writing a commit. The content hash is no test either: it leaves out `status`, `verified` and the like, and keeps only a source's resource and locator, so a change to a source's title alone would read as unchanged. Both normalise trailing whitespace the same way.
- The commits after the watermark were never recorded, so no reader was ever served them. One ref moves and no object is rewritten. It stays a procedure because the question is whether to make the move at all, and no flag holds that judgement.

## Rejected

- Landing agent output on arrival as `status: draft`: every wrong atom becomes a clean-up commit in a permanent history.
- Rows written only by the worker after the commit: flagging stops being synchronous.
- No row at all: no filter for sensitivity or status, and no index.
- Admins clone and push, checked on arrival: rules in two places and a history the platform did not make.
- A read-only clone URL served by the api: a second authenticated endpoint before any customer asked.
- Deprecate only, never remove: mistakes filed as history forever. A governed remove for any concept: real knowledge can leave the tree.
- A `pnpm ops` command for the rewind: it could be run without the judgement the action turns on.
- Refusing a write whose sources and evidence differ: it keeps two inputs a writer must fill in step.
- Sending the raw file to the client to edit: a reader would see the locators of sources they may not open.
- A second write route for the ops body update: two readers of the stored file and two unchanged tests, which drift.

## History

The full record, with its amendments (ticket 19, ticket 24, ticket 74, ticket 79 applied by T-001, T-020, T-073, T-052, T-056, T-108, T-308, T-370, and a wording fix of 27/09/2026): `docs/archive/adr/0012-the-concept-write-path.md`. The *edit* kind and the owner's arm, the archived amendment of 27/08/2026, were missing from this doc until 20/10/2026, when the route's rewrite found S3 resting on them.

The promotion sentence was corrected on 20/10/2026, after a sample of the map tickets found it contradicting ADR 0017, which gives a *promotion* to the `Answer` collection's owner or an Admin.

On 21/10/2026 the landing moved into the commit's member transaction (BA-221). Until then, a revocation inside the action's window answered the action as refused, and the replay landed it.

On 22/10/2026 the owner arm became the rule in code (BA-231). Until then any Editor wrote directly and only an Admin accepted or declined, with the owner named in this doc and nowhere in the store. The import and the manifest write, which an Editor ran, became an Admin's alone. The accepter as author when the proposer has left was `authorFor`'s fallback and is now the rule.

On 22/10/2026 the edit route landed (BA-95, BA-126, BA-127). The separate evidence input went, and the replay's flag changed meaning: it had marked a file whose sources disagreed with the citations, which can no longer happen, and it now marks a file citing a document the catalogue no longer holds. `pnpm ops update-concept-body` (#885) became a caller of the save route.
