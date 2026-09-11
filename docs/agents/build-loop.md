# The build loop: ralph over a block's tickets

How a block of the route (`docs/specs/v01-route.md`) is built by agents to this repo's standards. One session **orchestrates**; **ralph** runs one ticket at a time as a work → test loop over fresh child agents; the **verifier** signs the ticket off against its acceptance criteria; the orchestrator lands it on the block branch. The agent files under `.claude/agents/` are short and point here; this page is the one place the rules live.

| Role | Agent | Model | Does |
| --- | --- | --- | --- |
| Orchestrator | the session | — | Picks from the frontier, cuts the worktree, briefs ralph, approves the plan, **dispatches each iteration** — the implementor, then the evaluator — holds the iteration cap, lands the ticket, moves the ordna task, opens the block PR |
| Ralph | `ralph` | opus, xhigh | Two modes, each a fresh agent. **Plan**: turns the ticket into the task note with test commands, once. **Evaluate**: after an implementor returns, runs the note's test commands, writes the feedback and the next focus into the note, answers one sigil, exits |
| Implementor | `implementor` | opus, high (the brief may say sonnet for a small ticket) | Builds one iteration's focus inside the gates below; commits on the worktree branch; reports five lines to the orchestrator |
| UI designer | `ui-designer` | opus, xhigh | The implementor for a ticket that lands a screen (T-136): the same gates, plus `/better-answers-design` and `/browser-suite` |
| Verifier | `verifier` | opus, xhigh | Evidence-driven pass over the ordna acceptance criteria and the gates; approves or lists what is missing |
| Reviewer | `pr-reviewer` | opus, xhigh | The block PR's review on two axes, standards and spec, while Cubic is paused |

## The shape

- **A block is one PR.** The block branch is named for the block — `s0`, `s1` — and cut from `main`. Tickets land on it as commits; the PR opens when the block's last ticket lands and the owner merges it. The route's status row flips to *building* in the block branch's first commit and to *done* in the PR's last.
- **A ticket is one worktree, and the orchestrator cuts it.** With the main checkout on the block branch: `git worktree add -b worktree-T-nnn .claude/worktrees/T-nnn <block>` then `bash .claude/hooks/provision-worktree.sh .claude/worktrees/T-nnn` (`pnpm install`, `uv sync`, the skills, the tracker guide). Every child is spawned without `isolation` and briefed with the worktree's absolute path, so the worktree's life is the ticket's and never a child's — a worktree cut for one agent is cleaned when that agent exits unchanged, which a planning ralph does. Nothing is committed in the main checkout during a ticket except landings and a rules-page correction between tickets.
- **Nobody waits with a context** (11/09/2026). The loop is a sequence of fresh, short agents and the orchestrator is its clock: it is the one context the harness wakes when a child completes, and it caches for an hour. Each iteration is two children in turn — an implementor, then ralph in evaluate mode — and each ends by reporting and exiting; between them nothing is alive, so a thirty-minute build costs nothing to wait for. This is the shape Matt Pocock's Ralph has always had: a shell loop over fresh processes with state in files and the iteration cap in the loop header, where the agent cannot reach it (`.scratch/v01-route/research/ralph-articles-2026-09-11.md`). Last session's long-lived ralph held a 150–350k context across every wait and re-wrote it on each wake, a third of the session's spend, and its watcher rules were corrected three times in two days; they retire with the waiting they governed. What survives of them: an iteration ends on the child's own report and never on a branch that moved, since a child commits and then amends (T-124).
- **The cap is the orchestrator's, not the agent's.** The note's *Current iteration* carries the iteration number and the count of failures on the same issue; the orchestrator reads both before every dispatch. Ten iterations, or three failures on one issue, stops the loop and opens a discussion with the owner — an unbounded loop over a stochastic system is the one thing Pocock calls dangerous, and the count lives where no child can reset it.
- **The verdict is a sigil, never prose.** The evaluator's last line is exactly one of `<verdict>PASS T-nnn <sha></verdict>`, `<verdict>NEXT T-nnn <n>: <focus></verdict>` or `<verdict>STOP T-nnn: <why></verdict>`; the orchestrator dispatches on the string and reads nothing into a report that lacks it. A PASS the orchestrator had to interpret was misread once on a moving tree (T-124).
- **Two reading rules for a loop's evidence** (T-127, 11/09/2026). A background task's exit code is its last command's, so a trailing `echo` reports 0 over a red check — read the log, never the notification; and a run killed mid-way answers 0 too, which is the kill and not a pass. And each wave's brief is checked against the task note's hazard list before it is sent, not only against the ticket's acceptance lines: a hazard the plan recorded and no brief carried is one the verifier finds.
- **Waiting is one call, never a turn** (11/09/2026). A long command runs in the foreground with an explicit `timeout` of up to ten minutes; one that runs longer is backgrounded once and then waited on in `until <its done-condition>; do sleep 30; done` calls of up to ten minutes each, so a forty-minute check is four turns. Every turn replays the whole context, so a turn that only reads a log is the most expensive way to learn nothing: one implementor spent 219 of its 442 turns on `wc -c` and `tail` against a check log, $68 for one iteration (T-124), and 23% of the verifiers' shell calls were the same. Only the orchestrator ends a turn on a background task — a subagent that does is not woken by its exit (Claude Code's sub-agents doc, read 11/09/2026), and neither is any agent by its child agent's completion.
- **The frontier** is every `todo` task in the block whose `depends_on` are all `done` — `ordna list -s todo`, then `ordna show` on each. Tickets on the frontier may run in parallel in separate worktrees, with one exception below.
- **Migrations serialise.** A ticket that adds a migration or bumps `contract_version` runs alone until it lands; the drizzle journal and the contracts manifest do not merge. In S0 and S1 that is T-120, then T-127 and T-128 one after the other.
- **S1's branch is cut from `s0`** after T-120 lands, so S1's tickets that edge S0's can proceed while S0's PR waits; when S0 merges, `s1` rebases onto `main` and its PR follows.

