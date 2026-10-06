---
name: survey-architecture
description: Surveys the whole codebase for modules worth reshaping — picks areas from git history and GitNexus, walks each for friction against this repository's design rules and decisions, rebuilds each proposal from first principles, and writes an annotatable report of opportunities. Use before a route block that the route spec holds behind an architecture review, or when the owner names an area to survey. Use `ce-code-review` for a diff. Invoked as `/survey-architecture`, optionally followed by an area.
disable-model-invocation: true
---

# Survey the architecture

The survey produces one report of **opportunities**: places in the code where a different shape would make the next route block easier to build and to test. The owner reads and annotates the report. Then the architecture review, which runs through `/ce-brainstorm`, starts from it. The run is done when the report and its markdown copy exist with every field of every opportunity filled, or when a stop names what was missing. The report says what the run did without, so a thin result is never mistaken for a full one.

Nothing measures depth. `CODING_STANDARDS.md` says so in its deep-module rule. This survey supplies the judgement that no gate makes, so it reports what the gates and the diff reviewers cannot see and leaves out what they already hold.

Invoking this skill authorizes reading anything in the checkout, running read-only git, GitNexus and code-index queries, dispatching read-only subagents, writing the report's two files and opening the report in `lavish-axi`. It does not authorize editing code, `CONCEPTS.md`, `CODING_STANDARDS.md`, a decision doc or an issue. The review that follows owns those changes.

Each reference below is read at the step that names it. A read made earlier does not count.

## 1. Choose the areas

An area is one of these:
- a slice under `packages/core/src/`;
- a directory under `apps/api/src/`, `apps/web/src/` or `apps/worker/src/`, one level deeper under `apps/worker/src/better_answers_worker/` and `apps/web/src/features/`;
- the source folder of any other package, such as `packages/schema/src/`.

The files that sit directly in one of these folders, such as `apps/api/src/server.ts`, form an area of their own, named by the folder.

**When the owner named an area,** resolve it to areas.
- If each path or slice name the owner gave matches exactly one area, survey those areas alone.
- If one matches several areas, or if the owner described a pain point rather than a place, list the areas it points to and ask which to survey. Wait for the answer.
- If one matches none, stop and list the areas the history recipe below finds.

**When no area was named,** pick the areas from the history recipe and GitNexus. The recipe is `scripts/churn.sh` in this skill's directory; run it from the repository root. It counts commits per area over the last 30 days and leaves out commits that touch more than 4 areas, because mechanical sweeps dominate raw churn here. Its last line counts the commits it left out:

```bash
bash .claude/skills/survey-architecture/scripts/churn.sh 30 4 HEAD
```

The arguments are the window in days, the area cap and the ref. Record all three, and the number of commits left out, for the report header. Then:
- Take the five areas with the most commits.
- Add an area a GitNexus community crosses into from a picked area, even if that area is quiet. A community spanning two slices is itself a signal. Rank such quiet areas by size and callers.
- Stop at eight areas, so each walk can read its area in full.

**What GitNexus can and cannot tell you.** Its communities, their cohesion and their callers rank areas and point at seams.
- Key a community by its id, never its label, because labels repeat.
- GitNexus reads the main checkout's index, even from a worktree. For each area, compare the index's commit with the last commit on the surveyed ref that touched the area. Where the index is older, say so in the header and use the history recipe and jCodeMunch for that area.
- Caller counts are a lower bound wherever dispatch is indirect. Between the TypeScript tiers and the Python worker they are zero by construction, because the tiers meet through tables and `contracts/`.
- Test files are not indexed, so read tests through jCodeMunch.
- If GitNexus is unavailable, pick from the history recipe alone and say so in the header.

## 2. Walk each area

Dispatch one read-only subagent per area, all in one response. A walk reads far more than it returns. Give each walker the area's paths, the parts of this step it needs and the shape to return. Tell it to edit nothing and to ask the owner nothing.

**Friction to look for.** Explore the area. Do not run a checklist. Note where it is hard to work:
- Understanding one concept means bouncing between many small modules.
- A module's interface is nearly as complex as its implementation.
- Pure functions were pulled out for testing, while the defects live in how they are called.
- Modules leak across the seam between them.
- Code is untested, or hard to test through the interface a caller crosses.

Apply the deletion test to anything that looks shallow. Ask whether deleting it would concentrate complexity or only move it. Concentrating is the signal.

**The rules to judge against.**
- The Design and Tests sections of `CODING_STANDARDS.md`, plus the standards file beside the area (`apps/api/CODING_STANDARDS.md`, `apps/web/CODING_STANDARDS.md`, `apps/worker/CODING_STANDARDS.md`). Cite each rule by its heading, word for word.
- The decisions in `docs/solutions/architecture-patterns/`. Match an area to its decisions by each doc's `module` and `applies_when` frontmatter instead of reading all of them. `docs/solutions/architecture-patterns/adr-0029-apps-over-packages-capability-slices.md` gives the slice vocabulary and the shapes it rejected. A matching door list in two slices is not duplication: a slice gets its own type for the doors it takes.
- `CONCEPTS.md` for the names. A module named off-glossary is friction worth noting.

**Leave out what a gate already holds for that tier.** The TypeScript gates are the `check:gates` script in the root `package.json` and the rules in `.oxlintrc.json`, which include import direction for `packages/core` only, cycles and the complexity cap. The worker's gates are the ruff settings in `apps/worker/pyproject.toml`. Where a rule could be gated and is not, the opportunity names that gap. The fix for it is a Linear issue, never an edit to `CODING_STANDARDS.md`.

**Rebuild each opportunity from first principles.** The proposal is not limited to deepening a module. It may merge, split or delete modules, move a seam, or reopen a decision, whichever shape the facts support.
- When this checkout has the `first-principles` skill (`.agents/skills/first-principles/SKILL.md`), read it as a method. Do not invoke it: it asks the owner one question at a time, and the walk asks nothing. Fill each of its buckets from the code, docs and history. Each unknown that reading cannot settle becomes an open question on the opportunity, for the review.
- When it is absent, use the same frame. State the facts, the constraints, the assumptions and the unknowns, then what the module must do, before choosing its shape. Say in the header that the skill was absent.

**The test note.** Read `references/deepening.md` from this skill's directory when writing each proposal's test note.

**What each walker returns,** per opportunity:
- the files involved
- the problem
- the rule heading it breaks
- the proposed shape, before and after
- the test note
- a recommendation strength: Strong, Worth exploring or Speculative
- any decision doc it conflicts with, by path and as `ADR NNNN`, named only when the friction is real enough to reopen that decision
- open questions

It also returns what it walked and found nothing in, with one line on why.

## 3. Write the report

Read `references/report.md` from this skill's directory now. It gives the files, their names and place, the header, the card, the diagrams and how the report opens.

When no opportunity survives the walks, still write the report. List the areas walked and why nothing qualified, so the review knows they were covered.

## 4. Hand off

End the run with the hand-off lines `references/report.md` gives: the report's path, its markdown copy, how to collect the owner's annotations and the next step, `/ce-brainstorm`. Then stop. The review starts in its own session.
