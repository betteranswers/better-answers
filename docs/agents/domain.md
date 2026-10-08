# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one root `CONCEPTS.md` and one set of decisions in `docs/solutions/architecture-patterns/`. The pnpm and uv workspaces (`apps/*`, `packages/*`) are runtime tiers, not separate domains — they share one vocabulary by design.

## Before exploring, read these

- **`CONCEPTS.md`** at the repo root — the glossary.
- **`docs/solutions/architecture-patterns/`** — the live architecture decisions. Read the ones that touch the area you're about to work in.
- **`AGENTS.md`** — the map: layout, how a task is worked, which skill to reach for.
- **`CODING_STANDARDS.md`** — the constitution. A workspace's own rules live in `apps/api/CODING_STANDARDS.md`, `apps/web/CODING_STANDARDS.md` and `apps/worker/CODING_STANDARDS.md`; read a workspace's file too when changing it.
- **`docs/okf-v02.md`** — read before adding a key, convention or feature that touches a concept file.

## File structure

```
/
├── AGENTS.md          ← the map (CLAUDE.md is a one-line pointer to it)
├── CONCEPTS.md        ← the glossary
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

When your output names a domain concept (in a task title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONCEPTS.md`. Don't drift to a synonym.

The rule this repo runs on: **a domain word code uses is defined in `CONCEPTS.md` in the same change, or before it**. Compound Engineering's skills keep the file: `ce-brainstorm` and `ce-plan` add the terms a dialogue or a plan settles, and `ce-compound` and `ce-compound-refresh` add, refine, fold and retire entries as CE's rules for the file define. Each edit shows in its pull request's diff. The exceptions that hold here are in the glossary's own opening paragraph. So if the concept you need isn't in the glossary yet, either you're inventing language the project doesn't use (reconsider) or there's a real gap (define it in the same change).

## Flag decision conflicts

If your output contradicts a decision in `docs/solutions/architecture-patterns/`, raise it explicitly rather than silently overriding. Say the decision in words, and name its doc only where a reader can open it, never in code:

> _Contradicts the decision that the database is plain Postgres and the api owns every migration (`adr-0007-plain-postgres-and-app-owned-migrations.md`) — but worth reopening because…_

## Where a changed decision lands

A decision's doc states what is true now. A change that moves it edits the doc in place, in the same commit as the code; git keeps the history. The ADRs these docs came from, amendments and struck text included, are frozen in `docs/archive/adr/`: read one there when you need how a decision got to where it is.