## The orchestrator's steps, per ticket

1. Pick a ticket on the frontier. `ordna move T-nnn doing`, `ordna assign T-nnn ralph`, then push the ref: `git push origin refs/ordna/tasks/T-nnn` (`docs/agents/issue-tracker.md`).
2. Cut and provision the worktree (above). Spawn `ralph` with the plan brief below. Ralph writes the task note, answers with its plan and the question *approve?*, and exits.
3. Read the plan against the ticket's acceptance criteria. Amend or approve by `SendMessage` to ralph; an amendment is folded into the note by ralph, which answers `<plan>READY T-nnn</plan>` and exits again.
4. **Iterate.** Read the note's *Current iteration* against the cap. Spawn `implementor` with the iteration brief (the note's path, the focus, the worktree's path, *report to main*). On its completion, spawn `ralph` with the evaluate brief and the implementor's five lines. Dispatch on the sigil: `NEXT` → step 4 again with the note's next focus; `STOP` → the owner; `PASS` → step 5.
5. Spawn `verifier` against the same worktree with the ticket id. *APPROVED* lands; anything else is the next iteration's focus, written into the note, and step 4 resumes.
6. **Land.** In the worktree: `git rebase <block>`, root `pnpm check` green, `detect_changes` clean. In the main checkout: fast-forward the block branch onto the worktree branch, `git push origin <block>`, `node .gitnexus/run.cjs analyze`. Remove the worktree.
7. Append the ticket's Progress entry — what landed, the suites, the measurement if the ticket records one — through the origin-first procedure, `ordna move T-nnn done`, push the ref.

The orchestrator's context is finite and it is the one context the harness wakes, so it holds decisions and never evidence: a child's report is five lines, the note is the record, a `detect_changes` answer is read for its summary and its changed names, and the session hands off (`/mattpocock-skills:handoff`) at about 400k tokens rather than at the day's end. The previous session reached 976k and its last seven turns were refused as too long, with nothing compacted (11/09/2026).

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

The named suites are the loop's arbiter, run by the evaluator in its own foreground after every implementor. Root `check` runs once, by the evaluator whose iteration otherwise passes, and again at landing; the whole suite mid-loop is waste.

## The gates every implementor obeys

