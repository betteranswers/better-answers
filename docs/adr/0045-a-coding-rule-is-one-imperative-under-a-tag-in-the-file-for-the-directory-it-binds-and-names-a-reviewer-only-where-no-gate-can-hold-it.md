---
status: accepted
date: 2026-09-22
---

# A coding rule is one imperative under a tag, in the file for the directory it binds, and it names a reviewer only where no gate can hold it

The rules files were founded on a short imperative form and drifted into narrative — enforcement bookkeeping, mechanism description, ticket history. An agent writes what it sees, and the same voice ran through the code.

## The form

A rule is a tagged heading with an imperative title, a body, an optional `Reviewer:` line, and a BAD/GOOD snippet where code shows the rule faster than words. Eighty words of prose a rule, snippets free, with a shrink-only exception list; two and a half thousand in the root file. Outside a snippet a rules file names identifiers only: a ticket, a date and a decision are read where they are kept.

A rule lives in the file for the directory it binds: the root file, one per workspace, one beside the deployment configuration.

## Who holds a rule

The `Reviewer:` line is the one marker of a holder, written only where no mechanism can exist: a judgement about depth, an oracle, a comment's intent. Where a gate could exist and does not, the gap is a ticket and no sentence. A rule states what it asks for, not which gate catches a breach — the gate prints the tag in the message a reader hits.

A tag is written in three places: a rules file, a review finding, a gate's failure message.

## Holders and review

`apps/api/tests/coding-rules-form.test.ts` holds the form and `coding-rules-tags.test.ts` the three places, each proving its parser on fixture text first. The comment gates hold the same bans inside code, and the repository's own review pass read the new text as its standard.
