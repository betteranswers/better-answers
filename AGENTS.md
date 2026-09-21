# AGENTS.md

A living company knowledge map for UK SMBs on OKF v0.2. Three knowledge layers — **sources** (evidence) → **bundles** (OKF concepts: the curated map) → **graph** (derived) — and **records** (guides, compositions, usage, bindings, audit) the platform keeps over them, citing concepts. The destination this repo builds towards: `docs/vision.md`. Two runtime tiers sharing four stores — Postgres, an object store, a git repository per workspace, and the graph as Postgres tables under RLS. The way to v0.1 is the **route spec**, `docs/specs/v01-route.md`; the map it was cut from (`.scratch/v01-spec/map.md`) is resolved and closed.

## Read first

- `docs/specs/v01-route.md` — the route: the blocks to v0.1 in order, each with its edges and what it must carry. A product session opens its status table first and picks the first unblocked block; a block goes to `/to-spec` before its build and `/to-tickets` after.
- `CONTEXT.md` — the glossary. Name things in code, tests, docs and commits with its words.
- `docs/okf-v02.md` — what OKF defines, what it leaves open and where each lands here; read before adding a key, convention or feature that relates to the knowledge layer.
- `CODING_RULES.md` — the constitution: every rule that binds work in this repo. A workspace's own rules live in `apps/api/CODING_RULES.md`, `apps/web/CODING_RULES.md` and `apps/worker/CODING_RULES.md`.
- `docs/adr/` — why the architecture is the way it is. Start at `docs/adr/README.md`, the one-line live-conclusion index (a row moves, in the same commit, when the live conclusion moves). Read the ADR a change touches before touching it; a change that contradicts one is a new ADR, never a quiet edit.

## Layout

`apps/` is what deploys; `packages/` is what is imported.

| Path | What it is |
| --- | --- |
| `apps/api/` | The one TypeScript deployable — Hono on Node 24. Transports only: tRPC, the MCP surface, the authorization server and the SPA's static build on one origin, the `pnpm ops` commands and the reconciler's tick. No app↔worker HTTP — the control plane is rows |
| `apps/web/` | Vite React single-page app; talks to `apps/api/` over tRPC only |
| `apps/worker/` | Python 3.13 knowledge worker (uv): the work loop, the nightly parser audit and the full rebuild. Connectors, conversion, indexing and extraction arrive with the route's S1 onward, composing cocoindex |
| `packages/core/` | The business logic `apps/api` calls — capability slices over four store doors. Transport-agnostic, and lint-enforced as such |
| `packages/devtools/` | The repository's own gate tooling — the throwaway-tree runner every gate's test runs its tool through, the lint rules, the anti-slop lift, the mutation probe and summary; its README lists them. |
| `packages/` | The rest of the shared TypeScript: `schema`, `design-system` |
| `contracts/` | The tier contract's language-neutral fixtures — both tiers' suites read it, nothing imports it |
| `docs/adr/` | Architecture decision records |
| `docs/architecture/` | The C4 diagrams — context, containers, three component views, deployment, three flows — a reading of the tree, redrawn by `/c4-architecture` after any review that moves the shape; its README maps each route block to the containers and components it touches |
| `docs/specs/` | `<ticket>.md` is a ticket's spec and `v01-route.md` the route |
| `docs/operations/` | Public-facing ops documents; non-public facing documents are under `.planning/estate/` |
| ordna | The work queue — tasks as git namespace refs (`refs/ordna/tasks/<id>`), not files |
| `deploy/` | Compose files and deployment configuration |
| `.cubic/wiki/` | Cubic's generated wiki |

Commands, versions and scripts are read from each workspace's `package.json` or `pyproject.toml`. Every workspace exposes `check` (lint, types, tests) unless a test names it as having nothing to run; one `check` runs every step it has and names all that failed, and the root `check` runs them all.

## Skills

