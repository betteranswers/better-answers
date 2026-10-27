---
extends: feature, refactoring, bug-fix
when: A change that coins, renames or retires a domain word, moves an architecture decision, or solves a problem worth remembering.
---

# Knowledge

This repo's domain documentation:

- `CONCEPTS.md` — the glossary at the repo root. 
- `docs/solutions/architecture-patterns/` — the live architecture decisions.
- `docs/solutions/` — lessons learned.

- **In** "named data shape and its organizing structure", look up each domain noun of the data shape in `CONCEPTS.md`, one entry at a time, with jDocMunch `search_sections`. Do not read the whole file. If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap - apply the principles, and if you're unable to resolve, note it for the owner.
- **In** "Name the structure the code is missing", look up and work the domain nouns as above.
- **In** "Plan the fix.", look up and work the domain nouns of the fix as above.
- **Before** "Run **Opening a PR**", check the change against the glossary and the two other homes.
  - A renamed domain word renames its entry's `###` head in `CONCEPTS.md` in the same change. The old word leaves the glossary. No line names it as a word to avoid.
  - If the change moves a decision, edit its doc in `docs/solutions/architecture-patterns/` in the same commit. The doc states what is true now, edited in place, not as an amendment.
  - Write a new decision doc only when the decision is hard to reverse, surprising without context, and the result of a real trade-off. Name it the next `adr-NNNN-<slug>.md`, give it the frontmatter the existing docs use, `applies_when` included, and land it with the code it decides.
  - If the change fixed a mistake, correction, or is a notable codebase learning, route the lesson through `/correct`. Write a `docs/solutions/<category>/` doc only for the part no gate can hold, and fill in its `applies_when`.

## Glossary entry template

A glossary entry is a `###` head under its cluster's `##` heading, then a definition of one sentence. An entry a person meets is headed by the word they read on a page, in an MCP tool's text or answer, or in an email. `_Internal._` covers definitions for concepts which aren't user-facing. Relevant rules follow when the entry has rules.

```markdown
### knowledge layer

_Internal._ one of sources, bundles, the map.

Records are not a layer.
```
