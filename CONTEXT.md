# CONTEXT.md — glossary

Root glossary for the platform. Each entry a person meets is headed by the word they read on a
page, in an MCP tool's text or answer, or in an email, and the code, the database and the docs use
that same word. Two marks may open a definition. `_Internal._` marks something no person meets; its
entry carries the name its code uses. `_Code rename pending._` marks an entry whose code still uses
an older name until that noun's sweep lands, and `apps/api/tests/old-words.ts` gives that name.
Names the platform does not own keep theirs: OKF's keys and nouns and the keys written into concept
files, the MCP wire, a library's or a protocol's own names, and stored history. Terms not listed
here are still draft.

## Knowledge model

Three knowledge layers, named and never aggregated: **sources** (evidence — copied and indexed, or
read live) → **bundles** (OKF concepts, curated) → the **map** (derived from the bundles and
records; queryable). **Records** are what the platform itself keeps — guides, write-ups, usage,
connected sources, audit — citing concepts, never restating them. Where a unit lives is decided by
**minting**.

- **knowledge layer** — _Internal._ one of sources, bundles, the map. Records are not a layer.
- **minting** — _Internal._ deciding where a unit of knowledge lives: a concept when a company with
  no platform would keep it as knowledge; a record when it exists only because the platform runs a
  use case; both only as a concept's derived index row plus records attached to it by its IRI.

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
- **company language** — _Internal._ the kinds, names and links a company's concepts reveal; never
  a file or a registry — it is read off the knowledge base (ADR 0026). Inferred during extraction,
  corrected by the company's people through the ordinary write.
- **kind** — the reader's word for a concept's `type`: the short string its producer chose,
  folded for case and plural at write. A new kind arrives with the concepts that carry it and
  is named in the suggestion set's summary; nobody pre-declares one. The kinds in use, derived from
  the concept index with counts per kind and per collection, are the **Kinds** list on Knowledge,
  where an Admin renames or merges a kind by one bulk commit. Never a file, never held to a closed
  set (ADR 0026).
- **Also known as** — a conventional body line naming a concept's other names; a confirmed alias
  lands there through an edit suggestion, and the merge key derives its names from it.
- **collection** — _Code rename pending._ a top-level division of a company's knowledge by
  ownership: the company itself, one product or service, one sector, listed with its owners on
  Knowledge › Collections and owners. The knowledge base is organised collection-first, and a
  collection is a future bundle boundary. Not an email domain.
- **knowledge base** — what a page calls a company's knowledge, held as one OKF *bundle*: what a
  reader is told a concept belongs to, and where an accepted suggestion is written. A company's
  knowledge is one knowledge base in v0.1.
- **bundle** — OKF's own noun for a knowledge base: a directory tree of concept documents with its
  own manifest, whose links join its concepts (the directory is only its storage shape). Code,
  concept files and the MCP wire keep the word; a page says *knowledge base*.
- **map** — _Code rename pending._ the platform's derived, queryable map over the knowledge base and
  the records: concepts, their links and relations, sources, actors and citations; held inside the
  platform Postgres as ordinary workspace-scoped rows (ADR 0032). Derived again from the knowledge
  base on every commit and from the records as they change; never a source of truth. **Two** fixed
  phrases tell its state: **map as of <time>** (the ordinary case — the map agrees with the
  knowledge base, stamped) and **map unavailable since <time>** (the panel is replaced by the phrase
  and one sentence of what still works). Because the map lives inside the same Postgres the api
  commits to, it is unavailable only when the database itself is, at which point nothing else
  works either. There is no third phrase: an edit's delta joins the api's commit transaction, so the
  map is never behind for an edit, and a full rebuild writes beside the live generation and flips in
  one row update, so it is never behind during a rebuild either (ADR 0023). Never a verdict; an
  answer carries the phrase in its context header line.
- **bundle manifest** — the bundle's self-description carried inside it: identity, origin,
  what it was made from, owner, content version.
- **api** — _Internal._ the TypeScript deployable: one directory (`apps/api`), one compose service
  and one process, carrying tRPC, the MCP surface, the authorization server and the SPA's build on
  one origin. The word for that tier in prose, in code and on a job's *claimant* (Liam,
  19/09/2026). `app_rt` is the Postgres runtime role the api connects as, an identifier rather than
  a second word for the tier.
- **estate** — _Internal._ the running deployment: the boxes, the stores, the stacks and the copies
  kept off them. The word every deploy document uses ("the estate is two 4 GB boxes").
- **bundle estate** — _Internal._ every bundle in a company's repository: its own knowledge
  bundle(s), the platform bundle, and any imported bundles. The knowledge sense of *estate*, always
  said with the word *bundle* so the two never collide.
- **producer** — _Internal._ an agent or a person that **makes** knowledge: an extraction or
  enrichment job, a person typing a concept, an Admin accepting a suggestion set. A producer mints a
  concept precisely so it need not fit anywhere yet (ADR 0026), and everything a producer prepares
  waits at the accept gate (ADR 0012). Not a connector, which carries documents rather than making
  knowledge.
- **consumer** — _Internal._ an agent or a person that **reads** knowledge and must tolerate what it
  did not expect: an unknown kind, a concept it cannot see, a map that is a moment behind. Every
  consumer reads through the same predicate and the same audit as any other. Not an *assistant*,
  which is the host a consumer arrives through.
- **Term** — a concept whose subject is *what a word means in this company*, kept in a glossary
  collection: how a kind, a product name or a piece of company language is defined, read by the
  extraction and judging prompts. A definition is knowledge by the minting rule, which is why there
  is no vocabulary file to hold it (ADR 0026).
- **Person** — a concept whose subject is a person, carrying only what the company itself publishes
  — name, role, public work contact, public bio, organisation link — minted only from a Public
  source or typed by an Editor, never from a meeting note, ticket or read-live fetch. Its IRI is
  opaque, it **starts Restricted whatever its evidence says** (the per-kind floor, ADR 0023), and a
  leaver's reads *Left*, never *Deprecated* (ADR 0020). Not a *Person* source entity, which is
  derived from one document and is never a concept.
- **platform bundle** — the bundle of concepts describing how to use the platform and
  how it fits together, seeded into every company's repository and expected to diverge per
  company; later platform changes arrive as suggestions, never applied.
- **imported bundle** — a bundle a company consumes but does not author (a vendor's
  documentation bundle): read-only, versioned, refreshed as a whole. Designed for, not
  shipped, in v0.1.
- **link** — what a page shows wherever it names a concept or a passage: the concept's title, or the
  document's title and place in it, leading there. A person never reads the identity beneath it: a
  concept's IRI and a passage's locator, which code, concept files and the MCP wire keep.
- **IRI (of a concept)** — a concept's stable identity, minted by the platform when the
  concept is created and never edited by hand; survives renames and is how one bundle
  refers to a concept in another. OKF's key, written into concept files as `iri` and kept; a
  page shows it as a *link*.
- **verify (a concept)** — a human or an agent confirming a concept against its sources in the
  platform, recorded on the concept as a spec `verified` event (`by`, `at`); the content it
  confirmed is kept platform-side on the *verification*, never as a key in the file.
  A human verifier earns *human-reviewed*; an agent earns *machine-confirmed*.
  A platform capability, not a repository workflow.
- **Q&A pair** — a concept (`type: Answer`): a question as its title, the answer as its body,
  alternate phrasings of the question in the body, its sources the entry it came from and the
  concepts the answer rests on. Knowledge a company keeps with no platform — the first client's
  bid libraries are Q&A pairs today. Usage, submissions and outcomes are records attached to it.
- **suggested concept** — _Code rename pending._ a concept the worker suggests (from extraction or
  enrichment) and the platform has not yet written to the knowledge base; it becomes a concept only
  when an Admin accepts the suggestion and the governed write commits it.
- **governed write** — _Internal._ the platform's only way of changing a bundle: an actor, a
  precondition on what it expects to find, one commit, one audit entry. Every bundle commit is one.
- **bundle commit** — _Internal._ one change to a bundle, by whatever path; what the map is derived
  from.
- **watermark** — _Internal._ the last commit a workspace's rows know about: its newest *bundle
  commit*, or none for a bundle whose rows know no commit yet. The governed write holds the
  per-repository lock through its Postgres COMMIT, so recorded history is a prefix of git history:
  everything after the watermark is missed and nothing before it is. A watermark the ref's history
  does not contain is *history diverged*, which no replay can put right (ADR 0012, amended
  2026-09-06).
- **head check** — _Internal._ the reconciler's periodic pass in the api process: every workspace's
  bundle head read against its *watermark*, and the commits between replayed oldest-first through
  the live handler under the reconciler's platform principal. Every thirty seconds, one tick at a
  time, quiet when it finds nothing; `pnpm ops reconcile-watermark` is the same pass on demand, the
  restore path (ADR 0012).
- **reconciler hit** — _Internal._ one commit the reconciler replayed: the audit event
  `platform.reconciler.replayed`, written under the commit's own `Audit:` id, a bulk replay's rows
  sharing one batch id. The *signal* ADR 0012 names, in ADR 0025's sense — a query over those rows,
  never a metric. One is a crash window that was recovered, so a series of them is a fact worth
  reading.
