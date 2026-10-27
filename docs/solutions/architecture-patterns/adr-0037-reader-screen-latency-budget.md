---
title: "A reader-facing page has a latency budget, asserted per page by the browser suite"
date: 2026-09-05
module: apps/web
problem_type: architecture_pattern
component: web
severity: medium
applies_when:
  - "Adding or changing a page an Editor or a Viewer reads"
  - "Writing the query, list or mutation behind a page, or the procedure it calls"
  - "Writing a browser-suite spec under apps/web/e2e"
tags:
  - adr-0037
  - latency
  - budget
  - browser-suite
  - optimistic-update
  - streaming
---

# A reader-facing page has a latency budget, asserted per page by the browser suite

## The decision

A reader-facing page has a latency budget in three parts:

- Lists and search matches render under one second.
- An action applies under 100 milliseconds. The web app applies it optimistically and reconciles the server's answer after.
- Answers stream. The first sentence is the first thing on the page, never a spinner until the last.

The browser suite asserts the budget per page, against the served build (`apps/web/e2e/`). A missed budget is a bug.

- The list budget is a timed assertion in the suite.
- The action budget is the query client's optimistic update, reconciled when the mutation settles. A refusal is never retried, because the budget protects the page, and that page has to say the action was refused.
- The answer contract (ADR 0016) owns streaming.

Work on a page names which of the three budgets it is under and how the suite asserts it.

`apps/web/AGENTS.md` keeps the keyboard clause: every common action has a keystroke, `?` lists them, and bulk work is select-then-command. The numbers live here.

## Why

- The numbers are the usual thresholds, taken as decisions. A tenth of a second reads as the reader's own action, a second keeps their flow, and past it they look away.
- The buyers are UK SMBs and public bodies whose readers open the map between other work. They arrive expecting what they need first, then more, then the action.
- An answer is judged by its first sentence, which is where the verdict sits (ADR 0016). Streaming is the shape of the answer contract.
- The estate is two 4 GB boxes (ADR 0024), so the budget disciplines how queries are shaped: one query per page, with rows joined once and never fetched per row, as ADR 0015's footnote join chose.
- A number nobody measures is a specification. The UX rule carried the numbers and almost nothing measured them, so they moved here and the suite asserts them.

Two things reopen the budget: a page added without its budget asserted, and a measured number on the estate that the budget cannot hold. The second is a decision about the budget or the box, taken here.

## Rejected

- Keep the numbers in the UX rule: the rule claimed an enforcement it lacked.
- No budget until the estate is measured: the budget shapes the queries before the estate exists, and measuring first ships the per-row fetch ADR 0015 refused.
