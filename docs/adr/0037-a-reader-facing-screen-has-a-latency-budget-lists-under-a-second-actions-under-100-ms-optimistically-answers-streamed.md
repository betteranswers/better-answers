---
status: accepted
date: 2026-09-05
---

# A reader-facing screen has a latency budget: lists under a second, actions under 100 ms optimistically, answers streamed

**Where this came from.** `[UX2]` carried three numbers and a keyboard rule. The numbers are a product decision that almost nothing measures — one list budget asserted in the browser suite, no budget on the tRPC client — and a number nobody measures is a specification, not a rule (the coding-rules audit of 5 September 2026, T-078). No ADR carried the reader-facing posture, so this one does; `[UX2]` keeps the keyboard clause, which a reviewer can check on a screen, and the sentence that a missed budget is a bug.

**The budget.** Lists and search hits render under **one second**. An action applies under **100 milliseconds** — optimistically, in the client, with the server's answer reconciled after — so a click never waits on a round trip to feel done. Answers **stream**: the first sentence is the first thing on the screen, never a spinner until the last. A screen that misses the budget is a bug, not a backlog item.

**Why these numbers.** They are the usual thresholds, taken as decisions: a tenth of a second reads as the reader's own act, a second keeps their flow, and past it they look away. The buyers are UK SMBs and public bodies whose readers open the map between other work, and the Linear/Spotify default `[UX1]` names is the bar they arrive with. An answer is judged by its first sentence, which is where the verdict sits (ADR 0016), so streaming is the answer contract's shape rather than a nicety. Two 4 GB boxes (ADR 0024) make the budget a discipline on query shape — one query per screen, rows joined once rather than fetched per row (the footnote join ADR 0015 chose against 200 rows per guide read) — rather than something spare hardware absorbs.

**How it is measured.** The browser suite asserts the list budget on the screens it drives against the served build on a loopback port (`apps/web/e2e/routes.spec.ts` is the first), so the number is a test rather than a hope; the action budget is the query client's optimistic update, reconciled when the mutation settles, and a refusal is never retried because the screen that has to say so is what the budget protects; streaming is ADR 0016's contract. Two reopening conditions: a screen added without its budget asserted, and a measured number on the estate the budget cannot hold — the second is a decision about the budget or the box, taken here.

## Considered options

- **Keep the numbers in the rule.** Rejected: the rule claimed enforcement it lacked. A budget the suite asserts per screen is the rule's teeth; the numbers are this record's.
- **No budget until the estate is measured.** Rejected: the budget is what shapes the queries before the estate exists; measuring first ships the per-row fetch ADR 0015 refused.

## Consequences

- `[UX2]` is the keyboard clause — every common action has a keystroke, `?` lists them, bulk work is select-then-command — and points here for the budget.
- Every screen ticket names which of the three budgets it is under and how the suite asserts it.
