# Issue tracker: ordna, with a discovery lane in `.scratch/`

This repo runs **two lanes**, and a skill must know which one it is in.

| Lane | Where | What lives there | Who writes it |
| --- | --- | --- | --- |
| **Build queue** | ordna — git blobs at `refs/ordna/tasks/<id>` | Tasks that produce code: `T-001`, `T-002`, … | `/to-tickets`, `/triage`, humans |
| **Discovery** | `.scratch/<effort>/` markdown | The wayfinder map and its research · prototype · grilling tickets | `/wayfinder`, `/research`, `/prototype` |

A discovery ticket asks *what should we build*. An ordna task says *build this*. Discovery output becomes a spec; a spec becomes ordna tasks. Never the reverse.

GitHub Issues on `betteranswers/better-answers` is **not** the work queue. It is the inbound surface from the public and from bots (Renovate, Dependabot). An inbound issue worth doing is copied into ordna and the GitHub issue is closed with a pointer.

---

## The build queue — ordna

`.ordna/config.yaml` sets `storage: namespace`. **There are no task files on disk.** `cat tasks/T-001.md` will fail — `tasks/` holds only `AGENTS.md`, the ordna guide. Every read and write goes through the CLI.

```bash
ordna list                       # the board
ordna list -s todo               # filter by status, -a assignee, -t tag
ordna show T-003                 # frontmatter + body to stdout
ordna create "Title…" -p high -t build -d T-002
ordna move T-003 doing           # todo → doing → done
ordna assign T-003 liam-jons
ordna commit -m "tasks: …"       # explicit; never auto-runs
```

Statuses are exactly `todo` · `doing` · `done`. Moving to `done` while any `depends_on` task is unfinished is **rejected by the CLI** — that is a real gate, not advice.

Full CLI and schema reference: `tasks/AGENTS.md`.

### When a skill says "publish to the issue tracker"

`ordna create` a task. Give it a `## Goal`, an `## Acceptance Criteria` checklist and `## Notes` naming the ADRs it touches — match the shape of `T-001`–`T-008`, which are the house style. Set `-d` for every task it genuinely depends on; the CLI enforces it later.

Acceptance criteria checkboxes are parsed structurally and are the source of truth for progress. Write them so each line is demonstrable by a test or a linked artefact (`AGENTS.md` § Working a task).

### When a skill says "fetch the relevant ticket"

`ordna show <id>`. The user normally passes the id. Do not grep `tasks/`.

### One task, one branch, one PR

`AGENTS.md` § Working a task is binding: take one task from ordna, one branch and one pull request per task; the PR closes when `check` is green and every acceptance line is demonstrated.

---

## The discovery lane — `.scratch/`

Used by `/wayfinder`, and read by `/to-spec`. The **map** is a file with one **child** file per ticket. `.scratch/v01-spec/` is the worked example — a map plus 85 numbered tickets — and its conventions are the ones below.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

Supporting artefacts alongside the map, following `v01-spec`: `research/` (findings), `briefings/` (a ticket's decisions gathered for a builder), `prototypes/` (throwaway code), `handoff-session-N.md` (session state).

`.scratch/` is git-ignored working material, not a deliverable. A decision that survives moves out — into `CONTEXT.md` for a word, `docs/adr/` for a decision, ordna for work. A `.scratch/` ticket is **not** authoritative once its decision has landed in an ADR; where the two disagree, the ADR wins.

## PRs as a request surface

Off. Pull requests are not part of the triage queue.
