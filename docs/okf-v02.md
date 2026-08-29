# OKF v0.2 on this platform — what the spec defines, what it leaves open, where each lands

Read before proposing any key, writing convention or feature that touches a concept file. Primary source: `~/Documents/development/knowledge-catalog/okf/SPEC.md` — v0.2, upstream `GoogleCloudPlatform/knowledge-catalog`, last spec commit `3fcbb9f` (24/07/2026); re-read upstream on 26/08/2026, still v0.2. Long form with line references: `.scratch/v01-spec/research/okf-v02-capabilities.md`.

## What the spec defines

- **Bundle** — a directory tree of UTF-8 markdown files with YAML frontmatter. Git is *recommended* for history and review, not required; a tarball or a subdirectory of a larger repository is equally a bundle. Reserved files: `index.md` (listing) and `log.md` (prose history). Every other `.md` file is a concept.
- **Concept** — one file; identity is the path minus `.md`. `type` is the only required key (a free string, "not registered centrally"). Recommended: `title`, `description` (one sentence, used by index generators), `resource`, `tags`. Producers may add any key; consumers must preserve unknown keys and must not reject a document for them.
- **Provenance** — `sources[]` with `resource` (required), `id`, `title`, `author`, `usage_count`, `last_modified`, and a sibling `usage_window`. A body footnote whose label is a `sources[].id` attributes one claim to one *whole* source. A `resource` may point at another concept in the bundle — lineage is a link, never a field. No credibility score by design.
- **Trust** — `generated {by, at}` and `verified [{by, at}]`. The trust tier is *derived*, never stored: no `verified` → unverified; only non-`human:` verifiers → machine-confirmed; any `human:<id>` → human-reviewed. A verification event has no scope, outcome or note. "Trust tiers are advisory signals, not access control."
- **Lifecycle** — `status: draft | stable | deprecated` (absent = stable; deprecated is "kept for links and history; no longer current"); `stale_after` as an absolute `YYYY-MM-DD`.
- **Links** — standard markdown links, directed and *untyped*: "the specific kind is conveyed by the surrounding prose, not by the link itself". Broken links are legal — "not-yet-written knowledge".
- **Actors** — `<producer>/<version>`, `human:<id>`, `process:<id>`; `<id>` is opaque.
- **Attested computation** — a concept type carrying a deterministic computation and the means to check a run; receipts are never stored in the bundle.
- **Non-goals** — a fixed taxonomy of types; replacing domain schemas; prescribing storage, serving or query; the attestation runtime.

## What the spec leaves to the consumer, and where this platform puts each