- **sweep pass** — _Internal._ the platform's daily pass of the *upload sweep* and the *graph
  sweep* over every workspace, one pass at a time, a sweep by hand included, then the deletion of
  expired sign-in rows: *sessions* past their end or their pending hour, the identity set's
  short-lived tokens a day past their expiry (sign-in codes and links, and Better Auth's others),
  and the rate-limit counts no workspace holds, a day old. Every pass is recorded, a pass that
  removed nothing too.
- **upload sweep** — _Internal._ the removal of the originals no document names, once past their
  grace: what a failed connect left, and what a concurrent repeat left when it lost the race to the
  first connect. **List-only** until the operator switches removal on, seven days after the first
  upload is connected in a client's workspace on production: it counts what it would remove and
  removes nothing.
- **graph sweep** — _Internal._ the removal of every generation of a workspace's map but the live
  one.
- **concept index** — _Internal._ the platform's derived row for every concept, written when the
  concept's commit is made, never edited. The only "both" of the minting rule. Carries the text
  `find` and `ask` match against, so a concept is searchable at its commit (ADR 0016, amended
  09/09/2026).
- **merge key** — _Internal._ what a concept is recognised by when its IRI is not yet known: the
  words a suggestion's payload carries about the concept it means, which an acceptance resolves the
  target from at the moment it commits, never before. One concept per merge key in a workspace, so
  a concept whose identity moved between proposal and decision refuses the acceptance rather than
  landing on the wrong concept.
- **suggestion** — a change to the company's knowledge or its configuration — prepared by the
  platform (suggested concepts from an extraction, a platform-bundle or template update, an alias
  merge, a write-up rewrite), or by a person who may not commit it (kind *edit*: a concept's text, a
  Brief, a missing fact, a new concept raised from unmapped passages; kind *promotion*: an answer
  proposed as an `Answer`, decided singly at the gate) — which the target's owner or an Admin
  accepts or declines before it is applied. Nothing platform-prepared enters a knowledge base
  without acceptance; every kind but *edit* is an Admin's to decide, in Control Centre. A suggestion
  the platform refused mid-acceptance is **returned**: handed back to its proposer with the
  reason, recording who was deciding it, because what it was written against moved.
- **To decide** — _Code rename pending._ the page on Control Centre › Suggestions listing every
  suggestion waiting to be decided, promotions included, with its payload; an Admin decides from
  it. What holds the waiting suggestions is platform state in no knowledge layer, its code word
  *suggestions*: nothing reads a payload but the acceptance path, and no extraction reads another's
  suggested concepts out of it. A person's **Inbox** *area* is not it, and points into it.
- **concept write request** — _Internal._ a suggestion's payload: the concept file it would write
  and the merge key it means it for, committed on acceptance and never on validation. It carries no
  IRI, because identity is the acceptance's to resolve.
- **citation fix** — _Code rename pending._ the platform's own fix for a source that moved on: a new
  locator into the same document, raised as a suggestion of its own kind, which nobody but the
  platform may raise, and decided like any other. Its acceptance re-points every standing
  verification at the content it wrote, so fixing a citation never turns *Verified by* into
  *Changed since verified*.
- **discard (a concept)** — removing a concept that was never stable and nothing cites or links:
  the file leaves the bundle, its identity and audit trail stay as a *removed concept*. Any
  concept that has been stable, or is cited or linked, is deprecated instead, never removed.
- **export** — the company taking its knowledge out of the platform: a *bundle snapshot* (the
  bundle's files at one commit, readable by any OKF tool), a *repository export* (the whole
  workspace repository with its history), a *records export* (the records about its concepts —
  verifications, owners, usage, conflicts — with the audit log and the publish confirmations)
  or a *guide snapshot* (a guide's prose as markdown, labelled with its date and "not
  maintained"). An Admin action with an audit row.
  The only way anyone but the platform reaches the repository.
- **evidence** — a locator into a source — a document or a span of it; a resource read live; a
  record the platform generated — with the content's version, that backs a concept; recorded when
  the concept is committed and kept until nothing cites it. A concept file's `sources` are its
  projection; a concept resting on another concept is a link, never evidence — except a successor's
  `sources[]` entry naming the concept it supersedes (lineage, ADR 0019).
- **sensitivity** — how confidential a connected source is, carried onto every document and source
  entity it yields, read from the connected source and the document for a passage, and sitting on
  the concept row, deciding who may view them:
  **Restricted** (Admins and named members; the default), **Internal** (the workspace, narrowed
  by audience), **Public** (already published by the company; still narrowed by audience). Only
  *Restricted* reaches a reader. Independent of trust: trust never gates viewing, sensitivity
  does. *Public* is not *published*. A page names it *Sensitivity* and nothing else, and
  *Restricted* is a sensitivity value, never a trust word.
- **effective class** — _Internal._ the sensitivity a source document is actually read at: the
  narrower of its connected source's and the document's own, where it has one — the seam's
  special-category verdict or an Admin's narrowing. Every passage of the document is read at it and
  a narrowing is compared against it, so a document's own sensitivity only ever takes visibility
  away. The document's own goes back only when a *dismissal* lifts the verdict, and then no further
  than the Admin's narrowing, or the connected source's if there is none.
- **finding** — what the pre-scan found in one source document: a category (bank details, date of
  birth, home address, personal contact, special category, …), offsets into the normalised text,
  the rule and detector version that fired. Counted per category; never a sensitivity, never a
  value. Born **unreviewed**; a review leaves it *kept in text*, *narrowed* or *dismissed*, with the
  acting Admin and the instant. **Marked** once an Admin has reviewed or restored it, *unmarked*
  until then. **The same finding on every sync that finds it**: the document, the rule and the
  offsets are what it is, for as long as the document's content stands, so what an Admin decided
  about it stands on every later sync. Its category, tier, score and version are a sync's
  **reading** of it — the last sync's — never part of what it is. Its tier is the tier it is
  withheld at on its connected source now: its rule's, raised to *always* by the officer-block rule
  or by an erasure request that names it. A finding the last sync did not raise, because the rules
  moved on, is no longer shown to a reviewer, acted on or counted at a publish.
- **group of findings** — _Code rename pending._ the unit of the review: one document's *findings*
  of one category, raised by one rule at one tier, with how many there are. It is what the review
  lists and what the three bulk actions below are taken over; it names no span and carries no
  value, so a reviewer acts on what was found without ever being shown it. Not a *group*, which is
  members.
- **keep in text** — an Admin's bulk action over named *groups of findings* of one connected source:
  every span of each group restored with one reason because it is the company's own business fact
  and reviewed as *kept in text*, and the sync that lets them back into the document queued with
  them. The always set alone, one audit event per span. An *erasure request* outranks it: a kept
  span a request names is **overridden by the erasure** — it stays withheld, and the review says
  so beside its group. (Not a *sensitivity override*, which is an Admin's action on a concept's
  sensitivity.)
- **narrow these documents** — an Admin's bulk action over named *groups of findings* of one
  connected source, taken on the *source documents* they sit in: each document takes a sensitivity
  of its own; the named groups' unreviewed findings are reviewed as *narrowed* — and no finding the
  Admin was not shown — and the *cascade* runs from the concepts citing the documents. One audit
  event per document; it never widens.
- **dismiss as not special category** — an Admin's bulk action over named special-category *groups
  of findings* of one connected source: every span of each group is reviewed as **dismissed** under
  one reason, because what the *cue* caught is not health data. Each such review is a
  **dismissal**. The sync that reads the dismissals is queued with them. The action changes what the
  finding is taken to be and does not let the span be shown: the span stays withheld unless it is
  also *kept in text*, and a later keep leaves the dismissal standing. On that sync, a document
  whose every special-category finding is dismissed has its **verdict lifted**, and the document's
  own sensitivity goes back to the Admin's narrowing, or to the connected source's if there is none.
  One audit event per document. It is the one road by which a document's sensitivity widens. (Not
  *keep in text*, which lets a span back into the text and lifts no sensitivity.)
- **cue** — _Internal._ a word which, found in a sentence in any of its forms, withholds that
  sentence whole as special category and narrows its document. It is how the special-category rule
  finds what it withholds, and it never makes another rule surer of what that rule found.
- **redaction seam** — _Internal._ the one place a document's text is read for what must be
  withheld and the placeholders are written in, ahead of splitting into passages, extraction and
  every model call, so that no derived store and no model ever holds the value.
- **redaction rule** — one of three tiers of what the seam withholds: **always** (policy no
  connected source switches off; a span restorable with a reason), **default on** per connected
  source, **default off** per connected source. The officer-block rule always wins.
- **consumer-domain list** — _Internal._ the email domains this repository judges a consumer
  provider's, dated and sourced. An address on one is a person's own and is personal contact; an
  address on any other domain is a company's and stays in the text. A judgement, never a complete
  register.
- **withheld** — the placeholder word: `[withheld]` for the always set, `[home address withheld]`
  and the like for the rest, `[person A]` for a pseudonymised name. The latter two are **typed
  placeholders** — each names the category of data taken, one word per category — where the always
  set has the one neutral word for everything in it, so that a reader is never told what category
  of data the document held. It is the word written over a *written span*.
- **withholding** — _Internal._ what one connected source does with one *finding* on one sync:
  *withheld* or *left in the text*, at a tier, for one **reason**, the first of these that holds —
  *overridden by the erasure* (a request names it and an Admin had kept it) · *erasure* (a request
  names it) · *restored* · *switched off* · *in force*. It says nothing of where a placeholder
  lands; the *written spans* do. A finding is never rewritten by a withholding. An *erasure match*
  is the one withholding with no finding: always withheld, at the always tier.
- **written span** — _Internal._ the run of characters one placeholder is written over, naming the
  *withholding* it writes for. Every character of a withheld finding or an *erasure match* lies
  under exactly one, so a finding that loses part of its run to another keeps its own word over the
  rest. How a finding was **written** is read off the spans: under its own placeholder where one
  names it, under another finding's where others cover every character of it, not at all
  otherwise.
- **emptying a binding** — _Internal._ deleting a connected source's derived rows in the api's
  transaction and removing its store in the job the same action enqueues. The two go together,
  whatever asked for them: the store is the engine's target-state tracking, so rows deleted beside a
  store left standing are re-upserted by nothing (ADR 0036). A *wipe* empties a connected source,
  and so does a rule change.
- **relation** — a link from one concept to another as the map holds it: the two kinds, the
  section and the sentence around the link (`LINKS_TO`); the kind of a relation is read from
  the sentence, never from a predicate list (ADR 0026). *Supersedes*, a write-up's citation
  and a source entity's *is concept* are the only named edges.
- **tier (of a product)** — a level of a product at which capability differs (Standard,
  Professional); a concept of its own that atoms relate to. A fact that differs by tier is two
  concepts. A guide reads a product's tiers; it never defines them.
- **context wording** — an alternative wording of a concept's statement demanded by a context: a
  buying framework (G-Cloud), a regulation, a sector, a source. A named section of the concept's
  body, chosen by an include — never a key in the file, never a record (ADR 0014). Named by its
  context, never by an audience; a wording that states a different claim is a separate concept.
- **connected source** — _Code rename pending._ an Admin's connection of one source to the
  workspace: its connector, credential, scope, collection, sensitivity, audience, cadence,
  destination and retention class; the unit the scheduler syncs and the unit that is published.
  Every source an Admin adds is one, listed on Control Centre › Sources › Connected sources and
  added by *Connect a document*. One collection per connected source — a website is connected per
  URL prefix (ADR 0013). It wears one state word: **received** (its documents are in the object
  store), **indexing** (a sync is turning them into passages), **indexed** (the sync has finished
  and there is something to review) and **published**. An upload's connected source id is minted by
  its caller, and the first connect under it wins: a repeat answers the first outcome, whatever file
  it carries (ADR 0043).
- **connector** — the lifted or written code that reaches one kind of source system and yields its
  documents: upload, website, SharePoint, HubSpot, Asana, the share agent's file share, the
  read-live tool. A connected source names one connector; a connector serves many connected
  sources.
- **origin (of a source)** — whose knowledge a source carries: the **company**'s own, a third
  party's (**external** — Companies House, a sector feed) or the **platform**'s (what the platform
  itself generated, cited as evidence; never a connected source).
- **reach (of a source)** — _Code rename pending._ whether the platform holds a copy. A **copied**
  source is connected, enumerated and indexed by syncs; a source **read live** is connected with a
  credential and read by a tool when a producer or a reader asks — never enumerated, never indexed,
  never cached. A source type is its origin and its reach.
- **source document** — the platform's row for one item a connected source yields: source-system
  id, title, `last_modified` (recorded absent when the source has none), content hash, first and
  last seen, `gone_at`, sensitivity, and the object-store key of each of its two landed copies. The
  catalogue every sync reconciles. A locator is a span into its normalised redacted text and never
  one of those keys.
- **landed copy** — _Internal._ a source document's bytes as the platform holds them in the object
  store: the original and the normalised redacted text. The normalised copy is keyed by the
  document; an upload's original by its *connected source*, the id its caller minted, and its
  document. A page says *Received*.
- **converter** — _Internal._ what turns a landed copy's bytes into the document's normalised text,
  before the redaction seam sees a word of it. One per media type, chosen once (ADR 0013), because
  the text it writes is the address space every locator and every content hash is read against.
- **unreadable** — _Code rename pending._ how a sync left a source document it reached and could not
  read: no normalised copy, no passages, and the word on its catalogue row beside its **reason**. A
  scan with no text layer, an encrypted file, a truncated upload and a conversion that ran past its
  own ceiling are all this one outcome; it is never a failed sync, and the sync takes in the
  connected source's other documents and finishes. Its opposite on that row is **converted**, and a
  row carrying neither is a document no sync has been over yet. The reason names what refused the
  document ("needs OCR", "took too long") and means nothing without the word beside it. It is a name
  and never a sentence, so the same refusal reads the same on every row and a connected source's
  documents can be counted by it — which is what an Admin deciding whether the platform needs OCR is
  reading. A document no sync has found unreadable has none.
- **passage** — _Code rename pending._ one unit of a source document's normalised redacted text that
  the passage index holds, keyed by its document and its ordinal, read at the visibility its
  connected source and its document give it — its *effective class*, its audience and whether it is
  published. Served, it is the text a *locator* resolves to, with its source document's title and
  its sensitivity word: the unit `open` returns and a match marked *Not company knowledge*
  previews. Never the original text.
- **window** — _Internal._ one run of a document's text the redaction seam puts to the detector's
  model in a single call, because the model reads less at once than a document holds. It is an
  argument to a model and nothing else: never stored, never addressed by a locator, and no finding's
  offsets are counted inside one — a finding's offsets are the document's. Where its edges fall is
  a rule, and the rule is ADR 0020's. Not a passage: the seam runs ahead of the passage index and
  never produces one; the model reads windows, the index holds passages.
- **detection key** — _Internal._ what the detector reads and nothing else, carried as one digest:
  the recognisers and their pins, the thresholds, the context lemmas, the *consumer-domain list* and
  the window rule. It moves only when a document's findings could move, and a move of it implies a
  move of the rule version. Not the rule version itself, which a *finding* row and a document's
  redaction version carry, and which also moves for a category's tier, its placeholder word and
  what it narrows to.
- **locator** — the address of a passage inside a source document, written whole as
  `<source document id>/chars:<start>-<end>`: the document it is in, then the span, whose offsets
  are counted in Unicode code points into the document's normalised redacted text and versioned by
  the redaction string that text carries. The one string a citation's evidence and a passage both
  carry, so a citation and a passage are one address. Written into concept files as
  `sources[].locator` and kept; a page shows it as a *link*.
- **sync** — _Code rename pending._ one execution of a connected source by the scheduler (enumerate,
  index, extract, prune or reindex): claimed under a lease, keyed by its run key, checkpointed per
  batch, one per connected source at a time, parked after repeated failure; its outcome rows record
  what changed per document. A page reads *Last synced*, *Not synced yet* or *Sync failed*.
- **job** — _Internal._ one unit of background work, as a row on the queue: what to do (its *kind* —
  the nightly audit or the full rebuild today; the route spec's S1 adds kinds to a loop that exists), for
  which workspace, **about which subject** — the connected source an index job is for, the concept a
  catch-up job is for, named on the row by a typed column a kind's CHECK requires (T-113,
  10/09/2026) — and the facts the claim protocol needs. Queued until a *claimant* takes it under a
  *lease*; ends *done* or *failed* with an *outcome*, or *poisoned* after its last lost claim. The
  api enqueues; a job's kind names the tier that claims it — the worker for every kind but the one
  only the api can do (the question-set job, S6's, whose answer path is the api's) — both through
  the same queue SQL functions (ADR 0031's `queue` agreement, which already admits the api as a
  claimant; ADR 0005: the control plane is rows; 09/09/2026). A job is its own record and never an
  *audit event*. A *sync* or a *map rebuild* is one job being done.
- **lease** — _Internal._ the scheduler's grip on a claimed job: held only while its claimant keeps
  confirming it is alive, expiring otherwise, so a job whose claimant died is handed back for
  another claim rather than lost. Nothing waits on it.
- **claimant** — _Internal._ the process holding a job's claim — the worker, or the api for a kind
  only it can do: the only one that may keep its lease alive, finish it or fail it — and no longer
  the claimant once the lease has lapsed, whether or not the job has been claimed again since. A
  job has no owner.
- **outcome** — _Internal._ what a job found, written once at its end by its claimant: counts, and
  the ids or paths it counted them at, or the name of what went wrong — never content, never a
  person's name, so a record of what a job did is kept as it was written. A job that never ran has
  none.
- **cost estimate** — _Code rename pending._ the priced scope of extraction for one connected
  source, accepted once by an Admin at review: the documents, the template per kind and the model
  choice, with hours and pounds from measured rates. Listed on Control Centre › Sources › Cost
  estimates. Once accepted, every sync extracts as it indexes; a sync that would reprocess more than
  a set share of the connected source, or pass the workspace's spending limit, waits for
  re-acceptance.
- **spending limit** — _Code rename pending._ the workspace's cap on what extraction may spend, held
  as a config row and read before a sync and before an ad-hoc draft, and shown on Models › Models
  and spend. At the limit the platform refuses in one sentence naming who can raise it, and never
  silently narrows the work. Distinct from a cost estimate's price, which is one connected source's
  scope.
- **extraction template** — the instruction for extracting concepts from one *kind of document*:
  which kinds a document of that kind evidences, and how a claim, its evidence and its locator are
  written for the file. Chosen per document kind in the cost estimate, versioned, and written for
  the concept file and never for the page that will read it. There is no design-time test against
  a vocabulary, because there is no vocabulary file (ADR 0026). Not a *template* (a
  platform-shipped guide definition).
- **publish (a connected source)** — the recorded Admin action that lets a connected source's
  passages and source entities reach anyone beyond Control Centre; separate from sensitivity, from
  audience and from accepting suggestions. Its audit row carries the Admin's confirmations (lawful
  basis recorded, privacy information updated, DPIA reference). Unpublished content is seen by
  Admins, in Control Centre only, and a concept citing it counts as Restricted until the publish
  releases the connected source's sensitivity.
