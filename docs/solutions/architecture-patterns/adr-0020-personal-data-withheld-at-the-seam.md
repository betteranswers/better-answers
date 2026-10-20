---
title: "Personal data is withheld at the redaction seam, and erasure rewrites what the platform wrote"
date: 2026-09-24
module: repository
problem_type: architecture_pattern
component: privacy
severity: high
applies_when:
  - "Adding a step that reads a document's text before splitting, embedding, extraction or a model call"
  - "Changing a redaction rule, a descriptor, the window rule or what a finding row holds"
  - "Touching the erasure routine, a subject request, a suppression or the replay copy"
  - "Adding a store, a column or a copy that could hold a person's identifier"
  - "Sending a model text a person typed, such as a question or a note"
tags:
  - adr-0020
  - redaction-seam
  - finding
  - sensitivity
  - erasure
  - suppression
  - withholding
---

# Personal data is withheld at the redaction seam, and erasure rewrites what the platform wrote

## The decision

The **redaction seam** withholds personal data in the worker's conversion step and on the read-live tool's return. It runs before splitting, embedding, extraction and every model call, so no derived store and no model ever holds the value. The original bytes stay in the object store as their connected source's retention class allows. Only an Admin opens them, and each view is an audit event.

- The seam is Presidio (`presidio-analyzer` and `presidio-anonymizer`) with GLiNER-PII (`urchade/gliner_multi_pii-v1`) on CPU as the name model, plus recognisers of our own. Each version is read from its source on the day it changes and pinned as one constant in `redaction/pins.py`. `detector_pin` is derived from every package and the model id together, and each finding records it.
- **Sensitivity** has three classes: Restricted (the default for every connected source and every `Person`), Internal and Public. Only *Restricted* is a reader word; the other two are Admin words. A reader outside a Restricted document's audience sees nothing of it: no hit, no hint and no count. A reader inside it sees the placeholders under the word *Restricted*, in the app and over MCP alike.
- **Redaction rules** have three tiers: *always* (special-category cues, financial account and government identifiers), *default on* and *default off* per connected source. No connected source switches the always set off. *Default on* withholds dates of birth, home addresses and personal contact details on the consumer-domain list. *Default off* withholds person names, as a `[person A]` stable within the connected source, and job titles. The officer-block rule always wins: it withholds a name inside a persons-with-significant-control or officers section together with its block. Special-category data narrows its document to Restricted on landing.
- Special-category data is never inferred by a prompt. Only the cue list finds it. The cues live in the descriptor's `cues` field (`diagnose`, `diagnosis`, `medication`, `sickness`), and `context` holds only the words the detector's enhancer boosts on.
- One declared descriptor per category, in `apps/worker/src/better_answers_worker/redaction/descriptors.py`, feeds the recognisers, the category list and `rule_version`. A rule about what the model is shown, such as the window rule, moves `rule_version` too. A score threshold in the table is policy, not tuning. The always tier asks for less confidence than a tier a connected source can switch off, because a miss there is the expensive direction.
- A window begins where the document begins something: a heading, then a paragraph. A run under a heading is read whole up to twice the detector's window. A longer run is cut at the blank lines between its paragraphs. Only a paragraph that does not fit is stepped through by count, with both edges on a whole word, and a document that is one unbroken paragraph past the ceiling falls back to the count. The window's size and overlap stay the detector's own.
- A source document's `content_hash` is the hash of the normalised text before the seam runs, and the redacted text carries the version string beside it. A re-detection re-baselines the evidence resting on it as a platform action and never raises *source moved on*.
- A **finding** is its document, its rule and its two offsets into the normalised text. Its category, tier, score and version pair are the last sync's reading of it. The row is unique on that key, and a sync upserts on it, so a span found again keeps its row, its id and its marks. A reading that has not moved is not written again.
- The worker's grants on `finding` are column-level. It may insert a row, read the row's identity, `restored_at` and `review_state`, and update the five reading columns. It never deletes a finding or writes a column an Admin writes, so it learns that a span was restored or dismissed but never why or by whom.
- An Admin's restore, *keep in text* or special-category dismissal reaches the next sync as an argument, never a change key. An erasure outranks all three.
  - Only an always-tier finding can be restored, and a restored finding keeps the tier it was restored at. The seam leaves a restored span in the text unless an unrestored finding overlaps it, and still raises the finding.
  - *Keep in text* never wipes its connected source. It queues the next sync with the reason `restored`. A keep that an erasure overrides still succeeds. The sync's outcome row lists each overridden span by document, rule and offsets, never a value, and the review counts them per group of findings.
  - A wipe deletes only a connected source's unmarked findings. A finding an Admin reviewed or restored stays.
  - *Dismiss as not special category* refuses a person who is not an Admin, a group outside the special category and a group the connected source holds no span of. It writes one `sources.document.special_category_dismissed` audit row per document under one batch id, in its own transaction, and queues the sync with the reason `dismissed`. A dismissal after a keep leaves the restore standing.
  - A document's `narrowed_to` holds the Admin's narrowing apart from the seam's verdict, and a CHECK keeps its sensitivity no wider. When the verdict is lifted, the sync writes the sensitivity back to `narrowed_to`. Otherwise a sync only narrows, and the worker's update on `source_document` leaves `narrowed_to` out.
