# OKF v0.2 on this platform

Read this page before you propose a key, a writing convention, or a feature that touches a concept file.

The primary source is `~/Documents/development/knowledge-catalog/okf/SPEC.md`. It is OKF v0.2 from the upstream repository `GoogleCloudPlatform/knowledge-catalog`, at spec commit `3fcbb9f`. A longer version of this page, with line references into the spec, is `.scratch/v01-spec/research/okf-v02-capabilities.md`.

## What the spec defines

**Bundle.** A bundle is a directory tree of UTF-8 markdown files with YAML frontmatter. The spec recommends git for history and review but does not require it. A tarball or a subdirectory of a larger repository is also a bundle. Two file names are reserved: `index.md` is a listing, and `log.md` is a prose history. Every other `.md` file is a concept.

**Concept.** A concept is one file. Its identity is its path without the `.md` extension.

- `type` is the only required key. It is a free string, "not registered centrally".
- The recommended keys are `title`, `description`, `resource`, and `tags`. A `description` is one sentence, and index generators use it.
- A producer may add any key. A consumer must keep unknown keys and must not reject a document because of them.

**Provenance.** A concept lists its sources in `sources[]`. Each entry has `resource`, which is required, and may have `id`, `title`, `author`, `usage_count`, and `last_modified`. A `usage_window` key sits beside `sources`, not inside an entry. A body footnote whose label is a `sources[].id` attributes one claim to one whole source. A `resource` may point at another concept in the same bundle, so lineage is a link and never a separate field. The spec stores no credibility score, by design.

**Trust.** A concept records `generated {by, at}` and `verified [{by, at}]`. A consumer derives the trust tier and never stores it:

- With no `verified` entry, the concept is unverified.
- If every verifier is a non-`human:` actor, the concept is machine-confirmed.
- If any verifier is a `human:<id>` actor, the concept is human-reviewed.

A verification event has no scope, outcome, or note. In the spec's words, "Trust tiers are advisory signals, not access control."

**Lifecycle.** `status` is `draft`, `stable`, or `deprecated`. A concept with no `status` is stable. A deprecated concept is "kept for links and history; no longer current". `stale_after` is an absolute date in `YYYY-MM-DD` form.

**Links.** Links are standard markdown links. They are directed and untyped: "the specific kind is conveyed by the surrounding prose, not by the link itself". A broken link is legal, because it can stand for "not-yet-written knowledge".

**Actors.** An actor is `<producer>/<version>`, `human:<id>`, or `process:<id>`. The `<id>` part is opaque.

**Attested computation.** This is a concept type that carries a deterministic computation and the means to check a run of it. A bundle never stores the receipts of a run.

**Non-goals.** The spec does not define a fixed taxonomy of types. It does not replace domain schemas. It does not prescribe storage, serving, or query, and it does not define the attestation runtime.

## What the spec leaves open, and where this platform puts each point

Each entry says what the spec does, what this platform does, and which decision record holds the full rule. Decision records are in `docs/solutions/architecture-patterns/adr-NNNN.md`.

### Supersession

The spec has no supersession field and no supersession edge. `status: deprecated` keeps the old file. Google's acme sample names the successor in prose and links to it. The neo4j-okf project infers "one deterministic replacement" from links at query time.

Here, a deprecated concept stays in the bundle for history and reproducibility, and the platform does not show it to new work. The deprecated file changes only its `status`. The successor carries the lineage as a `sources[]` entry that cites the deprecated concept. The map derives the `SUPERSEDES` edge from that entry when the cited concept is deprecated and has the same type. Any other `sources[]` entry that cites a concept gives a `DERIVED_FROM` edge. Supersession never uses an extension key.

### Conflicting claims

The spec does not model conflicts. neo4j-okf says that "conflict *detection* is a query; resolution is human".

Here, extraction raises `conflict` records, and the pipeline never resolves them. The answer path shows both values, each with its sources. See ADR 0003 and ADR 0014.

### Context

The spec expresses a claim that holds in only one setting through prose and links.

Here, a claim that differs by context is a separate concept, under the atom-boundary rule. It links to the context it holds in, and the map carries the edge. See ADR 0003.

### Temporal reasoning

The spec has no valid-from or as-of date. Its only dates are `generated.at`, `verified.at`, `stale_after`, and `sources[].last_modified`.

Here, git history and the deprecated concepts that stay in the bundle hold the past. As-of queries are future work in the map and the records.

### Typed relations

The spec's links are untyped, and the surrounding prose says what kind of relation a link is.

Here, the map stores each link as a `LINKS_TO` edge with two properties, the section and the sentence that hold it. The platform reads the kind of relation from that sentence. No list of predicates exists. The other named edges are `SUPERSEDES`, `DERIVED_FROM`, `CITES`, and `IS_CONCEPT`. See ADR 0026.

### Entity equivalence

The spec has no way to say that two concepts are the same thing.

