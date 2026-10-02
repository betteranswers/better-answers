---
title: "A coding rule is one imperative in the standards file of the directory it binds"
date: 2026-09-24
module: repository
problem_type: architecture_pattern
component: development-workflow
severity: medium
applies_when:
  - "Adding or editing a rule in a CODING_STANDARDS.md file"
  - "Finding a rule no gate holds, or deciding whether a rule needs a Reviewer line"
  - "Writing a comment, a docstring or a lint suppression, or changing the comment gates"
tags:
  - adr-0045
  - coding-standards
  - reviewer
  - comment-gate
  - oxlint
---

# A coding rule is one imperative in the standards file of the directory it binds

## The decision

A coding rule is one imperative in the `CODING_STANDARDS.md` of the directory it binds. There is the root file, one per workspace, and one beside the deployment configuration (`deploy/CODING_STANDARDS.md`).

**The form.**

- A rule's heading is its imperative. Under it come a body, an optional `Reviewer:` line, and a BAD/GOOD snippet where code says it faster than words.
- Prose is capped at 80 words a rule, under a shrink-only exception list, and at 2,500 words in the root file. Snippets are free.
- Outside a snippet, a rules file names identifiers only. A ticket, a date and a decision are each read where they are kept.

**Who holds a rule.**

- A `Reviewer:` line is written only where no mechanism could catch a breach: a judgement about depth, an oracle, a comment's intent.
- Where a gate could exist and does not, the gap is a ticket, and the rule gets no sentence about it.
- A rule states what it asks for. It does not say which gate catches a breach; the gate's failure message names the file that holds the rule.
- A finding quotes the rule's heading.

No suite holds the form now. The review reads the rules in whatever shape they take, so whoever edits a rules file keeps the form.

**Inside code, the comment rules are held by:**

- one oxlint config, `.oxlintrc.json`: stock rules, `comment-only-the-why`, and the string check `string-cites-nothing`;
- in Python, ruff's stock rules and a `.py`-only gate, `packages/devtools/python/comment_gate.py`;
- the density ceiling, `packages/devtools/src/comment-density.ts`.

## Why

- The rules files were founded on a short imperative form and drifted into narrative: enforcement bookkeeping, mechanism description, ticket history. An agent writes what it sees, and that voice ran through the code.
- A rule that names its gate repeats it. The gate already names the rule's file in the message a reader hits.
- With one lint config, `pnpm lint`, the pre-commit hook and an editor all show a breach as it is written.
- `string-cites-nothing` is its own rule because it polices text a person reads, which is not a comment.
- The density ceiling is the volume backstop, and the only gate on a config file's comments.

## History

The full record, with its one amendment (T-384): `docs/archive/adr/0045-coding-rule-is-one-imperative.md`.
