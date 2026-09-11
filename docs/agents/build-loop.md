# The build loop: ralph over a block's tickets

How a block of the route (`docs/specs/v01-route.md`) is built by agents to this repo's standards. One session **orchestrates**; **ralph** runs one ticket at a time as a work → test loop over fresh child agents; the **verifier** signs the ticket off against its acceptance criteria; the orchestrator lands it on the block branch. The agent files under `.claude/agents/` are short and point here; this page is the one place the rules live.

| Role | Agent | Model | Does |
| --- | --- | --- | --- |
| Orchestrator | the session | — | Picks from the frontier, briefs ralph, approves the plan, lands the ticket, moves the ordna task, opens the block PR |
| Ralph | `ralph` | opus, xhigh | Phase 1 turns the ticket into a plan with test commands; Phase 2 loops implementor → tester → evaluate until green |
| Implementor | `implementor` | opus, high (the brief may say sonnet for a small ticket) | Builds one iteration's focus inside the gates below; commits on the worktree branch |
| Tester | `implementor` on sonnet, or ralph itself | sonnet | Runs the plan's test commands and reports the output; changes nothing. Ralph may run the commands in its own foreground instead of spawning a tester — the commands are the arbiter either way, and it saves a child (T-120, 11/09/2026) |
| UI designer | `ui-designer` | opus, xhigh | The implementor for a ticket that lands a screen (T-136): the same gates, plus `/better-answers-design` and `/browser-suite` |
| Verifier | `verifier` | opus, xhigh | Evidence-driven pass over the ordna acceptance criteria and the gates; approves or lists what is missing |
| Reviewer | `pr-reviewer` | opus, xhigh | The block PR's review on two axes, standards and spec, while Cubic is paused |

## The shape

- **A block is one PR.** The block branch is named for the block — `s0`, `s1` — and cut from `main`. Tickets land on it as commits; the PR opens when the block's last ticket lands and the owner merges it. The route's status row flips to *building* in the block branch's first commit and to *done* in the PR's last.
- **A ticket is one worktree.** Ralph is spawned with `isolation: "worktree"` while the main checkout sits on the block branch, so the worktree is cut from the block's tip. The hooks provision it (`pnpm install`, the skills, the tracker guide). Nothing is committed in the main checkout during a ticket except landings and a rules-page correction between tickets.
- **Ralph stays awake by its own watcher.** A subagent is not resumed when its child finishes (T-120 stalled twice on this, 10/09/2026), so ralph never ends its turn with a child running: it arms a background shell task on the worktree that exits when the branch has moved and gone quiet — that exit re-invokes ralph — or it runs the test commands itself. The orchestrator keeps a backstop watch and nudges a silent ralph by message; a message to a running ralph answers *already running*, which is the liveness check. **What quiet is not** (wave 2, 11/09/2026): a reading pass leaves no mtime for many minutes; a suite run writes outside the worktree and under `node_modules`; and a process check must be scoped to this worktree's path or it counts another ticket's run. A truthful watcher exits on the success condition — the branch past its start commit and the tree clean for two minutes — and falls through on a long cap, never on silence alone.
- **The frontier** is every `todo` task in the block whose `depends_on` are all `done` — `ordna list -s todo`, then `ordna show` on each. Tickets on the frontier may run in parallel in separate worktrees, with one exception below.
- **Migrations serialise.** A ticket that adds a migration or bumps `contract_version` runs alone until it lands; the drizzle journal and the contracts manifest do not merge. In S0 and S1 that is T-120, then T-127 and T-128 one after the other.
- **S1's branch is cut from `s0`** after T-120 lands, so S1's tickets that edge S0's can proceed while S0's PR waits; when S0 merges, `s1` rebases onto `main` and its PR follows.

## The orchestrator's steps, per ticket

1. Pick a ticket on the frontier. `ordna move T-nnn doing`, `ordna assign T-nnn ralph`, then push the ref: `git push origin refs/ordna/tasks/T-nnn` (`docs/agents/issue-tracker.md`).
2. Spawn `ralph` in a worktree with the brief below. Ralph answers with its plan and the question *approve?*
3. Read the plan against the ticket's acceptance criteria. Amend or approve by `SendMessage` to ralph. Ralph loops until green and reports.
4. Spawn `verifier` against the same worktree with the ticket id. *APPROVED* lands; anything else goes back to ralph as the next iteration's feedback.
5. **Land.** In the worktree: `git rebase <block>`, root `pnpm check` green, `detect_changes` clean. In the main checkout: fast-forward the block branch onto the worktree branch, `git push origin <block>`, `node .gitnexus/run.cjs analyze`. Remove the worktree.
6. Append the ticket's Progress entry — what landed, the suites, the measurement if the ticket records one — through the origin-first procedure, `ordna move T-nnn done`, push the ref.

## Ralph's plan: what the test commands are

Every acceptance line on an ordna task is demonstrable by a test or an artefact. The plan maps each line to one of:

