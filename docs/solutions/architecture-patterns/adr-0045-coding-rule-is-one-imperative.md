---
title: "A coding rule is written down only where no gate holds it, beside the code it binds"
date: 2026-09-24
module: repository
problem_type: architecture_pattern
component: development-workflow
severity: medium
applies_when:
  - "Adding or editing a rule in `CODING_STANDARDS.md` or a directory's `AGENTS.md`"
  - "Adding a gate, or a gate's failure message"
  - "Writing a comment, a docstring or a lint suppression, or changing the comment gates"
tags:
  - adr-0045
  - coding-standards
  - comment-gate
  - oxlint
---

# A coding rule is written down only where no gate holds it, beside the code it binds

## The decision

A rule that binds every workspace is a bullet in the root `CODING_STANDARDS.md`. A rule that binds one directory is a bullet in that directory's `AGENTS.md`, which loads when work reaches the directory. Today those directories are `apps/api/`, `apps/web/`, `apps/worker/`, `deploy/`, `packages/core/` and `packages/schema/`.

**What gets written down.**

- A rule is written down only when no gate, type or test holds it. Where one does, the gate's failure message states the rule and its fix on its own, and names no file. The prose goes. A written rule states what it asks for and names no gate.
- General engineering judgement (module depth, where to validate, what a test asserts) is not restated. The pstack principle skills carry it, and load when the work calls for them.
- What an agent cannot derive from the tree stays, but never as a comment. A security or audit invariant stays as a grant, a revoke, a CHECK or a test. A trap is reshaped away. A product or legal requirement stays as a test whose title states it, or in `docs/solutions/`. A tier's ownership boundary is the `import-direction` lint and the table-ownership scan.
- Where a gate could hold a written rule and does not yet, building the gate and deleting the rule is the preferred fix.

**What a comment holds.** A comment stays only for a constraint outside this repository (a library, platform or protocol), a public contract, a generated-file marker, a license, or a suppression's reason. A public contract is a doc block on an export another workspace imports that states a precondition, postcondition, unit or error the signature cannot express. Every comment, a doc block or docstring included, is 25 words at most. A comment or docstring cites nothing. A ticket id, an ADR number, a rule tag or a date in one is refused, and both tiers read the patterns from `contracts/citation/cases.json`. A lint disable or suppression gives its reason on the same line, the reason counts against the 25 words, and a disable with no reason is refused. A comment about this repository's own code is deleted; its reason moves to a name, a type, a test, a grant or a lint, or is reported open in the tracker. Hand-written migration SQL is outside these rules: an applied migration is never edited, and its comments are the only prose beside a `REVOKE`, a `PARTITION BY` or a definer function.

**Inside code, the comment rules are held by:**

- one oxlint config, `.oxlintrc.json`: stock rules, `comment-only-the-why`, and the string check `string-cites-nothing`. The stock rules refuse `@ts-ignore`, a `@ts-expect-error` with no reason, a TODO, FIXME or XXX, and a disable that names no rule;
- in Python, ruff's stock rules and a `.py`-only gate, `packages/devtools/python/comment_gate.py`. The stock rules refuse a blanket `noqa` or `type: ignore`, and a TODO, FIXME, XXX or HACK;
- a disable that suppresses nothing, refused by `--report-unused-disable-directives-severity=error` on every `lint` script and the pre-commit hook, and by ruff's `RUF100`;
- the density ceiling, `packages/devtools/src/comment-density.ts`;
- the comment inventory, `pnpm comment-inventory`, the one deleter of a comment about this repository's code. It refuses a held comment whose named holder is not in the tree, and deletes an open one whose row names the tracker issue its reason went to.

Two stock rules hold code beside comments. oxlint's `complexity` and ruff's `C901` hold every function to 8, in the worker and the devtools ruff config alike. A test title is 10 words at most and never says "should". oxlint's `vitest/valid-title` holds a literal title, and a setup file holds a title built when the test runs. No file is exempt from either.