- **widen (a connected source)** — an Admin's recorded action that moves a connected source to a
  wider sensitivity, a wider audience or both, published or not, with the *cascade* run inside the
  same action. Its audit row carries the sensitivity and audience it moved from and to. A request
  that widens no term, or narrows any, is refused, and so is any widening while a special-category
  *finding* the last sync raised is unreviewed. A document's own sensitivity stays where it is,
  since the *effective class* is the narrower of the two. The one road by which a connected source's
  sensitivity widens.
- **audience** — who a connected source's content is for: everyone in the workspace, or named groups
  (plus, if needed, named individuals). Set on the connected source, carried with sensitivity onto
  every source entity and read from the connected source for a passage, and applied with
  *published* on every read and traversal hop. Distinct from sensitivity (how confidential) and from
  trust (how reliable).
- **cascade** — _Internal._ the re-derivation an Admin's narrowing of a connected source or of named
  documents of one, widening or publish of a connected source, or sensitivity override of a concept
  sets off inside the same action: first every concept citing the evidence that moved, then every
  write-up including one of those concepts — two levels, the second reading what the first wrote,
  never a third — so a guide never reaches a reader its includes would not.
- **sensitivity override** — _Code rename pending._ an Admin's recorded action that sets a concept's
  sensitivity and audience, whatever its evidence and its kind's floor derive: one row per concept,
  the latest standing, one audit event, and the *cascade* run inside the same action. The one action
  that may widen a concept's sensitivity past what its evidence derives (a connected source's widens
  by *widen (a connected source)*, and its concepts follow their evidence); where it does, a reader
  is in the *shared beyond its evidence* state and the *evidence pane* names the Admin (ADR 0039).
- **group** — a named set of members of one workspace: the one grouping concept, and the unit an
  *audience* names when a connected source is not for everyone. Groups are flat, and a person may
  belong to several. A group may represent a team ("HR team", "Sales executives") — that is its
  name, not a second concept. Belonging to a group never changes what a person may do — that is
  their *role*; a group only ever changes what they may see, via audiences. Everything is a group,
  with one lookup per visibility check (Liam, 05/09/2026, aligned to the Entra access model); nesting
  would be an additive migration, never a reversal.
- **retention class** — what the platform keeps of a connected source's documents, and for how long:
  **mirror** (the source holds the record; a document gone at source keeps its passages through a
  grace period, then loses them), **keep** (the platform holds the record — uploads; nothing leaves
  without an Admin action), **transient** (original bytes deleted after processing, the normalised
  redacted text kept; map-only connected sources). In every class cited evidence outlives its
  source: the evidence row stays until nothing cites it.
