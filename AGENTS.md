# AGENTS.md

A living company knowledge map for UK SMBs, on OKF v0.2. It has three knowledge layers: **sources** (evidence) → **bundles** (OKF concepts: the curated map) → **graph** (derived). Over them the platform keeps **records** (guides, compositions, usage, bindings, audit), which cite concepts. The destination this repo builds towards is `VISION.md`. Two runtime tiers share four stores: Postgres, an object store, a git repository per workspace, and the graph as Postgres tables under RLS. The way to v0.1 is the **route spec**, `docs/specs/v01-route.md`. The map it was cut from (`.scratch/v01-spec/map.md`) is resolved and closed.

## Read first

- `docs/specs/v01-route.md` — the route: the blocks to v0.1 in order, each with its edges and what it must carry. A product session opens its status table first and picks the first unblocked block. A block becomes a plan through `/ce-brainstorm` and `/ce-plan` (*Workflow*, below).
- `CONTEXT.md` — the glossary. Name things in code, tests, docs and commits with its words.
- `docs/okf-v02.md` — what OKF defines, what it leaves open, and where each lands here. Read it before adding a key, convention or feature that relates to the knowledge layer.
- `CODING_STANDARDS.md` — the constitution: every rule that binds work in this repo. A directory's own rules live beside it, in `apps/api/CODING_STANDARDS.md`, `apps/web/CODING_STANDARDS.md`, `apps/worker/CODING_STANDARDS.md` and `deploy/CODING_STANDARDS.md`.
- `docs/solutions/architecture-patterns/` — why the architecture is the way it is: one doc per live decision. `/ce-plan` finds the ones a plan touches. Code cites a decision as `ADR NNNN`, and its doc is `adr-NNNN-<slug>.md`. A change that moves a decision edits its doc in the same commit, and says so in the pull request. The ADRs these came from, with their amendments, are frozen in `docs/archive/adr/`.

## Layout

`apps/` is what deploys; `packages/` is what is imported.

| Path | What it is |
| --- | --- |
| `apps/api/` | The one TypeScript deployable: Hono on Node 24. It holds transports only. Four share one origin: tRPC, the MCP surface, the authorization server and the SPA's static build. The rest are the `pnpm ops` commands, the reconciler's tick and the daily sweep pass. There is no api↔worker HTTP: the control plane is rows |
| `apps/web/` | Vite React single-page app. It talks to `apps/api/` over tRPC only |
| `apps/worker/` | Python 3.13 knowledge worker (uv). It runs the work loop, the nightly parser audit and the full rebuild. Connectors, conversion, indexing and extraction arrive with the route's S1 onward, built on cocoindex |
| `packages/core/` | The business logic `apps/api` calls: capability slices over four store doors. It is transport-agnostic, and a lint rule enforces that |
| `packages/devtools/` | The repository's own gate tooling: the throwaway-tree runner that every gate's test runs its tool through, the lint rules, the anti-slop lift, and the mutation probe and summary. Its README lists them |
| `packages/` | The rest of the shared TypeScript: `schema`, `design-system` |
| `contracts/` | The tier contract's language-neutral fixtures. Both tiers' suites read it, and so does the gate tooling. Nothing imports it and nothing deploys it |
| `docs/architecture/` | The C4 diagrams: context, containers, three component views, deployment and six flows. They are a reading of the tree, which `/c4-architecture` redraws after any review that moves the shape. The README maps each route block to the containers and components it touches |
| `docs/specs/` | `v01-route.md`, the route |
| `docs/archive/` | Frozen history from before Compound Engineering: the ADRs with their amendments, and the block and ticket specs the route was built through. Read, never edited |
| `docs/plans/` | Compound Engineering's plans, one per piece of work. A plan has no status: git says what shipped |
| `docs/solutions/` | Documented solutions to past problems (bugs, best practices, workflow patterns), by category, with YAML frontmatter (`module`, `tags`, `problem_type`). `/ce-plan` searches it before every plan |
| `docs/personas/` | The personas `/ce-dogfood` walks a screen as: a git-ignored link to `.planning/personas/`, which the worktree hook makes |
| `.compound-engineering/` | Compound Engineering's settings for this repository |
| `docs/operations/` | Public-facing ops documents. Documents that are not public-facing are under `.planning/estate/` |
| `deploy/` | Compose files and deployment configuration |
| `.cubic/wiki/` | Cubic's generated wiki |

Read commands, versions and scripts from each workspace's `package.json` or `pyproject.toml`. Every workspace exposes `check` (types, tests), unless a test names it as having nothing to run. One `check` runs every step it has and names all that failed, and the root `check` runs them all. The TypeScript lint is a root gate: `oxlint` walks the whole tree once, under `check:gates`, so no workspace's `check` repeats it. Each workspace keeps its own `lint` script for running by hand. `packages/devtools` also keeps its Python lint and format checks in `check`, because the tree walk does not reach them.

