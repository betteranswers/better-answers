# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one root `CONTEXT.md` and one `docs/adr/`. The pnpm and uv workspaces (`app/`, `web/`, `worker/`, `packages/*`) are runtime tiers, not separate domains — they share one vocabulary by design.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **`AGENTS.md`** — the map: layout, how a task is worked, which skill to reach for.
- **`CODING_RULES.md`** — the constitution. Tier rules live in `app/CODING_RULES.md` and `worker/CODING_RULES.md`; read the tier's file too when changing that tier.
- **`docs/okf-v02.md`** — read before adding a key, convention or feature that touches a concept file.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── AGENTS.md          ← the map (CLAUDE.md is a one-line pointer to it)
├── CONTEXT.md         ← the glossary
├── CODING_RULES.md    ← the constitution
├── docs/
│   ├── okf-v02.md
│   ├── vision.md
│   └── adr/           ← 0001…0027
├── app/               ← + app/CODING_RULES.md
├── web/
├── worker/            ← + worker/CODING_RULES.md
└── packages/{schema,contracts}
```

## Use the glossary's vocabulary

When your output names a domain concept (in a task title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

`CONTEXT.md` states the stronger rule this repo actually runs on: **a new domain word is settled in the glossary before it appears in code**, and a term moves into the glossary only once it has been settled in a wayfinder ticket. So if the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

`AGENTS.md` sharpens this: a change that contradicts an ADR is **a new ADR, never a quiet edit**. Where an ADR and a `.scratch/` ticket disagree, the ADR wins — several `.scratch/v01-spec/issues/` tickets still carry text superseded by ADRs 0023, 0024 and 0026.

## Where an amendment lands

ADRs here amend each other in place (ADR 0023 supersedes 0021; 0026 removes the vocabulary file; 0027 renames the notices file). When you read an ADR, read to the bottom — the amendment sections are load-bearing, and the pre-build gate (`T-001`) exists because six of them once amended earlier files by notes those files did not carry.
