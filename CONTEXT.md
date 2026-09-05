# CONTEXT.md — domain glossary

Root glossary for the platform. Seeded from `.planning/draft-docs/draft-context.md`; a term
moves here only once it has been settled in a wayfinder ticket. Terms not listed here are
still draft.

## Knowledge model

Three knowledge layers, named and never aggregated: **sources** (evidence — connected and
indexed, or referenced and read live) → **bundles** (OKF concepts: the curated map) → **graph** (derived from the bundles
and records; queryable). **Records** are what the platform itself keeps — guides,
compositions, usage, bindings, audit — citing concepts, never restating them; their families
are fixed by ADR 0014 (ticket 16). Where a unit lives is decided by **minting** (ADR 0011).

- **knowledge layer** — one of sources, bundles, graph. Records are not a layer.
- **minting** — deciding where a unit of knowledge lives: a concept when a company with no
  platform would keep it as knowledge; a record when it exists only because the platform runs
  a use case; both only as a concept's derived index row plus records attached to it by IRI.

- **source** — the underlying thing knowledge is extracted from: a document, a system, a
  web page, a company wiki. A source is never itself a concept; it backs concepts as a
  resource.
- **concept** — one unit of knowledge the company keeps (the minting rule, ADR 0011) — extracted
  from a source, promoted from an answer, or brought in from what the company already holds —
  carried as one OKF concept document, sized by trust: an entity or a fact that can be verified,
  go stale, or change owner on its own.
  Split when trust state can differ; mint a separate concept only when it is nameable,
  citable in one sentence, and reused in two or more places — otherwise it is a section of
  its parent. Some concepts align to the company's existing ontology, intentionally or not.
- **company language** — the kinds, names and links a company's concepts reveal; never a file
  or a registry — it is read off the bundle (ADR 0026). Inferred during extraction, corrected by
  the company's people through the ordinary write. (Was "domain vocabulary" in the draft.)
- **kind** — the reader's word for a concept's `type`: the short string its producer chose,
  folded for case and plural at write. A new kind arrives with the concepts that carry it and
  is named in the suggestion set's summary; nobody pre-declares one.
- **type vocabulary** — the set of kinds in use, derived from the concept index with counts per
  kind and per domain; shown as the **Kinds list** on Knowledge, where an Admin renames or
  merges a kind by one bulk commit. Never a file, never checked closed-world (ADR 0026).
- **Also known as** — a conventional body line naming a concept's other names; a confirmed alias
  lands there through an edit suggestion, and the merge key derives its names from it.
- **domain** — a top-level division of a company's knowledge by ownership: the company
  itself, one product or service, one sector. The bundle is organised domain-first, and a
  domain is a future bundle boundary.
- **bundle** — an OKF bundle: a directory tree of concept documents with its own manifest,
  whose links make it a graph (the directory is only its storage shape). A company's
  knowledge is one bundle in v0.1.
- **graph** — the platform's derived, queryable map over the bundle and the records: concepts,
  their links and relations, sources, actors and citations; held inside the platform Postgres
  as ordinary workspace-scoped rows (ADR 0032). Derived again from the bundles on every
  commit and from the records as they change; never a source of truth.
- **bundle manifest** — the bundle's self-description carried inside it: identity, origin,
  owner, content version.
- **estate** — the running deployment: the boxes, the stores, the stacks and the copies kept off
  them. The word every deploy document uses ("the estate is two 4 GB boxes"). _Avoid_: environment,
  infrastructure.
- **bundle estate** — every bundle in a company's repository: its own knowledge bundle(s), the
  platform bundle, and any imported bundles. The knowledge sense of *estate*, always said with the
  word *bundle* so the two never collide.
- **producer** — an agent or a person that **makes** knowledge: an extraction or enrichment run, a
  person typing a concept, an Admin accepting a suggestion set. A producer mints a concept precisely
  so it need not fit anywhere yet (ADR 0026), and everything a producer prepares waits at the accept
  gate (ADR 0012). Not a connector, which carries documents rather than making knowledge.
- **consumer** — an agent or a person that **reads** knowledge and must tolerate what it did not
  expect: an unknown kind, a concept it cannot see, a map that is a moment behind. Every consumer
  reads through the same predicate and the same audit as any other (`[SEC2]`). Not a client
  (connected), which is the host a consumer arrives through.
- **Term** — a concept whose subject is *what a word means in this company*, kept in a glossary
  domain: how a kind, a product name or a piece of company language is defined, read by the
  extraction and judging prompts. A definition is knowledge by the minting rule, which is why there
  is no vocabulary file to hold it (ADR 0026). _Avoid_: vocabulary entry, type definition.
- **Person** — a concept whose subject is a person, carrying only what the company itself publishes
  — name, role, public work contact, public bio, organisation link — minted only from a Public
  source or typed by an Editor, never from a meeting note, ticket or referenced fetch. Its IRI is
  opaque, it **starts Restricted whatever its evidence says** (the per-kind floor, ADR 0023), and a
  leaver's reads *Left*, never *Deprecated* (ADR 0020). Not a *Person* source entity, which is
  derived from one document and is never a concept.
- **platform bundle** — the bundle of concepts describing how to use the platform and
  how it fits together, seeded into every company's repository and expected to diverge per
  company; later platform changes arrive as suggestions, never applied.