- **destination (of a connected source)** — which derived stores a connected source's documents
  feed: the passage index (searchable), the knowledge base (as suggestions an Admin accepts), the map
  (as source entities); at least one. The object store is where every document is received first,
  not a destination.
- **source entity** — a typed node or edge the map derives directly from a source document (a
  person, a meeting, a task), keyed to that document; never a concept and never a record. The
  map is derived from sources, bundles and records (ADR 0011).
- **provider** — the system that produced a connected source's documents (Granola, Otter, Teams), as
  distinct from the system they are reached in; one per connected source.
- **share agent** — the platform's small on-site program that watches a company's file share and
  sends changed documents out to the platform; a caller of the public API, never the worker.
- **run key** — _Internal._ the key that makes two requests to sync the same connected source for the
  same period one sync.
- **model choice** — _Code rename pending._ a workspace's choice of model and provider for one
  purpose (extraction, enrichment, answering, judging, embedding), local or hosted; one model choice
  per purpose, listed on Control Centre › Models › Models and spend. Its `model` names the model it
  calls. The embedding model choice is **fixed** — the word a reader sees on it — from the start,
  before any vector exists, and never changes once vectors exist (ADR 0020).
- **DPIA input** — what one connected source contributes to a data protection impact assessment, as
  a document and its hash: the personal data categories its rules in force can raise, its scope,
  sensitivity, model choices, *retention class* and audience. The hash rides on the publish audit
  row.

## Trust words the reader sees

The platform's trust tiers (unverified, machine-confirmed, human-reviewed) and states are shown to
readers in these words and no others, on a page and in what `find` and `open` return; each is a
text tag, never a colour. The tier and status values on the MCP wire keep their names, which are
for code and never for a reader: tier `human-reviewed` reads *Verified by*, `machine-confirmed`
*Verified automatically* and `unverified` *Unverified*; status `changed-since-checked` reads
*Changed since verified*; `checkedBy` and `checkedAt` carry who verified it and when.

- **Verified by <person>** — human-reviewed: a named person confirmed it against its sources on a
  date; shown as "Verified by Priya Shah · 3 March 2026". The name is the verifier's current
  *display name*, and it stands after they leave the workspace; once they are erased the
  verification reads "Verified by a former member" and still counts.
- **Verified automatically** — machine-confirmed: an agent that did not generate it confirmed it.
- **Unverified** — nobody has confirmed it.
- **Changed since verified** — its content changed after its most recent `verified` event; the
  earlier verification is kept, and it reads so until a person or an agent verifies it again.
- **Out of date** — past its shelf life (`stale_after`); needs verifying again.
- **Draft** — proposed, not yet part of what the company states.
- **Left** — a `Person` concept whose person has left the company; kept for history; never
  offered to new work. Never *Deprecated*: a person has no successor.
- **Deprecated** — no longer current; kept for history; its successor is linked; never offered
  to new work.

Two **riders** may follow *Verified by* and never change the tier: **· imported** (a verification
recorded before the platform, kept as written) and **· source moved on** (its source changed or is
gone since the verification; the verification stands; the reason is on the row). No other rider
exists.

- **shared beyond its evidence** — the state where a recorded Admin override lets a reader see a
  concept whose cited evidence they may not view (ADR 0023). Never a rider and never a trust
  signal — the tier and *Verified by* stand untouched. The evidence pane leads with the reader's
  access ("Based on your current access, the evidence isn't included"), always names the Admin
  whose override created the state, and never dead-ends (Liam, 05/09/2026 — exact copy polished
  at spec time; the fixed rule is the routing, not the sentence).
- **evidence pane** — what a reader sees of a concept's cited evidence: one of three states off two
  counts — *included*, *partly included* or *not included* in their access. It leads with the
  reader's access, lists only the evidence they may open, names the Admin whose *sensitivity
  override* put them in *shared beyond its evidence* where one has, and always says where to go
  next, so it is never a dead end (ADR 0023; Liam, 05/09/2026). Never a trust signal.

## Guides and answers

Guides are platform functionality over the knowledge base and the map; nothing in this section
lives in a bundle (Q&A pairs do — they are concepts).
The platform exports a guide's *structure* into the company's repository so it can be rebuilt
from concepts elsewhere; the prose stays a platform record.

- **guide** — a set of pages that gives the company's people, by role, its knowledge about one
  subject (a product, a service, a sector, the company itself), configurable per company. A guide is
  never the unit of trust: every fact it shows is a concept. A guide has no publish state: it is
  seen from the moment it exists, every section wearing its trust badge. Its readers are roles,
  never an audience.
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
- **write-up** — _Code rename pending._ the written prose in a guide section or a tender response:
  assembled prose plus the ordered concepts it includes or cites, with its own provenance and
  verification. A guide section and a response are its two homes. Its shown trust is the weaker of
  its own and its cited concepts'.
- **include** — _Internal._ one concept a write-up draws on, in order, with the context wording
  chosen for it and the concept's content as it stood when the prose was written. An include names
  a concept, never another write-up.
- **needs review** — the state of a write-up whose included concept changed or was removed,
  whose expectation is unmet, or on which a review found a fault; the platform *marks* it (a
  reader *flags* an answer); shown, never hidden, until a person acts.
- **skeleton projection** — the guide's structure the platform writes into the company's
  repository (kind, subject, roles, sections with their prompts and included concepts; no
  prose), regenerated when the guide definition changes.
- **citation** — the unit a reader follows back to the source: a concept, the source and locator it
  rests on, and the cited passage, shown beside the claim it supports. In a search match, the same
  unit shown as the match.
- **footnote** — _Code rename pending._ the mark in a write-up's prose that ties one claim to one
  include: a footnote reference labelled by the include (ADR 0015). What the reader sees as the
  passage beside the claim, and what the copied text carries as a numbered footnote; its text is
  never stored, always rendered from the include.
- **expectation** — a section's statement of which concepts should populate it (by type,
  relation to the subject, tag or feed); coverage is expectation minus what is included.
- **response** — a write-up scoped to one question put to the company: a question-set
  question in v0.1 (ticket 47 Q10), an opportunity's question once the opportunity layer arrives.
  A record like every write-up; the opportunity, when there is one, attaches to it later
  (Liam, 26/08/2026). Empty, carrying its unmapped passages, when nothing on the map answers.
- **answer** — what the platform returns for a question: prose asserting concepts only, a
  passage per claim, its verdict for the caller's role, and what it could not answer — found by
  traversal first (an existing `Answer` reused as it stands, shown with the question it
  answered) and drafted over the walk's concepts otherwise (ADR 0016). Not the `Answer` concept
  (a Q&A pair), which an answer may reuse or cite.
- **answer contract** — _Internal._ the one shape an answer takes for the UI, MCP and the response
  record: an event stream — verdict first — folded into one object (ADR 0016).
- **match** — _Code rename pending._ one unit a search returns, typed by its knowledge layer: a
  concept, with the guide sections it appears in and the documents it rests on nested under it; a
  guide section or a document on its own only when no concept covers it. Every match wears its trust
  or sensitivity word; a document nothing rests on reads *Not company knowledge*. The MCP wire's key
  for them stays `hits`.
- **unmapped passage** — a passage from a connected document that no concept rests on, shown
  where nothing on the map answers — source, locator, sensitivity word — never asserted as the
  company's answer; one action from a suggested concept.

## Records the platform keeps

Records exist because the platform runs a use case (ADR 0011); every record about a concept refers
to it by IRI and never restates it (ADR 0014).

- **record family** — _Internal._ one kind of record the platform keeps: one shape, one reason to
  exist (the use case or the derived view it serves). Records are never a knowledge layer.
- **verification** — _Code rename pending._ the platform's record of one person or agent confirming
  a concept or a write-up against its sources: who, when, and the content confirmed. A concept
  file's `verified` event is its projection.
- **verification request** — a reader's or the platform's ask that a concept or a write-up be
  verified, with a reason — a reader's flag, *due for verification*, *shelf life ending*, *source
  changed*, *source gone*, *cited concept deprecated*, *verifier left*, *verifier erased*; one open
  per concept and reason; lands in its owner's queue, the interval ones batched into the weekly
  digest, and listed on Knowledge › Due for verification.
- **verification interval** — _Code rename pending._ how long after its latest matching verification
  a concept of a kind is *due for verification*: a per-kind workspace setting with platform defaults
  (Certification, Insurance, Rate: twelve months; most kinds none); never written into a file.
- **shelf life** — the reader's word for `stale_after`: the date after which a concept is *Out of
  date*; absent means none.
- **actor id** — _Internal._ who a `generated.by` or `verified[].by` names: a person as
  `human:<email>` (as Google's samples), the platform's agents as `better-answers-<purpose>/<version>`,
  a process as `process:better-answers-<purpose>`. Verifier and generator must differ on the
  producer part. On a record the platform keeps — the *audit log*, a commit trailer, a suggestion's
  proposer — a person is `human:<person id>`; the file forms stand. A page shows the person's name.
- **actor alias** — an Admin's mapping of an imported actor id to a member, so *Verified by* can
  name them; the file is never rewritten.
- **person id** — _Internal._ the platform's one stable id for a person: minted by the platform at
  their first sign-in, or earlier when the platform adds them by name, carried on the identity set's
  user row, `userId` on every Principal, and what every record names a person by as
  `human:<person id>`. Never written into a concept file, which keeps `human:<email>` (ADR 0019).
  The member row's key names nothing (05/09/2026). A page shows the person's name.
- **display name** — the one line a person is credited by wherever the platform names them:
  *Verified by*, a commit's author, a member list. The person states it themselves; an Admin flags
  an inappropriate one and the *operator* corrects it, since one name is shown in every workspace
  the person belongs to and no workspace's Admin may learn of the others. Not a *Person* concept's
  name, which the company publishes.
- **minter** — _Internal._ the kernel's one function that mints every id the platform writes, a
  time-ordered ULID; Better Auth is handed it too, so every identity id has the same shape (ADR
  0035). Not the *minting* rule, which decides where a unit of knowledge lives (ADR 0011).
- **owner (of a concept)** — the person answerable for keeping a concept verified and current: the
  collection's owner unless the concept names its own. May edit it directly and decides *edit*
  suggestions on it. Distinct from a connected source's owner and from the bundle manifest's owner.
- **usage** — one recorded action that takes a concept or a write-up out of the platform: copied
  into a document, exported in a document (a response-set document is one usage per response),
  later submitted. Being in a section is not usage; a citation in an answer is counted from
  *Questions asked*. (Not OKF's `usage_count`, which is a source's use by a concept.)
- **conflict** — two values for one claim found across sources, recorded with both values and
  their evidence; raised by the pipeline, resolved only by a person (supersede, deprecate, split by
  tier, dismiss).
- **question set** — the ordered questions a document put to the company, which responses
  answer; extracted as a suggestion and confirmed by the person before any response is drafted;
  an input to a use case, never a source and never company knowledge. Not a pack, not an
  opportunity.
- **Questions asked** — _Code rename pending._ the retained record of every answer the platform
  gave, and the page an Admin reads it on, flagged first: who asked, where, what was answered, what
  it cited and how trusted that was at the time, the predicate that applied and, on reuse, the
  matched `Answer` and the judge's verdict; with the feedback and corrections it received. Not part
  of the audit log. Content is kept twelve months by default, then thinned to the skeleton —
  citations, trust then, verdicts, feedback and corrections — kept for good (ADR 0017).
- **feedback** — a reader's verdict on one answer, never the platform's: *helpful*, or a **flag**
  with a reason — *wrong* · *out of date* · *incomplete* · *should not have shown* — that becomes
  a record in someone's queue (a verification request, an edit suggestion, or the Admin's to
  pass on).
