# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one root `CONTEXT.md` and one set of decisions in `docs/solutions/architecture-patterns/`. The pnpm and uv workspaces (`apps/*`, `packages/*`) are runtime tiers, not separate domains — they share one vocabulary by design.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary.
- **`docs/solutions/architecture-patterns/`** — the live architecture decisions. Read the ones that touch the area you're about to work in.
- **`AGENTS.md`** — the map: layout, how a task is worked, which skill to reach for.
- **`CODING_STANDARDS.md`** — the constitution. A workspace's own rules live in `apps/api/CODING_STANDARDS.md`, `apps/web/CODING_STANDARDS.md` and `apps/worker/CODING_STANDARDS.md`; read a workspace's file too when changing it.
- **`docs/okf-v02.md`** — read before adding a key, convention or feature that touches a concept file.

## File structure

```
/
├── AGENTS.md          ← the map (CLAUDE.md is a one-line pointer to it)
├── CONTEXT.md         ← the glossary
├── CODING_STANDARDS.md    ← the constitution
├── VISION.md          ← the destination
├── docs/
│   ├── okf-v02.md
│   ├── solutions/     ← what past work learned; architecture-patterns/ holds the decisions
│   └── archive/       ← frozen: the ADRs and specs from before Compound Engineering
├── apps/
│   ├── api/           ← + apps/api/CODING_STANDARDS.md
│   ├── web/           ← + apps/web/CODING_STANDARDS.md
│   └── worker/        ← + apps/worker/CODING_STANDARDS.md
├── packages/{core,schema}
└── contracts/         ← the tier contract's fixtures (ADR 0031)
```

## Use the glossary's vocabulary

When your output names a domain concept (in a task title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

`CONTEXT.md` states the stronger rule this repo actually runs on: **a new domain word is settled in the glossary before it appears in code**, and a term moves into the glossary only once it has been settled in a wayfinder ticket. So if the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for the next `/ce-brainstorm`).

## Flag decision conflicts

If your output contradicts a decision in `docs/solutions/architecture-patterns/`, surface it explicitly rather than silently overriding:

> _Contradicts ADR 0007 (plain Postgres, app-owned migrations) — but worth reopening because…_

## Where a changed decision lands

A decision's doc states what is true now. A change that moves it edits the doc in place, in the same commit as the code; git keeps the history. The ADRs these docs came from, amendments and struck text included, are frozen in `docs/archive/adr/`: read one there when you need how a decision got to where it is.