- **imported bundle** — a bundle a company consumes but does not author (a vendor's
  documentation bundle): read-only, versioned, refreshed as a whole. Designed for, not
  shipped, in v0.1.
- **IRI (of a concept)** — a concept's stable identity, minted by the platform when the
  concept is created and never edited by hand; survives renames and is how one bundle
  refers to a concept in another.
- **verify (a concept)** — a human or an agent confirming a concept against its sources in
  the platform, recorded on the concept as a spec `verified` event (`by`, `at`); the content it
  confirmed is kept platform-side on the verification record, never as a key in the file
  (`[OKF2]`). A human verifier earns *human-reviewed*; an agent earns *machine-confirmed*.
  A platform capability, not a repository workflow.
- **changed since checked** — the state of a concept whose content changed after its
  most recent `verified` event; shown as such, with the earlier event kept, until a human or
  an agent verifies it again. _Avoid_: changed since last verified.
- **Q&A pair** — a concept (`type: Answer`): a question as its title, the answer as its body,
  alternate phrasings of the question in the body, its sources the entry it came from and the
  concepts the answer rests on. Knowledge a company keeps with no platform — the first client's
  bid libraries are Q&A pairs today. Usage, submissions and outcomes are records attached to it.
- **candidate concept** — a concept the worker suggests (from extraction or enrichment) and
  the platform has not yet written to the bundle; it becomes a concept only when an Admin
  accepts the suggestion and the governed write commits it.
- **governed write** — the platform's only way of changing a bundle: an actor, a precondition on
  what it expects to find, one commit, one audit entry. Every bundle commit is one.
- **bundle commit** — one change to a bundle, by whatever path; what the sync derives from.
- **concept index** — the platform's derived row for every concept, written when the concept's
  commit is made, checked by the sync, never edited. The only "both" of the minting rule.
- **suggestion** — a change to the company's knowledge or its configuration — prepared by the
  platform (candidate concepts from a run, a platform-bundle or template
  update, an alias merge, a composition rewrite), or by a person who may not commit it (kind
  *edit*: a concept's text, a Brief, a missing fact, a new concept raised from unmapped
  passages; kind *promotion*: an answer proposed as an `Answer`, decided singly at the gate) — which the target's owner or an Admin
  accepts or declines before it is applied. Nothing platform-prepared enters a bundle without
  acceptance; every kind but *edit* is an Admin's to decide, in Control Centre.
  _Avoid_: proposal (the bid document), offered change, revision.
- **discard (a concept)** — removing a concept that was never stable and nothing cites or links:
  the file leaves the bundle, its identity and audit trail stay as a *removed concept*. Any
  concept that has been stable, or is cited or linked, is deprecated instead, never removed.