- The seam answers one **withholding** per finding and never rewrites a finding. The withholding's reason is never stored on the finding row. The counts and the special-category verdict are read off the findings, never the withholdings, so a special-category span an Admin restored still narrows its document. Pseudonym letters are drawn over every person-name finding whatever tier it ends at, so a suppression changes one person's output and no other person's letter.

Text a person types, such as a question or a note on a flag, never passes the worker's seam. The **typed-text check** covers it in the api tier.

- Before any model call, the check reads typed text against the always tier and replaces each hit with a placeholder in what the model is sent. The record keeps the text as typed.
- Core reads the three always-tier categories with detectors of its own. Cases in `contracts/redaction` hold them to the worker's, and both tiers run every case. A change to the worker's always-tier patterns moves its rule version, and core changes in the same pull request.
- The worker reads a cue, and the word that names a sort code and account number, through its tokenizer. Core has none. The worker finds a cue by taking an ending off the written word. So core reads any word that opens with a cue's stem as a cue, a misspelt one included. The worker reads five words before the pair. Between the pair's two numbers it reads only a naming word, whole or as its plural. Core reads all the text before the pair, and whole words between its numbers. Core's reading is made the wider of the two, so that a difference between them withholds more and not less.
- The limit is stated: a name in typed text is not withheld. The always tier is patterns, which the api tier can read. A name needs the detector's model, which the api tier cannot read.
- A special-category cue withholds its whole sentence, so a one-sentence question that holds one reaches the model as a placeholder alone.
- The check is `checkTypedText` in core's `llm` layer. Its callers are the ask's model calls on a question, the judge and the draft, in core's `answering` slice.

The erasure routine rewrites what the platform wrote; a person edits what the company wrote.

- Every actor id the platform wrote (files, history and its commit trailers, `bundle_commit` rows, verification rows, git author lines by mailmap) becomes `human:<erasure pseudonym>`, one pseudonym per workspace. The audit log is never rewritten: it names a person by person id. Each moved verification hash is computed again and recorded under the origin *erasure-rewrite*.
- The erasure map is fenced to the erasing workspace on every family. The routine's writes to the identity tables are the erasure slice's own, and each table it touches is recorded as cross-owner access.
- A member's commit to the bundle holds their member row until the commit is in git, or until its one-minute budget runs out and it fails. So ending the member waits for a commit under way, and refuses a later one. The routine rewrites history a second time once the member has ended.
- When this is the person's last workspace, it pseudonymises the user row (email to a tombstone, name cleared, id kept) and deletes their sessions, verification rows, invitations and linked accounts. It deletes invitations to the person's addresses in every workspace, its only write outside the erasing workspace, because an invitation left standing is a live copy of the address. It ends the person as a member here on every arm.
- It reaches *Questions asked* on every arm, in the erasing workspace alone. Who asked and who gave feedback become `human:<erasure pseudonym>`, the question is deleted and each note and each disputed sentence is cleared. The record's skeleton stays (ADR 0017).
- Erasure alone may leave a workspace with no Admin. The operator repairs it with `pnpm ops add-member`.
- It clears the operator's mark where the person carries one.
- It writes its replay copy to the object store, under `erasures/<workspace id>/`, before the completion commits.
- Its stored report tells the erasing workspace nothing of another. It is never given the identifier set or the erasure pseudonym, because a report naming the pseudonym would be the cross-workspace join ADR 0035 prevents. The replay copy carries both.
- The report claims no more than the routine does. Its fixed wording says that every actor identifier was rewritten across history, the index, the evidence, the map and the listed backup copies, and that names inside concept bodies are listed for the owner, where an edit leaves the name in earlier commits, exports and older backups. Every report prints the same sentences whichever arm ran: sign-in identity goes with the last workspace, invitations are deleted wherever they were sent, and the original files are untouched while the identifiers are withheld from every document now and later. Its documents line counts the documents found, the connected sources re-indexed now and the identifiers withheld, and names none of them. It says that exports already issued are not recalled.
- The report's four beyond-use dates are counted from an anchor it names. Until backup rows exist, the anchor is the instant the routine took its lock. Each tier is a calendar interval (48 hours, 30 days, 8 weeks, 6 months), never a count of days.
- The identity step writes one log line as it commits, under `process:better-answers-erasure`, on every arm and every run. The line carries the erasure request's id, the arm, `pseudonymised`, and the counts of sessions, verifications, accounts and invitations deleted here and everywhere. It never carries an address, and no workspace reads it.
- Names inside concept bodies are listed for the owner to edit.
- A subject request records `clock_started_at` and may carry `extended_to` for the Article 12 extension. It is due one calendar month on, or on the extended date.

