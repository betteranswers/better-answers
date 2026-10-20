---
title: "Guides and write-ups are platform records that cite concepts and never restate them"
date: 2026-08-28
module: packages/core
problem_type: architecture_pattern
component: records
severity: high
applies_when:
  - "Adding a guide, a section, a write-up or a response"
  - "Deciding whether a new key belongs in a concept file or in a platform record"
  - "Adding a reader-facing state for a guide, such as publishing or hiding it"
  - "Showing a guide or an answer while the map is unavailable"
tags:
  - adr-0004
  - guide
  - write-up
  - skeleton-projection
  - context-wording
  - answer-concept
  - bundle-alone-test
---

# Guides and write-ups are platform records that cite concepts and never restate them

## The decision

A guide definition and every write-up are platform records in Postgres, with append-only versions and actor provenance. They cite concepts by IRI and never restate them. The bundle holds concepts only.

- A write-up has two homes: a guide section and a response.
- The platform writes each guide's skeleton projection into the workspace repository: kind, subject, roles, and the ordered sections with their role labels, their prompts and their included concepts' IRIs. It holds no prose, is regenerated when the guide definition changes, and is never hand-edited.
- A Q&A pair is a concept, `type: Answer` (ADR 0011): the question as `title`, the answer as the body, and `sources[]` naming the entry it came from and the concepts it rests on. Its usage and submissions are records attached by IRI. A guide's FAQ or Bid Reference section is a view over them (ADR 0011).
- A context wording lives on its concept as a named section of the body, chosen by an include (ADR 0014). There is no `variants:` key and no guide-shaped tag on a concept. A wording that states a different claim is a separate concept. A concept's `tags` may name, in company language, the contexts it carries wordings or answers for.
- A guide's readers are roles, and roles are levels: Admin, Editor, Viewer. Per role, the guide definition sets the default layer and the action threshold. A reader opens a guide on their role's default layer, and opens a section's Detail in place beneath its Brief.
- An action threshold names a trust rung and an origin, *platform* or *any*. It defaults to any origin, so an imported check clears it. An Admin tightens a guide where a pasted answer must stand on a platform check. The action gate follows the reader's role, never the layer they are viewing.
- A guide has no publish state. It is visible to its readers from the moment it exists, every section wearing its trust badge. Hiding a section is a setting in the guide definition. Admins see a hidden section marked, and coverage still counts it. Hiding a section is never a way to keep an unchecked section from its readers.
- A write-up's shown trust is the weaker of its own and its cited concepts'. When a cited concept changes, the write-up is marked *needs review* synchronously in Postgres. Its prose flags that citation inline as citing a concept that changed. The write-up is still shown, never served silently and never withheld. Its prose is not refreshed on its own. A rewrite waits as a suggestion (ADR 0014, ADR 0017).
- Status, trust, freshness and *Changed since verified* are carried on the Postgres row, so the map is never a hard dependency of a cited answer.
- When the map degrades, it shows in fixed words. An answer carries them in its context header line, never in its verdict. The glossary's two are *map as of <time>* and *map unavailable since <time>*.

Guides are S3's, so none of the guide side is in the tree yet: the guide definition, its sections and skeleton projection, layers and thresholds, hidden sections, and the *needs review* mark. Today a write-up and its includes exist for visibility alone.

## Why

- Guides are product functionality over knowledge, not knowledge. In every platform surveyed, the narrative page is a record that references and orders trust-bearing units, is never itself verified and is never exported.
- Generated prose stored as a file drifts by design. Prose that must stay current is a regenerated row with version and provenance.
- Prose in git would tie OKF to one product feature, fill the interchange format with UI-shaped state and make every guide edit a git commit.
- For structure, the skeleton keeps the promise that the map outlives the tool.
- The bundle-alone test governs every key and convention in a concept file: a company with no platform and no guides must still want it there. Q&A pairs and context wordings pass it, since the first customer keeps both today with no platform. Guide-shaped tags do not.
- A concept's body is a plain statement of the knowledge. The register a tender needs is the write-up's job, never the concept's.
- Moving prose between git and the database later would re-key every write-up's version history and edges.

## Rejected

- Narrator concepts in the bundle: prose drifts, the bundle carries per-product UI state, and guides become git workflow for people.
- Database only, with no skeleton projection: gives up the structural portability no competitor offers.

## History

The full record, with its eight amendments (tickets 38, 45 and 46, 47, 16, 19, 20, 23 and 39): `docs/archive/adr/0004-guides-and-compositions-are-platform-records.md`.

Later decisions overturned four rules of the record:

- A third degraded phrase, *map as of <time> · updating*, showed during a rebuild. ADR 0023 and ADR 0032 put the map in the same Postgres, and `CONCEPTS.md` keeps two phrases.
- The successor chase fell back one hop to a successor IRI on the concept index row. ADR 0019 derives supersession and keys none, and lineage is a `SUPERSEDES` edge.
- Deleting a cited concept left a "cited concept no longer exists" state. ADR 0012 gives a concept two endings, and a cited one is deprecated, never discarded.
- Audience tags on an `Answer` were records attached by IRI. ADR 0039 carries an audience as a visibility pair on the concept index.

The section's role label, the FAQ view, the tags that name contexts, the default layer and the in-place Detail, the threshold's origin, the action gate, the refusal to hide an unchecked section, the inline flag and the concept body's register were missing from this doc until 20/10/2026 (BA-215).
