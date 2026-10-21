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

- Its skeleton is kept for good: who asked and where, the collections named, the verdict, how the judge stood and its verdict per candidate, the predicate that applied, each returned or cited concept with its content hash and its trust at the time, each unmapped passage shown by its locator, feedback and corrections. Trust at the time is the tier, the status, the rider and when the concept was verified. Who verified it is a person, so the record does not keep the name.
- Its content (the question and any prose the platform drafted) is kept twelve months by default. It is stored by the month the question was asked in, and it leaves when that month's partition is dropped. No statement thins a row.
- Who asked is on the skeleton as an actor id, and so is who gave each piece of feedback. The erasure routine rewrites both to the erasure pseudonym, deletes the question, and clears each note and each disputed sentence (ADR 0020). The skeleton stays, with the feedback's reason and the concept a disputed sentence rested on (owner, 14/10/2026).
- The record holds what `ask` gave. It never restates a concept's text (ADR 0014), and a page re-reads each concept as the person reading may read it now. A page shows each concept's trust as it is now, in the closed trust words, while the record keeps the trust at the time. It holds drafted prose only when the platform drafted it, so an answer an assistant wrote over MCP is kept as the concepts it was given.
- Feedback names the record it is about and is stored on it. It is *helpful*, or a flag with one reason and the reader's note: *wrong*, *out of date*, *incomplete* or *should not have shown*. A flag on prose an assistant wrote carries the sentence disputed and the concept it rested on.
- Storing a flag comes before routing it. S2b stores it, and S5 adds the routing that makes the reason a record in someone's queue.
- An Admin closes a flag as fixed in the knowledge or as no fault in the knowledge, so a fault in an assistant's wording is told apart from a fault in a concept.
- A correction is an Admin's or owner's action that records the level the answer went wrong at (concept, source or retrieval) and links the action that fixed it.
- A retrieval correction is kept as an answer test. The test is replayed retrieval-only when the answer path changes, and weekly.

An `Answer` concept is minted or updated only at a gate a person runs, the promotion gate.

- An Editor's *Save as an Answer* waits as a suggestion of kind *promotion*.
- The `Answer` collection's owner or an Admin decides it one at a time, never in bulk: update the existing, add as new, or decline.
- The decider sees the proposed `Answer` beside the closest existing one, which one judging call labels same, variant or different, with any customer-specific wording to strip.
- Accepting is one governed write with the decider as author. A trim makes the decider the generator.
- An uncited answer may be promoted. It lands as `status: draft` with no sources, and stays out of new answers until its owner attaches evidence and moves it to stable.

Control Centre is one area of eight groups: Overview, Suggestions, Sources, Models, Questions, People, Personal data and System. ADR 0047 lists each group's pages.

- Questions holds *Questions asked* and the answer tests. A promotion waits in Suggestions' queue with every other suggestion.
- People's pages are members, groups and tokens.
- The audit log, in System, is the workspace's own audit events, never the identity-set audit log.
- The operator's console is an area of its own, outside Control Centre, reached from the workspace switcher.

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
- Corrections as notes, an external evaluation tool, replaying the draft, or one pass-rate percentage.
- A lenient generator at the gate: the check no longer means a second person.
- Four pages, or "Answers" for the audit page.

## History

The full record, with its amendments (ADR 0025 of 28/08/2026, ticket 79 applied by T-001, and the T-027 and T-028 grill): `docs/archive/adr/0017-answers-are-retained-correctable-records.md`.

Edited 30/09/2026 with ADR 0047, after the archived record was frozen: Control Centre's six pages became one area of eight groups, Knowledge left it to become an area, and the refusal of pages named by verbs was lifted because Ask contradicts it.

Amended 13/10/2026 on the owner's decisions of 11/10 and 12/10/2026, by the S2b ask plan (`docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, R29, with R19 to R21 and R37). The record holds what `ask` gave and no prose an assistant wrote. Feedback is stored on the record it names, a flag on an assistant's prose carries its sentence and concept, and a flag can be closed either way. A flag reaches nobody's queue until S5 builds the routing.

Amended 13/10/2026 by the same plan's U4, which built the record's three tables (KTD8, with R19, R38 and R39). Who asked moved from the content to the skeleton, where the erasure routine rewrites it. The content is the question and drafted prose alone, and it leaves by dropping a month's partition, never by thinning rows. The trust a record keeps for a concept names no verifier.

The judge's three labels and the uncited draft rule, both in the archived record, were missing from this doc until 20/10/2026, when the route's rewrite found S5 resting on them.

Amended 21/10/2026 on the owner's ruling of 15/10/2026 (BA-181). Questions asked showed each concept's trust at the time it was asked, and Your questions was to. Both now show its trust as it is now, re-read under the reader's predicate in the closed trust words, because a reader acts on the concept as it stands. The record still keeps the trust at the time, and what `ask` stores is unchanged.