## Skills

- `/lfg` for a change end to end: plan, build, review, compound, browser test and pull request, with no pause for approval.
- `/ce-brainstorm` when what to build is still open, `/ce-plan` to write the plan, `/ce-work` to build one.
- `/ce-debug` for anything broken or slow.
- `/ce-code-review` before a pull request, `/ce-compound` after a solved problem (*Compounding*, below).
- `/ce-dogfood` for a screen, walked as the personas in `docs/personas/`.
- `/browser-suite` for any Playwright spec under `apps/web/e2e/`.
- `/renovate-prs` for Renovate's dependency pull requests, red or waiting.
- `/better-answers-design` for anything a person will look at.
- The api's tRPC skills under `apps/api/.claude/skills/` for any procedure, link or adapter in `apps/api/`.
- `resend` and `email-best-practices`, vendored from Resend, for its sending limits, deliverability and webhooks. The api sends through Resend's SMTP relay with nodemailer (`apps/api/src/smtp.ts`), not its SDK, so check any of their samples against the code before copying it.
- `/c4-architecture` when an architecture review has moved the shape and the diagrams must say so.

Other skills live beside the code that uses them most, such as `apps/worker/.claude/skills/` and `apps/web/.claude/skills/`. If a task has a skill, use it for best practice. For example, coolify and hono for deployment, cocoindex for the worker and its pipeline, and better-auth for authentication.

## Agent skills

### Issue tracker

`project_tracker: linear`

The backlog lives in **Linear**: team `better-answers` (issue ids `BA-N`), project `better-answers`, reached through the `linear-server` MCP. It holds work not yet planned and review findings put off for later. A plan in `docs/plans/` is the unit of build work, and the pull request that lands it names its issue as `Fixes BA-N`. The tasks before Linear were ordna's `T-nnn`, and they stay readable in git. The procedure is in `docs/agents/issue-tracker.md`.

### Workflow

Work runs on the Compound Engineering plugin (CE), pinned in `.claude/settings.json`. A change goes through `/lfg`, or `/ce-plan` then `/ce-work`. `ce-commit-push-pr` opens the pull request. `arm-merge.yml` arms its merge once Cubic has read the head, and the merge queue merges it when `check` is green. CI's `check` is the arbiter.

Every commit reaches `main` through the merge queue. A commit's subject and a PR's title take the Conventional Commits form, and commitlint refuses a commit or a PR title that breaks it.

`docs/agents/workflow.md` has the loop, the commit's form, the merge and what `check` runs where.

### Compounding

`docs/solutions/` is the repository's memory of solved problems; `/ce-plan` reads it before planning.

After a solved, verified problem, automatically invoke the `ce-compound` skill with `mode:non-interactive` at the completion checkpoint only when the work produced durable project reasoning that is not readily recoverable from the final code, tests, types, comments, or existing documentation, and losing it would plausibly cause recurrence, material risk, or substantial rediscovery. Apply this counterfactual: if the learning document disappeared, would a future engineer reading the final implementation still be likely to repeat the mistake or redo substantial investigation? If not, do not invoke it. Completion, effort, and diff size alone are not enough. Capture at the checkpoint so a qualifying learning can ship in the PR that produced it, and only where the repository treats captured learnings as tracked, committed knowledge.

### Triage

A new issue lands in Linear's **Triage** state. The owner moves it to Todo when it is ready to build, or to Backlog with what it waits on. `docs/agents/issue-tracker.md` gives each state's meaning.

### Domain docs

Single-context: one root `CONTEXT.md` and one set of decisions in `docs/solutions/architecture-patterns/`. See `docs/agents/domain.md`.

### Mutation triage

A mutation survivor is a hypothesis until a probe answers it. Triage uses controls both ways, the whole suite, one waiter on a long run, and staging by path. The method is `docs/agents/mutation-triage.md`. Read it before touching a mutation report, or a `src` file a report names.

### Code review

Two reviews, one in the session and one on the pull request. `/ce-code-review` runs before the pull request, with a second model family read through OpenCode (`.compound-engineering/config.yaml`). Cubic reviews every head on the pull request. `ce-babysit-pr` fixes or answers its threads, three rounds at most, and the ruleset holds the merge until every thread is resolved. The loop is in `docs/agents/code-review.md`.

## Code Exploration Policy

Always use jCodeMunch-MCP for code navigation. Never fall back to Read, Grep, Glob, or Bash for code exploration.
**Exception:** use `Read` when you are about to edit a file — the harness requires a `Read` before `Edit`/`Write`. Use jCodeMunch to *find and understand* code, then `Read` only the file you are changing.