## Why

- Every session, and every agent it spawned, read the root file and the workspace files in full, about 420 lines. Most of it restated a gate that already refuses the breach, or a principle a frontier model applies unprompted. That text cost context on every turn and taught nothing.
- A rule beside its directory loads only when work reaches that directory.
- A gate message that points at a file breaks when the file's prose is cut. A message that states the rule stands on its own.
- With one lint config, `pnpm lint`, the pre-commit hook and an editor all show a breach as it is written.
- `string-cites-nothing` is its own rule because it polices text a person reads, which is not a comment.
- The density ceiling is the volume backstop for each workspace's TypeScript and Python. No gate reads a config file's comments; review holds them.
- Nothing checks a comment that states an invariant, so it drifts from the code unseen. A grant, a CHECK or a test fails when the code drifts from it. A comment deleted by hand can take with it a reason that nothing else holds, so one tool deletes, and only once the holder exists or the reason is open in the tracker. A comment kept until its holder lands is a reason no gate checks, for as long as the holder waits.

## History

The full record, with its one amendment (T-384): `docs/archive/adr/0045-coding-rule-is-one-imperative.md`.

Amended 12/10/2026 by the comment gates plan (`docs/plans/2026-10-12-1241-chore-one-holder-per-comment-rule-plan.md`, KTD5). The density ceiling measures workspaces only, so a config file, a shell script and a migration have no comment gate. The Claude Code hook that re-ran the comment gates on each written file is removed; the pre-commit hook now runs the Python gate and lints root scripts.

Amended 16/10/2026 on the move from Compound Engineering to pstack. The rules files were cut to what no gate holds, the `Reviewer:` line and the per-rule form were dropped, the directory files became `AGENTS.md`, `packages/core/` and `packages/schema/` gained one each for the audit and row-level-security rules, and gate messages stopped naming the root file.

Amended 16/10/2026 by the comment sweep's pilot over `packages/schema/src`. What an agent cannot derive from the tree no longer stays as a comment. A grant, a revoke, a CHECK, a test, a lint, a scan or `docs/solutions/` holds it. A comment stays only for a constraint outside the repository, a public contract, a generated-file marker, a license or a suppression's reason, and `pnpm comment-inventory` is the one deleter of a comment whose reason moved. The pilot found two comments standing where a gate should. One said the platform never deletes a `user` row, while `app_rt` holds `DELETE` on `public.user` (Linear BA-191). The other said the contract digest's length prefix stops a forged file boundary, and no test held that until `packages/schema/test/contract-digest.test.ts`.

Amended 18/10/2026 by the owner's ruling on the comment sweep, which had kept a comment about this repository's own code until a structure held its reason. That comment is now deleted, and its reason is reported open in the tracker (BA-195 to BA-199) until a name, a type, a test, a grant or a lint holds it. The 50-word allowance for a doc block on an exported core or schema function, and for a public worker function's docstring, is gone.

Earlier changes also overturned rules of the record. The rule-names plan (`docs/plans/2026-10-02-2253-chore-rule-names-in-words-plan.md`) removed the rule tags, so a tag is no longer written in a rules file, a review finding and a gate's message, and a rule tag in a comment is now a refused citation. `apps/api/tests/coding-rules-form.test.ts` and `coding-rules-tags.test.ts` were deleted on 29/09/2026, before the form they held was dropped. The record's rule that a missing gate is a ticket and no sentence gave way to the cut of 16/10/2026, which lets a written rule stand until its gate exists. The stock rules' refusals, the unused-disable refusal, the citation ban, a disable's reason, the complexity cap, the test-title rule, the empty exemption lists and the rule that names no gate were missing from this doc until 20/10/2026 (BA-215). On 20/10/2026 every directory's `CLAUDE.md` was deleted except `deploy/`'s, so this doc no longer says one loads each `AGENTS.md`.
