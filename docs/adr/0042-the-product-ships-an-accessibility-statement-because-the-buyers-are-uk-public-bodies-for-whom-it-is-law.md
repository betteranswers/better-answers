---
status: accepted
date: 2026-09-21
---

# The product ships an accessibility statement, because the buyers are UK public bodies for whom it is law

**Where this came from.** This decision predates this record. Where and when it was taken is not written down; what is known is that it was held inside `[A11Y1]`, at the end of a rule whose other sentences a gate runs. The coding-rules audit of 21 September 2026 (T-184) sorted it as a decision rather than a rule and moved it here, unchanged: nothing checks it, nothing can — a statement the product has not written yet shows in no diff and fails no suite — and it binds no change a reviewer could read. Nothing below is new. `[A11Y1]` keeps the WCAG pass, the acceptance line and the component semantics, and points here for the statement.

**The decision.** The product ships an **accessibility statement**. `[A11Y1]` said that and no more.

**Why.** Because the buyers are UK public bodies for whom this is law, and the first client states it of its own products. That sentence closed `[A11Y1]` and reads as the reason for the whole rule, not for the statement alone, so it **stays in `[A11Y1]`** and is cited here rather than taken: a rule that lost its own *why* would be worse off for this move. It is recorded here too so that a later reader does not take the statement for a nice-to-have and drop it from a scope cut.

**What this does not decide.** Not its contents, not when it ships, not where it is published, not who writes it, and not the conformance claim it makes. All of that was open when the sentence lived in the constitution and is open still; moving it changed where the commitment is written down and nothing else.

## Considered options

- **Keep it in `[A11Y1]`.** Rejected, and this is the change. A rule is what binds a change; this sentence binds none. Left there it read as though the axe gate covered it, which is exactly the confusion T-184 was cut to remove — the pattern T-078 found in `[UX2]`'s latency numbers (ADR 0037).
- **Drop the sentence until something ships.** Rejected: the commitment is real and its reason is a legal one that no future reader would reconstruct from the code. Deleting it would lose the *why* and leave the obligation to be rediscovered late.

## Consequences

- `[A11Y1]` keeps its checked and reviewable sentences and cites this ADR for the statement.
- The statement is not written, and this record is where its absence is now visible; the task that writes it amends here with the date and the claim it made.
