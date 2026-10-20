---
title: "The product ships an accessibility statement; its contents, timing and claim are open"
date: 2026-09-21
module: apps/web
problem_type: architecture_pattern
component: web
severity: medium
applies_when:
  - "Cutting scope from a release a UK public body will buy"
  - "Writing or publishing the product's accessibility statement"
  - "Changing the web tier's accessibility rule"
tags:
  - adr-0042
  - accessibility
  - accessibility-statement
  - wcag
  - public-sector
  - a11y
---

# The product ships an accessibility statement; its contents, timing and claim are open

## The decision

The product ships an accessibility statement.

These are all open, as they were when the sentence lived in the constitution:

- its contents
- when it ships
- where it is published
- who writes it
- the conformance claim it makes

The statement is not written yet. The work that writes it records the date it shipped and the claim it made.

The accessibility rule in `apps/web/AGENTS.md` keeps the first half of the reason, that the buyers are UK public bodies, for whom this is law. This doc alone keeps the second half, that the first customer states it of its own products. The rule also keeps the WCAG 2.2 AA bar and the component semantics. The axe check runs in the browser suite.

The decision predates this record and was moved out of the accessibility rule unchanged.

## Why

- The buyers are UK public bodies for whom this is law, and the first customer states it of its own products.
- A statement the product has not written shows in no diff and fails no suite. It binds no change a reviewer could read, which makes it a decision. Left in the rule, it read as though the axe gate covered it.
- It is recorded as a decision so that a later reader does not take the statement for a nice-to-have and drop it from a scope cut.

## Rejected

- Keeping it in the accessibility rule: it binds no change, and it read as covered by the axe gate.
- Dropping the sentence until something ships: the commitment is real, and its reason is a legal one no reader would reconstruct from the code.

## History

The full record, with no amendments; T-184 moved it out of the constitution: `docs/archive/adr/0042-product-ships-accessibility-statement.md`.

The record had every UI change carry the acceptance line "WCAG 2.2 AA, tested with a keyboard and a screen reader". ADR 0045's amendment of 16/10/2026 cut the rules files to what no gate holds, and the line went with it, as did the second half of the reason in the rule. The rule's pointer to this doc went in the one-form rewrite of 22/09/2026, and no decision restored it.