- **correction** — an Admin's or owner's action on one answer in *Questions asked* that records the
  level it went wrong at — concept, source or retrieval — and links the action that fixed it; never
  a text edit.
- **answer test** — a retrieval correction kept as a test: a question, a role, the concepts the
  answer must reach and must not, the `Answer` it must or must not reuse, the expected verdict;
  the workspace's tests are replayed retrieval-only when the answer path changes and weekly;
  *stale* when a concept it names is deprecated.
- **audit event** — the record of one action by an Admin, the platform or a person acting on their
  own identity — what was done, to what, by whom, when, with what confirmations — in the one
  append-only *audit log* a workspace keeps, or in the *identity-set audit log* when the action
  belongs to no workspace. Every event belongs to one of four families — **people**,
  **knowledge**, **sources**, **platform** — named as the first word of its *audit action*,
  `family.subject.verb`; jobs, *Questions asked*, *signals* and spend are their own records and
  never audit events.
- **audit action** — _Code rename pending._ the name an *audit event* is recorded under,
  `family.subject.verb` (`sources.binding.published`), declared by the part of the platform that
  performs it and never a free string. One *action* may write more than one, and a read writes none
  (ADR 0043). A stored name stays as it was written, and the Audit log shows it in today's
  words.
- **audit log** — the one append-only record of every *audit event* a workspace keeps, written in
  the same action it records; an Admin reads their workspace's own on System › Audit log (moved from
  People on 30/09/2026), and never another's. Not *Questions asked*, which records answers.
- **identity-set audit log** — the append-only record of the actions that belong to no workspace
  because they act on a person's identity itself: a person giving their own *display name*, an
  Admin's flag on one, a sign-in, every write the *operator* makes, and an Admin's action that ends
  a person's access. It sits beside the *audit log* and uses the same *audit actions*. A person
  appears in it by *person id*, never by name or address, and no row is ever rewritten. Only the
  operator reads it; no workspace's Admin ever does.
- **log line** — _Internal._ one line the running platform writes to its operational log for
  whoever runs it: a token refresh, a workspace picked, a failure. Never a record: nothing reads it
  back as evidence of an action, and an action that must be answerable for is an *audit event*, not
  a log line.
- **erasure request** — a person's request that their personal data leave the platform: what was
  done in every store, when, and when the backups are beyond use. A valid one reaching the bundle
  runs the history-rewrite routine (ADR 0020) and carries the *erasure pseudonym* it minted.
- **erasure pseudonym** — _Internal._ the per-workspace opaque id, minted at erasure and kept on the
  erasure request, that `human:<email>` becomes across that workspace's files and history on a
  valid erasure request. Never the person id, so two workspaces' rewritten histories cannot be
  joined on one person.
- **subject request** — a person's access or erasure request — a member's, or one recorded on
  behalf of a person the company's files name who never signed in (10/09/2026): the same
  per-store finder over the request's identifier set, the one-month clock from its start;
  access answers with where the platform holds the person and under which categories, never
  a passage.
- **suppression** — the workspace's entry that keeps a person's identifiers out of every derived
  store: one per *erasure request*, holding the request's identifier set, applied to every
  document of the workspace on every sync, now and later.
- **erasure match** — _Internal._ a bounded, case-folded occurrence of a *suppression*'s identifier
  in a document's normalised text, which the *redaction seam* withholds. It is a withholding and
  never a *finding*: no finding row holds it, no review reaches it and no *keep in text* releases
  it. An identifier below the **identifier floor** — under three characters once normalised, or a
  name of one word — raises none, and recording a *subject request* refuses it as too broad to
  withhold.
- **erasure map** — _Internal._ the per-store finder's answer for one *subject request*: every store
  family the platform holds and what in each of them names the person, found over the request's
  identifier set. Its documents entry names the live documents whose indexed text holds an
  identifier, and those choose which connected sources are wiped now; the *suppression* is written
  from the request's identifier set, not from the map.
- **replay copy** — _Internal._ the completed *erasure request*'s copy in the object store — the
  request, its *erasure pseudonym*, the identifier set and the *erasure map* — that a restore reads
  to run the erasure again over a dump older than the request. Restricted personal data, as a
  *suppression* is.
- **erasure rehearsal** — _Internal._ the *restore drill*'s proof that erasure erases, run against
  *staging* in two phases so a dump can be taken between them: a **synthetic subject** — a person
  the platform invented, addressed under a reserved domain that resolves nowhere — is seeded into a
  workspace as a member, with a concept file naming them and a connected document naming them by
  their address and their name, which the first phase waits to see indexed; the erasure routine is
  then run over them and answers with the real report. Its **tokens** are the values that subject
  is greppable by in a dump, each one a value the erasure removes; *token* here is `dump-grep
  --tokens`' sense of the word and never a credential (*personal token*, *share agent token*).
- **version (of a record)** — one state of a write-up or a guide definition, kept for good with
  who changed it and why; the current state is the latest version. Concepts have git instead.

- **backup** — _Code rename pending._ one scheduled copy of one store, or one restore drill, as a
  row: what, when, outcome, size, where it went, whether it holds personal data, when it expires,
  and — for a drill — how long the restore took.
- **tier (of a backup)** — _Internal._ where a database dump is filed by when it was taken, which
  sets how long it is kept: hourly, daily, weekly or monthly. It is not a *retention class*, which
  is a connected source's.
- **restore drill** — _Internal._ the monthly rehearsal that restores the platform from its copies
  into staging, proves it answers, records the recovery time, and wipes staging afterwards.
- **staging** — _Internal._ a second copy of the platform on VPC 2 holding synthetic data only,
  brought up on demand for a drill or a rehearsal and wiped after; it never stands between them (ADR
  0024).
- **local database** — _Internal._ a developer's own Postgres on the pinned image, migrated and
  holding the synthetic fixture, kept across restarts: what a GUI browses day to day. Nothing a
  client wrote is in it.
- **browsing role** — _Internal._ the read-only login every GUI profile signs in as, on the *local
  database* and on production: every workspace's rows in every table and view, no credential
  column, no write to a platform table. Made by an operator action, never by the journal.
- **git store** — _Internal._ one of the platform's four shared stores (ADR 0005): the bare git
  repositories under `/data/git`, one per workspace, holding the bundle. The api is its only writer
  and the worker mounts it read-only at a commit; it is backed up as a verified `git bundle` per
  workspace and mirrored to the second box.
- **forge** — _Internal._ the same thing named from the outside: the bare git repository per
  workspace that the api writes and the worker reads at a commit. **No forge *service* runs** — no
  UI, no SSH server, no user model, no second schema (ADR 0024).
- **root refusal** — _Internal._ `openGit`'s refusal of a root that is not an absolute path or not
  an existing directory: validated once, at open, so nothing downstream — `initRepository` included —
  trusts a root nobody validated (ADR 0024).
- **deploy unit** — _Internal._ **what one release changes**: the platform stack — `migrate`, `api`,
  `worker` — deployed by image digest. The stores stack and the database resource are **not** in it:
  they change on their own upgrade drill, not on a release. Use the phrase in this sense only; a
  document that means "everything on the boxes" says **estate** (ADR 0022; A16 of the pre-build
  gate).
- **release** — _Internal._ the recorded promotion of a built image digest to production, on its
  own or by an Admin's dispatch, as the *release mode* says. A release is recorded, as a
  `release/*` tag, only once it has held: its smoke passed and, under `JOURNEYS_MODE=gate`, its
  *journeys* ended `held` too. A release `build.yml` calls after a merge runs no journeys, so it
  holds on its smoke under every value. Under `gate` a release whose journeys end `fail` is tagged
  `rejected/*` instead, and the nightly release never promotes that commit again until the tag is
  deleted.
- **release mode** — _Internal._ how releases happen: **per-merge**, every green build on `main`
  released; **nightly**, one release a night just after a verified backup; **drill**, only a
  dispatched release riding a drill or a hotfix. The phases run in that order: per-merge until the
  first client's bundle lands, nightly until *go-live*, drill after it.
- **go-live** — _Internal._ the day the platform is live for its clients, no earlier than the end of
  v0.1. It comes after the day the first client's data is on the box.
- **journeys** — _Internal._ the small set of Playwright tests that sign in to production as each
  *test person*, with an email code read from the *test inbox*. Each **journey** walks the pages
  its role reaches, taking only actions it can undo and that cost nothing, so it leaves the *test
  workspace* as it found it. They run after a scheduled or dispatched *release*'s smoke, and alone
  against the live release on a scheduled night with nothing newer to promote or on a
  journeys-only dispatch; a release `build.yml` calls after a merge never runs them. A run ends in
  one **outcome word**, the body of its *dead-man ping*: `held`, every journey passed; `fail`, a
  page did not do what its journey asks, no code came within 90 seconds, or the promote failed and
  none ran; `could-not-run`, the run could not judge the release, because the inbox, the edge, a
  setting or the commit under test stood in its way, the gate refused the run or its promote was
  cancelled, or the test workspace was found holding something its fixture does not. `JOURNEYS_MODE` stages them: under `off`, or while it is unset,
  none run; under `report` they run and report; under `gate` a release they ran on is recorded
  only once they end `held`. Not the browser suite, whose specs seed a fresh database through its
  harness.