- **export** — the company taking its knowledge out of the platform: a *bundle snapshot* (the
  bundle's files at one commit, readable by any OKF tool), a *repository export* (the whole
  workspace repository with its history), a *records export* (the records about its concepts —
  verifications, owners, usage, conflicts — with the audit ledger and the publish confirmations)
  or a *guide snapshot* (a guide's prose as markdown, labelled with its date and "not
  maintained"). An Admin act with an audit row.
  The only way anyone but the platform reaches the repository.
- **evidence** — a locator into a source — a document, page or span; a referenced resource read
  live; a record the platform generated — with the content's version, that backs a concept;
  recorded when the concept is committed and kept until nothing cites it. A concept file's
  `sources` are its projection; a concept resting on another concept is a link, never evidence —
  except a successor's `sources[]` entry naming the concept it supersedes (lineage, ADR 0019).
- **sensitivity** — a source binding's confidentiality class, carried onto every document,
  chunk and source entity it yields and sitting on the concept row, deciding who may view them:
  **Restricted** (Admins and named members; the default), **Internal** (the workspace, narrowed
  by audience), **Public** (already published by the company; still narrowed by audience). Only
  *Restricted* reaches a reader. Independent of trust: trust never gates viewing, sensitivity
  does. *Public* is not *published*.
- **finding** — what the pre-scan found in one source document: a category (bank details, date of
  birth, home address, personal contact, special category, …), offsets into the normalised text,
  the rule and detector version that fired. Counted per category; never a class, never a value.
- **redaction rule** — one of three tiers of what the seam withholds: **always** (policy no
  binding switches off; a span restorable with a reason), **default on** per binding, **default
  off** per binding. The officer-block rule always wins.
- **withheld** — the placeholder word: `[withheld]` for the always set, `[home address withheld]`
  and the like for the rest, `[person A]` for a pseudonymised name.
- **relation** — a link from one concept to another as the map holds it: the two kinds, the
  section and the sentence around the link (`LINKS_TO`); the kind of a relation is read from
  the sentence, never from a predicate list (ADR 0026). *Supersedes*, a composition's citation
  and a source entity's *is concept* are the only named edges.
- **tier (of a product)** — a level of a product at which capability differs (Standard,
  Professional); a concept of its own that atoms relate to. A fact that differs by tier is two
  concepts. A guide reads a product's tiers; it never defines them.
- **context wording** — an alternative wording of a concept's statement demanded by a context: a
  buying framework (G-Cloud), a regulation, a sector, a source. A named section of the concept's
  body, chosen by an include — never a key in the file, never a record (ADR 0014). Named by its
  context, never by an audience; a wording that states a different claim is a separate concept.
  _Avoid_: phrasing variant (the record it was until 27/08/2026).
- **source binding** — an Admin's connection of one source to the workspace: its connector,
  credential, scope, domain, sensitivity, audience, cadence, destination and retention class; the
  unit the scheduler runs and the unit that is published. One domain per binding — a website is
  bound per URL prefix (ADR 0013). _Avoid_: connection, integration.
- **connector** — the lifted or written code that reaches one kind of source system and yields its
  documents: upload, website, SharePoint, HubSpot, Asana, the share agent's file share, the
  referenced read tool. A binding names one connector; a connector serves many bindings.
  _Avoid_: connector for the MCP surface (Claude calls it one; our screens say *client*).
- **origin (of a source)** — whose knowledge a source carries: the **company**'s own, a third
  party's (**external** — Companies House, a sector feed) or the **platform**'s (what the platform
  itself generated, cited as evidence; never a binding).
- **reach (of a source)** — whether the platform holds a copy. A **connected source** is bound,
  enumerated and indexed by runs; a **referenced source** is bound with a credential and read live
  by a tool when a producer or a reader asks — never enumerated, never indexed, never cached. A
  source type is its origin and its reach.
- **source document** — the platform's row for one item a binding yields: source-system id and
  locator, title, author, `last_modified` (recorded absent when the source has none), content hash,
  first and last seen, `gone_at`, sensitivity, and the references to its original and normalised
  copies. The catalogue every run reconciles. _Avoid_: ingest trace (the draft's word).
- **connector run** — one execution of a binding by the scheduler (enumerate, index, extract, prune
  or reindex): claimed under a lease, keyed by its run key, checkpointed per batch, one per binding
  at a time, parked after repeated failure; its outcome rows record what changed per document.
- **lease** — the scheduler's grip on a claimed run: held only while the worker keeps confirming it
  is alive, expiring otherwise, so a run whose worker died is handed back for another claim rather
  than lost. _Avoid_: lock (nothing waits on it).
- **extraction plan** — the priced scope of extraction for one binding, accepted once by an Admin at
  review: the documents, the template per kind and the route, with hours and pounds from measured
  rates. Once accepted, every run extracts as it indexes; a run that would reprocess more than a set
  share of the binding, or pass the workspace's extraction ceiling, waits for re-acceptance.
- **extraction ceiling** — the workspace's cap on what extraction may spend, held as a config row
  and checked before a run and before an ad-hoc draft. At the ceiling the platform refuses in one
  sentence naming who can raise it, and never silently narrows the work. Distinct from a plan's
  price, which is one binding's scope. _Avoid_: quota, budget cap.
- **extraction template** — the instruction for extracting concepts from one *kind of document*:
  which kinds a document of that kind evidences, and how a claim, its evidence and its locator are
  written for the file. Chosen per document kind in the extraction plan, versioned, and written for
  the concept file and never for the surface that will read it (`[OKF1]`). There is no design-time
  check against a vocabulary, because there is no vocabulary file (ADR 0026). Not a *template* (a
  platform-shipped guide definition).
- **publish (a binding)** — the recorded Admin act that lets a binding's chunks and source entities
  reach anyone beyond Control Centre; separate from sensitivity, from audience and from accepting
  suggestions. Its audit row carries the Admin's confirmations (lawful basis recorded, privacy
  information updated, DPIA reference). Unpublished content is seen by Admins, in Control Centre only.
- **audience** — who a binding's content is for: everyone in the workspace, or named groups (plus,
  if needed, named individuals). Set on the binding, carried with sensitivity onto every chunk and
  source entity, and applied with *published* on every read and traversal hop. Distinct from
  sensitivity (how confidential) and from trust (how reliable).
- **group** — a named set of members of one workspace: the one grouping concept, and the unit an
  *audience* names when a binding is not for everyone. Groups are flat, and a person may belong to
  several. A group may represent a team ("HR team", "Sales executives") — that is its name, not a
  second concept. Membership of a group never changes what a person may do — that is their *role*;
  a group only ever changes what they may see, via audiences. _Avoid_: team, Team (Liam,
  05/09/2026 — aligned to the Entra access model: everything is a group, one membership lookup per
  visibility check; sub-teams would be an additive nesting migration, never a reversal).
- **retention class** — what the platform keeps of a binding's documents, and for how long:
  **mirror** (the source holds the record; a document gone at source keeps its chunks through a grace
  period, then loses them), **keep** (the platform holds the record — uploads; nothing leaves without
  an Admin act), **transient** (original bytes deleted after processing, the normalised redacted text
  kept; graph-only bindings). In every class cited evidence outlives its source: the evidence row
  stays until nothing cites it.
- **destination (of a binding)** — which derived stores a source binding's documents feed: the
  chunk index (searchable), the bundle (as suggestions an Admin accepts), the graph (as source
  entities); at least one. The object store is where every document lands first, not a destination.
- **source entity** — a typed node or edge the graph derives directly from a source document (a
  person, a meeting, a task), keyed to that document; never a concept and never a record. The
  graph is derived from sources, bundles and records (ADR 0011).
