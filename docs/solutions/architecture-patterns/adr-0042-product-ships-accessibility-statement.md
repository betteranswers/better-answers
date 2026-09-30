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

The reason stays in the accessibility rule, `[A11Y1]` in `apps/web/CODING_STANDARDS.md`: the buyers are UK public bodies for whom this is law, and the first client states it of its own products. That reason justifies the whole rule, so it is quoted here and not moved. The rule also keeps the WCAG 2.2 AA bar, the acceptance line and the component semantics. The axe check runs in the browser suite.

The decision predates this record and was moved out of the accessibility rule unchanged.

## Why

- The buyers are UK public bodies for whom this is law, and the first client states it of its own products.
- A statement the product has not written shows in no diff and fails no suite. It binds no change a reviewer could read, which makes it a decision. Left in the rule, it read as though the axe gate covered it.
- It is recorded as a decision so that a later reader does not take the statement for a nice-to-have and drop it from a scope cut.

## Rejected

- Keeping it in the accessibility rule: it binds no change, and it read as covered by the axe gate.
- Dropping the sentence until something ships: the commitment is real, and its reason is a legal one no reader would reconstruct from the code.

## History

The full record, with no amendments; T-184 moved it out of the constitution: `docs/archive/adr/0042-product-ships-accessibility-statement.md`.
