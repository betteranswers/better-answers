---
title: "Guides and compositions are platform records that cite concepts and never restate them"
date: 2026-08-28
module: packages/core
problem_type: architecture_pattern
component: records
severity: high
applies_when:
  - "Adding a guide, a section, a composition or a response"
  - "Deciding whether a new key belongs in a concept file or in a platform record"
  - "Adding a reader-facing state for a guide, such as publishing or hiding it"
  - "Showing a guide or an answer while the map is unavailable"
tags:
  - adr-0004
  - guide
  - composition
  - skeleton-projection
  - context-wording
  - answer-concept
  - bundle-alone-test
---

# Guides and compositions are platform records that cite concepts and never restate them

## The decision

A guide definition and every composition are platform records in Postgres, with append-only versions and actor provenance. They cite concepts by IRI and never restate them. The bundle holds concepts only.

- A composition has two homes: a guide section and a response.
- The platform writes each guide's skeleton projection into the workspace repository: kind, subject, roles, and the ordered sections with their prompts and included concepts' IRIs. It holds no prose, is regenerated when the guide definition changes, and is never hand-edited.
- A Q&A pair is a concept, `type: Answer` (ADR 0011): the question as `title`, the answer as the body, and `sources[]` naming the entry it came from and the concepts it rests on. Its usage and submissions are records attached by IRI.
- A context wording lives on its concept as a named section of the body, chosen by an include (ADR 0014). There is no `variants:` key and no guide-shaped tag on a concept. A wording that states a different claim is a separate concept.
- A guide's readers are roles, and roles are levels: Admin, Editor, Viewer. Per role, the guide definition sets the default layer and the action threshold.
- A guide has no publish state. It is visible to its readers from the moment it exists, every section wearing its trust badge. A hidden section is a definition setting that Admins see marked, and coverage still counts it.
- A composition's shown trust is the weaker of its own and its cited concepts'. When a cited concept changes, the composition is marked *needs review* synchronously in Postgres.
- Status, trust, freshness and *changed since checked* are carried on the Postgres row, so the graph is never a hard dependency of a cited answer.
- The map degrades visibly in fixed words, carried in an answer's context header line and never its verdict. The glossary's two are *map as of <time>* and *map unavailable since <time>*.

## Why

- Guides are product functionality over knowledge, not knowledge. In every platform surveyed, the narrative page is a record that references and orders trust-bearing units, is never itself verified and is never exported.
- Generated prose stored as a file drifts by design. Prose that must stay current is a regenerated row with version and provenance.
- Prose in git would tie OKF to one product surface, fill the interchange format with UI-shaped state and make every guide edit a git commit.
- The skeleton keeps the promise that the map outlives the tool, for structure.
- The bundle-alone test governs every key and convention in a concept file: a company with no platform and no guides must still want it there. Q&A pairs and context wordings pass it, since the first client keeps both today with no platform. Guide-shaped tags do not.
- Moving prose between git and the database later would re-key every composition's version history and edges.

## Rejected

- Narrator concepts in the bundle: prose drifts, the bundle carries per-product UI state, and guides become git workflow for people.
- Database only, with no skeleton projection: gives up the structural portability no competitor offers.

## History

The full record, with its eight amendments (tickets 38, 45 and 46, 47, 16, 19, 20, 23 and 39): `docs/archive/adr/0004-guides-and-compositions-are-platform-records.md`.
