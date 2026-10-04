---
title: "Editors and Viewers land on Ask, an area in the one rail beside Control Centre"
date: 2026-09-27
module: apps/web
problem_type: architecture_pattern
component: web
severity: medium
applies_when:
  - "Adding a page for Editors or Viewers, or deciding which area a page belongs on"
  - "Changing where a role lands after signing in, or where a lost member is sent"
  - "Changing who may read the answer audit, or where a person reads their own questions"
tags:
  - adr-0046
  - area
  - ask
  - control-centre
  - home
  - answer-audit
---

# Editors and Viewers land on Ask, an area in the one rail beside Control Centre

## The decision

- **Ask** is an area in the one rail, beside Knowledge, Inbox and Control Centre (ADR 0047). It was first drawn apart from Control Centre, as a reader area in regions of its own. It is now one entry in the same rail.
- Ask has two pages, *New question* (the default) and *Your questions*, at `/ask`.
- An Editor's and a Viewer's home is Ask. They land there after signing in, and the not-found page offers it back. Until Ask is built, it opens a page saying plainly that it is on its way.
- An Admin lands on People › Members until Control Centre › Overview is built.
- Control Centre stays the one Admin area, shown to Admins alone. Questions keeps the answer audit and the answer tests, their names and addresses too, *Answer audit* included.
- What this record first set aside as a filtered Control Centre is now the decision, one level up: one rail, filtered page by page by role or by ownership of a domain (ADR 0047). Control Centre itself stays Admin-only, so a reader's home is never in it.
- The answer audit is read by Admins alone, in Control Centre › Questions. Each person reads their own questions in Ask › Your questions.
- An owner decides in their Inbox, whatever their role (ADR 0047).
- The console is reached from the workspace switcher, which lists it to the operator alone.

One thing stays open: an Editor's home once question sets land. It is Ask, or the question sets.

## Why

- Someone who asks questions and reads answers should land where asking happens. Questions is where an Admin judges the answers other people got. Sending a Viewer there first shows them an audit they cannot act on, under a name they have not learnt yet.
- The first fix proposed was to rename the view *Answers*. ADR 0017 had already refused that word for this door, because it would send readers to the bid library's wrong home, and the first client's bid library is 241 `Answer` concepts. The design review found the home was the fault, and the name never was.
- The first change was cheap: the web client already ran a second area, the console, through the same frame. One rail of areas then made a second set of regions unnecessary. An Admin who also asks reaches Ask from the same rail.
- A reader needs their own history and the flags they can act on, not the workspace's questions. Ask gives them the first and their Inbox the second, so the workspace-wide audit stays with the Admin.

## Rejected

- Renaming *Answer audit* to *Answers*: ADR 0017 refused the word for this door.
- Keeping readers on Questions and improving its unbuilt line: the page under it still audits everyone's answers.
- Letting readers read everyone's answers in the audit, with or without who asked: they need their own, not the workspace's.
- A *Your queue* on the reader area for an owning Editor: the Inbox serves every owner, whatever their role.

## History

The full record as first written, with no amendments: `docs/archive/adr/0046-a-reader-surface-beside-control-centre.md`.

Edited 30/09/2026 with ADR 0047, after the archived record was frozen: the reader area became the Ask area in one rail, the filtered Control Centre it had set aside became the decision, and two of its three open questions were answered, who reads the answer audit and where an owning Editor decides. The filename keeps the old words so references still resolve.
