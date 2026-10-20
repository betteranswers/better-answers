---
title: "Every answer is a retained, correctable record; an Answer is minted only at the promotion gate"
date: 2026-09-24
module: packages/core
problem_type: architecture_pattern
component: records
severity: medium
applies_when:
  - "Recording an answer, the feedback on it or a correction to it"
  - "Minting or updating an `Answer` concept"
  - "Adding a group or a page to Control Centre"
tags:
  - adr-0017
  - questions-asked
  - feedback
  - correction
  - answer-test
  - promotion-gate
  - control-centre
---

# Every answer is a retained, correctable record; an Answer is minted only at the promotion gate

## The decision

Every answer the platform gives is one retained, correctable record in *Questions asked*.

- Its skeleton is kept for good: who asked and where, the collections named, the verdict, how the judge stood and its verdict per candidate, the predicate that applied, each returned or cited concept with its content hash and its trust at the time, each unmapped passage shown by its locator, feedback and corrections. Trust at the time is the tier, the status, the rider and when the concept was verified. Who verified it is a person, so the record does not keep the name. A record's id cannot be guessed.
- Its content (the question and any prose the platform drafted) is kept twelve months by default. A workspace may set the period between 30 days and three years. It is stored by the month the question was asked in, and it leaves when that month's partition is dropped. No statement thins a row. Before a partition is dropped, the content of a held record, one with an open correction, is copied forward.
- "Cited in N answers" counts distinct pairs of person and day, over only the answers the person counting could have received.
- The records export takes the skeleton and whatever content is still within retention.
- Who asked is on the skeleton as an actor id, and so is who gave each piece of feedback. The erasure routine rewrites both to the erasure pseudonym, deletes the question, and clears each note and each disputed sentence (ADR 0020). The skeleton stays, with the feedback's reason and the concept a disputed sentence rested on (owner, 14/10/2026).
- The record holds what `ask` gave. It never restates a concept's text (ADR 0014), and a page re-reads each concept as the person reading may read it now. It holds drafted prose only when the platform drafted it, so an answer an assistant wrote over MCP is kept as the concepts it was given.
- Feedback names the record it is about and is stored on it. It is *helpful*, or a flag with one reason and the reader's note: *wrong*, *out of date*, *incomplete* or *should not have shown*. A flag on prose an assistant wrote carries the sentence disputed and the concept it rested on. A person gives feedback only on an answer they received. A record that is missing and one that is not theirs get the same *not found*.
- Storing a flag comes before routing it. S2b stores it, and S5 adds the routing that makes the reason a record in someone's queue. The reason sets the level of the fix. *Wrong* and *out of date* become a verification request on a concept the answer cited, or an edit suggestion when the reader typed the fix. *Incomplete*, *should not have shown*, and any flag on an answer that cited nothing go to an Admin, who picks the level.
- An Admin closes a flag as fixed in the knowledge or as no fault in the knowledge, so a fault in an assistant's wording is told apart from a fault in a concept.
- A correction is an Admin's or owner's action that records the level the answer went wrong at (concept, source or retrieval) and links the action that fixed it. A concept correction links the verification request, suggestion or conflict resolution it made. A source correction links the connected-source action or citation fix it made.
- A retrieval correction is kept as an answer test. The test is replayed retrieval-only when a model choice, a prompt or the index changes, and weekly. Each `llm_call` row records its prompt's version, so a prompt change starts a replay.
- An answer test keeps its own copy of the question and names a role, never a person, so it outlives both the partition drop and erasure. It is *stale* when a concept it names is deprecated or discarded, set in the same commit. It fails only when it fails on two runs in a row. The tests report three counts: passed, failed and stale.
- The erasure routine also reaches each answer test's question and each promotion's payload.

An `Answer` concept is minted or updated only at a gate a person runs, the promotion gate.

- An Editor's *Save as an Answer* waits as a suggestion of kind *promotion*.
- The `Answer` collection's owner or an Admin decides it one at a time, never in bulk: update the existing, add as new, or decline.
- The decider sees the proposed `Answer` beside the closest existing one, which one judging call labels same, variant or different, with any customer-specific wording to strip. The gate finds the closest one when the decider opens the promotion, under the decider's own predicate. It shows the proposed `Answer` with its trust words, and the diff sits one disclosure down.
- A decline carries a reason.
- Accepting is one governed write with the decider as author. A trim makes the decider the generator. `generated.by` names the last person to change the body, so a decider who trimmed the proposal cannot verify it in the same action, and the `Answer` lands *Unverified*.
- Once a promotion is accepted, the response it came from is marked *needs review* and asked to cite the new `Answer`. The platform never writes a new version of the response for its author.
- Returning an `Answer` unchanged is neither a generation nor a verification.
- An uncited answer may be promoted. It lands as `status: draft` with no sources, and stays out of new answers until its owner attaches evidence and moves it to stable. It cannot be verified until it has evidence to verify against.

A concept raised from unmapped passages is drafted by the platform only on request, in one extraction call within the spending limit. The person edits it, and the collection's owner or an Admin accepts it as an edit suggestion for a new concept.

