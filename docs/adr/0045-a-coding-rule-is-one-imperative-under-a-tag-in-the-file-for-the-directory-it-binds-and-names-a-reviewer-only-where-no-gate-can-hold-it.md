---
status: accepted
date: 2026-09-22
---

# A coding rule is one imperative under a tag, in the file for the directory it binds, and it names a reviewer only where no gate can hold it

The rules files were founded on a short imperative form and drifted into narrative — enforcement bookkeeping, mechanism description, ticket history. An agent writes what it sees, and that voice ran through the code.

## The form

A rule is a tagged heading with an imperative title, a body, an optional `Reviewer:` line, and a BAD/GOOD snippet where code says it faster than words. Eighty words of prose a rule, snippets free, with a shrink-only exception list; two and a half thousand in the root file. Outside a snippet a rules file names identifiers only: a ticket, a date and a decision are read where each is kept.

A rule lives in the file for the directory it binds: the root file, one per workspace, one beside the deploy configuration.

## Who holds a rule

The `Reviewer:` line is the one marker of a holder, written only where no mechanism could catch a breach on the way in: a judgement about depth, an oracle, a comment's intent. Where a gate could exist and does not, the gap is a ticket and no sentence. A rule states what it asks for, not which gate catches a breach — the gate prints the tag in the message a reader hits.

A tag is written in three places: a rules file, a review finding, a gate's failure message.

## Holders and review

`apps/api/tests/coding-rules-form.test.ts` holds the form and `coding-rules-tags.test.ts` the three places, each proving its parser on fixture text. The comment gates hold the same bans inside code, and this repository's review pass read the new text.

## Amendment — 2026-09-24, the comment gates are one lint config (T-384)

The TypeScript comment gates are now one lint config, `.oxlintrc.json`. So `pnpm lint`, the pre-commit hook and an editor all show a breach as it is written. The separate comment-gate config is gone.

- **Stock rules first.** oxlint refuses `@ts-ignore`, a bare `@ts-expect-error`, a TODO and a blanket disable. `--report-unused-disable-directives` refuses a disable that suppresses nothing. In the worker, ruff's stock rules do the same.
- **One custom comment rule.** `comment-only-the-why` keeps the 25-word cap and the citation ban. A doc block on an exported function may run to 50 words. A disable needs a reason, and the reason counts against the cap.
- **The string check is its own rule**, `string-cites-nothing`, because it polices text a person reads, not comments.
- **A `.py`-only Python gate** holds the same caps in Python and nothing else.
- **The density ceiling** stays as the volume backstop. It is the only gate on a config file's comments.

The complexity cap and the test-title rule go into the same config as stock rules.
