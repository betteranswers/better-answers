---
title: "Trust is derived from the file, told in fixed words, and moved only by a verification"
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

# Trust is derived from the file, told in fixed words, and moved only by a verification

## The decision

Everything a reader is told about a concept's trust is derived from its OKF file, by the spec's own rules, and never stored in it. It is told in a fixed set of words and moved only by a check.

- Verifier ≠ generator, enforced on the producer part of the actor string. Nobody may verify a version they made. That rules out both the person whose edit made the current version of a concept or write-up, nor the person who accepted the rewrite that made it. The owner stays answerable.
- A verification needs view on every source the concept cites. Otherwise the page says *cannot check, source restricted*.
- Every verification row carries its origin: `platform`, `imported`, `citation-fix` or `erasure-rewrite`. An imported verification has no content hash, so it never reads *Changed since verified*, and its verification interval counts from its `at`.
- The words are *Verified by*, *Verified automatically*, *Unverified*, *Changed since verified*, *Out of date*, *Draft*, *Left* and *Deprecated*, plus two riders, *· imported* and *· source moved on*. A rider never changes the tier. *Restricted* is a sensitivity value only.
- *Out of date* comes from `stale_after` alone. Its absence means no shelf life. `stale_after` is read as a date or as a datetime with an offset, and written as the UTC date.
- *Changed since verified* comes from `content_hash`: canonical JSON of the frontmatter, keys sorted and each value as its JSON text, without `generated`, `verified`, `stale_after`, `status` and `iri`, with `sources[]` reduced to ordered `(resource, locator)` pairs, plus the normalised body.
  - Each `sources[].resource` path is resolved to its `/abs.md` form first. The parser reads a path written as `/abs.md`, `./rel.md` or bare `dir/x.md`.
  - The body has `\r\n` turned into `\n`, trailing whitespace stripped from each line, and exactly one trailing newline.
  - So renaming a heading or swapping a source changes the hash. Fixing a source's title, writing a source path in another form, or editing `stale_after` does not.
- Supersession is derived, never keyed: only a citation of a deprecated concept of the same `type` is a succession. Every commit that deprecates a concept revisits its inbound lineage, so each citing concept's edge is relabelled `SUPERSEDES` or `DERIVED_FROM`.
- A draft `Answer` with no evidence cannot be verified. Its owner or an Admin moves it to `stable` once evidence is attached.

The code owns four keys of a concept file: `iri`, `generated`, which moves only when the content hash moves, the `verified` events the platform writes, and `status` on deprecation. Every normaliser is a pure function in `packages/`, and the worker has its twin.

Decided and not yet in the tree:

- The verify action, with its refusal of a version's maker and the verification interval.
- A supersession chain walked with a visited set to its newest concept that is not deprecated, where `find` and `ask` land.
- One *cited concept deprecated* verification request for each write-up that cites a deprecated concept, with *use the successor* inline.
- A filter on Knowledge that includes deprecated concepts, for Admins only.
- `generated` moved when the hash moves, and `stale_after` written by the platform.
- The import rewriting each file once in Google's key order, and round-trip tests in CI on Google's four sample bundles and openwiki's wiki.
- The actor alias as a record attached by IRI, and `sources[].author` stripped for documents of company origin.

A person in a file is `human:<email>`.

- Only an erasure, on a valid request, rewrites it, across history, to `human:<erasure pseudonym>`. A reader then sees *Verified by a former member*.
- The erasure pseudonym is a per-workspace id minted at erasure. It is never the person id (ADR 0035).
- On a record the platform keeps, a person is `human:<person id>`. An erasure rewrites it to `human:<erasure pseudonym>` on the records ADR 0020 lists: `bundle_commit`, `concept_verification`, the commit trailers and *Questions asked*. The audit log is never rewritten. A suggestion's proposer and decider are not rewritten yet.
- When the erasure routine rewrites a file, it moves each standing verification's hash with it and marks it `erasure-rewrite`, so an erasure never makes a concept read *Changed since verified*.

## Why

- The file is the substrate any OKF consumer reads. If the platform showed a word that another consumer of the same file could not derive, the platform would disagree with the bundle it exports.
- The words follow OKF's own. A concept file records `verified` events, so a reader of the raw file and a reader of a page meet one word.
- A hash two parsers must agree on has to be a specification, not a description.
- A verification must mean a second pair of eyes wherever the word appears, or it means less than it says.
- Any citation of a deprecated concept is a derivation, and only a same-type one is a succession. Without that rule *use the successor* repoints a Brief at the wrong concept.
- The email in `human:<email>` is itself a credibility signal a reader of the raw file wants, as in Google's samples.
- The pseudonym is per workspace so that two workspaces' rewritten histories cannot be joined on one person. The `human:` prefix survives the rewrite, so the tier derived from it does too.

## Rejected

- The platform writing `stale_after` on every verification: policy dressed as knowledge.
- An absent `stale_after` read as a computed shelf life: contradicts every other consumer of the same file.
- A workspace-wide twelve-month cadence: treats a company address like an insurance certificate.
- Owner-only checking, or checking by any role: one person's queue, or a thumbs-up.
- Hashing the body only, or every source key: a swapped source keeps its verification, or a title fix unverifies.
- Opaque per-member ULIDs in the file: the email is the signal a reader wants, and the erasure map carries the cost.
- Imported verifications earning no tier, counting for actions, or a platform-origin threshold by default.
- Parsing the `Supersedes:` body line, a `superseded_by` key, or any link into a deprecated concept counting as succession.
- Two reader words for a source that moved on, or folding it into *Changed since verified*.
- A verification as the only road from draft to stable: a second person before any typed Answer is usable.
- File-relative links on emit: they break when a file moves directories.

## History

The full record, with its two amendments (ticket 24 on the erasure line, T-073 on the erasure pseudonym): `docs/archive/adr/0019-trust-derived-from-the-file.md`.

Amended 03/10/2026 by the glossary plan (`docs/plans/2026-10-02-2325-docs-glossary-in-the-readers-words-plan.md`, R4 and R5). The trust words became the reader's words listed above, and *Restricted* left the set to stay a sensitivity value. The tiers, the derivation and every rule above stand.

Amended 14/10/2026 on the owner's ruling of 14/10/2026, by BA-160 (`docs/plans/2026-10-14-1811-fix-erasure-late-commit-and-actors-plan.md`). The rule that "no routine rewrites" a person id now holds for the audit log alone. An erasure rewrites `bundle_commit.actor`, `concept_verification.actor` and the commit trailers to the pseudonym, as ADR 0020 says, so a verification by a person erased while they hold another workspace reads *Verified by a former member*.

The view-on-every-source condition, in the archived record, was missing from this doc until 20/10/2026, when a sample of the map tickets found V1 resting on it.

Later decisions overturned two rules of the record. The emitter wrote links as `/abs.md` paths, until ADR 0002's amendment of 30/08/2026 made a file refer to another concept by its HTTPS IRI. A discarded concept's citers read *no longer exists*, until ADR 0012 gave a cited concept no ending but deprecation.

The rule against verifying one's own version, the origins, `stale_after`'s forms, the hash's normalisation and examples, the lineage relabel, the draft `Answer`'s road to stable, the code-owned keys, the erasure's moved hashes and what is not yet built were missing from this doc until 20/10/2026 (BA-215). The same reading found that the erasure does not reach every record that names a person yet, and that the hash's canonical JSON is not RFC 8785's for numbers, so this doc no longer claims either.