This server runs the **front door** surface. Three tools reach every jCodeMunch capability, so the tool list stays small and the catalogue is fetched only when you need it.

**Start any session:**
1. `order { "action": "resolve_repo", "args": { "path": "." } }` — confirm the project is indexed. If it is not: `order { "action": "index_folder", "args": { "path": "." } }`

**Then, for any task:**
- Know what you want → `order { "action": "<name>", "args": { ... } }`
- Know the goal, not the tool → `route { "query": "your task in a sentence" }` picks the action and shapes the arguments
- Want to see what exists → `menu { "query": "what you are trying to do" }` returns matching actions with example arguments
- Want the whole catalogue and the usage rules → `jcodemunch_guide`

`menu` and `jcodemunch_guide` list every action this server can run, including ones absent from your tool list. That is expected: the front door is the way to call them.

**Interpreting results:**
- A `verdict` of `no_implementation_found` is evidence of absence. Report the gap; do not re-search with different wording.
- A `verdict` of `degraded` means a channel was unavailable, so absence is NOT proven. Read the note before relying on the result.
- `source: ""` alongside `source_status` means the body could not be read, not that the symbol is empty.

**After editing files:**
- A login service per server (`jcodemunch-mcp watch-install`, `jdocmunch-mcp watch-install --no-ai-summaries`) reindexes the main checkout and each worktree on any change on disk, merges included. Check it with `watch-status`.
- Without the watchers, only the Edit and Write tools reindex, and jCodeMunch's hook skips non-code files. After a change made another way (a Bash edit, a delete, a rename), call `order { "action": "register_edit", "args": { "paths": [...] } }`.

**Announce your model once per session** so the server can size its answers: `announce_model { "model": "<your-model-id>" }`.

**From a worktree, two indexes.**

- jCodeMunch and jDocMunch each read the worktree's own index, which the create hook builds, so they see this branch's uncommitted edits. jDocMunch names it `local/<the worktree's folder name>`. Find it with `doc_resolve_repo` on the worktree's path, because `doc_list_repos` lists the main checkout's index too, and a doc read from that one misses this branch.
- GitNexus reads the main checkout's index, taken at its last `analyze`. `analyze` runs after every merge to `main`, in the main checkout only; the runner is absent from a worktree.

So from a worktree:

- `detect_changes` takes `repo: "better-answers"` **and** `worktree: <the worktree's absolute path>`.
- An `impact` that answers *ambiguous* is re-run by `target_uid` before its risk counts.
- `rename` stays a dry run (`dry_run: true`, its default). It has no `worktree:` parameter: it reads **and writes** the main checkout's files, and its answer names no tree. Its edit list names the sites, by the main checkout's line numbers. Apply each one in the worktree with `Edit`. The rename counts as done only when a jCodeMunch `search_text` for the old name comes back empty. That search sees what this branch added since the last `analyze`.

## Doc Exploration Policy

Always use jDocMunch-MCP tools for documentation navigation. Never fall back to Read for doc exploration.
**Exception:** Use `Read` when you need exact line numbers for `Edit`.

**Start any session:**
1. `doc_list_repos` — check what's indexed. If your docs aren't there: `index_local { "path": "." }`

**Finding content:**
- keyword/topic search -> `search_sections` (returns summaries only)
- browse structure -> `get_toc` (flat) or `get_toc_tree` (nested)
- single document -> `get_document_outline`

**Reading content:**
- one section -> `get_section` (full content via byte-range)
- multiple sections -> `get_sections` (batch)
- section + context -> `get_section_context` (ancestors + children)

**Maintenance:**
- broken internal links -> `get_broken_links`
- code/doc coverage gap -> `get_doc_coverage`

<!-- gitnexus:start -->
<!-- gitnexus:keep -->
## Code Intelligence Policy

This project is indexed by GitNexus as **better-answers**. Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner.

GitNexus is a tool to reach for, not a gate: CI's `check` and the two reviews are the gates.

### Use it for

- The blast radius of a change to a symbol other code calls: `impact({target: "symbolName", direction: "upstream"})`. Warn the user before editing when it answers HIGH or CRITICAL.
- The symbols and flows a large diff touches: `detect_changes()`.
- Full context on a symbol — callers, callees, the flows it takes part in: `context({name: "symbolName"})`.
- Security review: `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

### Never Do

- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph. From a worktree it stays a dry run and its edits are applied by hand: *From a worktree, two indexes*, above.

### Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/better-answers/context` | Codebase overview, check index freshness |
| `gitnexus://repo/better-answers/clusters` | All functional areas |
| `gitnexus://repo/better-answers/processes` | All execution flows |
| `gitnexus://repo/better-answers/process/{name}` | Step-by-step execution trace |

### CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |

<!-- gitnexus:keep -->
<!-- gitnexus:end -->
