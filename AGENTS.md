# AGENTS.md

`AGENTS.md` is the canonical repo instruction file, and Claude Code reads it directly. The repository has no root `CLAUDE.md`.

A living company knowledge map for UK SMBs, on OKF v0.2. It has three knowledge layers: **sources** (evidence) → **bundles** (OKF concepts, curated) → the **map** (derived). Over them the platform keeps **records** (guides, write-ups, usage, connected sources, audit), which cite concepts. The destination this repo builds towards is `VISION.md`. Two runtime tiers share four stores: Postgres, an object store, a git repository per workspace, and the map as Postgres tables under RLS. The way to v0.1 is the **route spec**, `docs/specs/v01-route.md`.

## Read first

- `docs/specs/v01-route.md` — the route: the blocks to v0.1 in order, each with its edges and what it must carry. A product session opens its status table first and picks the first unblocked block. A block one owner can build in one session goes to `/poteto-mode`, as one pull request or a short stack. A block that needs more than one owner, or will outlast one session, is planned first (*Workflow*, below).
- `CONCEPTS.md` — the glossary. Name things in code, tests, docs and commits with its words. `docs/agents/domain.md` says more.
- `docs/okf-v02.md` — what OKF defines, what it leaves open, and where each lands here. Read it before adding a key, convention or feature that relates to the knowledge layer.
- `CODING_STANDARDS.md` — the rules that bind every workspace and that no gate enforces. A directory's own rules live in its `AGENTS.md` (`apps/api/`, `apps/web/`, `apps/worker/`, `deploy/`, `packages/core/`, `packages/schema/`), which its `CLAUDE.md` loads when work reaches it.
- `docs/solutions/architecture-patterns/` — why the architecture is the way it is: one doc per live decision. The doc is `docs/solutions/architecture-patterns/adr-NNNN-<slug>.md`.

## Repository Docs Convention

- **plans**  live in `docs/plans/` — unified plan artifacts.
- **Solutions** live in `docs/solutions/` — documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.
- **Specs** live in `docs/specs/` — target platform format specifications. `v01-route.md` is the route spec.
- **C4 architecture diagrams** live in `docs/architecture/` - context, containers, three component views, deployment and flows. They are a reading of the tree, which `/c4-architecture` redraws after any review that moves the shape. The README maps each route block to the containers and components it touches.

## Directory Layout

`apps/` is what deploys; `packages/` is what is imported.

| Path | What it is |
| --- | --- |
| `apps/api/` | The product's one TypeScript deployable: Hono on Node 24. It holds transports only. Four share one origin: tRPC, the MCP surface, the authorization server and the SPA's static build. The rest are the `pnpm ops` commands, the reconciler's tick and the daily sweep pass. There is no api↔worker HTTP: the control plane is rows |
| `apps/web/` | Vite React single-page app. It talks to `apps/api/` over tRPC only |
| `apps/worker/` | Python 3.13 knowledge worker (uv). It runs the work loop, the nightly parser audit and the full rebuild. Connectors, conversion, indexing and extraction arrive with the route's S1 onward, built on cocoindex |
| `packages/core/` | The business logic `apps/api` calls: capability slices over four store doors. It is transport-agnostic |
| `packages/devtools/` | The repository's own gate tooling. Its README lists them |
| `packages/` | The rest of the shared TypeScript: `schema`, `design-system` |
| `contracts/` | The tier contract's language-neutral fixtures. Both tiers' suites read it, and so does the gate tooling. Nothing imports it and nothing deploys it |
| `docs/archive/` | Frozen history: the original ADRs with their amendments, and the block and ticket specs the route was built through |
| `docs/personas/` | The personas used for dogfooding |
| `docs/operations/` | Public-facing ops documents. Documents that are not public-facing are under `.planning/estate/` |
| `deploy/` | Compose files and deployment configuration |
| `.cubic/wiki/` | Cubic's generated wiki |