- **test inbox** — _Internal._ named in full, because *Inbox* alone is a person's *area*, which
  points into *To decide*: the Cloudflare Email Worker `apps/test-inbox`, on the *testing domain*,
  a domain apart from the product's. It keeps what reaches that domain for a day and judges
  nothing. The *journeys* read each sign-in code from it through its API, with a key that reads it
  and does nothing else, and verify each email's DKIM signature themselves. Outside the *estate*:
  the owner deploys it by hand, and nothing in CI can change it.
- **signal** — a named query over rows the platform already keeps, with a threshold that makes it
  worth a line on System (ADR 0025). Never a metric scraped from a process.
- **alert** — a signal over its threshold, recorded once as a `platform_event` and emailed by the
  api (immediate or in the daily digest) until a *cleared* event closes it (ADR 0025).
- **dead-man ping** — _Internal._ the outbound heartbeat a job sends only after its work is
  verified; silence is the alert. Carries an outcome word and sizes, never a path or an error.
- **escrow** — _Internal._ the two-holder vault outside every box that keeps the handful of secrets
  whose loss loses everything else.
- **envelope** — _Internal._ the sealed form a secret is kept in: one versioned frame, written by
  either tier and read the same way by the other, which opens only under the key it was sealed
  with. A frame whose version a reader does not know is refused, never guessed (ADR 0005).
- **boundary schema** — _Internal._ the validation schema a caller is held to for one table, in
  three shapes (select, insert, update), generated from the table rather than written beside it, so
  a column has one definition and a boundary cannot drift from it (ADR 0028). Narrowed by
  refinements and composed at a boundary by picking, omitting and extending; a table's columns are
  described in one place only.
- **refinement** — _Internal._ a narrowing of one column's boundary schema, written beside that
  column: a brand, a format, a trim, a value set smaller than the column's. A refinement only ever
  makes the accepted set smaller, and the parity test proves it by offering what the refinement
  accepts to the column itself (ADR 0028). Not a boundary's own shaping, which selects columns
  rather than redescribing one.

## People

- **workspace** — the tenancy boundary and the unit a company occupies: one company's people,
  connected sources, bundle repository, index, map and records. **Every tenant row, every
  object-store prefix, every map node and edge carries its workspace id**, and every query reaches
  its store through a store door, over row-level security (ADR 0032). Better Auth's identity set is
  not tenant data: read by key before a workspace is known, it is what a workspace id is resolved
  from (ADR 0009). One deployment holds many; a person may belong to more than one and picks before
  consent. Workspaces are provisioned by the platform, never created by a person. Better Auth's own
  name for it stays inside its API and is mapped to *workspace* in our code and on every page.
- **tenant** — _Internal._ the same boundary said from the platform's side, used only where the
  sentence is about isolation rather than about a company: *tenanted by rule*,
  *multi-tenant-ready*. There is one boundary and it is the workspace; *tenant* never appears on a
  page and is never a second concept.
- **principal** — _Internal._ who a call is made as: `workspaceId`, `userId` and `role`, built by the
  transport from a verified bearer and passed as the first parameter of every `packages/core`
  function that touches tenant data. It has **three kinds** (ADR 0009, 2026-09-04):
  - **user principal** — a signed-in person in one workspace, with the role they hold there as a
    member.
  - **platform principal** — the platform acting as itself, with its own actor id
    (`process:better-answers-<purpose>`) and no person behind it: the erasure routine, the nightly
    audit, the reconciler. Its actions are audited under that identity and never under a person's.
  - **operator principal** — the *operator*; its own entry below.

  One more word has no type yet — **deferred principal**: a named person's authority carried into
  work that outlives their session (a background job, a scheduled sync, a replay). It records the
  person it borrowed from and **expires with the authority it borrowed**, so a job cannot outlive
  the access that started it. Work that outlives a session runs under a deferred or a platform
  principal, never under a live user session. The *actor id* is the id on a file, not the
  principal.
- **operator** — _Internal._ the platform's own administrator over every workspace: a real person on
  the identity set, made the operator by a **mark** on their person that only the platform's own
  tooling grants or takes away, never a page, and that erasure clears with the rest of their
  identity; a third principal kind beside a user and the platform, audited under their own id.
  Never a workspace *role*; *Admin* is the highest role a workspace has. A page names them
  *better-answers support*.
- **better-answers support** — who a page sends a person to for what nobody in their workspace can
  do: a *display name* corrected in every workspace at once, an Admin restored when they hold
  neither a *second factor* nor a *recovery code*, anything across workspaces. Behind it is the
  *operator*.
- **action** — _Code rename pending._ what an entry — a page's call, an MCP entry, an ops command,
  the reconciler's tick — may ask the platform to do as a *principal*: one thing, a **read** or a
  **write**, answered with its value or with a *refusal*. Reading a connected source's findings is
  an action as much as publishing the connected source is. Where the *audit log* records an action,
  its *audit event* lands with it, under its *audit action* (ADR 0043). An endpoint or a procedure
  is a transport's way of reaching an action, never the action itself.
- **step (of an action)** — _Internal._ a part of an action that runs only inside the action that
  called it and never on its own: writing the *audit event*, queueing a *job*, reading whether a
  person holds every audience group. It is handed the principal its action admitted, judges no
  *admission* and has no *refusal* of its own — a step that cannot do its part fails the whole
  action, and nothing of the action lands.
- **admission** — _Internal._ the judgement of whether a *principal* may perform an *action* at all,
  made before the action does anything: from the principal's kind, a person's role, the purpose a
  *platform principal* acts for, and what was asked — never from a stored row. Whether the thing
  named exists, or is in a state to be acted on, is the action's own question, and its answer is a
  *refusal* of another class.
- **refusal** — an action's answer when it will not do what was asked: one hyphenated **refusal
  word** naming what refused (`role-forbids`, `no-such-binding`, `already-published`) — something
  the caller can act on, where a failure is something to log and try again. A word means one thing
  wherever it appears and belongs to one of seven **classes**, by what the caller can do about it:
  *unauthenticated* (sign in again), *forbidden* (someone with the authority must do it), *absent*
  (name something that exists), *malformed* (fix the shape of what was sent), *inapplicable*
  (well-formed, but not something this action applies to), *conflict* (the state moved: read again
  and decide again), *precondition* (something else comes first). A word reaches an agent, the
  operator and the web client as itself; a person reads its sentence. Once shipped, a word is never
  removed and never changes class, so a caller that has never met a word can still act on its
  class (ADR 0043).
- **issue word** — _Internal._ what a *malformed* refusal says about one field: one hyphenated word
  from the kernel's closed list (`missing`, `wrong-type`, `too-small`, `not-in-set`, `bad-format`)
  naming how the field was wrong, carried in a map of field path to word. The map never holds the
  value that was wrong, so a refusal can be logged and shown whatever the field held. A field path
  names a field, never a class: the class is the refusal's, and it is always *malformed*.
- **refused items** — _Internal._ what a *refusal* adds when an action refuses a whole set: a
  refusal's **items**, one *refusal word* per refused item, keyed by the id the caller sent for it
  or by an address's position in what was sent — never by an address or a name. Nothing of the set
  lands. The refusal's own word is the first refused item's word in id order. Only tRPC carries the
  items, to the web client; MCP and `pnpm ops` answer the set's word alone.
- **end every sign-in and token** — _Code rename pending._ the one action that ends what a person
  was issued, in two scopes. *In a workspace*: a workspace Admin ends every session and token a
  person holds there, by an instant on their member row the resolver refuses against; nothing
  outside that workspace changes, and the Admin never learns whether others exist. *Everywhere*: the
  operator ends every session and token the person holds, by an instant on the person. Both end
  what was issued; a fresh sign-in mints anew. The member page's last section reads *Remove and end
  every sign-in*.
