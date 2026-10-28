# AGENTS.md

A living company knowledge map for UK SMBs, built on the Open Knowledge Format (OKF).

## Repository context

- `VISION.md` — the destination this repo builds towards.
- `GLOSSARY.md` — the glossary.
- `docs/specs/` — `v01-route.md` with `route/` is the route spec. `v01-stories.md` holds the v0.1 user stories.
- `docs/okf-v02.md` — what OKF defines, what it leaves open, and where each lands here. Read it before adding a key, convention or feature which impacts to the knowledge layer (bundles, concepts, search).
- `docs/plans/` — unified plan artifacts.

## Directory Layout

| Path | What it is |
| --- | --- |
| `apps/api/` | Hono on Node. Holds transports only |
| `apps/web/` | Vite React single-page app. It talks to `apps/api/` over tRPC only |
| `apps/worker/` | Python knowledge worker (uv). |
| `packages/core/` | The business logic `apps/api` calls: capability slices over four store doors. Transport-agnostic |
| `packages/devtools/` | The repository's gate tooling |
| `packages/` | The rest of the shared TypeScript: `schema`, `design-system` |
| `contracts/` | The tier contract's language-neutral fixtures |
| `docs/personas/` | Personas used for dogfooding |
| `docs/operations/` | Public-facing ops documents. Documents that are not public-facing are under `.planning/estate/` |
| `deploy/` | Compose files and deployment configuration |
| `.cubic/wiki/` | Cubic's generated wiki |

## Coding

- Read the environment in the tier's config module. Pass it to a child process through one named function.
- No backward compatibility by default. No `omitempty` shims, no legacy fallbacks, no dual-path support. Only add compat when explicitly requested.

## Testing

- Test through the interface a caller crosses: `apps/api` through `server.request(...)`, `apps/worker` through the job or module entry point, `packages/core` through an entry its `exports` map names, and `apps/web` as a browser drives the served build, or a component through Testing Library.
- Use the real Postgres, object store, git repository and map. An in-memory adapter should only be used for a third-party service, e.g., an LLM provider.
- Postgres aborts the transaction after a failed statement, even a caught one. Assert the rejection or the rows before any returned value if the intention is for a test to provoke a failure.

## Secrets

- `docs/operations/SECRETS.md` says where each secret lives (ADR 0052). The tier's config module reads a deployment's secret once. A workspace's or a person's secret is a row in the database and never comes from the environment. Never log a secret.

## Agent skills

### Workflow

Use `pstack` skills. 

Day-to-day workflow: `/poteto-mode <goal and definition of done>` - name the goal and how to tell it is done, not the skills.

The project playbooks in `.agents/playbooks/` add this repository's steps to pstack's.

Until v0.1 the session lands its own pull request, with no press from the owner, once the verdict is `PASS` or `PASS+NOTES`.

The verifier records its Shipping verdict as a commit status on the verified head, context `verdict`: `success` for PASS or PASS+NOTES, `failure` for FAIL, and a description naming the verdict and the verifier, for example `gh api repos/{owner}/{repo}/statuses/<sha> -f state=success -f context=verdict -f description='PASS by <verifier>'`. The merge queue refuses a head without it.

### Issue tracker

The backlog lives in **Linear** - accessed via the `linear-server` MCP.  See `docs/agents/issue-tracker.md`.

### Lessons learned

`docs/solutions/` is the repository's memory of solved problems, organized by category with YAML frontmatter. Look up the docs whose `applies_when` matches the area you are working in.

### Mutation triage

A mutation survivor is a hypothesis until a probe verifies it. See `docs/agents/mutation-triage.md`.

### Cloud sessions

When a session runs in a cloud environment, see `docs/agents/cloud-sessions.md`.

## Code and doc exploration

The jCodeMunch policy, its front-door tools and how to read their results are here: `~/.claude/CLAUDE.md`. A global hook refuses raw reads of code.

### After editing files

- A login service reindexes on any change on disk.
- After a change made another way (a Bash edit, a delete, a rename), call `order { "action": "register_edit", "args": { "paths": [...] } }`.

### Docs 

Use jDocMunch to find and read this repository's indexed Markdown:

- Start with `doc_resolve_repo` on `.`.
- Find a passage with `search_sections`, and read it with `get_section` or `get_sections`.
- Open a long file's structure with `get_document_outline` before reading any of it.

Read a doc directly when you will work through all of it (a plan you are carrying out), when you are about to edit it, or when a command needs it raw, such as a grep that also covers code.

<!-- gitnexus:start -->
<!-- gitnexus:keep -->
## Gitnexus Policy

This project is indexed by GitNexus as **better-answers**. Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root.

### Use it for

- The blast radius of a change to a symbol other code calls: `impact({target: "symbolName", direction: "upstream"})`.
- The symbols and flows a large diff touches: `detect_changes()`.
- Full context on a symbol — callers, callees, the flows it takes part in: `context({name: "symbolName"})`.
- Security review: `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

### Renames

- Rename a symbol with `rename` as it follows the call graph, not find-and-replace.

## From a worktree

GitNexus `analyze` runs after every merge to `main`; the runner is absent from a worktree.

- `detect_changes` takes `worktree: <the worktree's absolute path>`.
- An `impact` that answers *ambiguous* is re-run by `target_uid` before its risk counts.
- `rename` stays a dry run. It reads **and writes** the main checkout's files.

### Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/better-answers/context` | Codebase overview, check index freshness |
| `gitnexus://repo/better-answers/clusters` | All functional areas |
| `gitnexus://repo/better-answers/processes` | All execution flows |
| `gitnexus://repo/better-answers/process/{name}` | Step-by-step execution trace |

<!-- gitnexus:keep -->
<!-- gitnexus:end -->