Read commands, versions and scripts from each workspace's `package.json` or `pyproject.toml`. Every workspace exposes `check` (types, tests). One `check` runs every step it has, and the root `check` runs them all. The TypeScript lint is a root gate: `oxlint` walks the whole tree once, under `check:gates`, so no workspace's `check` repeats it.

## Domain Skills

If a task has a skill, use it for best practice: for example, hono for the api's routes and middleware, cocoindex for the worker and its pipeline, and better-auth for authentication. 

The tracked skills are the folders `.gitignore` names under `.claude/skills/` and `apps/api/.claude/skills/`, plus `.claude/skills/better-answers-design`. Every other entry in `.claude/skills/`, or in a `.claude/skills/` folder below the root, is git-ignored and installed per checkout; `.claude/hooks/provision-skills.sh` copies them into each worktree. 

Other skills belong in the `.claude/skills/` folder beside the files they serve, so they load when that work starts: tRPC, hono, better-auth and Resend under `apps/api/`, React and tRPC's React Query client under `apps/web/`, cocoindex under `apps/worker/`, the coolify skills under `deploy/`, and GitHub Actions under `.github/`.

## Agent skills

### Issue tracker

`project_tracker: linear`

The backlog lives in **Linear**: team `better-answers` (issue ids `BA-N`), project `better-answers`, reached through the `linear-server` MCP. A pull request is the unit of build work. Work that needs more than one owner, or will outlast one session, gets a plan in `docs/plans/` first. The procedure is in `docs/agents/issue-tracker.md`.

### Workflow

Use pstack.

A pull request's body becomes its squash commit's body on `main`, so every body an agent writes has one form. A body repeats no check counts and no release steps a plan or the RUNBOOK holds; it links to them. The body closes with these lines, after every section and before any attribution a tool appends:

- `Merge risk:` is required on every body. It says whether reverting that commit undoes the change, `reversible` or `not reversible`, then what a failure would reach.
- The issue line follows it whenever the pull request has an issue: `Fixes BA-N` when the pull request completes the issue, or `Related to BA-N` when it does not.

```text
Merge risk: reversible, docs only
Fixes BA-58
```

Every commit reaches `main` through the merge queue. A commit's subject and a PR's title take the Conventional Commits form.

A plan's test scenario opens with the behaviour it checks.

`docs/agents/workflow.md` has the loop, the commit's form, the merge, what `check` runs where, and what a worker prompt carries.

### Compounding

`docs/solutions/` is the repository's memory of solved problems. Look up the docs whose `applies_when` matches the area you are working in.

After a solved, verified problem, document it. Apply this counterfactual: if the learning document disappeared, would a future engineer reading the final implementation still be likely to repeat the mistake or redo substantial investigation? If not, it doesn't warrant a document.

### Documentation and communication

When writing or reviewing docs, RFCs, readmes, PR descriptions, or commit messages, or when communicating with the user, use the `technical-writing` skill.

### Triage

A new issue lands in Linear's **Triage** state. The owner or an agent moves it to Todo when it is next to build, or to Backlog with what it waits on. An issue that waits on an owner ruling stays in Triage, with the question in a comment. `docs/agents/issue-tracker.md` gives each state's meaning.

### Domain docs

Single-context: one root `CONCEPTS.md` and one set of decisions in `docs/solutions/architecture-patterns/`. See `docs/agents/domain.md`.

### Mutation triage

A mutation survivor is a hypothesis until a probe answers it. Triage uses controls both ways, the whole suite, one waiter on a long run, and staging by path. The method is `docs/agents/mutation-triage.md`. Read it before touching a mutation report, or a `src` file a report names.

### Code review

Size a review to its change. `/thermos` runs before the pull request. Cubic is paused, so review happens before the pull request, unless CodeRabbit flags an issue. `babysit` fixes or answers a review bot's threads, three rounds at most, and the ruleset holds the merge until every thread is resolved. The loop is in `docs/agents/code-review.md`.