- **share agent token** — _Code rename pending._ a **share agent's** credential: scoped to one
  connected source, minted and ended by an Admin, validated in the api before any request body is
  read, and good only for the `/agent/v1` routes a share agent uses to push documents in from a
  company's own network (ADR 0008 amendment, ADR 0041's *agent* class). Listed on Control Centre ›
  Sources › Share agents. Not a personal token (a person's own bearer for Claude Code and scripts)
  and not an OAuth access token.

- **role (of a person)** — what a person may do in every area, a **level** never a job title:
  **Admin**, **Editor** or **Viewer** in v0.1 (the Principal every call carries; Liam, 27/08/2026 —
  the platform is agnostic about who a bid writer is). Editors and Admins verify concepts, answer
  question sets and save Answers from history; Viewers ask, flag and suggest. Owning a *collection*
  grants actions on it to a person of any role, so a Viewer may own one (ADR 0047). A guide
  definition sets, per role, the default layer and the action threshold; a connected source's
  *audience* is who may see, never a role. Not a section's role label.
- **access request** — a signed-in person's recorded ask to join one workspace, with a reason;
  decided by an Admin — approved (which mints the invitation) or declined — each decision on the
  *audit log*. Not a *subject request*.
- **short name** — _Code rename pending._ a workspace's unique short name, given when the platform
  provisions it: how a person names a workspace they do not belong to when they ask to join it.
  Never its id. Better Auth's API keeps its own word for it.
- **member** — _Code rename pending._ a person's place in one workspace: the one *role* they hold
  there, the *groups* they belong to in it, and the instant every sign-in and token they held there
  was last ended. It begins when the person accepts an *invitation*, or when the platform provisions
  the workspace or adds them; it ends when an Admin removes the member, which leaves the person and
  their *display name* as they were, or when an *erasure request* is carried out; either way every
  *audit event* naming the person stands. A workspace keeps at least one Admin: no role change or
  removal may leave it with none — erasure alone may, since the right outranks the rule, and the
  operator then adds an Admin. A person is a **member** of each workspace they hold such a place in.
- **invitation** — an Admin's offer of a place as a *member*, with one *role*, to one email address,
  sent to that address and good for seven days; accepted only by a person signed in with that
  address, whatever its letter case, which is when they become a member. Approving an *access
  request* mints one; a new invitation to an address with one waiting replaces it. Whether the
  address already belongs to a person on the platform never changes what the Admin is told. Its
  **status** is one of four: **waiting** until it is accepted, cancelled, replaced, or its seven
  days pass into **expired**; **expired** once its seven days pass unaccepted, until a resend
  renews it or an Admin cancels it; **accepted**; or **cancelled**, as a replaced one is. Its
  email goes after the invitation is made, so an invitation can wait with its email **unsent**;
  a resend sends it again.
- **test workspace** — _Internal._ the workspace the *journeys* sign in to in production, made and
  set back by `pnpm ops test-workspace` alone, never by a page: the three *test people* and the 51
  *invented members*. A page says *kept for testing*. It carries a **mark**, a row of its own
  naming its *testing domain*, which only that command writes and the api cannot remove. While the
  mark stands, every *invitation* the workspace sends, resends or mints from an *access request*
  goes to an address on that domain, and one off it is refused `off-testing-domain`. Not the
  *operator*'s mark, which is on a person.
- **testing domain** — what follows the `@` of every address a *test workspace* invites,
  lower-cased and matched whole, so a subdomain is another one. An email domain, never a
  *collection* of the company's knowledge.
- **test person** — _Internal._ one of the three people the *journeys* sign in as: the test Admin,
  the test Editor and the test Viewer of the *test workspace*. The workspace also holds 51
  **invented members**, Viewers nobody signs in as, so that every list a journey pages through runs
  past one page. None of them is the *operator* or a *member* of another workspace. Each address
  is on the *testing domain*, so anything that lists or counts people can tell them from real ones,
  and every code sent to one reaches the *test inbox*. None is ever erased: erasure tombstones the
  address for good, so one who must go is removed from the test workspace instead. A journey undoes
  every action it takes, and the next run sets back what a failed one left, so the test
  workspace's *audit log* is their one lasting record.
- **Activity (of a person)** — one person's part in the workspace's *audit log*, read by an Admin
  alone, in People: every *audit event* they took and every one done to them, newest first, each
  marked with its **direction**: *by*, *to* or both, as a self-demotion is. It spans their whole
  history in the workspace, their *access requests* and earlier times as a member included. An
  *invitation* names an address, not a person, so one sent before they joined is in its inviter's
  Activity alone; their *sign-ins* and the *display name* they give are in the
  *identity-set audit log*, which no workspace reads. A read of the audit log, kept nowhere of its
  own: not a *record family*.

## The platform's areas and tools

- **better-answers** — the product's name, written so wherever a person reads it: on its pages,
  the browser tab, the sign-in pages and the emails, the sender's name included (30/09/2026,
  replacing ticket 22's prose form of 27/08/2026). In this glossary and the docs it is still *the
  platform*. Concept IRIs live on its apex, `https://better-answers.com/c/<ulid>`.

- **Control Centre** — the one Admin *area*, shown to Admins alone, where the workspace's sources,
  suggestions, agents and spend, the answers it gave, its people, its personal data and its system
  are seen and acted on. Its *menu* has eight groups (ADR 0017, ADR 0047): **Overview** (where to
  focus), **Suggestions** (*To decide*: every waiting suggestion, promotions included),
  **Sources** (Connected sources, Publishing rules, Cost estimates, Backlogs, Removed at source,
  Share agents), **Models** (Models and spend, the spending limit), **Questions** (*Questions
  asked*, flagged first; the answer tests), **People** (members, groups, Personal tokens),
  **Personal data** (erasure and suppression) and **System** (the audit log, signals, health,
  backups).
- **console** — the *operator*'s area over every workspace, outside any one of them and never part
  of Control Centre, drawn in the same frame as a workspace and reached from the *workspace
  switcher*, with two groups of its own: **People** (Everyone: every person, the workspaces they
  belong to and their role in each, their sessions and access; end every sign-in and token
  everywhere. Names waiting: correct a display name) and **Workspaces** (Every workspace: each with
  its member count, read-only) (ADR 0047). Shown to the operator alone and reached only from a
  signed-in session, never from a token.
- **area** — the top level of the platform's navigation, one entry in the
  *icon rail*: **Ask** (every role; the *home* of an Editor or a Viewer), **Knowledge** (every role;
  its Curation group for Admins and owners), **Inbox** (Admins and owners: what waits on the person,
  pointing into *To decide*) and **Control Centre** (Admins), with an area for produced work (named
  with S6) and **Briefings** (Then) to come (ADR 0047). A person sees only the areas holding a
  *page* they may see. The *console* is the operator's area, reached from the *workspace switcher*
  and never the rail. Until 30/09/2026 Ask was drawn apart from Control Centre (ADR 0046).
- **menu group** — _Internal._ a heading in the *menu* over some of one *area*'s *pages*:
  Control Centre's eight, Knowledge's Browse and Curation. An area with none lists its pages alone,
  as Ask and Inbox do. A menu group holding no page the person may see is hidden whole. What was a
  page of Control Centre until 30/09/2026 is now a menu group. Not a *group* of members, though
  People › Groups lists those.
- **page** — one place a person reads or acts on, with an address of its own
  and an icon in the *menu*, under its menu group where its area has them: Members, Connected sources,
  Audit log. Control Centre's are listed in its entry above, and every area's in ADR 0047, in the
  order the menu shows them. A person sees a page by their *role* or by owning a *collection* it
  serves. A page not built, or not theirs to see, appears nowhere, and its address shows the same
  **not-found page** as one that never existed, offering their *home*. A page that fails says
  "This page didn't load". A page may carry *tabs*. What was a view until 30/09/2026 is now a page.
  Not a *view (of an MCP App)*.
- **tab** — a division inside one *page*, named in the page's *toolbar*: Members' Members and
  Invitations. A tab has no address of its own; the open tab is the *breadcrumb*'s last part.
- **detail address** — _Internal._ an address one segment beneath a *page*, naming one of its rows,
  as a *member page* names a person (ADR 0047). It is the page's place, not a page: listed nowhere,
  seen by whoever may see the page, and drawn in the page's frame with no *toolbar*. An address
  deeper than it names nothing.
- **member page** — one *member*'s page, at the *detail address* beneath Members, opened from
  their row, its *row menu*, a Members keystroke or *Jump to*. A header names them, their address
  and their role, over three sections: **Access** (their role, their groups, when they joined, when
  every sign-in and token they held here was last ended, and the *display name* flag), their
  *Activity*, and **Remove and end every sign-in**, set apart last. A section has no address. A page
  naming no member says so and leads to Members.
- **home (of a role)** — the *page* a member lands on after signing in, and the one offered back
  when a page fails or an address names nothing they may see: Ask for an Editor or a Viewer, and
  People › Members for an Admin until Control Centre › Overview is built. A role's home shows in
  the *icon rail* even before it is built, and then says plainly that it is on its way. The
  *console* has one home for everyone, Workspaces › Every workspace.
- **icon rail** — the region down the left edge, below the *top band*, listing the *areas* a person
  may see, each an icon carrying its area's name and marking the area open; the **rail** for short,
  named *Areas* on the page. The utilities sit at its foot: **Keyboard shortcuts**, which lists the
  open page's keystrokes as `?` does, and help and settings once they exist. Where the window is not
  wide, the top band holds Keyboard shortcuts instead.
- **menu** — the region beside the icon rail, below the *top band*, listing
  the open *area*'s groups, each a heading over its *pages*, marking the page being read, and
  swapping when the area changes. No heading in it repeats the area's name. The *navigation control*
  hides it (*Hide the menu*) and shows it again, moving nothing in the top band, and that choice is
  remembered on the browser it was made on.
- **navigation control** — the button in the *top band*, beside the *workspace switcher* where the
  window is wide, governing whether the navigation is showing: where the window is wide enough for
  the regions it hides the menu and shows it again, saying which state it is in and staying where
  it is; where it is not, it opens the icon rail and the menu over the content, in a sheet titled
  *Menu*, and gives focus back when it closes.
- **toolbar** — the region above a page's content carrying that page's tabs at one end and its
  actions at the other, filled by the page; a page with neither gets no toolbar.
- **selection bar** — the strip above a list that shows only while some of its rows are ticked:
  it says how many are ticked and how many of those the list is not showing, carries the actions
  the page takes over every ticked row, and offers *Clear selection*. A tick stays through a change
  of page, search or filter, which is why the bar counts the ticked rows out of sight. Not the
  page's *toolbar*.
- **bulk action** — _Code rename pending._ an action an Admin takes over every ticked row at once,
  from the *selection bar*: on Members, *Change role*, *Add to group* and *Remove*. It changes every
  ticked row or none: if any is refused, nothing lands, and the refusal names each refused person
  with its *refused items*, shown or not. A ticked row whose change is already true is **skipped**,
  never refused, and the outcome counts it. A set that includes the acting Admin says so before it
  is confirmed.
- **row menu** — the menu at the end of a list's row, its button named for whose actions these are
  (*Actions for* Priya Shah), holding the actions on that row alone; a destructive action sits last,
  apart. Not the *selection bar*.
- **view-state slot** — _Internal._ the one place the open page writes what the actions on its
  toolbar must read, such as what a reader has ticked. It answers empty to any page but the one
  that wrote it, and it is emptied when the reader opens another tab.
- **top band** — _Internal._ the region across the full width of every workspace and *console* page,
  above the icon rail and the menu, in three cells: the *logo* over the rail; the *workspace
  switcher* and the *navigation control* over the menu; then the *breadcrumb*, *Jump to* and the
  **avatar menu**, which shows the person's initials and opens to their name, their role and *Sign
  out*. It holds no page's actions: those are in the page's own *toolbar*. Hiding the menu moves
  nothing in it. Where the window is not wide it takes two rows, the breadcrumb alone on the
  second, and scrolls with the page.
- **logo** — the product's symbol: two square brackets with a square between them, like a
  citation. It fills the *top band*'s first cell and leads to the person's *home*, and it stands
  on the sign-in pages and as the browser tab's icon. Its accessible name is `better-answers`.
- **workspace switcher** — the control in the *top band*'s second cell naming the workspace being
  read and listing every workspace the person is a member of: choosing one takes them to its
  *home*, and *All workspaces* opens the workspace picker. It lists the *console* to the operator
  alone.
- **breadcrumb** — the line in the *top band* naming where the person is: the *area*, the group,
  the *page* and the open *tab*, or on a *member page* the person's name, each part but the last
  leading to its place. It names every part at every width; only the wide band shortens the middle
  ones.
- **Jump to** — the finder the *top band* opens by click, ⌘K or Ctrl+K, to go somewhere in one
  move: the *areas* and *pages* the person may see, the workspace's members for a person who may
  see People, each opening their *member page*, and the actions their role may take, such as
  *Invite a person*, listed under the headings Areas, Pages, Actions and Members. Knowledge joins it
  with S2's retrieval; until then it is not a search.
- **promotion** — an Editor's proposal that an answer or a response become an `Answer`
  concept — the button is *Save as an Answer* — kept as a suggestion of kind *promotion* until
  decided at the promotion gate.
- **promotion gate** — where the `Answer` collection's owner or an Admin decides a promotion, one at
  a time: the proposed Answer beside the closest existing one (found when opened, judged same ·
  variant · different) — update the existing, add as new, or decline; client-specific wording
  stripped first. One governed write, the decider as author; a trim makes the decider the
  generator.
- **MCP surface** — _Internal._ the platform's one tools-only MCP server at `app.<apex>/mcp`, on the
  product's own origin (T-045, 2026-09-03; `mcp.<apex>` before it): four entries in v0.1 — `find`,
  `ask`, `open`, `give_feedback` — the principal from the token, the same predicate and audit as the
  api, grown later by token scope, never by a second server (ADR 0018). Guides and the question set
  are not on it. Never named on a page; the System card says *Connected assistants*.
- **MCP tool** — one of the MCP surface's entries: a named, described, typed function that never
  takes a workspace and returns structured content with its human rendering. Not a connector's
  read-live tool.
- **open (an MCP entry)** — the verbatim step of two-step retrieval: a concept by its IRI, or the
  passage a citation rests on by its locator; `find` is the preview step.
- **MCP App** — a view the platform serves for an assistant to render inside the conversation:
  an HTML page addressed by a `ui://` URI, named in an entry's metadata, drawn in a sandbox the
  host controls, able to call the same entries the assistant can. It shows a concept, an answer
  or a set of matches; it is never a second way in (ADR 0030).
- **view (of an MCP App)** — the rendering half of an MCP App: one `ui://` resource bound to one
  entry. Every one has a **human rendering** behind it — the text form of the same result — and not
  every human rendering has one. Not a *page*, once called a view.
- **`ui://`** — _Internal._ the wire URI scheme for a view of an MCP App. Beside `okf://` and
  meaning something different: `okf://` identifies a **concept**, `ui://` identifies a **view (of an
  MCP App)**. On the wire only, never in a file.
- **token scope** — _Internal._ what a token may do on the MCP surface: `knowledge:read`,
  `feedback:write`; `act:*` later. Shown at consent in the person's words, never as an id. Not a
  connected source's scope.
- **personal token** — a person's own bearer credential for Claude Code and scripts (the
  `api_token` record): the same principal and scopes as an OAuth token, ninety days by default,
  shown once, minted on the Account page, listed to Admins in People › Personal tokens.
