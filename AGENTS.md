<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# AGENTS.md

A living company knowledge map for UK SMBs on OKF v0.2. Three knowledge layers — **sources** (evidence) → **bundles** (OKF concepts, the map) → **graph** (derived) — and **records** (guides, compositions, usage, bindings, audit) the platform keeps over them, citing concepts (ADR 0011). The destination this repo builds towards: `docs/vision.md`. Two runtime tiers (ADR 0005) sharing four stores — Postgres, an object store, a git repository per workspace, a derived graph — and never code.

## Read first

- `CONTEXT.md` — the glossary. Name things in code, tests, docs and commits with its words; a new domain word is settled there *before* it appears in code.
- `docs/okf-v02.md` — what OKF defines, what it leaves open and where each lands here; read before adding a key, convention or feature that touches a concept file.
- `CODING_RULES.md` — the constitution: every rule that binds work in this repo. Tier rules live in `app/CODING_RULES.md` and `worker/CODING_RULES.md`.
- `docs/adr/` — why the architecture is the way it is. Read the ADR a change touches before touching it; a change that contradicts one is a new ADR, never a quiet edit.

## Layout

| Path | What it is |
| --- | --- |
| `app/` | TypeScript server — Hono on Node 24: tRPC API, MCP server, OpenAPI, LLM routing, policy, worker control plane (ADRs 0006, 0008) |
| `web/` | Vite React single-page app; talks to `app/` over tRPC only |
| `worker/` | Python 3.13 knowledge worker (uv): connectors, conversion, indexing, graph derive-and-sync, enrichment, ontology tooling |
| `packages/` | Shared TypeScript: `schema` (Drizzle — the only migration owner, ADR 0007), `contracts` |
| `<tier>/tools/<name>/` | Development tooling installed into a tier — not shipped, not a lift. `app/tools/anti-slop/` is the oxlint plugin (`github.com/dmmulroy/anti-slop`) that `.oxlintrc.json` loads as a `jsPlugin`; it is excluded from lint and format because it is not our source to style |
| `<tier>/lifts/<name>/` | Pinned third-party snapshots the platform *runs*, each with a `THIRD_PARTY_NOTICES.md` — see `[LIFT]` in `CODING_RULES.md` (permissive licences only, ADR 0027). A lift is code we ship; a tool under `tools/` is not |
| `docs/adr/` | Architecture decision records |
| `docs-site/` | Astro + Starlight documentation site and its docs skills |
| ordna | The work queue — tasks as git namespace refs (`refs/ordna/tasks/<id>`), not files; set up once the repository has a root `package.json` (ticket 41) |
| `deploy/` | Compose files and deployment configuration |

Commands, versions and scripts are read from each workspace's `package.json` or `pyproject.toml`; this file does not repeat them. Every workspace exposes `check` (lint, types, tests); the root `check` runs them all.

## Working a task

1. Take one task from ordna; one branch and one pull request per task. The PR closes when `check` is green and the task's acceptance lines are each demonstrated by a test or a linked artefact.
2. Design before code: state the module's **interface** (what a caller must know) and its **seam**; a deep module — much behaviour behind a small interface — is the target (`[DESIGN]`).
3. Every behaviour change lands with a functional test through the module's interface in the same PR (`[TEST]`).
4. A decision that is hard to reverse, surprising later, and a real trade-off gets an ADR in the same PR (`[ADR]`).
5. Comments say *why*; history lives in git and ADRs (`[COMMENT]`).
6. Every version you introduce is read from Context7 or the vendor's release page in that PR (`[DEPS1]`); a remembered version is a wrong version.

## Skills

`/grilling` and `/domain-modeling` for any design conversation; `/codebase-design` when shaping a module; `/tdd` for red–green work; `/writing-for-agents` when editing this file, a `CODING_RULES.md` or a skill; `/diagnosing-bugs` for anything broken or slow.

## Agent skills

### Issue tracker

Build tasks live in **ordna** (`storage: namespace` — git blobs at `refs/ordna/tasks/<id>`, no files on disk; use the `ordna` CLI); wayfinding maps and their tickets live as markdown under `.scratch/<effort>/`; GitHub Issues is the public inbound surface, not the work queue. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unrenamed — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` — applied as ordna **tags**, since ordna has no label field. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` and one `docs/adr/`; the workspaces are runtime tiers, not separate domains. See `docs/agents/domain.md`.

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
- With PostToolUse hooks installed (Claude Code), edited files are reindexed automatically.
- Otherwise `order { "action": "register_edit", "args": { "paths": [...] } }` after an edit, batched for bulk changes.

**Announce your model once per session** so the server can size its answers: `announce_model { "model": "<your-model-id>" }`.