## Code and doc exploration

The jCodeMunch policy, its front-door tools and how to read their results are here: `~/.claude/CLAUDE.md`. A global hook refuses raw reads of code. This section adds only what is particular to this repository.

**After editing files:**
- A login service per server (`jcodemunch-mcp watch-install`, `jdocmunch-mcp watch-install --no-ai-summaries`) reindexes the main checkout and each worktree on any change on disk, merges included. Check it with `watch-status`.
- Without the watchers, only the Edit and Write tools reindex, and jCodeMunch's hook skips non-code files. After a change made another way (a Bash edit, a delete, a rename), call `order { "action": "register_edit", "args": { "paths": [...] } }`.

**From a worktree, two indexes.**

- jCodeMunch and jDocMunch each read the worktree's own index, which the create hook builds, so they see this branch's uncommitted edits. jDocMunch names it `local/<the worktree's folder name>`. Find it with `doc_resolve_repo` on the worktree's path, because `doc_list_repos` lists the main checkout's index too, and a doc read from that one misses this branch.
- GitNexus reads the main checkout's index, taken at its last `analyze`. `analyze` runs after every merge to `main`, in the main checkout only; the runner is absent from a worktree.

So from a worktree:

- `detect_changes` takes `repo: "better-answers"` **and** `worktree: <the worktree's absolute path>`.
- An `impact` that answers *ambiguous* is re-run by `target_uid` before its risk counts.
- `rename` stays a dry run (`dry_run: true`, its default). It has no `worktree:` parameter: it reads **and writes** the main checkout's files, and its answer names no tree. Its edit list names the sites, by the main checkout's line numbers. Apply each one in the worktree with `Edit`. The rename counts as done only when a jCodeMunch `search_text` for the old name comes back empty. That search sees what this branch added since the last `analyze`.

**Docs.** Use jDocMunch to find and read this repository's own Markdown, the files git tracks:
- Start with `doc_resolve_repo` on `.`. From a worktree it names the worktree's own index (above).
- Find a passage with `search_sections`, and read it with `get_section` or `get_sections`.
- Open a long file's structure with `get_document_outline` before reading any of it.

No hook holds this rule, so it applies whether you would read with `Read` or through Bash. Read a doc directly when you will work through all of it (a plan you are carrying out), when you are about to edit it, or when a command needs it raw, such as a grep that also covers code. Files outside the repository, such as the references of an installed plugin's skills and run output under `/tmp`, are always read directly.

<!-- gitnexus:start -->
<!-- gitnexus:keep -->
## Code Intelligence Policy

This project is indexed by GitNexus as **better-answers**. Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. `.gitnexusrc` sets its `--skip-agents-md` and `--skip-skills`, so it writes no `CLAUDE.md` and no skills, and leaves this block as it is.

`impact` warns on HIGH or CRITICAL and never stops an edit, and from a worktree `rename` stays a dry run.

### Use it for

- The blast radius of a change to a symbol other code calls: `impact({target: "symbolName", direction: "upstream"})`. Warn the user before editing when it answers HIGH or CRITICAL.
- The symbols and flows a large diff touches: `detect_changes()`.
- Full context on a symbol — callers, callees, the flows it takes part in: `context({name: "symbolName"})`.
- Security review: `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

### Renames

- Rename a symbol with `rename`, not find-and-replace: `rename` follows the call graph. From a worktree it stays a dry run and its edits are applied by hand: *From a worktree, two indexes*, above.

### Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/better-answers/context` | Codebase overview, check index freshness |
| `gitnexus://repo/better-answers/clusters` | All functional areas |
| `gitnexus://repo/better-answers/processes` | All execution flows |
| `gitnexus://repo/better-answers/process/{name}` | Step-by-step execution trace |

<!-- gitnexus:keep -->
<!-- gitnexus:end -->