| The spec is silent on | What the spec and Google's sample do instead | Where it lives here | Ruled by |
| --- | --- | --- | --- |
| Supersession — no field, no edge | `status: deprecated` keeps the file; the acme sample names the successor in prose and a link; neo4j-okf infers "one deterministic replacement" from links at query time | A deprecated concept stays in the bundle for history and reproducibility and is not surfaced to new work; **the successor carries the lineage** — a `sources[]` entry or a *Supersedes* line on the new concept, as Google's sample does — and the graph derives the edge from that backward link; the deprecated file changes only its `status` (Liam, 26/08/2026) | Ticket 23 fixes the exact form; never an extension key (`[OKF2]`) |
| Conflicting claims | Not modelled; neo4j-okf: "conflict *detection* is a query; resolution is human" | `conflict` records raised at extraction, never resolved by the pipeline; the answer path shows both values with their sources | ADR 0003 amendment; ADR 0014 (`conflict` records); ticket 20 |
| Context (a claim true only in one setting) | Prose and links | A claim that differs by context is a separate concept (atom-boundary rule) linked to the context it holds in; the graph carries the edge | ADR 0003 |
| Temporal reasoning beyond `generated.at`, `verified.at`, `stale_after`, `sources[].last_modified` | None — no valid-from, no as-of | Git history plus deprecated concepts kept; "as of" queries are graph/records work beyond v0.1 | Fog |
| Typed relations | Untyped links; kind in prose | The map holds the link with its two kinds, section and sentence (`LINKS_TO`); the kind of a relation is read from the sentence; no predicate list anywhere; `SUPERSEDES` · `CITES` · `IS_CONCEPT` the only named edges | ADR 0010 (rejected); ADR 0026 |
| Entity equivalence / resolution | None | Merge-by-identity key `(workspace, bundle, type, normalised label)` at write time, names derived from `title` and an *Also known as* body line; matcher-proposed, Admin-confirmed merges ("Are these the same thing?"), a *No* remembered | ADR 0003 amendment; ADR 0014 amendment; ADR 0026 |
| Identity across renames and bundles | Path only | `iri` — the one code-owned identity key the platform writes into the file | ADR 0002 |
| Evidence finer than a whole source | Footnote → whole source | `sources[].locator` in the file (the entry or span); the `evidence` table holds span, hash and version | Ticket 46 kept it; ADR 0014 (`evidence` rows, written at commit) |
| Citing a concept from prose outside the bundle (a guide's Brief, a response) | Body footnotes attribute a claim to a whole source; nothing for prose outside a bundle | A composition's markdown carries a footnote reference labelled by its include (`[^i7]`); the footnote text is rendered from the include row, never stored; the promotion gate rewrites markers into `sources[]` footnotes when it mints an `Answer`, so include ids never enter a file | ADR 0015 (ticket 19) |
| Taxonomy of `type` | Non-goal; free string | Honoured: kinds emerge with the concepts, folded for case and plural at write; the type vocabulary is a derived Kinds list with counts; rename/merge is one bulk commit; no file, no closed-world check | ADR 0026 (supersedes 0001) |
| Access control | "not access control" | **Sensitivity** on binding, document, chunk and concept row; trust never gates viewing | Ticket 38 D1; ticket 24 |
| Storage, serving, query | Non-goal | Concept index rows, chunks, embeddings and the graph — all derived from the bundle, none a source of truth; the bundle is written only by the app, one commit per act, platform-prepared changes waiting as suggestions | ADR 0012 (ticket 15) |
| Multi-bundle, tenancy, bundle identity | None | One bundle per tenant; domain directories as future bundle boundaries; in-bundle manifest | ADR 0002, 0003; research 35 |
| History | Git plus prose `log.md` | Git history for the bundle; append-only versions on compositions and guide definitions; `log.md` generated at export from the commit log | ADR 0004, 0014 |

## The platform's stance (Liam, 26/08/2026)

- **OKF targets the data layer.** The bundle is the substrate any AI system reads and writes: structured, contextual, portable, machine-readable, and readable by a person in any editor. System-agnostic, so a client can adopt new AI tools against it with confidence.
- **Two knowledge layers on OKF.** The bundle (concepts, graph-*shaped* through its links) and the graph built on top (queryable, traversable, reasoned over). Everything the spec leaves open is met in the graph and in records — never with keys in the file. The spec's silence on supersession is a boundary, not a gap.
- **Simplicity is the reason OKF is here.** If a planned feature or piece of infrastructure needs a concept file to carry more than the spec plus `iri` and `locator`, the approach is probably over-complicated; re-evaluate before proceeding.
- **The file is written for a company with no platform** (`[OKF1]`) and to the spec (`[OKF2]`).

## Assumed but not in the spec

- The file format is fixed — markdown with YAML frontmatter. JSON exists only as a consumer's projection (Knowledge Catalog aspects, a graph store). The graph level is free to use any representation.
- A bundle is not necessarily a git repository.
- `verified` cannot record a failed check; the tier ignores `at` entirely and keys off the `human:` prefix alone — verifier ≠ generator is a platform rule (Google's own sample self-verifies).
- `stale_after` absent → Google's reference implementation treats the concept as fresh; the platform's default is ticket 23's.
- In practice Google's producers emit `generated` and `sources` only; `verified`, `status` and `stale_after` appear only in the hand-authored sample.
- Knowledge Catalog (Google, article of 26/08/2026) ingests one Entry per concept with an `okf` aspect carrying all thirteen fields, including `verified`, `status` and `stale_after`; a team "publishes a trustworthy bundle for its own agents" — the granularity Google now describes.