Prose never refreshes itself. When a cited concept changes, the scheduled guide review prepares one waiting rewrite per flagged section, up to a set number of sections a run, oldest first. A person may also ask for one, and the cost is stated in words. At most one rewrite waits per section, and a person accepts it section by section (ADR 0014).

Control Centre is one area of eight groups: Overview, Suggestions, Sources, Models, Questions, People, Personal data and System. ADR 0047 lists each group's pages.

- Questions holds *Questions asked* and the answer tests. A promotion waits in Suggestions' queue with every other suggestion. The *Questions asked* page shows the weekly trend of flags in its head.
- People's pages are members, groups and tokens. Where a role is chosen, each role's one-line meaning is shown.
- Reader pages say *Save as an Answer*, *flag*, *helpful* and *answer test*. They never say *promote*, *eval*, *moderation*, *rating*, *log* or *report*.
- The audit log, in System, is the workspace's own audit events, never the identity-set audit log.
- The operator's console is an area of its own, outside Control Centre, reached from the workspace switcher.

Decided and not yet in the tree: the retention setting and the held records, the citation count, the records export, the routing and the corrections, answer tests and their replay, the promotion gate, the drafting of a concept from unmapped passages, the guide review's rewrites, the flag trend, and two signals and a notice:

- the answer signals: passed, failed and stale answer tests; replay spend beside extraction spend; the Suggestions backlog, counting each promotion once; flags per hundred answers, with last week's figure; and open corrections;
- a person's Inbox and digest saying "you copied this and it changed since" when a concept they copied changes.

## Why

- A wrong answer can be traced to the level it went wrong at and fixed there, visibly. A thumbs-down nobody can act on changes nothing. A reason that is already a record in someone's queue is the workflow.
- A retrieval fix without a replayable test is a belief.
- The bid library grows from use. A gate only Admins can feed is a gate nobody feeds, and one with no second pair of eyes turns one tender's wording into company knowledge.
- Without reading, a person can hold one noun per thing an Admin is answerable for, so each of Control Centre's groups is a noun. *Answers* on the door would send them to the bid library's wrong home.
- Pages named by verbs were refused while Control Centre was the only area. Ask contradicts that refusal: it is an area every role opens to do one thing, and the verb names that thing. The refusal was lifted on 30/09/2026 (ADR 0047). Control Centre's groups keep their nouns.
- The page is *members*, not *roles*, because the three roles are fixed and ADR 0038 adopts no custom roles.

## Rejected

- Thinning by `UPDATE`: dead tuples and held locks, where dropping a partition is free.
- 90 days then deleted, or keeping everything until erasure: the bid cycle lost, or the largest text table in the estate within a year.
- Thumbs only, free text only, or "missing" as a reader's reason: nothing routes.
- Storing the assistant's final text for every answer, or a setting that makes the platform draft over MCP: an answer test replays retrieval, which the record keeps in full. What is given up is the wording a person read through an assistant, which the record holds only for a sentence someone flagged.
- Promotion as an *edit* suggestion: a promotion has no target and no base hash until decided.
- Admin-only promotion, every response promoted unless declined, or an Editor committing directly.
- Refusing an uncited answer until evidence is attached: the writer stops proposing.
- "Check it as a human" on an `Answer` with no evidence: *verify* would mean something else on that rung.
- Prose refreshed on its own, or a rewrite on every commit: a quoted page changes silently, and every commit costs tokens.
- Corrections as notes, an external evaluation tool, replaying the draft, or one pass-rate percentage.
- A lenient generator at the gate: the check no longer means a second person.
- Four pages, or "Answers" for the audit page.

## History

The full record, with its amendments (ADR 0025 of 28/08/2026, ticket 79 applied by T-001, and the T-027 and T-028 grill): `docs/archive/adr/0017-answers-are-retained-correctable-records.md`.

Edited 30/09/2026 with ADR 0047, after the archived record was frozen: Control Centre's six pages became one area of eight groups, Knowledge left it to become an area, and the refusal of pages named by verbs was lifted because Ask contradicts it.

Amended 13/10/2026 on the owner's decisions of 11/10 and 12/10/2026, by the S2b ask plan (`docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, R29, with R19 to R21 and R37). The record holds what `ask` gave and no prose an assistant wrote. Feedback is stored on the record it names, a flag on an assistant's prose carries its sentence and concept, and a flag can be closed either way. A flag reaches nobody's queue until S5 builds the routing.

Amended 13/10/2026 by the same plan's U4, which built the record's three tables (KTD8, with R19, R38 and R39). Who asked moved from the content to the skeleton, where the erasure routine rewrites it. The content is the question and drafted prose alone, and it leaves by dropping a month's partition, never by thinning rows. The trust a record keeps for a concept names no verifier.

The judge's three labels and the uncited draft rule, both in the archived record, were missing from this doc until 20/10/2026, when the route's rewrite found S5 resting on them.

Two later decisions overturned rules of the record. One functional test per capability through every mounted transport fell to ADR 0008's amendment of 05/09/2026 (T-078). The rider *Unchecked · no evidence* on an uncited `Answer` fell to ADR 0047's amendment of 03/10/2026, after which no other rider exists. The record's remaining rules listed above, from the retention setting to the reader words, were missing from this doc until 20/10/2026 (BA-215).
