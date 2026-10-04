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
  - answer-audit
  - feedback
  - correction
  - answer-test
  - promotion-gate
  - control-centre
---

# Every answer is a retained, correctable record; an Answer is minted only at the promotion gate

## The decision

Every answer the platform gives is one retained, correctable record in the answer audit.

- Its skeleton (citations with their trust at the time, the predicate that applied, reuse and the judge's verdict, feedback, corrections) is kept for good.
- Its content (the question, the answer, who asked) is kept twelve months by default, then thinned to the skeleton.
- Feedback is *helpful*, or a flag with one reason: *wrong*, *out of date*, *incomplete* or *should not have shown*. The reason becomes a record in someone's queue.
- A correction is an Admin's or owner's act that records the level the answer went wrong at (concept, source or retrieval) and links the act that fixed it.
- A retrieval correction is kept as an answer test, replayed retrieval-only when the answer path changes and weekly.

An `Answer` concept is minted or updated only at a gate a person runs, the promotion gate.

- An Editor's *Save as an Answer* waits as a suggestion of kind *promotion*.
- The `Answer` domain's owner or an Admin decides it one at a time, never in bulk: update the existing, add as new, or decline.
- Accepting is one governed write with the decider as author. A trim makes the decider the generator.

Control Centre is one area of eight groups: Overview, Suggestions, Sources, Agent Operations, Questions, People, Personal data and System. ADR 0047 lists each group's pages.

- Questions holds the answer audit and the answer tests. A promotion waits in Suggestions' queue with every other suggestion.
- People's pages are members, groups and tokens.
- The audit log, in System, is the workspace's own audit events, never the identity-set audit log.
- The operator's console is an area of its own, outside Control Centre, reached from the workspace switcher.

## Why

- A wrong answer can be traced to the level it went wrong at and fixed there, visibly. A thumbs-down nobody can act on changes nothing. A reason that is already a record in someone's queue is the workflow.
- A retrieval fix without a replayable test is a belief.
- The bid library grows from use. A gate only Admins can feed is a gate nobody feeds, and one with no second pair of eyes turns one tender's wording into company knowledge.
- One noun per thing an Admin is answerable for is what a person holds without reading, so each of Control Centre's groups is a noun. *Answers* on the door would send them to the bid library's wrong home.
- Pages named by verbs were refused while Control Centre was the only area. Ask contradicts that refusal: it is an area every role opens to do one thing, and the verb names that thing. The refusal was lifted on 30/09/2026 (ADR 0047). Control Centre's groups keep their nouns.
- The page is *members*, not *roles*, because the three roles are fixed and ADR 0038 adopts no custom roles.

## Rejected

- Thinning by `UPDATE`: dead tuples and held locks, where dropping a partition is free.
- 90 days then deleted, or keeping everything until erasure: the bid cycle lost, or the largest text table in the estate within a year.
- Thumbs only, free text only, or "missing" as a reader's reason: nothing routes.
- Promotion as an *edit* suggestion: a promotion has no target and no base hash until decided.
- Admin-only promotion, every response promoted unless declined, or an Editor committing directly.
- Refusing an uncited answer until evidence is attached: the writer stops proposing.
- Corrections as notes, an external evaluation tool, replaying the draft, or one pass-rate percentage.
- A lenient generator at the gate: the check no longer means a second person.
- Four pages, or "Answers" for the audit page.

## History

The full record, with its amendments (ADR 0025 of 28/08/2026, ticket 79 applied by T-001, and the T-027 and T-028 grill): `docs/archive/adr/0017-answers-are-retained-correctable-records.md`.

Edited 30/09/2026 with ADR 0047, after the archived record was frozen: Control Centre's six pages became one area of eight groups, Knowledge left it to become an area, and the refusal of pages named by verbs was lifted because Ask contradicts it.
