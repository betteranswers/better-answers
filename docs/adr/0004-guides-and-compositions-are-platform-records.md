---
status: accepted
date: 2026-08-25
---

# Guides and compositions are platform records over a concepts-only bundle; the structure is exported, the prose is not

A guide definition and every composition — a guide section's prose, a Q&A pair's answer, later an opportunity response — are platform database records with append-only versions and actor provenance, citing concepts by IRI. The OKF bundle holds concepts only. The platform exports each guide's *skeleton* (kind, subject, audiences, ordered sections with prompt, role, style and included-concept IRIs; no prose) into the tenant's repository, regenerated on change. We chose this over narrator concept files in the bundle (research 32/33's framing, ticket 11's "in principle") because guides are product functionality over knowledge, not knowledge: in every platform surveyed (research 36) the narrative page is a record that references and orders trust-bearing units, is never itself verified, and is never exported, and generated prose stored as a file drifts by design (Dust Frames) while prose that must stay current is a regenerated row with version and provenance tables (Dust Takeaways). Putting prose in git would over-align OKF with one product surface, fill the interchange format with UI-shaped state, and make every tenant's guide edits git commits. The skeleton export keeps the "map outlives the tool" promise for structure — the one page-adjacent thing any vendor (Guru `folders/*.yaml`) makes portable — and exceeds every competitor.

## Considered options

- Narrator concepts in the bundle (Brief + `includes:`; Model A/C) — edges are native links and portability is total, but prose drifts, the bundle carries per-product UI state, and guides become git workflow for humans.
- Database only, no projection — the market shape exactly; forgoes the structural portability that distinguishes this platform.
- Q&A answers as concepts — rejected at the session-2 rebase and again here: answers need alternate questions, audience tags, usage and their own verification, none of which OKF carries.

## Consequences

- The graph is the derived read model over bundle *and* records; section→concept and answer→concept edges are materialised at ingest so impact, staleness and coverage queries cover compositions. Compositions are indexed for retrieval alongside concepts.
- A composition's shown trust is the weaker of its own `verified` state and its cited concepts'; a wrong sentence over fresh atoms and a fresh sentence over a stale atom both surface.
- Moving prose between git and the database later re-keys every composition's version history and edges — the reason this is decided before the prototype (ticket 14).
- Portability of prose is an export, labelled as a snapshot; the skeleton projection is a platform-owned file the tenant does not hand-edit.

## Amendment — 2026-08-25, architecture review pass 1 (ticket 38)

- **The graph is never a hard dependency of a cited answer.** Status, trust tier, freshness and "changed since last verified" are carried on the Postgres row; the graph adds impact and supersession and degrades visibly when unavailable.
- **A changed atom reaches its compositions immediately.** When a concept's content changes, every composition citing it is flagged needs-review synchronously in Postgres, and the citation is flagged inline in rendered prose ("cites a concept that changed") rather than served silently or withheld; whether assembled prose refreshes automatically is ticket 34/37's call. Deleting a cited concept warns and leaves a visible "cited concept no longer exists" state.

## Amendment — 2026-08-26, the bundle-alone test (tickets 45 and 46)

