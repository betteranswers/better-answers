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

A rule that binds every workspace is a bullet in the root `CODING_STANDARDS.md`. A rule that binds one directory is a bullet in that directory's `AGENTS.md`, and a `CLAUDE.md` beside it holding `@AGENTS.md` loads it when work reaches the directory. Today those directories are `apps/api/`, `apps/web/`, `apps/worker/`, `deploy/`, `packages/core/` and `packages/schema/`.

**What gets written down.**

- A rule is written down only when no gate, type or test holds it. Where one does, the gate's failure message states the rule and its fix on its own, and names no file. The prose goes.
- General engineering judgement (module depth, where to validate, what a test asserts) is not restated. The pstack principle skills carry it, and load when the work calls for them.
- What an agent cannot derive from the tree stays, but never as a comment. A security or audit invariant stays as a grant, a revoke, a CHECK or a test. A trap is reshaped away. A product or legal requirement stays as a test whose title states it, or in `docs/solutions/`. A tier's ownership boundary is the `import-direction` lint and the table-ownership scan.
- Where a gate could hold a written rule and does not yet, building the gate and deleting the rule is the preferred fix.

**What a comment holds.** A comment stays only for a constraint outside this repository (a library, platform or protocol), a public contract, a generated-file marker, a license, or a suppression's reason. A comment about this repository's own code goes once a name, a type, a test, a grant or a lint holds its reason. Hand-written migration SQL is outside these rules: an applied migration is never edited, and its comments are the only prose beside a `REVOKE`, a `PARTITION BY` or a definer function.

**Inside code, the comment rules are held by:**

- one oxlint config, `.oxlintrc.json`: stock rules, `comment-only-the-why`, and the string check `string-cites-nothing`;
- in Python, ruff's stock rules and a `.py`-only gate, `packages/devtools/python/comment_gate.py`;
- the density ceiling, `packages/devtools/src/comment-density.ts`;
- the comment inventory, `pnpm comment-inventory`, the one deleter of a comment whose reason moved. It refuses to delete a comment whose named holder is not in the tree.

## Why

- Every session, and every agent it spawned, read the root file and the workspace files in full, about 420 lines. Most of it restated a gate that already refuses the breach, or a principle a frontier model applies unprompted. That text cost context on every turn and taught nothing.
- A rule beside its directory loads only when work reaches that directory.
- A gate message that points at a file breaks when the file's prose is cut. A message that states the rule stands on its own.
- With one lint config, `pnpm lint`, the pre-commit hook and an editor all show a breach as it is written.
- `string-cites-nothing` is its own rule because it polices text a person reads, which is not a comment.
- The density ceiling is the volume backstop for each workspace's TypeScript and Python. No gate reads a config file's comments; review holds them.
- Nothing checks a comment that states an invariant, so it drifts from the code unseen. A grant, a CHECK or a test fails when the code drifts from it. A comment deleted by hand can take with it a reason that nothing else holds, so one tool deletes, and only once the holder exists.

## History

The full record, with its one amendment (T-384): `docs/archive/adr/0045-coding-rule-is-one-imperative.md`.

Amended 12/10/2026 by the comment gates plan (`docs/plans/2026-10-12-1241-chore-one-holder-per-comment-rule-plan.md`, KTD5). The density ceiling measures workspaces only, so a config file, a shell script and a migration have no comment gate. The Claude Code hook that re-ran the comment gates on each written file is removed; the pre-commit hook now runs the Python gate and lints root scripts.

Amended 16/10/2026 on the move from Compound Engineering to pstack. The rules files were cut to what no gate holds, the `Reviewer:` line and the per-rule form were dropped, the directory files became `AGENTS.md`, `packages/core/` and `packages/schema/` gained one each for the audit and row-level-security rules, and gate messages stopped naming the root file.

Amended 16/10/2026 by the comment sweep's pilot over `packages/schema/src`. What an agent cannot derive from the tree no longer stays as a comment. A grant, a revoke, a CHECK, a test, a lint, a scan or `docs/solutions/` holds it. A comment stays only for a constraint outside the repository, a public contract, a generated-file marker, a license or a suppression's reason, and `pnpm comment-inventory` is the one deleter of a comment whose reason moved. The pilot found two comments standing where a gate should. One said the platform never deletes a `user` row, while `app_rt` holds `DELETE` on `public.user` (Linear BA-191). The other said the contract digest's length prefix stops a forged file boundary, and no test held that until `packages/schema/test/contract-digest.test.ts`.
