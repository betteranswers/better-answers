# Issue tracker: Linear

Issues live in Linear: workspace `tw-group`, team `better-answers` (ids `BA-N`), project `better-answers`. Reach it through the `linear-server` MCP. In Claude Code its tools are deferred, so load them with `ToolSearch` (`select:mcp__linear-server__save_issue,mcp__linear-server__get_issue,mcp__linear-server__list_issues`) before the first call.

---

## What an issue is for

- **The backlog.** Work that is known but not yet planned.
- **A finding put off for later.** A review, a gate or a mutation run finds something that does not belong in the change at hand. It becomes one issue, with no plan and no spec until it is picked up.

An issue is not the unit of build work: a plan in `docs/plans/` is. An issue that gets built gets a plan (`/ce-plan`), and the pull request that lands it says `Fixes BA-N` in its description.

## States

| State | Meaning |
|---|---|
| Triage | New, and not yet looked at by the owner. An agent files a new issue here. An issue waiting on an answer stays here, with the question in a comment |
| Backlog | Held. The description's opening lines say what it waits on: an upstream release, a route block, an owner action |
| Todo | Ready to build. Unassigned means an agent may take it; assigned to the owner means it is theirs |
| In Progress, In Review | Being built; In Review once its pull request is open |
| Done | Its pull request merged |
| Canceled | Will not be done. A comment gives the reason |
| Duplicate | Folded into the issue it duplicates |

## Filing an issue

Create it with `save_issue`: `team: better-answers`, `project: better-answers`, `state: Triage`, a priority, and one of the workspace's `product` labels: `feature`, `bug` or `improvement`.

**The title** takes the commit's form (`docs/agents/workflow.md`, *The commit's form*): `type(scope): summary`, 72 characters at most, the summary imperative and lower-case with no full stop. The title names no issue id, and the detail goes in the description. Check one before it is written: `printf '%s\n' "<title>" | pnpm exec commitlint`.

**The description** has these sections:

```markdown
## Goal
What this issue accomplishes.

## Acceptance Criteria
- [ ] Criterion one
- [ ] Criterion two

## Notes
Anything that doesn't fit elsewhere.
```

Progress goes in comments, one per landing. A dependency is a Linear relation (`blockedBy`), not a line in the description. The route block an issue belongs to (`S2`, `S4` …) is named in its Goal or Notes.

## The tasks before Linear

Until 30/09/2026 the tracker was ordna, and code, docs and commits cite its tasks as `T-nnn`. The tasks stay in git as blobs at `refs/ordna/tasks/<id>`. A fresh clone does not fetch them, so read one like this:

```bash
git fetch origin '+refs/ordna/tasks/*:refs/ordna/tasks/*'
git cat-file -p refs/ordna/tasks/T-123
```

The eleven tasks still open on 30/09/2026 moved to Linear as BA-11 to BA-21. Each description opens with `Migrated from ordna T-nnn`, so a Linear search for the `T-nnn` finds it, and each ordna task is archived with a line naming its `BA-N`. Nothing writes to the ordna refs any more.