The ticket-14 prototype showed how the guide template reaches into the bundle, and Liam set the rule that governs every key and convention in a concept file (`[OKF1]`): **a company with no platform and no guides must still want it there.** Applied: **no guide-shaped tags on concepts** (`benefits`, `objection`, `demo` — the section's prompt and the population prompt carry that framing; expectations select by type and company-language tags, and by relations if ADR 0010 is accepted — ADR 0010 was rejected on 26/08/2026, relations are derived in the graph, and an expectation may still select by them, CONTEXT.md `expectation`); **phrasing variants are platform records, not keys on concepts** — this reverses ticket 34 §7 and ticket 45 E2: a variant (a G-Cloud wording, a sector wording) is attached to the concept in the database and chosen by an include; a wording that states a *different claim* is a separate concept by the boundary rule; **product tiers are concepts** the guide's tier axis is derived from, never a list a guide defines; **descriptions and bodies are written for the file** — `description` is OKF's index summary, the body a plain statement of the knowledge; the register a tender needs is the composition's job. The reader-facing trust words (CONTEXT.md), the citation as a passage, the badge, the evidence pane and the copy artefact are platform surface over records; the bundle is unchanged by them.

## Amendment — 2026-08-26, Q&A pairs are concepts (ticket 47, ADR 0011)

The third considered option — "Q&A answers as concepts — rejected" — is reversed under the minting rule (ADR 0011), which did not exist when this ADR was written.

## Amendment — 2026-08-27, context wordings return to the concept (ticket 16, ADR 0014)

The 26/08 amendment's "phrasing variants are platform records, not keys on concepts" is reversed in its first half under ADR 0011, decided later that same day and applied to Q&A pairs but never to variants (research 56). A **context wording** — an alternative wording of a concept's statement demanded by a buying framework, a regulation, a sector or a source — is a unit the first client keeps today with no platform (its 89 context variants), so by the minting rule it is knowledge: a **named section of the concept's body**, chosen by an include, carrying the concept's history, portability and `verified` state — the only way a "Checked by" badge on a copied wording is honest. The second half of the 26/08 amendment stands in full: no `variants:` key (ticket 46's ruling on *keys*, `[OKF2]`), no guide-shaped tags, a wording named by its context and never by an audience, and a wording that states a different claim is a separate concept. A concept's `tags` may name the contexts it carries wordings or answers for, in company language (ticket 50 fixes the convention). Everything else in this ADR stands. A **Q&A pair is a concept** (`type: Answer` in the tenant's vocabulary): the question as `title`, the answer as the body, alternate phrasings of the question as a body section, `sources[]` = the entry it came from (with its locator) *and* the concepts the answer rests on — a `resource` pointing at another concept is the spec's own derivation edge. The first client keeps its bid libraries as markdown today with no platform: knowledge by the bundle-alone test; per-answer `verified` and `stale_after` are exactly OKF's model. What this ADR said answers need and OKF lacks — audience tags, usage, submission provenance — are **records attached to the concept by IRI**, never keys in the file. The drift argument that decided the original option (prose over atoms drifts) is met as for any concept citing another: the atom-boundary rule plus *changed since checked* on the citing `Answer`. Compositions therefore have **two** homes — a guide section and a response; a guide's FAQ or Bid Reference section is a view over `Answer` concepts linked to its subject; the promotion gate (ticket 37) mints or updates an `Answer` through the governed write; the ticket-14 prototype's `records/qa-pairs/*.json` are re-read as concepts. Everything else in this ADR stands.

## Amendment — 2026-08-27, a guide's readers are its roles; layers; no publish state (ticket 19)

Where this ADR and its skeleton projection say *audiences*, read **roles**: a guide definition sets, per role (Admin · Bid writer · Sales in v0.1, Better Auth's organisation roles), the default layer and the action threshold, and the word *audience* belongs to a binding's groups (ADR 0013). A section's *role* (know / say / show / do) is its **role label**. A section's **layers** are *assembled* (prose written over the concepts it includes — the first client's Brief) or *quoted* (the included concepts' own words — its Detail); a reader opens on their role's default layer, opens a section's Detail in place under its Brief, and the action gate follows the role, never the view. A guide has **no publish state**: it is visible to its readers from the moment it exists, every section wearing its trust badge; a *hidden* section is a definition setting that Admins see marked, readers do not, and coverage still counts — never a way to keep an unchecked section from view (ticket 38 D4). The citation inside a composition's prose is ADR 0015's. Everything else in this ADR stands.


## Amendment (27/08/2026, ticket 20, ADR 0016)

"Compositions are indexed for retrieval alongside concepts" stands, read through ADR 0016: on the page a hit is the **concept**, with the guide sections it appears in and the documents it rests on nested under it; a guide section or a document is a hit on its own only when no concept covers it. Answering traverses the map before it drafts; a document is never spoken for.

## Amendment — 2026-08-27, thresholds name a rung and an origin; roles are levels (ticket 23, ADR 0019)

A guide definition's action threshold names a trust rung **and an origin** (*platform* or *any*), defaulting to any origin; an imported check clears the default and an Admin tightens a guide where a paste must stand on a platform check. Roles are **levels** — **Admin · Editor · Viewer** — never job titles: where this ADR and its amendments say *Bid writer* read *Editor*, where they say *Sales* read *Viewer* (Liam, 27/08/2026 — the platform stays agnostic about who a bid writer is). Everything else stands.

## Amendment — 2026-08-28, the degradation made concrete (ticket 39, ADR 0021)

"Degrades visibly when unavailable" is now three fixed phrases in the reader's word **map** — *map as of <time>* · *map as of <time> · updating* · *map unavailable since <time>* — carried in an answer's context header line, never its verdict; impact, successors and coverage show the phrase and what still works; the successor chase falls back one hop to the successor IRI on the concept index row. Everything else stands.