A **suppression** belongs to the workspace. There is one per erasure request, and it holds the request's identifier set and the addresses the person signs in with, never a member's display name. It refuses an unshaped or empty set. It is written whenever the set holds an identifier, whatever the map found, and writing it again changes nothing. The seam withholds every exact occurrence of those identifiers each time a document of the workspace, held now or bound later, is indexed. Names are matched exactly, as emails are, so a namesake of the person is withheld too. Recording a subject request refuses an identifier too broad to withhold (`identifier-too-broad`). An identifier below that floor, recorded before the floor existed, still raises a detected finding to the always tier, but raises no erasure match and is not searched for. An access answer is locations and categories, never a passage.

The documents finder searches the workspace's full-text index with each identifier's words, as recorded and as folded. It checks each candidate's passages in order under the erasure-match agreement, inside the map's one transaction, and never reads the object store. A document it misses is withheld at its connected source's next sync.

The platform emits a **DPIA input** per connected source: its data types, scope, sensitivity class, the redaction rules in force, each model choice with its processor, country and retention tail, the retention class and the audience. It names the categories a connected source can raise, from the redaction agreement's list, and never counts a finding. It also lists what the platform itself holds as personal data: `human:<email>` in concept files, the `Person` concept, the per-connected-source LMDB and authored concept bodies. The publish action's audit row carries its totals and its hash.

- A workspace's embedding model choice is fixed once any vector exists. Its hosted provider is listed in the DPIA input and in the platform's sub-processor list only from the day that model choice is first called, never ahead of the processing. The local model choice names no sub-processor.
- Four questions are owed to a lawyer, recorded as owed and answered by no build: a six-month governance-locked tier under Article 17, with re-apply-on-restore as beyond use; RPO, RTO and the beyond-use period as contract terms; healthchecks.io and GitHub as sub-processors that hold no personal data; and whether a forward edit satisfies Article 17 for a capability statement that names an employee, which is knowledge the company asserts about itself. Two more are owed with data-protection advice: whether a log line kept under its retention limit is a sufficient record of deleted invitations, and whether the other company is owed a trace of its invitation's deletion.

Decided and not yet in the tree:

- *Default off* seeded on for meeting-note, support-ticket and HR-shaped connected sources.
- Narrowing a document or a connected source raises the *should not have shown* report over the answers already given from it.
- A model choice under zero data retention refuses in code any step that would leave zero data retention, and the erasure report states every model choice's retention tail, the embedding one included.
- A person's `human:<email>` is kept under a documented basis (legitimate interests, accountability) for as long as their checks stand, and is reviewed on the storage-limitation cadence.
- The identity step's log line carries `admins_left`, so the operator sees when an erasure leaves a workspace with no Admin.
- What becomes of a document's findings when its content hash moves. The block that first moves a hash decides it.

## Why

- The first corpus's most useful file is also the flagged one. Setting it aside is the manual work the product exists to remove. Role-gating in place puts a sort code in four stores and at a processor.
- A placeholder written before splitting is the one control that holds whatever a predicate, a prompt or an assistant's context later does with the text.
- No detector clears 0.6 F1 on independent benchmarks, so the design is detector plus review by category plus a Restricted default.
- The first Admin is a bid writer, not a DPO, so the safe set must be what they get by doing nothing.
- An actor id is a record, so the platform may rewrite it across history. A name in a concept body is knowledge the company asserts about itself (ADR 0011); rewriting it would make every export already issued diverge.
- A pseudonym that is never the person id means two workspaces' rewritten histories cannot be joined on one person (ADR 0035).
- A per-document suppression missed documents bound later, not yet indexed, unreadable, or withheld by a rule later switched off.
- One rule switch must never re-extract fifty thousand documents through a hosted model choice.
- Matching a name exactly withholds a namesake too. The owner accepted that cost.

## Rejected

