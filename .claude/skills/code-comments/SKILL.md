---
name: code-comments
description: Decides whether code carries a comment or docstring and what it may say — the core policy for every language, then JS/TS doc blocks, suppression directives and their oxlint and ESLint rules. Use when writing or reviewing comments or docstrings, suppressing a lint or type error, or configuring comment lint rules.
---

# Code Comments

The core policy binds every language. Python follows it too, and a
docstring counts as a comment. The sections after it are JS/TS. Where a
project's own comment rules differ, they win.

## Core policy

- A comment states only what the code cannot: a constraint, a trade-off,
  a trap. Plain words.
- Absent is the default.
- A comment never restates what the code does, and carries no history and
  no ticket, date, decision or rule citation; those belong in the commit
  message, the tracker and the decision record.
- Wrap at the project's line width; 100 columns where it sets none.

## Docstrings

- No docstring by default. An exported function may carry a doc block
  stating what its signature can't: units, ranges, what `null` means,
  side effects, errors (`@throws`).
- Internal functions and members get none unless a caller would
  otherwise guess. A guessable boolean is renamed rather than documented:
  `corrected` becomes `titleCorrectedByUser`.
- A comment that sits on a declaration uses `/** */`, so editors show it
  on hover.
- Tags carry prose, never types: no `@param {string}`, no `@returns` that
  restates the return type.
- `@deprecated <use-instead>` over a prose note: editors strike it
  through and lint reads it.

## Directive comments

- `// @ts-expect-error <why>` over `@ts-ignore`: it errors once the
  suppression is unnecessary, so it cleans itself up.
- Every disable carries its reason on the same line: `eslint-disable*`,
  `oxlint-disable*`, and `// Stryker disable` (the `mutation-testing`
  skill has Stryker's form).

## TODOs

No TODO comments; file the ticket.

## Lint

| Enforces | oxlint | ESLint |
| --- | --- | --- |
| `@ts-expect-error` with a reason, never `@ts-ignore` | `typescript/ban-ts-comment`, `typescript/prefer-ts-expect-error` | `@typescript-eslint/ban-ts-comment` (it absorbed the deprecated `prefer-ts-expect-error`) |
| No TODO, FIXME or XXX | `eslint/no-warning-comments` | `no-warning-comments` |
| No blanket disable | `unicorn/no-abusive-eslint-disable` | `unicorn/no-abusive-eslint-disable` |
| A disable that suppresses nothing fails | `--report-unused-disable-directives` | `--report-unused-disable-directives` |
| A reason on every disable | no rule; review holds it | `@eslint-community/eslint-comments/require-description` |

## Prefer language features over comments

- `#private` fields or the `private` keyword over `@private` tags.
- A well-named extracted function over a section comment inside a long
  one (pairs with the `complexity-gate` skill).
- `as const` and branded types over a comment saying which strings are
  allowed.
