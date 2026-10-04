---
title: "cloc counts the lines between two glob strings in a JS config as a block comment"
date: 2026-10-04
category: integration-issues
module: repository
problem_type: integration_issue
component: development-workflow
severity: low
symptoms:
  - "check:gates fails on comment-density: the-root-tool-configuration source: 0.10 comment lines per code line, over the 0.10 ceiling"
  - "The change that tripped it added one plain string to an array and no comment"
  - "Removing that one line makes the gate pass again"
root_cause: wrong_api
resolution_type: config_change
framework_version: "cloc 2.06"
tags:
  - cloc
  - comment-density
  - jscpd
  - check-gates
  - glob
  - tool-config
retire_when: "A cloc release counts a JavaScript string holding /** and */ as code. Check by running the repo's cloc over a file whose array holds \"a/**\", a plain entry, then \"**/b/**\": two comment lines means the trap still holds."
---

# cloc counts the lines between two glob strings in a JS config as a block comment

## Problem

The comment-density gate counts comments with cloc, and cloc does not know where a JavaScript string starts or ends. A glob such as `"apps/web/src/shared/ui/**"` holds `/**`, which cloc reads as the start of a block comment, and the next glob such as `"**/lifts/**"` holds `*/`, which ends it. Every line between the two is counted as a comment line, though each is a plain string.

## Symptoms

- `pnpm run check:gates` fails on `comment-density` with `the-root-tool-configuration source: 0.10 comment lines per code line, over the 0.10 ceiling`.
- The change that set it off added a code line and no comment: one string, `"apps/web/src/features/people/audit-acts.ts"`, in the `ignore` array of `jscpd.config.mjs`.
- Taking that one line out makes the gate pass, and putting it back fails it.

## What Didn't Work

- Reading the failure as a real comment. The diff held no comment, so there was nothing to delete.
- Reading it as a rounding edge that one more code line would clear. Adding a code line should lower the ratio, but here it raised it, which is what pointed at the counter.

## Solution

Put the new entry where cloc cannot read it as inside a comment: above the first entry whose string holds `/**`. In `jscpd.config.mjs` that is the top of the `ignore` list:

```js
ignore: [
  "apps/web/src/features/people/audit-acts.ts",

  "apps/web/src/shared/ui/**",

  "**/lifts/**",
```

The same entry placed after `"apps/worker/src/better_answers_worker/schema_view.py"`, between `"**/lifts/**"` and `"**/node_modules/**"`, failed the gate.

## Why This Works

The gate runs cloc (`clocArgv` in `packages/devtools/src/comment-density.ts:62`) over the root tool configuration files, which the gates script names as one unit: `commitlint.config.mjs`, `cubic.yaml`, `jscpd.config.mjs`, `knip.config.ts`, `lefthook.yml` and `pnpm-workspace.yaml`. cloc strips C-style comments by pattern, not by parsing the language, so `/**` and `*/` inside string literals count. Run directly, cloc 2.06 reports two comment lines for this file:

```js
export const c = {
  ignore: [
    "a/**",
    "plain/entry.ts",
    "**/b/**",
  ],
};
```

and one when `"plain/entry.ts"` comes first. A line placed above the first `/**` glob is outside every span cloc reads as a comment, so it counts as code, as it should.

## Prevention

- When the comment-density gate fails on a root tool configuration file and the diff adds no comment, look for glob strings with `/**` or `*/` around the lines you added before you look for a comment to delete.
- In `jscpd.config.mjs`, `knip.config.ts` and the other files of that unit, add a plain entry above the first `/**`-shaped glob in its list, or next to another plain entry outside the glob spans.
- Do not raise the ceiling or add a comment to rebalance the ratio. The miscount is in where the line sits, and moving the line fixes it.

## Related

- `docs/solutions/architecture-patterns/adr-0045-coding-rule-is-one-imperative.md` names the density ceiling as the volume backstop and the only gate on a configuration file's comments.
- Found while adding the generated audit action list to the duplication gate's ignore list on branch `feat/audit-log-rebuild-and-words` (BA-49); its pull request was not yet open when this was written.