- **provider** — the system that produced a binding's documents (Granola, Otter, Teams), as
  distinct from the system they are reached in; one per binding.
- **share agent** — the platform's small on-site program that watches a client's file share and
  sends changed documents out to the platform; a client of the public API, never the worker.
- **run key** — the key that makes two requests to run the same binding for the same window one
  run. _Avoid_: idempotency key (cocoindex's word for its stable data ids).
- **route** — a workspace's choice of model and provider for one purpose (extraction,
  enrichment, answering, judging, embedding), local or hosted; one route per purpose. The
  embedding route is **fixed** — the word a reader sees on it — and never changes once vectors
  exist (ADR 0020).

## Trust words the reader sees

The platform's trust tiers (unverified, machine-confirmed, human-reviewed) and states are shown to
readers in these words and no others; each is a text tag, never a colour.

- **Checked by <person>** — human-reviewed: a named person confirmed it against its sources on a
  date; shown as "Checked by Priya Shah · 3 March 2026".
- **Checked by the platform** — machine-confirmed: an agent that did not generate it confirmed it.
- **Unchecked** — unverified: nobody has confirmed it.
- **Changed since checked** — its content changed after its latest check; the earlier check is kept.
- **Out of date** — past its shelf life (`stale_after`); needs checking again.
- **Draft** — proposed, not yet part of what the company states.
- **Restricted** — its sensitivity limits who may view it.
- **Left** — a `Person` concept whose person has left the company; kept for history; never
  offered to new work. Never *Deprecated*: a person has no successor.
- **Deprecated** — no longer current; kept for history; its successor is linked; never offered
  to new work.

Two **riders** may follow *Checked by* and never change the tier: **· imported** (a check
recorded before the platform, kept as written) and **· source moved on** (its source changed or
is gone since the check; the check stands; the reason is on the row). No other rider exists.

- **shared beyond its evidence** — the state where a recorded Admin override lets a reader see a
  concept whose cited evidence they may not view (ADR 0023). Never a rider and never a trust
  signal — the tier and *Checked by* stand untouched. The evidence pane leads with the reader's
  access ("Based on your current access, the evidence isn't included"), always names the Admin
  whose override created the state, and never dead-ends (Liam, 05/09/2026 — exact copy polished
  at spec time; the fixed rule is the routing, not the sentence).

## Guides and answers

Guides are platform functionality over the knowledge map; nothing in this section lives in a
bundle (Q&A pairs do — they are concepts).
The platform exports a guide's *structure* into the company's repository so it can be rebuilt
from concepts elsewhere; the prose stays a platform record.

- **guide** — a platform surface that gives the company's people, by role, its knowledge about
  one subject (a product, a service, a sector, the company itself), configurable per company. A
  guide is never the unit of trust: every fact it shows is a concept. A guide has no publish
  state: it is seen from the moment it exists, every section wearing its trust badge.
  _Avoid_: publish (a guide); audience (of a guide) — a guide's readers are roles.
- **guide definition** — the company-owned description of a guide: its kind, subject, the
  roles it serves (each with a default layer and an action threshold), its layers and its tree
  of sections. Seeded from a template, then owned outright.
- **template** — a platform-shipped guide definition a company seeds from (a bid-library
  product guide, a sector guide, a sales play, a battlecard, a documentation set). Later
  template changes arrive as suggestions, never applied.
