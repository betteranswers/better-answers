---
title: "A comment sweep's named holders need an independent check before the tool deletes"
date: 2026-10-17
category: best-practices
module: packages/devtools
problem_type: best_practice
component: comment-inventory
severity: medium
applies_when:
  - "Sweeping a workspace's comments with `pnpm comment-inventory`, including the Python worker once the tool can relocate Python rows"
  - "Deleting a comment because a test, type, rules file or name is said to hold its reason"
  - "Briefing agents to classify comments into the inventory's `class`, `holder`, `structure` and `unit` columns"
symptoms:
  - "A classifier names a test title as the holder of a comment's reason, the tool resolves the anchor once in its file, and the test does not assert the reason"
  - "A held row's anchor names the subject the comment talks about without stating the property the comment states"
root_cause: missing_validation
resolution_type: workflow_improvement
related_components:
  - devtools
---

# A comment sweep's named holders need an independent check before the tool deletes

## What happened

The sweep of 16 and 17 October 2026 ran `comment-inventory` over every TypeScript workspace, source and tests: about 7,800 comment blocks. Classifier agents filled each row's class. A row classed `held` names the code that holds the comment's reason, and the tool deletes the comment once that anchor resolves exactly once in its file.

The anchor resolving proves the holder exists. It does not prove the holder holds the reason. An independent reviewer read every held row's holder, and found it covered only part of the reason, or none, in a large share of rows:

| Area | Held rows | Not fully held |
|---|---|---|
| core src | 580 | 107 |
| api src | 161 | 34 |
| web src | 636 | 138 |
| devtools src | 106 | 18 |
| core, api, schema tests | 103 | 57 |
| web tests and journeys | 354 | 129 |
| devtools and test-inbox tests | 27 | 12 |

Without the second read, those comments would have gone, and with them the only statement of their reason. Some carried security reasons: an open-redirect test that never tries the backslash form, a log test whose fake error can never contain the name it guards, a refusal whose sameness across outcomes no test asserts.

## The method that held

1. Inventory one workspace and split it into partitions of about 200 rows. Each classifier writes only its partition's out TSV, works alone, and keeps scratch files in its own temp directory (two classifiers sharing `/tmp/sicko/` overwrote each other).
2. Check each out TSV against its input: same rows, same first seven columns.
3. Give every `held` row to an independent reviewer with the strict rule: a holder that exercises the path without asserting the property misses, and a title that names the subject without stating the property misses.
4. Fold the verdicts. A `partial` or `misses` row becomes `structure`, its `structure` cell carrying the reviewer's note, and its unit empties, so the comment stays. An identical comment in the same file as a structure row follows it. A backslash in the reviewer's note must be doubled, or the TSV is malformed.
5. Apply unit 1 (narration), run oxfmt over the touched files, then `check:gates` and the workspace's own `check`, and commit. Then unit 2 (held) the same way. A deletion can let a JSX element fit one line, and the format gate refuses it unformatted.
6. File the structure rows as one tracker issue per workspace, with the rows attached. The reviewer's note often names a sibling test that already asserts the missing half, which is a second anchor and a cheap fix.

## Rules a sweep needs before it starts

- **Name the contract criterion per workspace.** Without one, each classifier invents its own. In this sweep a contract was a doc block on a tRPC procedure, an MCP entry or a file the SPA's typecheck reads (api), a doc block on a helper exported through `@better-answers/schema/testing` (schema tests), and nothing in web.
- **Scan the rows to delete for text a tool reads.** One doc block carried `@public S2a`, which knip reads to allow an unused export. Its review downgraded it, so it stayed, but nothing in the method guaranteed that.
- **A suppression or directive row is kept, and a comment that is the whole body of a `catch` is structure**, since deleting it leaves an empty block the lint refuses.
- **Line numbers in the TSV go stale after each apply.** The tool relocates rows by text, so later units still apply, but a filed row's line is where the comment stood before the sweep.

## When it does not apply

A narration row needs no second read: deleting a comment that says what the code says loses nothing. The reviewer's cost is spent only on `held` rows.