- **Read first**: the ordna task (`ordna show`), the spec sections it names, `CODING_RULES.md` and the workspace's own rules file, the ADRs the task's Notes name. `CONTEXT.md`'s word for a thing is the name in code.
- **Navigation is jCodeMunch** (`AGENTS.md`, *Code Exploration Policy*): `resolve_repo` on the worktree, `index_folder` if it is not indexed; `Read` a file only to edit it. A `Read` that pages through a file with moving offsets to find something is the fallback the policy forbids and every page stays in context for the rest of the iteration: search first, then read the section found (250 windowed reads across two tickets, 11/09/2026). This binds ralph's own reading in Phase 1 as much as an implementor's.
- **GitNexus**: the index lives in the main checkout only (`.gitnexus/` is excluded per checkout and the runner is absent from a worktree), so `analyze` is the orchestrator's, at every landing. From a worktree the MCP tools read that index, which is at the block's tip: `impact` before editing any symbol that exists there — a symbol the ticket creates has no caller to report — and `detect_changes` before every commit with the worktree's absolute path passed explicitly. HIGH or CRITICAL risk is reported to ralph before the edit, never absorbed. An `impact` answer of *ambiguous* is not a risk reading: the same symbol read LOW by name and CRITICAL by `target_uid` (T-128, 11/09/2026), so an ambiguous answer is re-run with the uid before it counts.
- **Words before code, records with code** (`[GLOSSARY1]`): a new domain word lands in `CONTEXT.md` before code names it; an ADR amendment and its `docs/adr/README.md` row land in the same commit as the code they record; a contract fixture lands with its manifest entry and `contract_version`.
- **Tests as the constitution says** (`[TEST1]` to `[TEST9]`): real Postgres, our own code never mocked, factories, pairs both ways, expected values as literals. `/mattpocock-skills:tdd` at the seams the ticket names; `/mattpocock-skills:implement` is the process.
- **The tier's skills**: `apps/api/.claude/skills/` for any tRPC procedure, link or adapter; `/hono`; `/cocoindex` for the pipeline; `/browser-suite` for a spec under `apps/web/e2e/`; `/better-answers-design` for anything a person looks at; `/writing-react-effects` and `/react-hook-form-writer` in the web; the privacy skills for the seam.
- **A rule tag never appears in source, a deploy file, a Dockerfile, a CI workflow or a workspace config** — the scan's own scope, wider than "source": a comment there carries the constraint in words, and the tag is cited in the test that holds it (T-122, T-124, 11/09/2026: three loops lost a root-check run to this).
- **Commits**: `git status` first, stage by path, one message in the repo's prose shape — what landed and why, the tests it adds, the ticket id in brackets at the end — and the attribution line the session carries. Commit on the worktree branch; never on `main` or the block branch.
- **Scope**: the ticket and nothing beside it. A finding outside the ticket is one line in ralph's report, which the orchestrator turns into a hygiene task.
- **A report is five lines to the agent that spawned you**, named in the brief; the evidence — commands and their output, files, the reading behind a claim — goes into the task note, which is where the next child and the verifier read it. A report longer than a message truncates and costs a round-trip to recover (eight times last session); one that reaches the wrong parent is relayed by hand (81 times, 11/09/2026). **The report ends the work**: a message that reaches a child after it has reported is answered in one line and acted on by the next iteration, never by an amend — a round-3 fixer applied a ruling after reporting and moved the tree under the landing's root `check`, which then had to be taken twice (12/09/2026).

## Review while Cubic is paused

Cubic's plan limit is reached (10/09/2026), so the PR loop in `docs/agents/code-review.md` is paused. The substitute:

- Per ticket: `/mattpocock-skills:implement` ends with `/code-review`, and the verifier's pass is the second pair of eyes.
- Per block: before the PR opens, `/mattpocock-skills:code-review` on the block branch since `main`, then `pr-reviewer` on the PR. Findings are fixed in one commit per round, three rounds at most, as the Cubic loop says.

## The briefs the orchestrator gives

Ralph, plan mode:

```
Plan: T-nnn (ordna show T-nnn). Block: s0. Block branch tip: <sha>.
Worktree: /abs/path/.claude/worktrees/T-nnn.
Spec: docs/specs/<block>.md — the sections the ticket names.
Edges done: T-… (what each landed, one line).
Rules: docs/agents/build-loop.md.
Task note: /abs/path/to/main-checkout/.scratch/build/T-nnn.md (the main checkout's, absolute — the worktree is removed at landing).
Anything the orchestrator already knows the loop will hit: <one line each>.
```