- **section** — one node of a guide definition's tree: a prompt, a role label (know / say /
  show / do), a usage note, the layers it renders, and an expectation of which concepts should
  populate it. A section inside a section is still a section (the draft's "subsection"). A
  **hidden** section is a definition setting: Admins see it marked hidden, readers do not,
  coverage still counts it.
- **layer (of a section)** — one of the ways a section shows its knowledge: *assembled* (prose
  written over the concepts it includes — the first client's Brief) or *quoted* (the included
  concepts' own words — its Detail). A reader switches layers; the definition says which a
  section renders and which a role opens on.
- **prompt** — what a section or a Q&A pair answers: a heading or a question.
- **composition** — assembled prose plus the ordered concepts it includes or cites, with its
  own provenance and verification. A guide section and a response are its two homes. Its
  shown trust is the weaker of its own and its cited concepts'.
- **include** — one concept a composition draws on, in order, with the context wording chosen
  for it and the concept's content as it stood when the prose was written. An include names a
  concept, never another composition.
- **needs review** — the state of a composition whose included concept changed or was removed,
  whose expectation is unmet, or on which a review found a fault; the platform *marks* it (a
  reader *flags* an answer); shown, never hidden, until a person acts.
- **skeleton projection** — the guide's structure the platform writes into the company's
  repository (kind, subject, roles, sections with their prompts and included concepts; no
  prose), regenerated when the guide definition changes. _Avoid_: projection alone, structure export.
- **citation** — the unit a reader checks: a concept, the source and locator it rests on, and
  the cited passage, shown beside the claim it supports. In a search hit, the same unit shown
  as the hit.
- **citation marker** — the mark in a composition's prose that ties one claim to one include: a
  footnote reference labelled by the include (ADR 0015). What the reader sees as the passage
  beside the claim, and what the copied text carries as a numbered footnote; its text is never
  stored, always rendered from the include.
- **expectation** — a section's statement of which concepts should populate it (by type,
  relation to the subject, tag or feed); coverage is expectation minus what is included.
- **response** — a composition scoped to one question put to the company: a question-set
  question in v0.1 (ticket 47 Q10), an opportunity's question once the opportunity layer arrives.
  A record like every composition; the opportunity, when there is one, attaches to it later
  (Liam, 26/08/2026). Empty, carrying its unmapped passages, when nothing on the map answers.
- **answer** — what the platform returns for a question: prose asserting concepts only, a
  passage per claim, its verdict for the caller's role, and what it could not answer — found by
  traversal first (an existing `Answer` reused as it stands, shown with the question it
  answered) and drafted over the walk's concepts otherwise (ADR 0016). Not the `Answer` concept
  (a Q&A pair), which an answer may reuse or cite. _Avoid_: RAG answer.
- **answer contract** — the one shape an answer takes for the UI, MCP and the response record:
  an event stream — verdict first — folded into one object (ADR 0016).
- **hit** — one unit a search returns, typed by its knowledge layer: a concept, with the guide
  sections it appears in and the documents it rests on nested under it; a guide section or a
  document on its own only when no concept covers it. Every hit wears its trust or sensitivity
  word; a document nothing rests on reads *Not company knowledge*. _Avoid_: result.
- **unmapped passage** — a passage from a connected document that no concept rests on, shown
  where nothing on the map answers — source, locator, sensitivity word — never asserted as the
  company's answer; one act from a suggested concept. _Avoid_: lead (a sales word).

## Records the platform keeps

Records exist because the platform runs a use case (ADR 0011); every record about a concept refers
to it by IRI and never restates it (ADR 0014).

- **record family** — one kind of record the platform keeps: one shape, one reason to exist (the
  use case or the derived view it serves). Records are never a knowledge layer.
  _Avoid_: activity record (the draft's word).
- **verification** — the platform's record of one check of a concept or a composition against its
  sources: who, when, and the content confirmed. A concept file's `verified` event is its
  projection.
- **verification request** — a reader's or the platform's ask that a concept or a composition be
  checked, with a reason — a reader's flag, *due a check*, *shelf life ending*, *source changed*,
  *source gone*, *cited concept deprecated*; one open per concept and reason; lands in its
  owner's queue, the cadence ones batched into the weekly digest.
- **review cadence** — how long after its latest matching check a concept of a type is *due a
  check*: a per-kind workspace setting with platform defaults (Certification,
  Insurance, Rate: twelve months; most types none); never written into a file. _Avoid_: TTL.
- **shelf life** — the reader's word for `stale_after`: the date after which a concept is *Out of
  date*; absent means none. _Avoid_: expiry, expired.
- **actor id** — who a `generated.by` or `verified[].by` names: a person as `human:<email>` (as
  Google's samples), the platform's agents as `better-answers-<purpose>/<version>`, a process as
  `process:better-answers-<purpose>`. Verifier and generator must differ on the producer part. On
  a record the platform keeps — the *ledger*, a commit trailer, a suggestion's proposer — a person
  is `human:<person id>`; the file forms stand.
- **actor alias** — an Admin's mapping of an imported actor id to a member, so *Checked by* can
  name them; the file is never rewritten.
- **person id** — the platform's one stable id for a person: minted by the platform at their first
  sign-in, carried on the identity set's user row, `userId` on every Principal, and what every
  record names a person by as `human:<person id>`. Never written into a concept file, which keeps
  `human:<email>` (ADR 0019). _Avoid_: member id (retired 05/09/2026 — the member row's key names
  nothing), user id (on a screen).
- **minter** — the kernel's one function that mints every id the platform writes, a time-ordered
  ULID; Better Auth is handed it too, so every identity id has the same shape (ADR 0035). Not the
  *minting* rule, which decides where a unit of knowledge lives (ADR 0011). _Avoid_: id generator.
- **owner (of a concept)** — the person answerable for keeping a concept checked and current: the
  domain's owner unless the concept names its own. May edit it directly and decides *edit*
  suggestions on it. Distinct from a binding's owner and from the bundle manifest's owner.
- **usage** — one recorded act that takes a concept or a composition out of the platform: copied
  into a document, exported in a document (a response-set document is one usage per response),
  later submitted. Membership in a section is not usage;
  a citation in an answer is counted from the answer audit. (Not OKF's `usage_count`, which is a
  source's use by a concept.)
- **conflict** — two values for one claim found across sources, recorded with both values and
  their evidence; raised by the pipeline, resolved only by a person (supersede, deprecate, split by
  tier, dismiss).
- **question set** — the ordered questions a document put to the company, which responses
  answer; extracted as a suggestion and confirmed by the person before any response is drafted;
  an input to a use case, never a source and never company knowledge. Not a pack, not an
  opportunity.
- **answer audit** — the retained record of every answer the platform gave: who asked, on which
  surface, what was answered, what it cited and how trusted that was at the time, the predicate
  that applied and, on reuse, the matched `Answer` and the judge's verdict; with the feedback and
  corrections it received. Not part of the audit ledger. Content is kept twelve months by default, then thinned to the
  skeleton — citations, trust then, verdicts, feedback and corrections — kept for good (ADR 0017).
- **feedback** — a reader's verdict on one answer, never the platform's: *helpful*, or a **flag**
  with a reason — *wrong* · *out of date* · *incomplete* · *should not have shown* — that becomes
  a record in someone's queue (a verification request, an edit suggestion, or the Admin's to
  route). _Avoid_: rating, report.
- **correction** — an Admin's or owner's act on one audited answer that records the level it went
  wrong at — concept, source or retrieval — and links the act that fixed it; never a text edit.
- **answer test** — a retrieval correction kept as a test: a question, a role, the concepts the
  answer must reach and must not, the `Answer` it must or must not reuse, the expected verdict;
  the workspace's tests are replayed retrieval-only when the answer path changes and weekly;
  *stale* when a concept it names is deprecated. _Avoid_: eval (on any screen).
- **audit event** — the record of one act by an Admin or the platform — what was done, to what, by
  whom, when, with what confirmations — in the one append-only *ledger*. Every event belongs to
  one of four families — **people**, **knowledge**, **sources**, **platform** — named as the first
  word of its act, `family.subject.verb`; runs, the *answer audit*, *signals* and spend are their
  own records and never audit events. _Avoid_: log.
- **ledger** — the one append-only record of every *audit event* a workspace keeps, written in
  the same act it records. _Avoid_: audit log, event log.
- **erasure request** — a person's request that their personal data leave the platform: what was
  done in every store, when, and when the backups are beyond use. A valid one reaching the bundle
  runs the history-rewrite routine (ADR 0020) and carries the *erasure pseudonym* it minted.
- **erasure pseudonym** — the per-workspace opaque id, minted at erasure and kept on the erasure
  request, that `human:<email>` becomes across that workspace's files and history on a valid
  erasure request. Never the person id, so two workspaces' rewritten histories cannot be joined
  on one person.
- **subject request** — a person's access or erasure request: the same per-store finder, the
  one-month clock; access answers from the normalised text.
- **suppression** — the entry that keeps a person's data out of every derived store when a
  document is reprocessed; applied per document, linked to its erasure request.
- **version (of a record)** — one state of a composition or a guide definition, kept for good with
  who changed it and why; the current state is the latest version. Concepts have git instead.

- **backup run** — one scheduled copy of one store, or one restore drill, as a row: what, when,
  outcome, size, where it landed, whether it holds personal data, when it expires, and — for a
  drill — how long the restore took.
- **restore drill** — the monthly rehearsal that restores the platform from its copies into staging,
  proves it answers, records the recovery time, and wipes staging afterwards.
- **staging** — a second copy of the platform on VPC 2 holding synthetic data only, brought up on
  demand for a drill or a rehearsal and wiped after; it never stands between them (ADR 0024).
- **git store** — one of the platform's four shared stores (ADR 0005): the bare git repositories
  under `/data/git`, one per workspace, holding the bundle. The app is its only writer and the
  worker mounts it read-only at a commit; it is backed up as a verified `git bundle` per workspace
  and mirrored to the second box. _Avoid_: git host, repository server.
- **forge** — the same thing named from the outside: the bare git repository per workspace that the
  app writes and the worker reads at a commit. **No forge *service* runs** — no UI, no SSH server,
  no user model, no second schema (ADR 0024). _Avoid_: Forgejo (as a component).
- **deploy unit** — **what one release changes**: the platform stack — `migrate`, `app`, `worker` —
  deployed by image digest. The stores stack and the database resource are **not** in it: they change
  on their own upgrade drill, not on a release. Use the phrase in this sense only; a document that
  means "everything on the boxes" says **estate** (ADR 0022; A16 of the pre-build gate).
- **release** — an Admin's recorded act that promotes a built image digest to production.
- **signal** — a named query over rows the platform already keeps, with a threshold that makes it
  worth a line on System (ADR 0025). Never a metric scraped from a process. _Avoid_: metric, KPI.
- **alert** — a signal over its threshold, recorded once as a `platform_event` and emailed by the
  app (immediate or in the daily digest) until a *cleared* event closes it (ADR 0025).
- **dead-man ping** — the outbound heartbeat a job sends only after its work is verified; silence
  is the alert. Carries an outcome word and sizes, never a path or an error.
- **escrow** — the two-holder vault outside every box that keeps the handful of secrets whose loss
  loses everything else.
- **boundary schema** — the validation schema a caller is checked against for one table, in three
  shapes (select, insert, update), generated from the table rather than written beside it, so a
  column has one definition and a boundary cannot drift from it (ADR 0028). Narrowed by refinements
  and composed at a boundary by picking, omitting and extending; a table's columns are described in
  one place only. _Avoid_: shadow schema (a second, hand-written description of a table's columns —
  the thing a boundary schema exists to make unnecessary).
- **refinement** — a narrowing of one column's boundary schema, written beside that column: a brand,
  a format, a trim, a value set smaller than the column's. A refinement only ever makes the accepted
  set smaller, and the parity test proves it by offering what the refinement accepts to the column
  itself (ADR 0028). Not a boundary's own shaping, which selects columns rather than redescribing
  one.

## People

- **workspace** — the tenancy boundary and the unit a company occupies: one company's people,
  bindings, bundle repository, index, graph and records. **Every tenant row, every object-store
  prefix, every graph node and edge carries its workspace id**, and every query reaches its store
  through a store door, over row-level security (ADR 0032). Better Auth's identity set is not
  tenant data: read by key before a workspace is known, it is what a workspace id is resolved from
  (ADR 0009). One deployment holds many; a person may belong to more than one and picks before
  consent. Workspaces are provisioned by the platform, never created by a person. _Avoid_:
  organisation (Better Auth's word for the same thing — say *workspace* in our own code and on every
  screen), account, team, site.
- **tenant** — the same boundary said from the platform's side, used only where the sentence is
  about isolation rather than about a company: *tenanted by rule*, *multi-tenant-ready*. There is one
  boundary and it is the workspace; *tenant* never appears on a screen and is never a second concept.
- **principal** — who a call is made as: `workspaceId`, `userId` and `role`, built by the transport
  from a verified bearer and passed as the first parameter of every `packages/core` function that touches
  tenant data (`[SEC2]`). It has **three kinds** (ADR 0009, 2026-09-04):
  - **user principal** — a signed-in person in one workspace, with the role their membership gives them.
  - **platform principal** — the platform acting as itself, with its own actor id
    (`process:better-answers-<purpose>`) and no person behind it: the erasure routine, the nightly
    audit, the reconciler. Its acts are audited under that identity and never under a person's.
  - **operator** — the platform's administrator over every workspace; its own entry below.

  One more word has no type yet — **deferred principal**: a named person's authority carried into
  work that outlives their session (a background job, a scheduled run, a replay). It records the
  person it borrowed from and **expires with the authority it borrowed**, so a job cannot outlive
  the access that started it. Work that outlives a session runs under a deferred or a platform
  principal, never under a live user session.
  _Avoid_: user (in code), session, caller, actor (which is the *id* on a file, not the principal).
- **operator** — the platform's own administrator over every workspace: a real person on the
  identity set with the platform-level role, a third principal kind beside a user and the
  platform, audited under their own id. Never a workspace *role*; *Admin* is the highest role a
  workspace has.
- **revoke credentials** — the one revocation act, in two scopes. *In a workspace*: a workspace
  Admin ends every session and token a person holds there, by an instant on the membership row
  the resolver refuses against; nothing outside that workspace changes, and the Admin never
  learns whether others exist. *Everywhere*: the operator ends every session and token the
  person holds, by an instant on the person. Both end what was issued; a fresh sign-in mints
  anew. _Avoid_: suspend, ban, deactivate.
- **agent token** — a **share agent's** credential: binding-scoped, minted and revoked by an Admin,
  checked in the app before any request body is read, and good only for the `/agent/v1` routes a
  share agent uses to push documents in from a company's own network (ADR 0008 amendment, `[SEC1]`'s
  *agent* class). Not a personal token (a person's own bearer for Claude Code and scripts) and not an
  OAuth access token. _Avoid_: api key, service account.

- **role (of a person)** — what a person may do on every surface, a **level** never a job title:
  **Admin**, **Editor** or **Viewer** in v0.1 (`[SEC2]`'s Principal; Liam, 27/08/2026 — the
  platform is agnostic about who a bid writer is). Editors and Admins check concepts, run
  question sets and save Answers from history; Viewers ask, flag and suggest. _Avoid_: Bid
  writer, Sales (as role names). A guide definition sets, per role, the default layer
  and the action threshold; a binding's *audience* is who may see, never a role. Not a section's
  role label.
- **access request** — a signed-in person's recorded ask to join one workspace, with a reason;
  decided by an Admin — approved (which mints the invitation) or declined — each decision on the
  *ledger*. Not a *subject request*.

## Platform surfaces

- **Better Answers** — the product's name (ticket 22, 27/08/2026): "Better Answers" in prose,
  `better-answers` as the handle; in this glossary and the docs it is still *the platform*.
  Concept IRIs live on its apex, `https://better-answers.com/c/<ulid>`.

- **Control Centre** — the one Admin surface, in six **screens**, where every agent interaction,
  suggestion, conflict, review request, export and system signal is seen and acted on:
  **Sources** (bindings, the publish and accept gates, the priced plan, backlogs, gone-at-source
  impact, agent tokens, the ceiling), **Suggestions** (every waiting suggestion, one queue),
  **Knowledge** (the review table over every concept and composition; conflicts and
  verification requests as saved filters; exports), **Questions** (the answer audit, flagged
  first, with the promotions and the answer tests), **People** (roles, owners, thresholds,
  erasure and suppression, tokens), **System** (signals, health, routes and spend, backups)
  (ADR 0017, ticket 37). "Proposal" is the bid document a company completes and is never a
  screen (Liam, 26/08/2026). _Avoid_: section (a guide's node), "Mission Control".
- **screen (of Control Centre)** — one of its six: Sources, Suggestions, Knowledge, Questions,
  People, System.
- **promotion** — an Editor's proposal that an answer or a response become an `Answer`
  concept — the button is *Save as an Answer* — kept as a suggestion of kind *promotion* until
  decided at the promotion gate. _Avoid_: promote (as a reader's verb — a marketing word).
- **promotion gate** — where the `Answer` domain's owner or an Admin decides a promotion, one at
  a time: the proposed Answer beside the closest existing one (found when opened, judged same ·
  variant · different) — update the existing, add as new, or decline; client-specific wording
  stripped first. One governed write, the decider as author; a trim makes the decider the
  generator. _Avoid_: moderation.
- **MCP surface** — the platform's one tools-only MCP server at `app.<domain>/mcp`, on the product's
  own origin (T-045, 2026-09-03; `mcp.<domain>` before it): four entries in
  v0.1 — `find`, `ask`, `open`, `give_feedback` — the principal from the
  token, the same predicate and audit as the app, grown later by token scope, never by a
  second server (ADR 0018). Guides and the question set are not on it. Never named on a screen;
  the System card says *Connected clients*. _Avoid_: connector, endpoint, MCP (on a screen).
- **MCP tool** — one of the surface's entries: a named, described, typed function that never
  takes a workspace and returns structured content with its human rendering. Not a connector's
  referenced read tool.
- **open (an MCP entry)** — the verbatim step of two-step retrieval: a concept by IRI, or the
  passage a citation rests on by locator; `find` is the preview step.
- **MCP App** — a view the platform serves for an assistant to render inside the conversation:
  an HTML page addressed by a `ui://` URI, named in an entry's metadata, drawn in a sandbox the
  host controls, able to call the same entries the assistant can. It shows a concept, an answer
  or a set of hits; it is never a second way in (ADR 0030). _Avoid_: widget, panel, interactive
  connector.
- **view** — the rendering half of an MCP App: one `ui://` resource bound to one entry. Every
  view has a **human rendering** behind it — the text form of the same result — and not every
  human rendering has a view.
- **`ui://`** — the wire URI scheme for a view. Beside `okf://` and meaning something different:
  `okf://` identifies a **concept**, `ui://` identifies a **view**. On the wire only, never in a
  file.
- **token scope** — what a token may do on the MCP surface: `knowledge:read`, `feedback:write`;
  `act:*` later. Shown at consent in the person's words, never as an id. Not a binding's scope.
- **personal token** — a person's own bearer credential for Claude Code and scripts (the
  `api_token` record): the same principal and scopes as an OAuth token, ninety days by default,
  shown once, minted on the Account page, listed to Admins in People. _Avoid_: api token,
  access token, agent token (the share agent's) for this meaning.
- **client (connected)** — a host that has been granted access to the surface by OAuth and used it
  (Claude on the web, Claude Code). Under client-ID-metadata documents there is **no registration**,
  so the word *registered* is wrong — but the platform caches each client's metadata document as a
  row, with the scopes it may request, refreshed from the document on a schedule (ADR 0009): the
  System card lists the distinct `client_id` URLs seen on issued grants, each named from its own
  metadata document, with who has connected through it. _Avoid_: registered client, connector,
  integration.
- **Account page** — a person's own small surface outside Control Centre: name, role,
  workspace, personal tokens.
- **sign-in** — how a person proves who they are to the platform: an email code, or Microsoft
  for a company on Microsoft 365 (T-045 grilling Q10, 2026-09-03); never a password. A person is
  invited by email first, and a Microsoft account signs in only on an exact match with that
  email. _Avoid_: login, social login; SSO only for the per-client shape, a client's own tenant.

- **map** — the reader's word for the graph, and the only one that reaches a surface (*graph*,
  *sync*, *traversal* and *generation* never do). **Two** fixed phrases tell its state: **map as of
  <time>** (the ordinary case — the map agrees with the bundle, stamped) and **map unavailable since
  <time>** (the panel is replaced by the phrase and one sentence of what still works). Because the
  map lives inside the same Postgres the app commits to, it is unavailable only when the database
  itself is, at which point nothing else works either. The third phrase, *map as of <time> ·
  updating*, is **retired**: the graph delta joins the app's commit transaction, so the map is never
  behind for an edit, and a full rebuild writes beside the live generation and flips in one row
  update, so it is never behind during a rebuild either (ADR 0023, *the graph is application data*).
  Never a verdict; an answer carries the phrase in its context header line.
- **generation** — the stamp every bundle-and-record node and edge in the graph carries; a
  workspace has one live generation, flipped by one row update after a full rebuild, and every read
  binds it. Generations exist **for full rebuilds only** — an ordinary edit's delta lands in the
  app's own commit transaction and writes no new generation (ADR 0023). Source entities carry none:
  they are reconciled per document.
- **graph sync run** — the job that **rebuilds** one workspace's graph in full as a new generation,
  for one of six reasons — first sync · route change · reconciler · erasure · upgrade · drill — and
  flips it live in one row update. It is not how an ordinary edit reaches the map: that delta is
  written by the app in the same transaction as the concept index row, the `bundle_commit` and the
  `audit_event` (ADR 0023). _Avoid_: derive-and-sync (for the edit path), sync lag.
- **entity merge** — the rule an Admin's confirmed alias-merge suggestion writes: an audit event,
  never a commit; undone by deleting it and re-deriving (ADR 0023).
- **canonical entity** — the node an entity merge produces: keyed by the rule, carrying no
  binding, with every contribution hanging off it under its own binding, class and audience; never
  shown when no contribution is visible to the reader; never a concept (ADR 0023).