| Line's kind | Command shape |
| --- | --- |
| A core or schema suite | `pnpm --filter @better-answers/core exec vitest run test/<file>.test.ts` (or `@better-answers/schema`) |
| An api suite | `pnpm --filter @better-answers/api exec vitest run tests/<file>.test.ts` |
| A worker suite | `cd apps/worker && uv run --frozen pytest tests/<file>.py` |
| A browser spec | `pnpm --filter @better-answers/web exec playwright test e2e/<file>.spec.ts` (the `/browser-suite` skill) |
| A document scan | `pnpm --filter @better-answers/api exec vitest run tests/coding-rules-tags.test.ts tests/adr-index.test.ts` |
| A recorded measurement or a docblock line | the file read and the line quoted |
| The workspace | its `check`; root `pnpm check` once, last |

The named suites are the loop's arbiter. Root `check` runs once at the end of the loop and again at landing; the whole suite mid-loop is waste.

## The gates every implementor obeys

- **Read first**: the ordna task (`ordna show`), the spec sections it names, `CODING_RULES.md` and the workspace's own rules file, the ADRs the task's Notes name. `CONTEXT.md`'s word for a thing is the name in code.
- **Navigation is jCodeMunch** (`AGENTS.md`, *Code Exploration Policy*): `resolve_repo` on the worktree, `index_folder` if it is not indexed; `Read` a file only to edit it.
- **GitNexus**: the index lives in the main checkout only (`.gitnexus/` is excluded per checkout and the runner is absent from a worktree), so `analyze` is the orchestrator's, at every landing. From a worktree the MCP tools read that index, which is at the block's tip: `impact` before editing any symbol that exists there — a symbol the ticket creates has no caller to report — and `detect_changes` before every commit with the worktree's absolute path passed explicitly. HIGH or CRITICAL risk is reported to ralph before the edit, never absorbed.
- **Words before code, records with code** (`[GLOSSARY1]`): a new domain word lands in `CONTEXT.md` before code names it; an ADR amendment and its `docs/adr/README.md` row land in the same commit as the code they record; a contract fixture lands with its manifest entry and `contract_version`.
- **Tests as the constitution says** (`[TEST1]` to `[TEST9]`): real Postgres, our own code never mocked, factories, pairs both ways, expected values as literals. `/mattpocock-skills:tdd` at the seams the ticket names; `/mattpocock-skills:implement` is the process.
- **The tier's skills**: `apps/api/.claude/skills/` for any tRPC procedure, link or adapter; `/hono`; `/cocoindex` for the pipeline; `/browser-suite` for a spec under `apps/web/e2e/`; `/better-answers-design` for anything a person looks at; `/writing-react-effects` and `/react-hook-form-writer` in the web; the privacy skills for the seam.
- **Commits**: `git status` first, stage by path, one message in the repo's prose shape — what landed and why, the tests it adds, the ticket id in brackets at the end — and the attribution line the session carries. Commit on the worktree branch; never on `main` or the block branch.
- **Scope**: the ticket and nothing beside it. A finding outside the ticket is one line in ralph's report, which the orchestrator turns into a hygiene task.

## Review while Cubic is paused

Cubic's plan limit is reached (10/09/2026), so the PR loop in `docs/agents/code-review.md` is paused. The substitute:

- Per ticket: `/mattpocock-skills:implement` ends with `/code-review`, and the verifier's pass is the second pair of eyes.
- Per block: before the PR opens, `/mattpocock-skills:code-review` on the block branch since `main`, then `pr-reviewer` on the PR. Findings are fixed in one commit per round, three rounds at most, as the Cubic loop says.

## The brief the orchestrator gives ralph

```
Ticket: T-nnn (ordna show T-nnn). Block: s0. Block branch tip: <sha>.
Spec: docs/specs/<block>.md — the sections the ticket names.
Edges done: T-… (what each landed, one line).
Rules: docs/agents/build-loop.md.
Models: implementor opus | sonnet; tester sonnet | ralph itself.
Task note: /abs/path/to/main-checkout/.scratch/build/T-nnn.md (the main checkout's, absolute — the worktree is removed at landing).
Anything the orchestrator already knows the loop will hit: <one line each>.
```

## The task note

Ralph keeps the main checkout's `.scratch/build/T-nnn.md` (git-ignored; the brief gives the absolute path) with five sections — **Plan**, **Test commands**, **Current iteration**, **Test feedback**, **Iteration history** — and rewrites it after every iteration. Child agents read it and never the conversation. Its last state is the source of the Progress entry the orchestrator appends to the ordna task.

## Environment

A Docker daemon (every suite starts a Testcontainers Postgres; T-124 onward a Garage; T-122 and T-129 build and run the worker image), `uv`, `pnpm`, Playwright's browsers for the web, and a warm `HF_HOME` for the detector's weights from T-121. A measurement a ticket records names the machine class it ran on.

## S0 and S1 in waves

The edges are on the tasks; this is the order they imply, migrations first in each wave:

1. T-120
2. T-127, then T-128 (migrations); beside them T-121, T-123, T-126
3. T-122, T-124, T-133
4. T-125, T-129, T-131, T-132, T-134
5. T-130, T-135, T-137
6. T-136

S0's PR opens after wave 4's T-125; S1's after T-136.
