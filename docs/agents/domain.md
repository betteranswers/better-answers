# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one root `CONCEPTS.md` and one set of decisions in `docs/solutions/architecture-patterns/`. The pnpm and uv workspaces (`apps/*`, `packages/*`) are runtime tiers, not separate domains — they share one vocabulary by design.

## Before exploring, read these

- **`CONCEPTS.md`** at the repo root, the glossary. Look up the entry for each domain word you meet with `search_sections`, one entry at a time. Do not read the whole file.
- **`docs/solutions/architecture-patterns/`** — the live architecture decisions. Read the ones that touch the area you're about to work in.
- **`AGENTS.md`** — the map: layout, how a task is worked, which skill to reach for.
- **`CODING_STANDARDS.md`** — the constitution. A directory's own rules live in its `AGENTS.md`, which loads when work reaches it.
- **`docs/okf-v02.md`** — read before adding a key, convention or feature that touches a concept file.

## File structure

```
/
├── AGENTS.md          ← the map
├── CONCEPTS.md        ← the glossary
├── CODING_STANDARDS.md    ← the constitution
├── VISION.md          ← the destination
├── docs/
│   ├── okf-v02.md
│   ├── solutions/     ← what past work learned; architecture-patterns/ holds the decisions
│   └── archive/       ← frozen: original ADRs and specs
├── apps/
│   ├── api/
│   ├── web/
│   └── worker/
├── packages/{core,schema}
└── contracts/         ← the tier contract's fixtures
```

## Use the glossary's vocabulary

When your output names a domain concept (in a task title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONCEPTS.md`. Don't drift to a synonym.

The rule this repo runs on: **a domain word code uses is defined in `CONCEPTS.md` in the same change, or before it**. The change that settles a term adds, refines, folds or retires its entry, under the rules in the glossary's own opening paragraph. So if the concept you need isn't in the glossary yet, either you're inventing language the project doesn't use (reconsider) or there's a real gap (define it in the same change).

## Flag decision conflicts

If your output contradicts a decision in `docs/solutions/architecture-patterns/`, raise it explicitly rather than silently overriding. Say the decision in words, and name its doc only where a reader can open it, never in code:

> _Contradicts the decision that the database is plain Postgres and the api owns every migration (`adr-0007-plain-postgres-and-app-owned-migrations.md`) — but worth reopening because…_

The one exception is a hand-written migration's first line, `-- Custom migration (hand-written SQL; ADR 0032).`, which is a tag that `packages/schema/test/migration-ownership.test.ts` matches exactly, not a citation.

## Where a changed decision lands

A decision's doc states **what is true now**. The step that edits it in place, in the same commit as the code, is in `.agents/playbooks/knowledge.md`; git keeps the history. The ADRs these docs came from, amendments and struck text included, are frozen in `docs/archive/adr/`: read one there when you need how a decision got to where it is.
