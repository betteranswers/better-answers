---
title: "Cubic writes into pull request bodies, and those bodies become merge commits on main"
date: 2026-10-06
category: integration-issues
module: repository
problem_type: integration_issue
component: development-workflow
symptoms:
  - "A 'Summary by cubic' block, a 'Review in cubic' link and a 'Turn on auto-fix' link appear in a pull request body the author wrote"
  - "The same block lands in the merge commit's body on main"
  - "The block still appeared after pr_descriptions.generate was set to false and the dashboard showed it off"
  - "Cubic's check completed neutral, so arm-merge.yml did not arm the merge"
root_cause: config_error
resolution_type: config_change
severity: medium
retire_when: "Cubic documents that pr_descriptions.generate: false alone stops every edit to a pull request body; check a new pull request opened after a cubic.yaml change with only generate set to false"
tags:
  - cubic
  - pull-request-body
  - merge-commit
  - pr-descriptions
  - arm-merge
  - merge-queue
  - draft
---

# Cubic writes into pull request bodies, and those bodies become merge commits on main

## Problem

The repository merges with `merge_commit_message=PR_BODY`, so a pull request's body is the merge commit's body on `main`. Cubic edited bodies after their authors wrote them, appending its own summary and links, and that text went into `main`'s history. Turning it off took two `cubic.yaml` changes, not one. The setting that sounds sufficient, `pr_descriptions.generate: false`, was not.

## Symptoms

- A body the author wrote gained a block between `<!-- This is an auto-generated description by cubic. -->` markers: a "Summary by cubic" section, a "Review in cubic" link and a "Turn on auto-fix" link.
- 55 of the 80 merge commits on `main` before 06/10/2026 carried it.
- Draft #589, opened after #587 had merged `generate: false`, still got the full block. Cubic's dashboard showed the generate row as off, from YAML.
- #592, opened 7 minutes after #591 merged the second change, got the two links but no summary.

## What Didn't Work

- **Changing `cubic.yaml` on the pull request that needs it.** Cubic reads `cubic.yaml` from the default branch only (its configuration docs), so a change takes effect only on pull requests opened after it merges.
- **`pr_descriptions.generate: false` alone** (#587). The summary kept arriving on #589. The cause was not found: the dashboard read the YAML, so the file parsed.

## Solution

All three `pr_descriptions` keys are set, in `cubic.yaml:138-141`:

```yaml
pr_descriptions:
  generate: false
  cubic_review_link: false
  skip_if_author_description: true
```

`cubic_review_link: false` (#591) removes the link block, the only `pr_descriptions` setting that was still on. `skip_if_author_description: true` is a second guard. Every pull request an agent opens has a body the author wrote, because `AGENTS.md` (*Workflow*) states the form `ce-commit-push-pr` writes. After #591 merged, #593 was opened with an authored body and got no Cubic block at all.

**To keep one pull request's body clean** while the config change is still landing, or when a block has already appeared:

1. Open it as a draft. `arm-merge.yml:37` arms only a pull request that is not a draft, and `cubic.yaml:9` sets `check_drafts: false`.
2. Replace the body with `gh pr edit <n> --body-file <file>`. On #589, Cubic did not re-add the block after the body was replaced, on a new head or when the pull request was marked ready.
3. Mark it ready, then watch the body until the queue merges it.

## Why This Works

Cubic's description feature has three switches, and the link block is governed by `cubic_review_link`, not by `generate`. Cubic's schema describes `cubic_review_link` as "Include a link to review the PR in cubic", separate from generation. With the link off and generation off, Cubic has nothing to append. `skip_if_author_description` covers a new pull request on a path where generation is somehow still active. Whether `issues.fix_with_cubic_buttons` drives the "Turn on auto-fix" link was not established. #592's links came only minutes after #591 merged, so they may also reflect config propagation.

## Prevention

- **Expect a neutral Cubic check on any pull request, and arm by hand.** Cubic's check completed neutral on all four pull requests that day: #587, #591, #589 and #593. `arm-merge.yml:41` arms only on `success`, so none was armed automatically. `docs/agents/workflow.md` (*Merging*) names two causes, an exhausted allowance and a rewritten branch, but neither was confirmed here. #593 changed a source file outside Cubic's ignore list and was still neutral. Arm with `gh pr merge <n> --auto --merge` once checks are green and no thread is open.
- **Land a `cubic.yaml` change in its own pull request first**, and check its effect on the next pull request opened after the merge, never on its own.
- **Read a merge commit's body on `main` after merging** when the form of bodies matters: `git log -1 --format=%b origin/main`.

## Related Issues

- `AGENTS.md`, *Workflow*: the pull request body form this protects.
- `docs/agents/workflow.md`, *Merging*: arming by hand when Cubic's check is neutral.
- `docs/agents/code-review.md`: Cubic's ignore list and allowance.