- **assistant** — _Code rename pending._ a host a person has given access to the MCP surface by
  OAuth and has used: Claude on the web, Claude Code, ChatGPT. Under client-ID-metadata documents
  there is **no registration**, but the platform caches each assistant's metadata document as a row,
  with the scopes it may request, refreshed from the document on a schedule (ADR 0009): the System
  card lists the distinct `client_id` URLs seen on issued access, each named from its own metadata
  document, with who has connected through it. OAuth's own names for it stay.
- **access (of an assistant)** — _Code rename pending._ what a person's consent gives an assistant:
  the MCP surface in one workspace, or in none, lasting through the assistant's refreshes. It is
  open until it lapses or an action ends it: ending every sign-in and token, here or everywhere, or
  removing a member. That action's audit event records each access it ended, so ended access stays
  on record after its tokens are gone. The authorization server can end it too, when the person's
  session ends or the assistant disconnects. Nothing records that end, so it stands only while its
  tokens do.
- **Account page** — a person's own small page outside Control Centre: name, role,
  workspace, personal tokens, and two sections of its own. **Sign-in**
  holds the person's *passkeys*, their *second factor*, their *recovery codes* and any Microsoft
  account they linked; **Sessions** lists their *sessions*.
- **sign-in** — how a person proves who they are to the platform: the *sign-in link* or the
  six-digit code in a sign-in email, a *passkey*, or Microsoft for a company on Microsoft 365
  (T-045 grilling Q10, 2026-09-03); never a password. A passkey is a whole sign-in on its own; a
  person who must hold a *second factor* and signs in by email confirms it before reaching any
  page. A person signs in first and an Admin then adds them to a workspace; whether an
  invitation must come first is open (T-027). A Microsoft account signs in only on an exact match
  with that person's email.
- **sign-in link** — the link in a sign-in email, which makes one credential with the email's
  six-digit code: both last the code's five minutes, and signing in with either spends both. It
  signs in only the browser that asked for the code, and only when the person presses *Sign in* on
  the page it opens, so a mail scanner that opens it first changes nothing. Opened anywhere else,
  the page shows the code to type where the person started.
- **passkey** — a sign-in credential that a person's device or password manager keeps for the
  platform, unlocked by their face, fingerprint or device PIN and good only on the platform's own
  address, so a page imitating the platform cannot use it. A person adds, names and removes their
  own on the *Account page*. Signing in with one needs no email, and it stands for the *second
  factor* as well.
- **authenticator** — a phone application that shows a changing six-digit code for the platform,
  set up from a QR code or from its key written out; one of the two kinds of *second factor*. A
  page imitating the platform can pass its code on as it is typed, which it cannot do with a
  *passkey*.
- **second factor** — what a person holds besides their mailbox to prove who they are: a *passkey*
  or an *authenticator*. A person who is an Admin in any workspace, and the *operator*, must hold
  one, and sets one up before reaching any page if they hold none; anyone else may add a passkey
  for a quicker sign-in. It is the person's own, across every workspace: neither an email nor a
  workspace Admin can remove, reset or stand in for it, and an Admin cannot remove their last one.
  Every change to it is announced to the person's email address.
- **recovery code** — one of ten one-time codes an Admin is shown once, when they first set up a
  *second factor*, to keep somewhere safe. One gets them in once in place of their second factor
  and takes them straight to setting up a new one; replacing the set on the *Account page* voids
  the old one. An Admin with no factor and no code left is restored by the *operator* alone, with
  a *restore code*.
- **restore code** — the one code the *operator* issues when restoring an Admin who holds neither
  a *second factor* nor a *recovery code*. The operator first confirms who the Admin is by a
  channel other than their email, and hands the code over by that same channel. It is good once, and setting
  up a new second factor after the restore needs it, so whoever holds only the Admin's mailbox
  cannot finish the restore.
- **re-confirm** — an Admin's confirming their *second factor* again before a high-impact action,
  such as removing a member, changing a role, ending every sign-in and token or an export, when
  they last confirmed it over an hour before. The action goes ahead once they have.
- **session** — one browser's sign-in, lasting up to thirty days and renewed while it is used. A
  person sees their own on the *Account page*, each with its device, its browser and when it was
  last active, never a place, and may sign any one out, or every one but the current one. Signing
  a session out ends that session alone, never an assistant's *access* or a *personal token*.
- **last active** — when a member last used one workspace, through the platform or through
  Claude. A workspace knows it of its own members alone, never their activity in another workspace
  or when they last signed in, which would tell one company about another. When a *session* was
  last active is the person's own, on the *Account page*.

- **generation** — _Internal._ the stamp every bundle-and-record node and edge in the map carries; a
  workspace has one live generation, flipped by one row update after a full rebuild, and every read
  binds it. Generations exist **for full rebuilds only** — an ordinary edit's delta lands in the
  api's own commit transaction and writes no new generation (ADR 0023). Source entities carry none:
  they are reconciled per document.
- **map rebuild** — _Code rename pending._ the job that **rebuilds** one workspace's map in full as
  a new generation, for one of six reasons — first build · model choice change · reconciler ·
  erasure · upgrade · drill — and flips it live in one row update. It is not how an ordinary edit
  reaches the map: that delta is written by the api in the same transaction as the concept index
  row, the `bundle_commit` and the `audit_event` (ADR 0023).
- **entity merge** — _Internal._ the rule an Admin's confirmed alias-merge suggestion writes: an
  audit event, never a commit; undone by deleting it and re-deriving (ADR 0023).
- **canonical entity** — the node an entity merge produces: keyed by the rule, carrying no
  connected source, with every contribution hanging off it under its own connected source,
  sensitivity and audience; never shown when no contribution is visible to the reader; never a
  concept (ADR 0023).

## The route

How the work from the foundation to a finished v0.1 is cut and ordered.

- **route spec** — _Internal._ the one document that holds the way to a finished v0.1: a head over
  the vision's v0.1 row, then the *blocks* in order, each with its edges and the obligations it
  carries, and a status table that is the product frontier every product session reads first.
  Each block is planned from it. A Wayfinder map is charted only for a destination the route spec
  does not already hold. A plan is one piece of work's, in `docs/plans/`, never the route spec.
- **block** — _Internal._ one section of the route spec: a destination a product session can pick,
  about a page — the ADRs and words it rests on, what in the tree it builds on, what it must carry,
  its blocking edges, a seam sketch. Taken to `/ce-brainstorm` and `/ce-plan` before its build; its
  plans are in `docs/plans/`, and the block itself is never one. Each block lands its own page. A
  slice is a `packages/core` capability, never a block.
- **strand** — _Internal._ one chain of blocks the route spec orders by their edges, worked in
  parallel with the other: the *knowledge strand* (a document to a passage, an answer, the
  producer) and the *records strand* (guides, suggestions). A block belongs to one strand; a
  cross-strand edge is stated on the block.
- **land (the verb)** — _Internal._ to take a change to `main` through the merge queue: a branch, a
  commit, a push, a pull request and an armed auto-merge, the queue doing the merge
  (`docs/agents/workflow.md`, *Merging*). The adjective is the other sense — a *landed copy* is a
  state of the knowledge layer, and nothing here lands one.
