# Issue tracker: Linear

Issues live in Linear: workspace `tw-group`, team `better-answers` (ids `BA-N`), project `better-answers`. Reach it through the `linear-server` MCP. In Claude Code its tools are deferred, so load them with `ToolSearch` (`select:mcp__linear-server__save_issue,mcp__linear-server__get_issue,mcp__linear-server__list_issues`) before the first call.

---

## States

| State | Meaning |
|---|---|
| Triage | New, and not yet triaged. New issues start here. The owner or an agent then moves it through the workflow states |
| Backlog | Held. The description's opening lines say what it waits on |
| Todo | Ready to build |
| In Progress, In Review | Being built; In Review once its pull request is open |
| Done | Its pull request merged |

## Filing an issue

Create it with `save_issue`: `team: better-answers`, `project: better-answers`, `state: Triage`, a priority, and the relevant team issues `route-block` label e.g., `S1`, `S2`, `S3` etc.

**Description format:**

```markdown
## Goal
What this issue accomplishes.

## Acceptance Criteria
- [ ] Criterion one
- [ ] Criterion two

## Notes
Anything that doesn't fit elsewhere.
```

Progress goes in comments, one per landing. A dependency is a Linear relation (`blockedBy`), not a line in the description.
