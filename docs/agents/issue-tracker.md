# Issue tracker: Ordna

Issues live as Ordna tasks - git blobs at `refs/ordna/tasks/<id>`.

---

## The `ordna` CLI

`.ordna/config.yaml` sets `storage: namespace`. **There are no task files on disk.** Use the CLI (`ordna show T-001`, `ordna list`, `ordna create`, etc.) for everything — direct file access is not possible.

| Command                                  | What it does                                                       |
|------------------------------------------|--------------------------------------------------------------------|
| `ordna list` / `ordna ls`                | List tasks. Filter with `-s <status>`, `-t <tag>`. |
| `ordna show <id>`                        | Print a task's frontmatter + body to stdout.                       |
| `ordna create <title…>`                  | Create a task. See options below.                                  |
| `ordna move <id> <status>`               | Move a task. Rejected if `done` and any `depends_on` task isn't done. |
| `ordna commit -m "tasks: ..."`                  | Explicit; **Never auto-runs.**              |

### IDs

IDs have 3-digit padding with prefix `T` → `T-001`, `T-002`, …, `T-1000`. Each new task is auto-incremented from the highest existing numeric ID. Merge conflicts on IDs are resolved by the developer — Ordna does not renumber files.

### `ordna create` options

| Command | Options |
|---|---|
| -p, --priority | <high|medium|low> |
| -t, --tag <tag...> | one or more tags |
| -d, --depends-on <id...> | one or more dependency IDs |
| -s, --status <status> | <todo|doing|done> |

### Examples

```bash
ordna create "Implement payment flow" -p high -t payments
ordna create "Write tests" -d T-001              # depends on T-001
ordna list -s todo
ordna move T-001 doing
ordna show T-001
ordna commit -m "tasks: progress on T-001"
```

### Editing a body: origin first

The CLI has no edit command, and `ordna web` / `ordna board` auto-fetch `refs/ordna/*` from origin every minute, **overwriting any local ref origin disagrees with**. A body edit that only touches the local ref is silently reverted within a minute while a board is open. So the order is: write the blob, push it to origin, then set the local ref, then re-read.

```bash
git cat-file -p refs/ordna/tasks/T-004 > /tmp/T-004.md      # edit this; bump updated_at
oid=$(git hash-object -w /tmp/T-004.md)
git push --force origin "$oid:refs/ordna/tasks/T-004"        # origin FIRST
git update-ref refs/ordna/tasks/T-004 "$oid"
ordna show T-004                                             # confirm the edit is what the CLI reads
```

`ordna create` and `ordna move` write the local ref only; push it by hand the same way (`git push origin refs/ordna/tasks/T-030`) or the next fetch will not delete it but no other clone will see it. Two sessions editing the same task race on origin; re-read before writing.

`ordna move` fails silently about one time in ten. Read the status line back — `ordna show T-nnn | sed -n 2p` — after every move and before its push.

### When a skill says "publish to the issue tracker"

`ordna create` a task. Give it a `## Goal`, an `## Acceptance Criteria` checklist and `## Notes`. Set `-d` for every task it genuinely depends on; the CLI enforces it later.

**Body sections:**

```markdown
## Goal
What this task accomplishes.

## Acceptance Criteria
- [ ] Criterion one
- [ ] Criterion two

## Notes
Anything that doesn't fit elsewhere.

## Progress
Append-only log of what has happened so far.
```

The `Acceptance Criteria` checkboxes (`- [ ]` / `- [x]`) are the source of truth for AC progress — they are parsed structurally.

### When a skill says "fetch the relevant ticket"

`ordna show <id>`. The user normally passes the id.
