---
status: accepted
date: 2026-09-27
---

# Editors and Viewers land on Ask, the first screen of a reader surface beside Control Centre, which stays the one Admin surface

**Where this came from.** Since T-444, an Editor or a Viewer who signed in landed on Questions, at its first view, *Answer audit*. T-451's closing measure of T-441 read that screen against the design system's *Clarity* rule and found a glossary word on the first screen a newcomer sees. The first fix proposed was to rename the view *Answers*. ADR 0017 had already refused that word for this door. Its last reason is that "*Answers* on the door would send them to the bid library's wrong home", and the first client's bid library is 241 `Answer` concepts. The design review of 27 September 2026 found that the name was not the problem. The home was. Questions audits every answer the workspace has given, and under ADR 0017 that is an Admin's work.

## The decision

- A **reader surface** sits beside Control Centre and the console, drawn in the same three regions: icon rail, secondary nav and top bar. Its navigation is named *Better Answers*, the product's name set in type, as the design system's readme sets it wherever a mark would go. Route S6 already asks for the question-set page as "a reader surface beside Control Centre". This is that surface, opened before S6 with one screen.
- **Ask** is that screen, at `/ask`. It has two views, *New question* (the default) and *Your questions*. Both ship unbuilt and tell the reader to ask in Claude for now.
- An Editor's and a Viewer's home is Ask. They land there after signing in, and they are sent back there when a screen fails or an address names none. An Admin's home is still People.
- Control Centre is still the one Admin surface. Its six screens are unchanged, and so are Questions' three views, their names and their addresses, *Answer audit* included. Questions loses the line it carried for readers, because it is no longer anyone's home.
- The person menu on each workspace surface leads to the other one: Control Centre's to Ask, the reader surface's to Control Centre. The link to the console is still shown to the operator alone, on either surface's menu.

## Why

Someone who asks questions and reads answers should land where asking happens. Questions is where an Admin judges the answers other people got. Sending a Viewer there first shows them an audit they cannot act on, under a name they have not learnt yet.

The change is cheap. The web client already runs a second surface, the console, through the same frame, so a third is one more table of screens and one more set of routes.

## Considered options

- Rename *Answer audit* to *Answers*. Rejected: ADR 0017 refused *Answers* for this door, and the review showed the name was never the fault.
- Keep readers on Questions and improve its unbuilt line. Rejected: T-444 already gave Questions a line for readers, and the screen under it still audits everyone's answers.
- Show readers a filtered Control Centre. Not rejected, but a different decision. Filtering Control Centre by role is the ticket after this one. A filtered Control Centre is still the Admin's surface, so it would not become a reader's home.

## What stays open

- An Editor's home once question sets land in route S6: Ask, or the question sets.
- Who may read the answer audit. It could show a reader only their own questions, or everyone's, with or without who asked.
- Where an owning Editor decides: in Control Centre, or in a *Your queue* on the reader surface.

## Consequences

- `CONTEXT.md` gains *reader surface*, and its *home* entry names Ask for Editors and Viewers.
- The web client's screen tables hold a third surface. Control Centre and the reader surface read one table of homes, so a member lost on either is offered the same way home.
- The link to Control Centre opens it at the member's home where Control Centre holds that home, which is People for an Admin. Anyone else meets its first screen, Sources, which refuses them until Control Centre is filtered by role.
- Building Ask, Search and Guides, and placing the reader screens in the route, are later tickets.