`/grill-with-docs` and `/domain-modeling` for any design conversation; `/codebase-design` when shaping a module; `/tdd` for red–green work; `/writing-for-agents` when editing ANY file; `/diagnosing-bugs` for anything broken or slow; `/browser-suite` for any Playwright spec under `apps/web/e2e/`; `/better-answers-design` for anything a person will look at; the api's tRPC skills under `apps/api/.claude/skills/` for any procedure, link or adapter in `apps/api/`; `/c4-architecture` when an architecture review has moved the shape and the diagrams must say so. Other skills are available, co-located where they are most often utilised e.g., `apps/worker/.claude/skills/`, `apps/web/.claude/skills/`. If a task has a skill associated to it, use it to ensure best practice e.g., coolify and hono skills for deployment, cocoindex for worker/pipeline, better-auth for authentication etc.

## Agent skills

### Issue tracker

Build tasks live in **ordna** (`storage: namespace` — git blobs at `refs/ordna/tasks/<id>`, no files on disk; use the `ordna` CLI), cut from a block of the route spec. A body edit or a new task is pushed to **origin first**, then set locally: an open board auto-fetches every minute and reverts a local-only ref. Procedure in `docs/agents/issue-tracker.md`.

### Workflow

A set of ordna tickets is built under one `/goal` in one session, the Coordinator: one agent per ticket runs `/implement` end to end and fixes what its own `/code-review` finds; PR into `main`, CI's root `check` the arbiter. The steps, the goal's shape and what `check` runs where are `docs/agents/workflow.md`.

### Triage labels

The five canonical roles — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` — applied as ordna **tags**. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` and one `docs/adr/`. See `docs/agents/domain.md`.

### Mutation triage

A survivor is a hypothesis until a probe answers it: controls both ways, the whole suite, one waiter on a long run, staging by path. The method is `docs/agents/mutation-triage.md` — read it before touching a mutation report or a `src` file a report names.

### Code review

Cubic reviews every PR and its findings are triaged through the `cubic` MCP on the PR threads, one commit per round, three rounds at most — **paused since 10/09/2026** at the plan's limit. GitNexus gates every edit and commit. The loop is `docs/agents/code-review.md` — read it before opening a PR.

## Code Exploration Policy

Always use jCodeMunch-MCP for code navigation. Never fall back to Read, Grep, Glob, or Bash for code exploration.
**Exception:** use `Read` when you are about to edit a file — the harness requires a `Read` before `Edit`/`Write`. Use jCodeMunch to *find and understand* code, then `Read` only the file you are changing.

This server runs the **front door** surface: three tools reach every jCodeMunch capability, so the tool list stays small and the catalogue is fetched only when you need it.

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
- Edited files are reindexed automatically.

**Announce your model once per session** so the server can size its answers: `announce_model { "model": "<your-model-id>" }`.

**From a worktree, two indexes.** jCodeMunch reads the worktree's own index, which the create hook builds, so it sees this branch's uncommitted edits. GitNexus reads the main checkout's, taken at its last `analyze`, which runs in the main checkout only — the runner is absent from a worktree — after every merge to `main`. So `detect_changes` from a worktree takes `repo: "better-answers"` **and** `worktree: <the worktree's absolute path>`; and an `impact` that answers *ambiguous* is re-run by `target_uid` before its risk counts. `rename` has no `worktree:` parameter: it reads **and writes** the main checkout's files, and its answer names no tree. So from a worktree `rename` stays a dry run (`dry_run: true`, its default) — its edit list names the sites, by the main checkout's line numbers; each is applied in the worktree with `Edit`; and a jCodeMunch `search_text` for the old name, which sees what this branch added since the last `analyze`, comes back empty before the rename counts as done.

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

### Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

### Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph. From a worktree it stays a dry run and its edits are applied by hand: *From a worktree, two indexes*, above.
- NEVER commit changes without running `detect_changes()` to check affected scope.

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
