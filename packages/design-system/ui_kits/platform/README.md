# UI kit — Better Answers platform

A click-through recreation of the platform's reader surfaces and Control Centre, composed
entirely from this design system's components. Open `index.html`.

## What is here

| Screen | File | Grounded in |
| --- | --- | --- |
| Ask — question, streaming answer, citations, feedback | `AskScreen.jsx` | ADR 0016 (answer contract), ADR 0015 (citation markers), `[UX1]` |
| Search — hits typed by knowledge layer | `SearchScreen.jsx` | `CONTEXT.md` "hit", "unmapped passage" |
| Guide — Brief / Detail layers, coverage, needs review | `GuideScreen.jsx` | ADR 0004, `CONTEXT.md` "guide", "layer", "expectation" |
| Control Centre → Sources | `ControlCentre.jsx` | `CONTEXT.md` "source binding", "publish", ticket 37 |
| Control Centre → Suggestions | `ControlCentre.jsx` | ADR 0012 (the write path), `CONTEXT.md` "suggestion" |
| Control Centre → Knowledge | `ControlCentre.jsx` | `CONTEXT.md` "Control Centre" |
| Questions, People, System | `ControlCentre.jsx` (`PlaceholderScreen`) | **Deliberately blank** — named in the source, no interface specified |

`AppShell.jsx` holds the left rail and top bar; `data.js` holds the fake workspace
(Northgate Facilities, a plausible UK SMB client).

## Interactions that work

- Left rail switches screen; the rail's counts are live for Suggestions.
- Ask: type a question, submit, flag the answer, open any citation's passage, open the audit disclosure.
- Search: switch hit tabs, remove filter chips.
- Guide: switch Brief / Detail layers, open the includes disclosure.
- Suggestions: Review → the consequence dialog → Accept → optimistic toast with Undo; the queue empties.
- Knowledge: select rows to reveal the select-then-command bar.

## What it is not

Nothing here is production code. There is no real retrieval, no auth, no map. Screens the
source names but does not specify are left blank with a disclaimer rather than invented.
