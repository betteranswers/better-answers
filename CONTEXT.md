# CONTEXT.md — domain glossary

Root glossary for the platform. Seeded from `.planning/draft-docs/draft-context.md`; a term
moves here only once it has been settled in a wayfinder ticket. Terms not listed here are
still draft.

## Knowledge model

Three knowledge layers, named and never aggregated: **sources** (evidence — connected and
indexed, or referenced and read live) → **bundles** (OKF concepts: the curated map) → **graph** (derived from the bundles
and records; queryable). **Records** are what the platform itself keeps — guides,
compositions, usage, bindings, audit — citing concepts, never restating them. 
Where a unit lives is decided by **minting**.

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
  what it was made from, owner, content version.
- **api** — the TypeScript deployable: one directory (`apps/api`), one compose service and one
  process, carrying tRPC, the MCP surface, the authorization server and the SPA's build on one
  origin. The word for that tier in prose, in code and on a job's *claimant*, because "the app" is
  ambiguous three ways — `apps/` holds three deployables, `app` is a hostname role in the ingress,
  and "the app" reads as the whole product (Liam, 19/09/2026). `app_rt` is the Postgres runtime
  role the api connects as, an identifier rather than a second word for the tier. _Avoid_: app (for
  the tier), the backend, the server.
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
  reads through the same predicate and the same audit as any other. Not a client
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
  confirmed is kept platform-side on the verification record, never as a key in the file.
  A human verifier earns *human-reviewed*; an agent earns *machine-confirmed*.
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
- **watermark** — the last commit a workspace's rows know about: its newest *bundle commit*, or
  none for a bundle whose rows know no commit yet. The governed write holds the per-repository lock
  through its Postgres COMMIT, so recorded history is a prefix of git history: everything after the
  watermark is missed and nothing before it is. A watermark the ref's history does not contain is
  *history diverged*, which no replay can put right (ADR 0012, amended 2026-09-06). _Avoid_: cursor,
  checkpoint (a connector run's per-batch mark).
- **head check** — the reconciler's periodic pass in the api process: every workspace's bundle head
  read against its *watermark*, and the commits between replayed oldest-first through the live
  handler under the reconciler's platform principal. Every thirty seconds, one tick at a time,
  quiet when it finds nothing; `pnpm ops reconcile-watermark` is the same pass on demand, the
  restore path (ADR 0012). _Avoid_: poll, sync (for this pass).
- **reconciler hit** — one commit the reconciler replayed: the ledger row
  `platform.reconciler.replayed`, written under the commit's own `Audit:` id, a bulk replay's rows
  sharing one batch id. The *signal* ADR 0012 names, in ADR 0025's sense — a query over those rows,
  never a metric. A hit is a crash window that was recovered, so a run of them is a fact worth
  reading. _Avoid_: reconciliation event, replay count.
- **concept index** — the platform's derived row for every concept, written when the concept's
  commit is made, checked by the sync, never edited. The only "both" of the minting rule. Carries
  the text `find` and `ask` match against, so a concept is searchable at its commit (ADR 0016,
  amended 09/09/2026).
- **merge key** — what a concept is recognised by when its IRI is not yet known: the words a
  suggestion's payload carries about the concept it means, which an acceptance resolves the
  target from at the moment it commits, never before. One concept per merge key in a
  workspace, so a concept whose identity moved between proposal and decision refuses the
  acceptance rather than landing on the wrong concept. _Avoid_: natural key, identity key.
- **suggestion** — a change to the company's knowledge or its configuration — prepared by the
  platform (candidate concepts from a run, a platform-bundle or template
  update, an alias merge, a composition rewrite), or by a person who may not commit it (kind
  *edit*: a concept's text, a Brief, a missing fact, a new concept raised from unmapped
  passages; kind *promotion*: an answer proposed as an `Answer`, decided singly at the gate) — which the target's owner or an Admin
  accepts or declines before it is applied. Nothing platform-prepared enters a bundle without
  acceptance; every kind but *edit* is an Admin's to decide, in Control Centre. A suggestion
  the platform refused mid-acceptance is **returned**: handed back to its proposer with the
  reason, recording who was deciding it, because what it was written against moved.
  _Avoid_: proposal (the bid document), offered change, revision.
- **inbox** — where suggestions wait to be decided: the queue of one workspace's suggestions
  and their payloads, platform state in no knowledge layer. Nothing reads a payload but the
  acceptance path, and no run reads another run's candidates out of it. _Avoid_: queue (a
  worker's), review queue.
- **concept write request** — a suggestion's payload: the concept file it would write and the
  merge key it means it for, committed on acceptance and never on validation. It carries no
  IRI, because identity is the acceptance's to resolve. _Avoid_: draft, pending concept.
- **citation repair** — the platform's own fix for a source that moved on: a new locator into
  the same document, raised as a suggestion of kind *repair* — which nobody but the platform
  may raise — and decided like any other. Its acceptance re-points every standing check at the
  content it wrote, so repairing a citation never turns *Checked* into *Changed since checked*.
  _Avoid_: relink, locator fix.
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
- **effective class** — the class a source document is actually read at: the narrower of its
  binding's class and the document's own, where it has one — the seam's special-category verdict
  or an Admin's narrowing. Every chunk of the document is read at it and a narrowing is checked
  against it, so a document's own class only ever takes visibility away. _Avoid_: folded class,
  derived class (a *concept's* class is derived, from its evidence).
- **finding** — what the pre-scan found in one source document: a category (bank details, date of
  birth, home address, personal contact, special category, …), offsets into the normalised text,
  the rule and detector version that fired. Counted per category; never a class, never a value.
  Born **unreviewed**; a review leaves it *kept in text* or *narrowed*, with the acting Admin and
  the instant. **Marked** once an Admin has reviewed or restored it, *unmarked* until then. **The
  same finding on every run that finds it**: the document, the rule and the offsets are what it
  is, for as long as the document's content stands, so what an Admin decided about it stands on
  every later run. Its category, tier, score and version are a run's **reading** of it — the last
  run's — never part of what it is. Its tier is the tier it is withheld at on its binding now: its
  rule's, raised to *always* by the officer-block rule or by an erasure request that names it. A
  finding the last run did not raise, because the rules moved on, is no longer shown to a
  reviewer, acted on or counted at a publish.
- **finding group** — the unit of the review: one document's *findings* of one category, raised
  by one rule at one tier, with how many there are. It is what the review lists and what the two
  bulk acts below are taken over; it names no span and carries no value, so a reviewer acts on
  what was found without ever being shown it. _Avoid_: group on its own (a *group* is members).
- **keep in text** — an Admin's bulk act over named *finding groups* of one binding: every span
  of each group restored with one reason because it is the company's own business fact and
  reviewed as *kept in text*, and the run that lets them back into the document queued with
  them. The always set alone, one ledger row per span. An *erasure request* outranks it: a kept
  span a request names is **overridden by the erasure** — it stays withheld, and the review says
  so beside its group. (Not a *class override*, which is an Admin's act on a concept's class.)
- **narrow these documents** — an Admin's bulk act over named *finding groups* of one binding,
  taken on the *source documents* they sit in: each document takes a class of its own, its chunk
  copies are rewritten, the named groups' unreviewed findings are reviewed as *narrowed* — and
  no finding the Admin was not shown — the *cascade* runs from the concepts citing the
  documents, and the run that puts the binding back through the index is queued with them. One
  ledger row per document; it never widens.
- **redaction seam** — the one place a document's text is read for what must be withheld and
  the placeholders are written in, ahead of chunking, extraction and every model call, so that
  no derived store and no model ever holds the value.
- **redaction rule** — one of three tiers of what the seam withholds: **always** (policy no
  binding switches off; a span restorable with a reason), **default on** per binding, **default
  off** per binding. The officer-block rule always wins.
- **consumer-domain list** — the email domains this repository judges a consumer provider's,
  dated and sourced. An address on one is a person's own and is personal contact; an address on
  any other domain is a company's and stays in the text. A judgement, never a complete register.
- **withheld** — the placeholder word: `[withheld]` for the always set, `[home address withheld]`
  and the like for the rest, `[person A]` for a pseudonymised name. The latter two are **typed
  placeholders** — each names the class of data taken, one word per category — where the always
  set has the one neutral word for everything in it, so that a reader is never told what class of
  data the document held. It is the word a *withholding* writes.
- **withholding** — what one binding does with one *finding* on one run: *withheld* or *left in
  the text*, at a tier, for one **reason**, the first of these that holds — *overridden by the
  erasure* (a request names it and an Admin had kept it) · *erasure* (a request names it) ·
  *restored* · *switched off* · *in force*. Beside the reason, how it was **written**: under its
  own placeholder, under another finding's, or not at all — a withheld finding inside a longer
  withheld span is written under that span's word and is no less withheld. A finding is never
  rewritten by a withholding. _Avoid_: decision, detection.
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
  bound per URL prefix (ADR 0013). A binding wears one state word: **landed** (its documents are in
  the object store), **indexing** (a run is turning them into chunks), **indexed** (the run has
  finished and there is something to review) and **published**. _Avoid_: connection, integration.
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
- **source document** — the platform's row for one item a binding yields: source-system id, title,
  `last_modified` (recorded absent when the source has none), content hash, first and last seen,
  `gone_at`, sensitivity, and the object-store key of each of its two landed copies. The catalogue
  every run reconciles. A locator is a span into its normalised redacted text and never one of
  those keys. _Avoid_: ingest trace (the draft's word).
- **landed copy** — a source document's bytes as the platform holds them in the object store: the
  original and the normalised redacted text. The normalised copy is keyed by the document; an
  upload's original by its *source binding*, the id its caller minted.
- **converter** — what turns a landed copy's bytes into the document's normalised text, before the
  redaction seam sees a word of it. One per media type, chosen once (ADR 0013), because the text it
  writes is the address space every locator and every content hash is read against. _Avoid_: parser
  — the nightly audit's word, for a different thing.
- **quarantined** — how a run left a source document it reached and could not read: no normalised
  copy, no chunks, and the word on its catalogue row beside the *quarantine error*. A page with no
  text layer, an encrypted file, a truncated upload and a conversion that ran past its own ceiling
  are all this one outcome; it is never a failed run, and the run lands the binding's other
  documents and finishes. Its opposite on that row is **converted**, and a row carrying neither is
  a document no run has been over yet.
- **quarantine error** — the name of what refused a document, on the row beside *quarantined* and
  meaningless without it. It is a name and never a sentence, so the same refusal reads the same on
  every row and a binding's documents can be counted by it — which is what an Admin deciding
  whether the platform needs OCR is reading. A document no run has quarantined has none.
- **chunk** — one unit of a source document's normalised redacted text that the chunk index holds,
  keyed by its document and its ordinal, read at the visibility its binding and its document give
  it — its *effective class*, its audience and whether it is published. Never the original text.
- **window** — one run of a document's text the redaction seam puts to the detector's model in a
  single call, because the model reads less at once than a document holds. It is an argument to a
  model and nothing else: never stored, never addressed by a locator, and no finding's offsets are
  counted inside one — a finding's offsets are the document's. Where its edges fall is a rule, and
  the rule is ADR 0020's. _Avoid_: chunk — the index's unit above, which this seam runs ahead of
  and never produces; the model reads windows, the index holds chunks.
- **locator** — the address of a passage inside a source document, written whole as
  `<source document id>/chars:<start>-<end>`: the document it is in, then the span, whose offsets
  are counted in Unicode code points into the document's normalised redacted text and versioned by
  the redaction string that text carries. The one string a citation's evidence and a chunk both
  carry, so a citation and a passage are one address.
- **passage** — the text a locator resolves to, served with its source document's title and its
  sensitivity word: the unit `open` returns and a hit marked *Not company knowledge* previews.
- **connector run** — one execution of a binding by the scheduler (enumerate, index, extract, prune
  or reindex): claimed under a lease, keyed by its run key, checkpointed per batch, one per binding
  at a time, parked after repeated failure; its outcome rows record what changed per document.
- **job** — one unit of background work, as a row on the queue: what to do (its *kind* — the
  nightly audit or the full rebuild today; the route's S1 adds kinds to a loop that exists), for
  which workspace, **about which subject** — the binding an index job is for, the concept a catch-up
  job is for, named on the row by a typed column a kind's CHECK requires (T-113, 10/09/2026) — and
  the facts the claim protocol needs. Queued until a *claimant* takes it under
  a *lease*; ends *done* or *failed* with an *outcome*, or *poisoned* after its last lost claim.
  The api enqueues; a job's kind names the tier that claims it — the worker for every kind but the
  one only the api can run (the question-set job, S6's, whose answer path is the api's) — both
  through the same queue SQL functions (ADR 0031's `queue` agreement, which already admits the api
  as a claimant; ADR 0005: the control plane is rows;
  09/09/2026). A job is its own record and never an *audit event*. A *run* is a job being done:
  a *connector run* or a *graph sync run* is one job's execution. _Avoid_: task, ticket.
- **lease** — the scheduler's grip on a claimed run: held only while its claimant keeps confirming
  it is alive, expiring otherwise, so a run whose claimant died is handed back for another claim
  rather than lost. _Avoid_: lock (nothing waits on it).
- **claimant** — the process holding a job's claim — the worker, or the api for a kind only it can
  run: the only one that may keep its lease alive, finish it or fail it — and no longer the
  claimant once the lease has lapsed, whether or not the job has been claimed again since.
  _Avoid_: owner (a job has none), holder.
- **outcome** — what a run found, written once at its end by its claimant: counts, and the ids or
  paths it counted them at, or the name of what went wrong — never content, never a person's name,
  so a record of what a run did is kept as it was written. A job that never ran has none.
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
  the concept file and never for the surface that will read it. There is no design-time
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
- **cascade** — the re-derivation an Admin's narrowing of a binding or of named documents of one,
  or override of a concept's class, sets off inside the same act: first every concept citing the
  evidence that moved, then every composition including one of those concepts — two levels, the
  second reading what the first wrote, never a third — so a guide never reaches a reader its
  includes would not. _Avoid_: recompute (one level's work, not the whole), propagation.
- **class override** — an Admin's recorded act that sets a concept's class — sensitivity and
  audience — whatever its evidence and its kind's floor derive: one row per concept, the latest
  standing, one audit event, and the *cascade* run inside the same act. The one act that may widen
  a class; where it widens past the evidence, a reader is in the *shared beyond its evidence* state
  and the *evidence pane* names the Admin (ADR 0039). _Avoid_: exception, exemption, allow-list.
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
- **DPIA input** — what one binding contributes to a data protection impact assessment, as a
  document and its hash: the personal data categories its rules in force can raise, its scope,
  class, routes, *retention class* and audience. The hash rides on the publish audit row.

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
- **evidence pane** — what a reader sees of a concept's cited evidence: one of three states off two
  counts — *included*, *partly included* or *not included* in their access. It leads with the
  reader's access, lists only the evidence they may open, names the Admin whose *class override*
  put them in *shared beyond its evidence* where one has, and always says where to go next, so it is
  never a dead end (ADR 0023; Liam, 05/09/2026). Never a trust signal. _Avoid_: sources panel,
  citations list.

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
  word of its *ledger act*, `family.subject.verb`; runs, the *answer audit*, *signals* and spend are
  their own records and never audit events. _Avoid_: log.
- **ledger act** — the name an *audit event* is recorded under, `family.subject.verb`
  (`sources.binding.published`), declared by the part of the platform that performs it and never a
  free string. One *act* may write more than one, and a read writes none (ADR 0043).
  _Avoid_: event type, action name.
- **ledger** — the one append-only record of every *audit event* a workspace keeps, written in
  the same act it records. _Avoid_: audit log, event log.
- **erasure request** — a person's request that their personal data leave the platform: what was
  done in every store, when, and when the backups are beyond use. A valid one reaching the bundle
  runs the history-rewrite routine (ADR 0020) and carries the *erasure pseudonym* it minted.
- **erasure pseudonym** — the per-workspace opaque id, minted at erasure and kept on the erasure
  request, that `human:<email>` becomes across that workspace's files and history on a valid
  erasure request. Never the person id, so two workspaces' rewritten histories cannot be joined
  on one person.
- **subject request** — a person's access or erasure request — a member's, or one recorded on
  behalf of a person the company's files name who never signed in (10/09/2026): the same
  per-store finder over the request's identifier set, the one-month clock from its start;
  access answers with where the platform holds the person and under which categories, never
  a passage.
- **suppression** — the entry that keeps a person's data out of every derived store when a
  document is reprocessed; applied per document, linked to its erasure request.
- **erasure map** — the per-store finder's answer for one *subject request*: every store family
  the platform holds and what in each of them names the person, found over the request's
  identifier set. The *suppression* entries and the report are written from it.
- **replay copy** — the completed *erasure request*'s copy in the object store — the request, its
  *erasure pseudonym*, the identifier set and the *erasure map* — that a restore reads to run the
  erasure again over a dump older than the request. Restricted personal data, as a *suppression* is.
- **erasure rehearsal** — the *restore drill*'s proof that erasure erases, run against *staging* in
  two phases so a dump can be taken between them: a **synthetic subject** — a person the platform
  invented, addressed under a reserved domain that resolves nowhere — is seeded into a workspace
  with a membership and a concept file naming them, and the erasure routine is then run over them
  and answers with the real report. Its **tokens** are the values that subject is greppable by in a
  dump, each one a value the erasure removes; *token* here is `dump-grep --tokens`' sense of the
  word and never a credential (*personal token*, *agent token*).
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
  under `/data/git`, one per workspace, holding the bundle. The api is its only writer and the
  worker mounts it read-only at a commit; it is backed up as a verified `git bundle` per workspace
  and mirrored to the second box. _Avoid_: git host, repository server.
- **forge** — the same thing named from the outside: the bare git repository per workspace that the
  api writes and the worker reads at a commit. **No forge *service* runs** — no UI, no SSH server,
  no user model, no second schema (ADR 0024). _Avoid_: Forgejo (as a component).
- **root refusal** — `openGit`'s refusal of a root that is not an absolute path or not an existing
  directory: checked once, at open, so nothing downstream — `initRepository` included — trusts a
  root nobody validated (ADR 0024).
- **deploy unit** — **what one release changes**: the platform stack — `migrate`, `api`, `worker` —
  deployed by image digest. The stores stack and the database resource are **not** in it: they change
  on their own upgrade drill, not on a release. Use the phrase in this sense only; a document that
  means "everything on the boxes" says **estate** (ADR 0022; A16 of the pre-build gate).
- **release** — an Admin's recorded act that promotes a built image digest to production.
- **signal** — a named query over rows the platform already keeps, with a threshold that makes it
  worth a line on System (ADR 0025). Never a metric scraped from a process. _Avoid_: metric, KPI.
- **alert** — a signal over its threshold, recorded once as a `platform_event` and emailed by the
  api (immediate or in the daily digest) until a *cleared* event closes it (ADR 0025).
- **dead-man ping** — the outbound heartbeat a job sends only after its work is verified; silence
  is the alert. Carries an outcome word and sizes, never a path or an error.
- **escrow** — the two-holder vault outside every box that keeps the handful of secrets whose loss
  loses everything else.
- **envelope** — the sealed form a secret is kept in: one versioned frame, written by either tier
  and read the same way by the other, which opens only under the key it was sealed with. A frame
  whose version a reader does not know is refused, never guessed (ADR 0005).
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
  tenant data. It has **three kinds** (ADR 0009, 2026-09-04):
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
- **act** — what an entry — a screen's call, an MCP entry, an ops command, the reconciler's tick —
  may ask the platform to do as a *principal*: one thing, a **read** or a **write**, answered with
  its value or with a *refusal*. Reading a binding's findings is an act as much as publishing the
  binding is. Where the *ledger* records an act, its *audit event* lands with it, under its
  *ledger act* (ADR 0043). _Avoid_: action, operation, command, use case; endpoint and procedure
  (a transport's words for how an act is reached).
- **step (of an act)** — a part of an act that runs only inside the act that called it and never
  on its own: writing the *audit event*, queueing a *job*, reading whether a person holds every
  audience group. It is handed the principal its act admitted, judges no *admission* and has no
  *refusal* of its own — a step that cannot do its part fails the whole act, and nothing of the
  act lands. _Avoid_: helper, sub-act, inner act.
- **admission** — the judgement of whether a *principal* may perform an *act* at all, made before
  the act does anything: from the principal's kind, a person's role, the purpose a *platform
  principal* acts for, and what was asked — never from a stored row. Whether the thing named
  exists, or is in a state to be acted on, is the act's own question, and its answer is a
  *refusal* of another class. _Avoid_: authorisation (the sign-in server's word), permission
  check, guard.
- **refusal** — an act's answer when it will not do what was asked: one hyphenated **refusal
  word** naming what refused (`role-forbids`, `no-such-binding`, `already-published`) — something
  the caller can act on, where a failure is something to log and try again. A word means one thing
  wherever it appears and belongs to one of seven **classes**, by what the caller can do about it:
  *unauthenticated* (sign in again), *forbidden* (someone with the authority must do it), *absent*
  (name something that exists), *malformed* (fix the shape of what was sent), *inapplicable*
  (well-formed, but not something this act applies to), *conflict* (the state moved: read again
  and decide again), *precondition* (something else comes first). A word reaches a screen, an
  agent and an operator as itself; once shipped it is never removed and never changes class, so a
  client that has never met a word can still act on its class (ADR 0043). _Avoid_: error (a
  failure, not a refusal), rejection, denial, error code.
- **issue word** — what a *malformed* refusal says about one field: one hyphenated word from the
  kernel's closed list (`missing`, `wrong-type`, `too-small`, `not-in-set`, `bad-format`) naming
  how the field was wrong, carried in a map of field path to word. The map never holds the value
  that was wrong, so a refusal can be logged and shown whatever the field held. A field path
  names a field, never a class: the class is the refusal's, and it is always *malformed*.
  _Avoid_: validation error, issue code, field error, message.
- **revoke credentials** — the one revocation act, in two scopes. *In a workspace*: a workspace
  Admin ends every session and token a person holds there, by an instant on the membership row
  the resolver refuses against; nothing outside that workspace changes, and the Admin never
  learns whether others exist. *Everywhere*: the operator ends every session and token the
  person holds, by an instant on the person. Both end what was issued; a fresh sign-in mints
  anew. _Avoid_: suspend, ban, deactivate.
- **agent token** — a **share agent's** credential: binding-scoped, minted and revoked by an Admin,
  checked in the api before any request body is read, and good only for the `/agent/v1` routes a
  share agent uses to push documents in from a company's own network (ADR 0008 amendment, ADR 0041's
  *agent* class). Not a personal token (a person's own bearer for Claude Code and scripts) and not an
  OAuth access token. _Avoid_: api key, service account.

- **role (of a person)** — what a person may do on every surface, a **level** never a job title:
  **Admin**, **Editor** or **Viewer** in v0.1 (the Principal every call carries; Liam, 27/08/2026 — the
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
- **view (of a screen)** — one of the parts a screen of Control Centre is divided into: the parts
  the Control Centre entry above lists for that screen, in that order and in those words. Each has
  an address of its own; a screen names one of them its **default view**, and the screen's own
  address leads there. A view nobody has built yet is still a destination, and says in words that
  it is not built. Not a *view (of an MCP App)*. _Avoid_: section (a guide's node), tab (a division
  inside one view, and the view's own business rather than a word of this glossary's).
- **icon rail** — the region down Control Centre's left edge listing its six screens, each an icon
  carrying its screen's name and marking the screen being read. _Avoid_: section nav, sidebar.
- **secondary nav** — the region beside the icon rail listing the open screen's views under that
  screen's name, marking the view being read, and swapping when the screen changes. The navigation
  control closes it and opens it again, and that choice is remembered on the browser it was made
  on. _Avoid_: section nav, sub-nav, sidebar.
- **navigation control** — the button in the top bar's leading corner governing whether the
  navigation is showing: where the screen is wide enough for the regions it closes the secondary
  nav and opens it again, saying which state it is in; where it is not, it opens the icon rail and
  the secondary nav over the content and gives focus back when it closes. _Avoid_: hamburger,
  burger, drawer, menu toggle.
- **toolbar** — the region above a view's content carrying that view's tabs at one end and its acts
  at the other, filled by the view; a view with neither gets no toolbar. _Avoid_: action bar,
  section header.
- **view-state slot** — the one place the open view writes what the acts on its toolbar must read,
  such as what a reader has ticked. It answers empty to any view but the one that wrote it, and it
  is emptied when the reader opens another tab. _Avoid_: selection store, shared context.
- **top bar** — the region across the top of Control Centre carrying the navigation control in its
  leading corner, then naming the workspace, then which screen and view the person is in, then who
  they are, their role and the way to sign out. _Avoid_: masthead, section header.
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
  token, the same predicate and audit as the api, grown later by token scope, never by a
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
- **view (of an MCP App)** — the rendering half of an MCP App: one `ui://` resource bound to one
  entry. Every one has a **human rendering** behind it — the text form of the same result — and not
  every human rendering has one. Not a *view (of a screen)*.
- **`ui://`** — the wire URI scheme for a view of an MCP App. Beside `okf://` and meaning something
  different: `okf://` identifies a **concept**, `ui://` identifies a **view (of an MCP App)**. On
  the wire only, never in a file.
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
  map lives inside the same Postgres the api commits to, it is unavailable only when the database
  itself is, at which point nothing else works either. The third phrase, *map as of <time> ·
  updating*, is **retired**: the graph delta joins the api's commit transaction, so the map is never
  behind for an edit, and a full rebuild writes beside the live generation and flips in one row
  update, so it is never behind during a rebuild either (ADR 0023, *the graph is application data*).
  Never a verdict; an answer carries the phrase in its context header line.
- **generation** — the stamp every bundle-and-record node and edge in the graph carries; a
  workspace has one live generation, flipped by one row update after a full rebuild, and every read
  binds it. Generations exist **for full rebuilds only** — an ordinary edit's delta lands in the
  api's own commit transaction and writes no new generation (ADR 0023). Source entities carry none:
  they are reconciled per document.
- **graph sync run** — the job that **rebuilds** one workspace's graph in full as a new generation,
  for one of six reasons — first sync · route change · reconciler · erasure · upgrade · drill — and
  flips it live in one row update. It is not how an ordinary edit reaches the map: that delta is
  written by the api in the same transaction as the concept index row, the `bundle_commit` and the
  `audit_event` (ADR 0023). _Avoid_: derive-and-sync (for the edit path), sync lag.
- **entity merge** — the rule an Admin's confirmed alias-merge suggestion writes: an audit event,
  never a commit; undone by deleting it and re-deriving (ADR 0023).
- **canonical entity** — the node an entity merge produces: keyed by the rule, carrying no
  binding, with every contribution hanging off it under its own binding, class and audience; never
  shown when no contribution is visible to the reader; never a concept (ADR 0023).

## The route

How the work from the foundation to a finished v0.1 is cut and ordered.

- **route spec** — the one document that holds the way to a finished v0.1: the `/to-spec` head
  over the vision's v0.1 row, then the *blocks* in order, each with its edges and the obligations
  it carries, and a status table that is the product frontier every session reads first. 
  Each block is specced and ticketed from it. A Wayfinder map is charted only for a
  destination the route spec does not already hold. _Avoid_: roadmap, plan, master spec.
- **block** — one section of the route spec: a destination a session can pick, about a page — the
  ADRs and words it rests on, what in the tree it builds on, what it must carry, its blocking
  edges, a seam sketch. Taken to `/to-spec` before its build and to `/to-tickets` after; its
  tracer bullets are ordna tasks and the block itself never is. Each block lands its own screen.
  _Avoid_: phase, milestone, epic; slice (a block's tracer bullet, or a `packages/core` capability).
- **strand** — one chain of blocks the route spec orders by their edges, worked in parallel with the
  other: the *knowledge strand* (a document to a passage, an answer, the producer) and the
  *records strand* (guides, suggestions). A block belongs to one strand; a cross-strand edge is
  stated on the block.
  _Avoid_: lane, track, path (the write path, the answer path).
- **Coordinator** — the one session that owns a `/goal` over a set of ordna tasks and works it
  to its end state: it dispatches each task to an agent with a context of its own — in a
  worktree, beside others in parallel — reads what comes back, and decides what runs next.
   _Avoid_: orchestrator, ralph.
- **land** (the verb) — to take a change to `main` through the merge queue: a branch, a commit,
  a push, a pull request and an armed auto-merge, the queue doing the merge. Step 5 of
  `docs/agents/workflow.md` is a ticket's landing; `pnpm land` is one command's, for a change
  too small for a ticket. The adjective is the other sense — a *landed* binding and a *landed
  copy* are states of the knowledge layer, and nothing here lands those.
  _Avoid_: ship, merge (the queue merges), push to main.
