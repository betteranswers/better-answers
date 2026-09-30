---
title: "Editors and Viewers land on Ask, on a reader surface beside Control Centre"
date: 2026-09-27
module: apps/web
problem_type: architecture_pattern
component: web
severity: medium
applies_when:
  - "Adding a screen for Editors or Viewers, or deciding which surface a screen belongs on"
  - "Changing where a role lands after signing in, or where a lost member is sent"
  - "Changing Control Centre's screens, Questions' views or a surface's person menu"
tags:
  - adr-0046
  - reader-surface
  - ask
  - control-centre
  - home
  - person-menu
---

# Editors and Viewers land on Ask, on a reader surface beside Control Centre

## The decision

- A **reader surface** sits beside Control Centre and the console. It is drawn in the same three regions: icon rail, secondary nav and top bar. Its navigation is named *Better Answers*.
- **Ask** is its first screen, at `/ask` (`apps/web/src/shared/screens.ts`). It has two views, *New question* (the default) and *Your questions*.
- An Editor's and a Viewer's home is Ask. They land there after signing in, and are sent back there when a screen fails or an address names none.
- An Admin still lands on People.
- Control Centre stays the one Admin surface. Questions and its three views are unchanged, their names and addresses too, *Answer audit* included.
- Each workspace surface's person menu links to the other: Control Centre's to Ask, the reader surface's to Control Centre. The link to the console is shown to the operator alone, on either menu.

Three things stay open:

- An Editor's home once question sets land: Ask, or the question sets.
- Who may read the answer audit. It could show a reader only their own questions, or everyone's, with or without who asked.
- Where an owning Editor decides: in Control Centre, or in a *Your queue* on the reader surface.

## Why

- Someone who asks questions and reads answers should land where asking happens. Questions is where an Admin judges the answers other people got. Sending a Viewer there first shows them an audit they cannot act on, under a name they have not learnt yet.
- The first fix proposed was to rename the view *Answers*. ADR 0017 had already refused that word for this door, because it would send readers to the bid library's wrong home, and the first client's bid library is 241 `Answer` concepts. The design review found the home was the fault, and the name never was.
- The change is cheap. The web client already runs a second surface, the console, through the same frame, so a third is one more table of screens and one more set of routes.

## Rejected

- Renaming *Answer audit* to *Answers*: ADR 0017 refused the word for this door.
- Keeping readers on Questions and improving its unbuilt line: the screen under it still audits everyone's answers.
- Showing readers a filtered Control Centre: not rejected, but a different decision. A filtered Control Centre is still the Admin's surface, so it would not become a reader's home.

## History

The full record, with no amendments: `docs/archive/adr/0046-a-reader-surface-beside-control-centre.md`.
