---
extends: feature, refactoring, bug-fix
when: A change that coins, renames or retires a domain word, moves an architecture decision, or solves a problem worth remembering.
---

# Knowledge

This repository keeps its words in `CONCEPTS.md`, its live decisions in `docs/solutions/architecture-patterns/` and its lessons in `docs/solutions/`. These changes apply each rule at the step where it matters. Look up an entry or a doc when a step names it. Do not pre-load either directory or the glossary.

- **In** "named data shape and its organizing structure", look up each domain noun of the data shape in `CONCEPTS.md`, one entry at a time, with jDocMunch `search_sections`. Never read the whole file. A noun with no entry gets one in the same change, in the entry template below. Before the delegate writes logic, work each noun four ways.
  - Challenge the user's word against its entry. If the user uses a word against its entry's meaning, raise it before any code.
  - Sharpen a fuzzy or overloaded word into the entry's word.
  - Test the word's edge with one concrete example that sits on the boundary.
  - Check that the code agrees with the entry, and raise any place where it does not.
- **In** "Name the structure the code is missing", look up and work the domain nouns as above.
- **In** "Plan the fix.", look up and work the domain nouns of the fix as above.
- **Before** "Run **Opening a PR**", check the change against the glossary and the two other homes.
  - A renamed domain word renames its entry's `###` head in `CONCEPTS.md` in the same change. The old word leaves the glossary. No line names it as a word to avoid.
  - If the change moves a decision, edit its doc in `docs/solutions/architecture-patterns/` in the same commit. The doc states what is true now. `docs/archive/adr/` is frozen.
  - Write a new decision doc only when the decision is hard to reverse, surprising without context, and the result of a real trade-off. Name it the next `adr-NNNN-<slug>.md`, give it the frontmatter the existing docs use, `applies_when` included, and land it with the code it decides.
  - If the change solved a problem, apply the counterfactual in `AGENTS.md` *Compounding*. Route a lesson that passes it through `/correct` first. Write a `docs/solutions/<category>/` doc only for the part no gate can hold, and fill in its `applies_when`.

## The entry template

An entry is a `###` head under its cluster's `##` heading, then a definition of one sentence. An entry a person meets is headed by the word they read on a page, in an MCP tool's text or answer, or in an email. `_Internal._` opens the definition of something no person meets, and that entry carries the name its code uses. A paragraph of rules follows when the entry has rules.

The glossary carries no lines of words to avoid. An entry that absorbs another does not name the word it replaced. A name the platform does not own keeps its code form.

```markdown
### knowledge layer

_Internal._ one of sources, bundles, the map.

Records are not a layer.
```