Here, the platform computes a merge key at write time with `mergeKeyOf`. The key is unique per workspace and combines the folded type with the normalised title. An *Also known as* line in the body feeds search but is not part of the key. A matcher proposes merges, and an Admin confirms each one by answering "Are these the same thing?". The platform remembers a *No*. See ADR 0003, ADR 0014, and ADR 0026.

### Identity across renames and bundles

The spec identifies a concept by its path only.

Here, `iri` is the identity key. It is the one key that the platform's code owns and writes into the file. See ADR 0002.

### Evidence finer than a whole source

The spec's footnotes attribute a claim to a whole source.

Here, `sources[].locator` in the file names the entry or span inside the source. The `evidence` table holds the span, its hash, and its version. The platform writes `evidence` rows at commit. See ADR 0014.

### Citations from prose outside the bundle

The spec's body footnotes attribute a claim inside a bundle. It defines nothing for prose outside a bundle, such as a guide's Brief or a response.

Here, a write-up's markdown carries a footnote marker whose label is an include id, for example `[^i7]`. The platform renders the footnote text from the include row and never stores it. When the promotion gate mints an `Answer` concept, it rewrites each marker into a footnote on a `sources[]` entry. Include ids therefore never enter a concept file. See ADR 0015.

### Taxonomy of `type`

The spec makes a type taxonomy a non-goal, and `type` is a free string.

Here, the platform keeps that rule, and calls the value a concept type. Concept types appear as concepts are written. At write time the platform folds each type for case and plural. The types in use form a derived Concept Types list with a count for each, and the list offers no rename or merge. No file lists the types, and no check rejects an unknown type. See ADR 0026.

### Access control

The spec says trust tiers are "not access control".

Here, sensitivity controls access. A sensitivity value sits on each connected source, document, passage, and concept row. Trust never decides who can view a concept.

### Storage, serving, and query

The spec makes these a non-goal.

Here, the platform derives the concept index rows, passages, embeddings, and the map from the bundle. None of them is a source of truth. Only the api writes to the bundle, with one commit per action. Changes that the platform prepares wait as suggestions until someone accepts them. See ADR 0012.

### Multiple bundles, tenancy, and bundle identity

The spec defines none of these.

Here, each tenant has one bundle. Collection directories may become bundle boundaries later. A manifest inside the bundle identifies it. See ADR 0002 and ADR 0003.

### History

The spec uses git and the prose file `log.md`.

Here, git history records changes to the bundle. Write-ups and guide definitions keep append-only versions. The platform generates `log.md` from the commit log at export. See ADR 0004 and ADR 0014.

## Why this platform keeps the file to the spec

OKF is the data layer. Any AI system can read and write a bundle. A bundle is structured, portable, and machine-readable, and a person can read it in any editor. Because the format belongs to no single system, a customer can point new AI tools at the same bundle.

The platform has two knowledge layers. The first is the bundle, a set of concepts that the links shape into a graph. The second is the map built on top of the bundle, which the platform queries, traverses, and reasons over. Everything the spec leaves open is met in the map and in platform records, never with new keys in the file. The spec says nothing about supersession, and the platform treats that silence as a boundary to respect, not a gap to fill.

Simplicity is the reason the platform uses OKF. A concept file carries the spec's keys plus `iri` and `sources[].locator`. If a planned feature needs the file to carry more, the design is probably too complex, and you should rethink it before you build it.

The concept file follows the spec and is written for a company that has no platform.

### The bundle-alone test

A key, a value, or a writing convention goes into a concept file only if a company with no platform and no guides would still want it there.

- Evidence, trust, lifecycle, identity, the company's own language, and its links pass the test.
- Anything that exists so a guide, a section, an audience, or a page can find or phrase a concept fails. It becomes a platform record instead.

The decision record that admits a new key must argue it against this test before the key lands. Write every extraction or enrichment prompt for the file, never for whatever will read the file.

No tool can check this test, because it is a judgement about a company that does not exist. For that reason, apply it where someone argues for a key, not where code writes one.

## Assumptions that the spec does not state

- The file format is fixed: markdown with YAML frontmatter. JSON appears only as a consumer's projection, such as Knowledge Catalog aspects or a graph store. The map can use any representation.
- A bundle need not be a git repository.
- `verified` cannot record a failed check. The trust tier ignores `at` and depends only on the `human:` prefix.
- The spec does not require the verifier to differ from the generator. This platform requires it. Google's own sample verifies its own output.
- When `stale_after` is absent, Google's reference implementation treats the concept as fresh. This platform does the same.
- Google's producers emit only `generated` and `sources`. Only the hand-authored sample uses `verified`, `status`, and `stale_after`.
- Knowledge Catalog ingests one Entry per concept. Each Entry has an `okf` aspect that carries all thirteen fields, including `verified`, `status`, and `stale_after`. Google describes a team that "publishes a trustworthy bundle for its own agents", which sets the granularity at one bundle per team.