The implementor, per iteration:

```
Iteration <n> of T-nnn. Worktree: /abs/path. Task note: /abs/path/.scratch/build/T-nnn.md — the authority; read it first.
Focus: <the note's next focus, one line>. Model: opus | sonnet.
Rules: docs/agents/build-loop.md. Report five lines to main.
```

Ralph, evaluate mode:

```
Evaluate: T-nnn, iteration <n>. Worktree: /abs/path. Task note: /abs/path/.scratch/build/T-nnn.md.
The implementor's report: <its five lines>.
Rules: docs/agents/build-loop.md.
```

A brief is under 2,000 characters. Edges and hazards are one line each, and a rule this page already carries is cited by its heading, never restated: briefs grew four-fold last session by restating landed tickets and dated rules in prose (11/09/2026).

## The task note

Ralph writes the main checkout's `.scratch/build/T-nnn.md` (git-ignored; the brief gives the absolute path) in plan mode and rewrites it in every evaluate step, with five sections — **Plan**, **Test commands**, **Current iteration** (the number, the failures on the same issue, the next focus), **Test feedback**, **Iteration history**. It is read at that path and never mirrored into the worktree. Child agents read it and never a conversation; the verifier writes its report under a sixth heading, **Verification**. Its last state is the source of the Progress entry the orchestrator appends to the ordna task.

The note carries everything a fresh child would otherwise re-derive (11/09/2026): the ticket's acceptance lines verbatim, the rule tags the ticket touches with the sentence each binds, the scouts' findings with their line numbers, and every `impact` reading already taken with its risk — so the next child reads the note and not `ordna show`, the rules file and the graph again (T-124's eight children each re-ran the same three reads; `runErasure` was `impact`-checked three times). An iteration's focus is sized for one child to finish in about a hundred turns: a conversation's cost grows with the square of its length, since every turn replays all the turns before it, and a child that ran 440 turns cost four times two children of 220.

## Environment

A Docker daemon (every suite starts a Testcontainers Postgres; T-124 onward a Garage; T-122 and T-129 build and run the worker image), `uv`, `pnpm`, Playwright's browsers for the web, a warm `HF_HOME` for the detector's weights from T-121, and `git-filter-repo` on the path at the version `apps/api/Dockerfile` pins (`uv tool install git-filter-repo==<that version>`; the check workflow reads the same pin) from T-124. A measurement a ticket records names the machine class it ran on. Subagents cache for an hour (`subagentPromptCacheTtl` in `.claude/settings.json`, 11/09/2026): on the five-minute default every wait over five minutes re-wrote a ralph's whole context at the write rate, $148 of the previous session's $1,096, and the setting is verified by `ephemeral_1h_input_tokens` on a child's turn rather than assumed, since the server may cap it. Two root `check`s never run side by side on one machine: each builds the worker and api images inside its suites, and two at once filled the host volume and starved the long core suites (11/09/2026, T-140; the causes are configuration — the VM's size, pnpm's workspace concurrency, the test Postgres's durability settings — and are that task's). The serialisation is a lock no orchestrator turn is spent on, in two steps: an evaluator takes `/tmp/root-check.lock` with `mkdir`, which is atomic — `until mkdir /tmp/root-check.lock 2>/dev/null; do sleep 60; done` — then waits until no root `check` runs — `until ! pgrep -f 'node [s]cripts/check.mjs' >/dev/null; do sleep 60; done` — each in Bash calls of up to ten minutes; runs; and `rmdir`s the lock when the run ends, whatever it read. Two things in that idiom are load-bearing: the bracket, since `pgrep -f` reads the waiting shell's own command line and a bare pattern matches itself forever; and that a waiter never `rmdir`s inside its wait, since the lock it would remove is another's (11/09/2026: three evaluators hung on the first, and the first form of this line had the second). A lock left by a killed evaluator is removed by hand once `pgrep` answers nothing.

## S0 and S1 in waves

The edges are on the tasks; this is the order they imply, migrations first in each wave:

1. T-120
2. T-127, then T-128 (migrations); beside them T-121, T-123, T-126
3. T-122, T-124, T-133
4. T-125, T-129, T-131, T-132, T-134
5. T-130, T-135, T-137
6. T-136

S0's PR opens after wave 4's T-125; S1's after T-136.
