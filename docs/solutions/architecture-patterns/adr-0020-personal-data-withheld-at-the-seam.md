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

The **redaction seam** withholds personal data in the worker's conversion step and on the read-live tool's return. It runs before splitting, embedding, extraction and every model call, so no derived store and no model ever holds the value. The original bytes stay in the object store, opened only by an Admin, each view an audit event.

- **Sensitivity** has three classes: Restricted (the default for every connected source and every `Person`), Internal and Public. Only *Restricted* is a reader word; the other two are Admin words.
- **Redaction rules** have three tiers: *always* (special-category cues, financial account and government identifiers), *default on* and *default off* per connected source. No connected source switches the always set off. The officer-block rule always wins. Special-category data narrows its document to Restricted on landing.
- One declared descriptor per category, in `apps/worker/src/better_answers_worker/redaction/descriptors.py`, feeds the recognisers, the category list and `rule_version`. A window begins where the document begins something: a heading, then a paragraph.
- A **finding** is its document, its rule and its two offsets into the normalised text. Its category, tier, score and version pair are the last sync's reading of it.
- An Admin's restore, *keep in text* or special-category dismissal reaches the next sync as an argument, never a change key. An erasure outranks all three.
- The seam answers one **withholding** per finding and never rewrites a finding.

Text a person types, such as a question or a note on a flag, never passes the worker's seam. The **typed-text check** covers it in the api tier.

- Before any model call, typed text is read against the always tier, and each hit is replaced by a placeholder in what the model is sent. The record keeps the text as typed.
- Core reads the three always-tier categories with detectors of its own. Cases in `contracts/redaction` hold them to the worker's, and both tiers run every case. A change to the worker's always-tier patterns moves its rule version, and core changes in the same pull request.
- The worker reads a cue, and the word that names a sort code and account number, through its tokenizer. Core has none. The worker finds a cue by taking an ending off the written word, so core reads as a cue any word that opens with a cue's stem, a misspelt one included. The worker reads five words before the pair, and between its two numbers it reads only a naming word whole, or its plural. Core reads all the text before the pair, and whole words between its numbers. Core's reading is made the wider of the two, so that a difference between them withholds more and not less.
- The limit is stated: a name in typed text is not withheld. The always tier is patterns, which the api tier can read, and a name needs the detector's model, which it cannot.
- A special-category cue withholds its whole sentence, so a one-sentence question that holds one reaches the model as a placeholder alone.
- The check is `checkTypedText` in core's `llm` layer. S2b builds its callers with the model client, and the tree does not hold them yet.

The erasure routine rewrites what the platform wrote; a person edits what the company wrote.

- Every actor id the platform wrote (files, history and its commit trailers, `bundle_commit` rows, verification rows, git author lines by mailmap) becomes `human:<erasure pseudonym>`, one pseudonym per workspace. The audit log is never rewritten: it names a person by person id.
- A member's commit to the bundle holds their member row until it is in git, so ending the member waits for a commit under way and refuses a later one. The routine rewrites history a second time once the member has ended.
- When this is the person's last workspace, it pseudonymises the user row (email to a tombstone, name cleared, id kept) and deletes their sessions, verification rows, invitations and linked accounts. It ends the person as a member here on every arm.
- It reaches *Questions asked* on every arm, in the erasing workspace alone. Who asked and who gave feedback become `human:<erasure pseudonym>`, the question is deleted and each note is cleared. The record's skeleton stays (ADR 0017).
- Erasure alone may leave a workspace with no Admin. The operator repairs it with `pnpm ops add-member`.
- It clears the operator's mark where the person carries one.
- It writes its replay copy to the object store, under `erasures/<workspace id>/`, before the completion commits.
- Its stored report tells the erasing workspace nothing of another. The operator's log line says which arm ran.
- Names inside concept bodies are listed for the owner to edit.

A **suppression** is the workspace's: one per erasure request, holding the request's identifier set and the addresses the person signs in with. The seam withholds every exact occurrence of those identifiers each time a document of the workspace, held now or bound later, is indexed. Recording a subject request refuses an identifier too broad to withhold (`identifier-too-broad`). An access answer is locations and categories, never a passage.

## Why

- The first corpus's most useful file is also the flagged one. Setting it aside is the manual work the product exists to remove, and role-gating in place puts a sort code in four stores and at a processor.
- A placeholder written before splitting is the one control that holds whatever a predicate, a prompt or an assistant's context later does with the text.
- No detector clears 0.6 F1 on independent benchmarks, so the design is detector plus review by category plus a Restricted default.
- The first Admin is a bid writer, not a DPO, so the safe set must be what they get by doing nothing.
- An actor id is a record, so the platform may rewrite it across history. A name in a concept body is knowledge the company asserts about itself (ADR 0011); rewriting it would make every export already issued diverge.
- A pseudonym that is never the person id means two workspaces' rewritten histories cannot be joined on one person (ADR 0035).
- A per-document suppression missed documents bound later, not yet indexed, unreadable, or withheld by a rule later switched off.
- One rule switch must never re-extract fifty thousand documents through a hosted model choice.

## Rejected

- Two classes, or a five-level government scheme: one word for the website and the board minutes, or levels nothing acts on.
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

Amended 13/10/2026 by the same plan's U4 (R39 and KTD8). The erasure routine gained a step and a family, `question-asked`, so an erasure rewrites who asked and who gave feedback, deletes the question and clears each note.

Amended 14/10/2026 on the owner's ruling of 14/10/2026, by BA-153. A naming word between a sort code and its account number, whole or as its plural, now names the pair, in a document and in typed text. A National Insurance number no longer takes the space before it, and a refused prefix after a space is no longer read as one. The rule version moved from 6 to 7. A National Insurance finding that took the space before it now starts one character later, so a restore made on it before the change no longer matches, and the number is withheld again at the next sync until an Admin restores it afresh.

Amended 14/10/2026 on the owner's ruling of 14/10/2026, by BA-166 and BA-160 (`docs/plans/2026-10-14-1811-fix-erasure-late-commit-and-actors-plan.md`). The routine now rewrites `bundle_commit.actor` and `concept_verification.actor`, which it had found but never rewritten, and the person id in commit trailers. A commit made as the person while the routine runs is rewritten: the commit holds the member row, and history is rewritten again once the member has ended. The identity step reads which arm applies inside its own transaction.
