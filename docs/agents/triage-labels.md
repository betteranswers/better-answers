# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## How a label is applied here

ordna has no label field. Labels are **tags**:

```bash
ordna create "Title…" -t needs-triage
ordna list -t ready-for-agent
```

Retagging an existing task means editing its `tags` list — ordna's CLI has no `tag` subcommand, so a retag goes through the task's frontmatter via `ordna` (or the TUI, `ordna board`). Keep the domain tags already in use (`gate`, `docs`, `build`, `ops`, `spike`, `licensing`) alongside the triage tag; they answer different questions.

`wontfix` is a tag, not a status — add the tag and then update the status to `archived`.