- Two classes, or a five-level government scheme: one word for the website and the board minutes, or levels nothing acts on. "Open" as the third word: it collides with the MCP entry and reads as *published*.
- "Any domain but ours" as personal contact: it withholds the buyer contact a bid needs.
- A per-document finding list: noise at five thousand documents and 0.5 F1.
- No `Person` concepts, or a `Person` with everything the page shows: answers already name people, and a personal mailbox is not the company's to republish.
- An actor alias as the rewrite target: the word already means an imported id's mapping.
- Restricted connected sources kept local-only, or routing per document: nothing extractable without a GPU, or two prompts for a value already withheld.
- Regex only, or a transformers or spaCy-trf engine: 0.17 F1 with no names, or GPU-shaped for no gain.
- A hash over the redacted text: it moves with every rule or pin and raises *source moved on*.
- The routine pushing to and pruning the VPC 2 mirror itself: the api would hold a second estate's key.
- A rewrite with dulwich in the worker: a second git writer, and a git credential in the worker.
- A wipe that spares marked rows without the span key: an unreviewed twin per marked span on every sync.
- A *keep in text* that also lifts the special-category narrowing, or a cue plus a second signal: the first mixes two reviews, and the second needs a medical lexicon.
- Setting a document's class back in the dismissal's own transaction: a second road that cannot know the next sync's findings. A marker saying only that an Admin narrowed: it loses the class the Admin chose.
- A finder in the worker that converts every original at erasure time: it breaks the map's one transaction and the access answer.
- Quarantining flagged documents, or role-gating the passages: the useful file is the flagged one, and the value reaches every store.
- Pseudonymising every name, or nothing by default: a worse answer, or an unsafe default.
- A publish block on special category: blocking widening is the control.
- Reprocessing on a connected-source-wide rule version: about £750 and two days for one switch.
- Rewriting on every leaver, or never rewriting: every clone diverges, or "we cannot" is not a basis.
- Typed placeholders for the always set, or an "incomplete" hint: each tells the reader what exists.
- A targeted text replacement over concept bodies: it rewrites what the company asserts.
- A keyed hash of each finding's value: a hash of a value is the value.
- Calling no model when a question holds an identifier, or sending a question as typed: a person who pastes a form row with an account number gets no answer, or the number reaches a provider. What is given up is a name: one typed into a question reaches the model.

## History

The full record, with its seventeen amendments (among them T-001, T-073, T-121, T-124, T-132, T-177, T-176, T-201, T-286, T-220, T-366 and the T-027/T-028 grill): `docs/archive/adr/0020-personal-data-withheld-at-the-seam.md`.

Amended 13/10/2026 on the owner's decision of 12/10/2026, by the S2b ask plan (`docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, R42 and KTD12). S2b is the first block to send a model text a person typed, which the seam never reads. The typed-text check reads it against the always tier before the call. Names in typed text are not withheld, and the record keeps the text as typed.

Amended 13/10/2026 by the same plan's U4 (R39 and KTD8). The erasure routine gained a step and a family, `question-asked`, so an erasure rewrites who asked and who gave feedback, deletes the question and clears each note and each disputed sentence.

Amended 14/10/2026 on the owner's ruling of 14/10/2026, by BA-153. A naming word between a sort code and its account number, whole or as its plural, now names the pair, in a document and in typed text. A National Insurance number no longer takes the space before it, and a refused prefix after a space is no longer read as one. The rule version moved from 6 to 7. A National Insurance finding that took the space before it now starts one character later, so a restore made on it before the change no longer matches, and the number is withheld again at the next sync until an Admin restores it afresh.

Amended 14/10/2026 on the owner's ruling of 14/10/2026, by BA-166 and BA-160 (`docs/plans/2026-10-14-1811-fix-erasure-late-commit-and-actors-plan.md`). The routine now rewrites `bundle_commit.actor` and `concept_verification.actor`, which it had found but never rewritten, and the person id in commit trailers. A commit made as the person while the routine runs is rewritten: the commit holds the member row, and history is rewritten again once the member has ended. The identity step reads which arm applies inside its own transaction.

The DPIA input, the fixed embedding model choice with its late-listed provider, and the four questions owed to a lawyer, all in the archived record, were missing from this doc until 20/10/2026, when the route's rewrite found S0, S8 and C1 resting on them.

Later decisions overturned two rules of the record. The local embedding route stayed the platform's default until ADR 0024 made a hosted model choice the default. Neo4j's transaction-log retention was the spike's question until ADR 0032 put the map in plain Postgres tables that ride the dump.

The seam's libraries and pins, the tiers' contents, the officer block, the cues, the thresholds, the window, the hash, the finding's key and grants, the review actions, `narrowed_to`, the reader's view of Restricted, the routine's fences, the report's wording and anchor, the log line, the subject request's clock, the suppression's and the finder's rules, the DPIA input's lists, two more owed questions, and what is not yet built were missing from this doc until 20/10/2026 (BA-215).
