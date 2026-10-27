---
extends: feature, refactoring, bug-fix
when: A change that coins, renames or retires a domain word, moves an architecture decision, or solves a problem worth remembering.
---

# Knowledge

This repo's domain documentation:

- `GLOSSARY.md` — the glossary at the repo root. 
- `docs/solutions/architecture-patterns/` — the live architecture decisions.
- `docs/solutions/` — lessons learned.

- **In** "named data shape and its organizing structure", look up each domain noun of the data shape in `GLOSSARY.md`, one entry at a time, with jDocMunch `search_sections`. Do not read the whole file. If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap - apply the principles, and if you're unable to resolve, note it for the owner.
- **In** "Name the structure the code is missing", look up and work the domain nouns as above.
- **In** "Plan the fix.", look up and work the domain nouns of the fix as above.
- **Before** "Run **Opening a PR**", check the change against the glossary and the two other homes.
  - When a term is resolved, update `GLOSSARY.md` right there. Don't batch these up: capture them as they happen. Use the format in `.agents/references/glossary-format.md`.
  - If the change moves a decision, edit its doc in `docs/solutions/architecture-patterns/` in the same commit. The doc states what is true now, edited in place, not as an amendment. Use the format in `.agents/references/adr-format.md`.
  - If the decision is hard to reverse, surprising without context, and the result of a real trade-off, it may warrant a new ADR. Use `.agents/references/adr-format.md` to determine if the decision qualifies, and if it does, create the ADR using the format.
  - If the change fixed a mistake, correction, or is a notable codebase learning, route the lesson through `/correct`. Write a `docs/solutions/<category>/` doc only for the part no gate can hold, and fill in its `applies_when`.