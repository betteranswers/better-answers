---
title: "Trust is derived from the file, told in fixed words, and moved only by a check"
date: 2026-09-05
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: high
applies_when:
  - "Showing a concept's trust word or rider to a reader"
  - "Checking a concept, or computing or comparing its content hash"
  - "Writing, importing or erasing an actor id in a concept file"
tags:
  - adr-0019
  - trust
  - verify
  - content-hash
  - actor-id
  - erasure-pseudonym
  - deprecated
---

# Trust is derived from the file, told in fixed words, and moved only by a check

## The decision

Everything a reader is told about a concept's trust is derived from its OKF file, by the spec's own rules, and never stored in it. It is told in a fixed set of words and moved only by a check.

- Verifier ≠ generator, enforced on the producer part of the actor string.
- The words are *Verified by*, *Verified automatically*, *Unverified*, *Changed since verified*, *Out of date*, *Draft*, *Left* and *Deprecated*, plus two riders, *· imported* and *· source moved on*. A rider never changes the tier. *Restricted* is a sensitivity value only.
- *Out of date* comes from `stale_after` alone. Its absence means no shelf life.
- *Changed since verified* comes from `content_hash`: RFC 8785 canonical JSON of the frontmatter without `generated`, `verified`, `stale_after`, `status` and `iri`, with `sources[]` reduced to ordered `(resource, locator)` pairs, plus the normalised body.
- Supersession is derived, never keyed: only a citation of a deprecated concept of the same `type` is a succession.

A person in a file is `human:<email>`.

- It is rewritten only on a valid erasure request, across history, to `human:<erasure pseudonym>`. A reader then sees *Verified by a former member*.
- The erasure pseudonym is a per-workspace id minted at erasure. It is never the person id (ADR 0035).
- On a record the platform keeps, a person is `human:<person id>`, which no routine rewrites.

## Why

- The file is the substrate any OKF consumer reads. A word the platform shows that another consumer of the same file could not derive would make the platform disagree with the bundle it exports.
- The words follow OKF's own. A concept file records `verified` events, so a reader of the raw file and a reader of a page meet one word.
- A hash two parsers must agree on has to be a specification, not a description.
- A check must mean a second pair of eyes wherever the word appears, or it means less than it says.
- Any citation of a deprecated concept is a derivation, and only a same-type one is a succession. Without that rule *use the successor* repoints a Brief at the wrong concept.
- The email in `human:<email>` is itself a credibility signal a reader of the raw file wants, as in Google's samples.
- The pseudonym is per workspace so that two workspaces' rewritten histories cannot be joined on one person. The `human:` prefix survives the rewrite, so the tier derived from it does too.

## Rejected

- The platform writing `stale_after` on every check: policy dressed as knowledge.
- An absent `stale_after` read as a computed shelf life: contradicts every other consumer of the same file.
- A workspace-wide twelve-month cadence: treats a company address like an insurance certificate.
- Owner-only checking, or checking by any role: one person's queue, or a thumbs-up.
- Hashing the body only, or every source key: a swapped source keeps its check, or a title fix un-checks.
- Opaque per-member ULIDs in the file: the email is the signal a reader wants, and the erasure map carries the cost.
- Imported checks earning no tier, counting for actions, or a platform-origin threshold by default.
- Parsing the `Supersedes:` body line, a `superseded_by` key, or any link into a deprecated concept counting as succession.
- Two reader words for a source that moved on, or folding it into *Changed since verified*.
- A check as the only road from draft to stable: a second person before any typed Answer is usable.
- File-relative links on emit: they break when a file moves directories.

## History

The full record, with its two amendments (ticket 24 on the erasure line, T-073 on the erasure pseudonym): `docs/archive/adr/0019-trust-derived-from-the-file.md`.

Amended 03/10/2026 by the glossary plan (`docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`, R4 and R5). The trust words became the reader's words listed above, and *Restricted* left the set to stay a sensitivity value. The tiers, the derivation and every rule above stand.
