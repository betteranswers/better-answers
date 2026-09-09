# The v0.1 route — the blocks from the foundation to the first client, in order

*The route spec (`CONTEXT.md`, *route spec*), written 9 September 2026 under T-112 from `.scratch/v01-route/handoff-2026-09-09.md`, the architecture review of the same day (`.scratch/v01-route/architecture-review-2026-09-09.html`, §5 the starting cut), ADRs 0001–0040 through `docs/adr/README.md`, `CONTEXT.md`, `docs/vision.md`'s v0.1 row, the tree at `6f03392`, the pre-build gate's §7 and its 7 September addendum, the nine specs under `apps/docs-site/specs/`, the ordna board and the open tasks' bodies, and the mutation findings of 9 September (`.scratch/v01-spec/research/mutation-findings-2026-09-09.md`). The owner's answers to the handoff's five open questions (09/09/2026) are recorded in the blocks they change. This document is never ticketed: each block is taken to `/to-spec` before its build, in the T-006 pattern, and then to `/to-tickets`. The status table at the end is the product frontier every later session reads first.*

**The authority order.** Where two sources disagree the higher wins without discussion: `docs/adr/README.md` · the ADR body with its amendments and strikes · `CONTEXT.md` · the tree, tests first then docblocks · the per-ticket specs · the gate including its addendum · the map's Decisions-so-far · a ticket body or briefing. This document cites the first four for *what* and the last three for *why*. A claim whose only source is the map or a ticket is marked **(map NN)**; one whose only source is the gate is marked **(gate §N)**; one placed by this document rather than by the handoff or the owner is marked **(placed here)**.

## Problem Statement

The owner of Better Answers set out to build a living company knowledge map for one first client — its product, service and sector guides, its four bid libraries as `Answer` concepts, search and cited Q&A, a question set answered from the knowledge with citations, a read-only MCP surface, and Control Centre — on a foundation locked by the pre-build gate. The foundation is built and enforced: four store doors, the governed write and its reconciler, the graph as application data, one read predicate rendered once, one person id, one origin, the tier contract, six repository gates. The product is not on any route. Layer 1 of the knowledge system — sources — is a substrate with no pipeline; `ask` always refuses; guides are a cascade helper; the erasure seam is eight lines; five of Control Centre's six screens render *unbuilt*. None of the gate's B7 to B10 has a ticket, and every build ticket since the gate has re-grilled at build time what the map had already decided, because the step the Wayfinder hand-off names — one spec over the cleared map — was skipped and the gate's §7 task list stood in for it. About one task in five since the gate has been product work. Code is waiting on "the map revisit", a document that did not exist until this one.

## Solution

One document holds the route: this spec. Its head is the vision's v0.1 row expanded into the stories a completed v0.1 satisfies. Its body is a numbered sequence of **blocks**, each about a page: a one-line destination, the ADRs and glossary words it rests on, what in the tree it builds on, the obligations pinned in code or research it must carry, its blocking edges, the open ordna tasks it absorbs, and a seam sketch. The gate's horizontal B7 to B10 are re-cut vertically — S1 is one uploaded document to a cited passage, not "sources"; B10's six screens dissolve into the blocks, each landing its own screen through the browser suite — and four things the build showed missing from §7 are added: the redaction seam (S0), the model client and signals (S2, O1), the question set (S6) and the producer (S7). Every open product task on the board is named in exactly one block; every platform-level mutation finding is placed in the block whose seam it names; the two obligations the 7 September addendum pinned in code are placed by name. Remediation moves off the route into a hygiene lane. The status table is the frontier: a product session opens it, picks the first unblocked block, takes it to `/to-spec`, and comes back to tick it.

## User Stories

### The Admin at the first client

1. As an Admin, I want to bind an uploaded document to my workspace, review what the pre-scan found in it by category and rule, and publish it, so that my company's knowledge enters the platform through a gate I ran and can explain.
2. As an Admin, I want every binding to start Restricted and every widening to be my recorded act, so that doing nothing is the safe thing and nothing reaches a reader I did not admit.
3. As an Admin, I want a sort code, a date of birth or a home address in a document withheld before it is chunked, embedded, extracted or sent to any model, so that no derived store and no processor ever holds the value.
4. As an Admin, I want the platform to emit the DPIA input for each binding — the data types, the class, the rules in force, the routes with their processor and country, the retention tail — so that our privacy assessment is written from what the platform actually does.
5. As an Admin, I want to bind my company's public website by URL prefix and a SharePoint library, see the enumeration and a priced extraction plan at review, and accept the plan once, so that indexing and extraction run on a cadence within a scope I priced.
6. As an Admin, I want an extraction ceiling the platform refuses at, in one sentence naming who can raise it, so that a run never silently narrows the work and never silently spends past what I set.
7. As an Admin, I want every suggestion of every kind — candidate concepts from a run, an Editor's edit, a promotion, an alias merge, a platform-bundle update — waiting in one queue with a summary that names the kinds it introduces, so that nothing platform-prepared reaches the bundle without my decision.
8. As an Admin, I want a bulk acceptance to land one commit per suggestion with per-item outcomes, and a set the platform refused mid-acceptance returned to its proposer with the reason, so that partial success is a state I can see and never a silent one.
9. As an Admin, I want a poisoned run's suggestion set reversed by run in one governed write, so that a bad producer stays out of a history that is permanent.
10. As an Admin, I want the Kinds list on Knowledge with counts per kind and per domain, and to rename or merge a kind by one bulk commit, so that my company's language is read off its concepts and corrected by me, never declared in a file.
11. As an Admin, I want the review table over every concept and composition, with conflicts and verification requests as saved filters and exports on its toolbar, so that the state of the map is one screen.
12. As an Admin, I want to invite a person by email, change their role, remove them, and revoke their credentials in this workspace, so that access follows the people my company has today.
13. As an Admin, I want groups, flat and Entra-aligned, as the one thing an audience names, so that who may see a binding's content is one membership lookup.
14. As an Admin, I want to name a concept's owner per domain, with a per-concept override, so that *edit* suggestions and verification requests land in a named person's queue and not only mine.
15. As an Admin, I want System's eight cards over real rows — boxes, backups, sources and the worker, the map, knowledge, questions, connected clients, personal data — each line with an action, so that I find out about a missed backup or a ceiling at 80 % before a client does.
16. As an Admin, I want to export the bundle at a commit, the whole repository, the records about its concepts, or a guide's prose, so that my company's knowledge is its own asset and leaves with it.
17. As an Admin, I want a person's valid erasure request to rewrite every actor id the platform wrote across history, the index, the evidence and the map, and the report to say exactly what it did and did not do, so that "beyond use" is honest.

### The Editor — a bid writer

18. As an Editor, I want to type a concept, or edit one from a guide page, and see it land as one commit with me as author, so that every change to what my company states is attributable and revertible.
19. As an Editor, I want a guide seeded from a template — a bid-library product guide, a sector guide — with its sections populated from concepts by expectation, so that the guide exists and shows its coverage from the moment it is defined.
20. As an Editor, I want to write a section's Brief over the concepts it includes, with a claim citing its concept by a footnote labelled by the include, so that prose I assemble never restates a concept and every claim leads to its evidence.
21. As an Editor, I want the editor never to save what I did not change, and to open in source mode when the visual mode would lose a mark, so that a no-op save never rewrites a body and a footnote never disappears.
22. As an Editor, I want to copy a section into a tender with resolvable footnotes and have the copy recorded as a usage, so that what left the platform is known.
23. As an Editor, I want to ask a question and get an answer that asserts concepts only, cited passage by passage, with its verdict for my role first, so that I can paste it knowing where every claim came from.
24. As an Editor, I want an existing `Answer` reused as it stands when it answers my question as asked, shown with the question it answered and its own trust, so that the bid library's checked answers are found before anything is drafted.
25. As an Editor, I want "Not answered from the company's knowledge" with the closest unmapped passages when nothing on the map answers, and one act to suggest a concept from a passage, so that a gap becomes knowledge rather than fluent prose nobody owns.
26. As an Editor, I want to save an answer as an `Answer` and see it decided one at a time against the closest existing `Answer`, so that the bid library grows without duplicates.
27. As an Editor, I want to paste a bid document, confirm its extracted question set in a table, and have every question answered as a background job streamed per question, so that a response set is drafted from the knowledge with citations and the unanswered questions sort to the top.
28. As an Editor, I want the response-set document out through the one renderer, recorded as one usage per response, so that what I submitted is traceable to the concepts it cited.
29. As an Editor, I want to check a concept against its sources and see *Checked by me · date* on it, and never be able to check a body I generated, so that a check is worth something.
30. As an Editor, I want a conflict — two values for one claim across sources — shown with both values and their evidence, and resolved by me in one of four ways, so that the pipeline never picks a side on my behalf.

### The Viewer

31. As a Viewer, I want every concept, section and hit to wear its trust in fixed words — *Checked by Priya Shah · 3 March 2026*, *Checked by the platform*, *Unchecked*, *Changed since checked*, *Out of date* — and its sensitivity where it limits me, so that what I read carries who, when and on what evidence.
32. As a Viewer, I want a search hit to be the concept, with the guide sections it appears in and the documents it rests on nested under it, and a document nothing rests on marked *Not company knowledge*, so that the same fact is never shown three times and a gap is visible.
33. As a Viewer, I want the evidence passage reachable beside the claim without leaving the page, so that checking a claim is one glance.
34. As a Viewer, I want to flag an answer as *wrong*, *out of date*, *incomplete* or *should not have shown*, so that a fault I found becomes someone's queue item at the right level.
35. As a Viewer, I want a concept withheld from me to be indistinguishable from one that does not exist — no hit, no count, no hint — on every surface, so that probing reveals nothing.
36. As a Viewer, I want a guide page's citation to a concept I may not see withheld the same way, so that a composition is never a side door.
37. As a Viewer, I want the map's state told in one of two phrases, *map as of <time>* or *map unavailable since <time>*, so that I know what an answer was reasoned over.

### A person working from Claude

38. As a person in Claude, I want to connect Better Answers once by OAuth and then `find`, `ask`, `open` and `give_feedback` from any conversation as myself, in my workspace, so that the company's knowledge is where I already work.
39. As a person in Claude, I want `ask` to answer only what I could see on the web, under the same predicate and the same audit, so that the assistant is never a wider door than the app.
40. As a person in Claude, I want `open` to give me the verbatim passage a citation rests on, by locator, so that I can verify a claim in the conversation.
41. As a person using Claude Code or a script, I want a personal token minted once on my Account page with the same principal and scopes as an OAuth token, so that automation runs as me and no wider.
42. As a person on Microsoft 365, I want to sign in with Microsoft on an exact match with the email I was invited on, and never be offered a password, so that my company's IT decides who I am.

### The person whose data the company holds

43. As a person named in a document, I want my personal contact details, date of birth and home address withheld by default, so that a bid writer indexing a proposal does not put my data in four stores.
44. As a person who has left, I want my `Person` concept to read *Left* and my actor ids rewritten to a pseudonym on a valid erasure request, so that my history is kept without my name on it.
45. As a person making an access or erasure request, I want it answered from the platform's own per-store finder on the one-month clock, so that the answer is complete and on time.

### The operator and the owner

46. As the operator, I want to provision a workspace and its first membership by one command under the platform principal, so that a client exists before anyone signs in and the product is dogfoodable.
47. As the operator, I want to revoke a person's credentials everywhere, list users across workspaces and inspect sessions, with Better Auth's admin plugin reduced to what ADR 0009 permits, so that the one cross-workspace surface is small and audited.
48. As the operator, I want `pnpm ops replay-erasures` and `erasure-rehearsal` to answer *done*, and the monthly restore drill to go fully green with a `backup_run` row written to production, so that the drill proves the thing it exists to prove.
49. As the operator, I want a stuck workspace — a replay stopped at a commit the index refuses — put right by one ops command that answers truthfully and books its ledger row, so that a workspace never falls silently behind its bundle.
50. As the owner, I want the route per purpose — extraction, enrichment, answering, judging, embedding — chosen per workspace, local or hosted, with the embedding route fixed once vectors exist and every model call a row, so that spend, residency and the ceiling are facts.
51. As the owner, I want every screen to meet its latency budget — lists under a second, actions under 100 ms, answers streamed — asserted by the browser suite as the screen lands, so that a missed budget is a bug and never a sweep.
52. As the owner, I want the first client's four bid libraries to land as `Answer` concepts through one normalising pass, its 23 cross-file contradictions as conflicts, and its website enumerated before any plan is priced, so that onboarding is the product's own path and not a migration script.
53. As the owner, I want every block of this route to reach `/to-spec` before its build and `/to-tickets` after, and the status table to be the one frontier a session reads, so that no session infers the next thing and no ticket re-grills the map.

### The builder and the reviewer

54. As a builder, I want each block to name the seam its functional tests go through before a line is written, so that the interface is the test surface from the first tracer bullet.
55. As a builder, I want the obligations pinned in code — the edge-projection rule, the concept-owner record, the four probe tests, the audience seed test — placed in a named block as acceptance lines, so that nothing waits on a document that does not exist.
56. As a builder, I want every platform-level mutation finding placed in the block whose seam it names, so that survivors close as a consequence of the block and never as a hardening pass of their own.
57. As a reviewer, I want every claim in a block spec to cite an ADR, the glossary or the tree, and a claim resting only on a map ticket marked so, so that a builder reading a stale file cannot build the old design.
58. As a builder picking up a short session, I want a hygiene lane of one-task findings off the route, so that remediation has a queue that does not compete with the product.

## Implementation Decisions

### What a block is, and the three rules every block spec follows

- A **block** (`CONTEXT.md`) is a destination a session can pick: about a page here, one `/to-spec` document before its build, a handful of tracer-bullet tickets after. Its tickets are ordna tasks; the block is not. A block lands its own screen — the six-screens layer of the gate's B10 dissolves into the blocks below, and ADR 0037's latency budget is asserted per screen as it lands.
- **The authority order** stated at the top binds every block spec. A block spec cites levels one to four for what and the rest for why.
- **The staleness pass, scoped.** The first step of each block's `/to-spec` is an AFK research pass over only the map tickets and briefings that block cites, reporting per claim *stands* or *overtaken by ADR nnnn / commit*. It never re-assesses all 85 tickets. The seed list of tickets already known to be overtaken is in Further Notes.
- **The hygiene lane** (`CONTEXT.md`; `docs/agents/issue-tracker.md`) is where a finding from a gate, a mutation run or a review goes: one ordna task tagged `hygiene`, no map, no spec, no grilling. A Wayfinder map is charted only for a destination this document does not hold.

### The five answers (owner, 09/09/2026)

1. **S0 is its own block**, ahead of S1: the drill's erasure step and the DPIA input do not depend on a document existing, and the map's D1 order — the redaction and erasure seam (ADR 0020) before the first document ingest — is visible as an edge rather than a slice boundary.
2. **S1 composes cocoindex from its first slice** (ADR 0036, `[PIPE1]`). The bounded architecture review that follows this document (Further Notes) carries the worker's shape as a cocoindex host as one of its four questions, and its verdict is a blocking edge of S1's block spec.
3. **S6, the question set, is on the route** as the last of the S blocks: the destination's own sentence and `docs/vision.md`'s v0.1 row name it, and first-client onboarding needs it. The status table says which blocks gate a v0.1 release, so S6 can slip in time without leaving the route.
4. **S7, the producer, runs parallel to S3 and after S4**, landing before S5: a guide section populates from concepts already in the bundle — typed by an Editor, or the first client's libraries as `Answer` concepts — while the producer fills the inbox at scale from the website.
5. **`concept_owner` lands in S3, aligned to OKF.** It is a record attached by IRI — per domain, with a per-concept override written at mint (ADR 0014) — and never a key in the concept file: OKF requires only `type`, and this platform meets every silence of the spec in records and the graph, never in the file (`docs/okf-v02.md`, the platform's stance; `[OKF2]`). The bundle manifest's `owner` (ADR 0002) stays the bundle's and is not the concept's. The record un-gates ADR 0012's owner arm; T-054's Admin-only gate, stated in the concepts slice docblock as a booked gap, closes in S3.

### Placement rules

- **Every open product task is in exactly one block**: T-029 and T-082 in S1; T-023 and T-108 in S5; T-027 and T-047 in P1; T-028 in P2. T-014, T-017, T-110 and the T-106/T-107 remainder are hygiene.
- **The addendum's two obligations**: the edge-projection rule is S2's; the concept-owner record is S3's.
- **The mutation findings** (§2 of the 9 September file) are placed by section: S2 carries §2.2 entire; S3 carries §2.6; S5 carries §2.5; P1 and P2 carry §2.1 and §2.3; S0 and S1 carry nothing, having no seam there yet. §2.4's five rows the handoff did not place are placed here: the audit-outcome and `jti` row with P1 beside §2.1; the platform-actor-id row with P2 beside the identity-set ledger; the failed-tRPC-procedure row with P1, the first screen whose acts go over tRPC; the api reconciler's operator line with S5 beside T-108 and §2.5; the `pnpm ops smoke` row with O1 **(placed here)**. §1's open items, §3.2, §3.3, §3.6 and §4 are hygiene; §3.1 is S5's; §3.4 is P1's.
- **Two lanes run in parallel.** The knowledge lane is S0 → S1 → {S2, S4} → S7 → S5 → S6 → C1. The records lane is S3, blocked by nothing on the route (B5 stands), then S5 with the knowledge lane. P1 → P2, O1 and V1 hang off the lanes where their edges say.

### The blocks

#### S0 · The redaction seam and erasure

**Destination.** Personal data is withheld at the seam before any store, and a valid erasure request leaves the platform able to say exactly what it did: the two ops commands answer *done*, the restore drill goes fully green, and the DPIA input has a mechanism behind it.

**Rests on.** ADR 0020 (the seam in the worker's conversion step, the three tiers of redaction rule, findings by category × rule, the `Person` concept, the routine, the narrowed promise of 30/08 and the erasure report's fixed wording, the erasure pseudonym of 05/09); ADR 0035 (one person id; the user row pseudonymised, id kept); ADR 0022 (every restore replays the erasures completed after the dump before `app` turns healthy; every third drill rehearses the routine on a synthetic subject); ADR 0012 (author lines mailmapped to the pseudonym; the erasure re-derive as a graph sync reason); ADR 0024 (bare repositories and the mirror; no forge to pause); ADR 0013 (findings at three moments; widening blocked while special category is unreviewed). Words: *finding*, *redaction rule*, *withheld*, *sensitivity*, *Person*, *Left*, *erasure request*, *erasure pseudonym*, *suppression*, *subject request*, *platform principal*.

**Builds on.** The class columns and the derivation (T-055); the erasure slice, today an empty export; `pnpm ops replay-erasures` and `erasure-rehearsal` answering *not built* at the `runOps` seam; the worker's chunker, which already indexes a concept's body only; the git door; the ledger and the audit slice's doors; the `graph sync run`'s six reasons, *erasure* among them.

**Must carry.** The seam as a deep module the worker calls on every span before any store, its output versioned by rule version and detector pin; the tier boundary — the detector runs in the worker, the review of findings and the erasure request are the app's (review C4; the block spec confirms it); the always set restorable per span by an Admin with a reason; the officer-block rule; special category narrowing a document to Restricted on landing; the two ops commands truthful; the drill fully green, with the rehearsal on a synthetic subject grepping the restored dump; the DPIA input's shape per binding, `authored concept bodies` among its categories (ADR 0020, 30/08) — its hash lands on the publish audit row with S1's publish act; the erasure report's wording as the amendment fixes it; the erasure map including the identity set's invitation emails, verification identifiers, session IP and user agent, and linked account id; `pg_advisory_lock(41)` held through the routine; the routine's git step on the bare repository and the mirror; the four questions owed to a lawyer (ticket 63; ADR 0020's fourth) recorded as owed, never answered by the block. Mutation findings: none.

**Edges.** Blocked by nothing on the route. Blocks S1.

**Absorbs.** No open task.

**Seam sketch.** The worker pytest harness for the detector: every fixture span asserted back against the text by offset, the recall set of ADR 0020's spike (eight flagged spans plus the health note), the memory beside conversion **(map 24)**. The core erasure slice's interface for the request and the routine against a real bare repository and real Postgres — the rewritten history, the pseudonymised user row, the re-derived index, evidence and map, the ledger never rewritten. `runOps` for the two commands and their refusals. No screen of its own: the People screen's erasure and suppression section is P1's, over this block's rows.

**Sources to re-read at `/to-spec`.** Tickets 24, 63; research `pii-detection-candidates.md`; ADR 0020's "open for the spike" list; the gate §4 probe 1.

#### S1 · One uploaded document to a cited passage

**Destination.** An Admin binds an upload, reviews its findings, publishes; the worker lands the file in the object store, converts, redacts through S0's seam, chunks, embeds on the fixed route, and writes `index.chunk` with the three visibility columns; `find` returns the hit as *Not company knowledge* and `open` by locator returns the passage; the Sources screen shows the binding and its gates.

**Rests on.** ADR 0013 (origin × reach × destination; the review and publish gates; retention classes); ADR 0036 (the worker composes cocoindex's blocks and writes only what the engine has no block for; every target `managed_by="user"`); ADR 0007 (the app owns all DDL in `index`); ADR 0005 (four stores, the control plane is rows, one LMDB per binding, never backed up); ADR 0020 (the seam before chunking and every route; a hosted embedding route names Mistral EU as sub-processor); ADR 0023 and 0039 (the visibility columns on every `index.chunk` row; audience by intersection); ADR 0025 (an `llm_call` row per embedding call); ADR 0031 (the tier contract); ADR 0037 (the Sources screen's budget); ADR 0024 (the worker's 1.5 GB cap, one index at a time). Words: *source binding*, *connector*, *source document*, *connector run*, *job*, *lease*, *claimant*, *outcome*, *publish (a binding)*, *retention class*, *destination (of a binding)*, *hit*, *open (an MCP entry)*, *route*.

**Builds on.** `source_binding`, `source_document` and `index.chunk`; the queue and its SQL functions under the `queue` contract; the worker's loop, lease, heartbeat and reaper (T-057) — B7 adds job kinds to a loop that exists; the sources slice's one act, narrowing a binding (T-055); `llm_route` with the embedding route shown as *fixed*; the object door, five lines today; `find` previewing the concept index; `open` by locator answering *not found*; the Sources screen routed and rendering *unbuilt*.

**Must carry.** The four probe measurements the gate turned into build-task tests **(gate §4)**: whether the per-binding LMDB holds personal data and whether one entry can be removed; that `drop` on one binding cannot take the shared `index.chunk` and its index with it; the `detect_change` blast radius — suppressions per document, never a global key; the LMDB size per binding as an ADR 0025 signal. `double_claim` as a `platform_event` **(gate §8, failure-recovery F3)**. The audience seed test — one group, one non-*everyone* binding — so the audience branch is driven **(gate §8)**. T-029 as written. `[PIPE1]`'s two sentences and ADR 0036's table as the review's checklist for the first `Environment`. The DPIA hash on the publish act's audit row (ADR 0020). The first document-shaped agreement in `contracts/`, conformance-tested by both tiers. The `[SEC3]` pass on every new table, grant and definer function. The chunker's body-only rule stands. Mutation findings: none.

**Edges.** Blocked by S0. Blocks S2 and S4. S1's block spec is also blocked by the bounded review's verdict on the worker as a cocoindex host (Further Notes).

**Absorbs.** T-029 (the embedding route immutable in the database); T-082 (the local seeded database — its seed grows one insert per slice, and the first document is the first seed worth browsing).

**Seam sketch.** The one new seam of this route, agreed 09/09/2026: a **document-shaped cross-tier test**, modelled on rebuild-equivalence — the Admin's bind, review and publish acts through the sources slice over real Postgres and a real object store, the worker run as a real process against the same stores, then `find` and `open` by locator through the core interface and the MCP surface, the passage asserted as a literal. Beside it: the worker pytest harness for convert, chunk and embed; the core interface for the acts and their refusals; `contracts/` for the document agreement; the api harness for the Sources screen's tRPC procedures; the browser suite for the Sources screen with its budget.

**Sources to re-read at `/to-spec`.** Tickets 17, 48, 52, 53, 54, 55; briefing 53; research `cocoindex-capability-map.md`, `source-connection-configuration.md`; the gate §4.

#### S2 · Ask answers, or refuses honestly

**Destination.** A question asked in Claude, or on the web, comes back cited from concepts — an existing `Answer` reused when it answers as asked, else drafted over the walk — or refused in one sentence; every model call is a row; the Questions screen shows the answer audit, flagged first.

**Rests on.** ADR 0016 (entry points by embedding over concepts, the depth-4 walk, reuse judged on the judging route, the one contract with the verdict first, the depth-0 fallback and the `map` field, unmapped passages); ADR 0017 (the answer audit's skeleton and content child; feedback's four reasons); ADR 0018 (four entries, the principal from the token grown by scope); ADR 0030 (MCP SDK v2 behind one fetch-shaped seam); ADR 0025 (`llm_call` on every call, never the prompt or the completion); ADR 0037 (answers streamed); ADR 0023 and 0032 (the walk templates, the predicate on every element); ADR 0019 (the trust words); the route per purpose on the common Messages API shape, local and hosted one code path **(map 05, 29 — D3)**. Words: *answer*, *answer contract*, *hit*, *unmapped passage*, *route*, *answer audit*, *feedback*, *map*, *MCP surface*, *MCP tool*.

**Builds on.** The answering slice's contracts and human renderings (T-004), `ask` refusing and naming the concepts its terms hit, `find` over the index, `open` by IRI (T-052), the trust words; the graph door's depth-4 templates (T-053); the invisibility suite through `find`, `ask`, the walk, the footnote and `open`; the llm slice's route resolution, calling nothing; `give_feedback`'s receipt; the Questions screen routed.

**Must carry.** The **edge-projection rule** (the addendum's first obligation): before any surface projects an edge's columns, the target's own predicate is applied — `open`'s relations projection is the first such surface and carries it as an acceptance line. **A21**: a retried `ask` settles its spend reservation on stream close, stale reservations swept, a retry a second audit row **(gate §2)**. Latency measured under concurrent load, never quiescent **(gate §8, scale F5)**. The `llm_call` columns as ADR 0025's amendment fixes them. The depth-0 fallback and the `map` field, never a count. No totals anywhere; one *not found* for absent and withheld alike. The positive control the invisibility suite lacks: an answer that cites. The provider client behind the route record as one fetch-shaped seam. Mutation findings **§2.2 entire**: the scope gate exercised with an `offline_access`-only token; the per-IP 401 flood limit on `/mcp`; a token issued after a revocation proved accepted; the JWKS cache counted; non-JWT, `alg`-less and claims-less bearers; `open` by locator driven through the surface; the credentials-refused branch; `ask`'s whole answer shape asserted against literals.

**Edges.** Blocked by S1 — chunks give entry points and the object store gives passages. Blocks S5, S6 and V1.

**Absorbs.** No open task.

**Seam sketch.** The core answering slice's interface over seeded concepts and chunks on real Postgres — entry points, the walk, reuse, the draft, the fold; the api harness through the MCP surface (structured content against literals) and tRPC's event stream; a **fetch-shaped fake at the Messages API** for the model client — the one third-party double on this route, our own code never mocked (`[TEST3]`); the browser suite for the Questions screen; the budget test as an ordinary member of the suite under concurrent reads.

**Sources to re-read at `/to-spec`.** Tickets 20, 58, 37, 59, 21, 80, 29, 05; research `llm-routing-local-models.md`, `80-mcp-2026-07-28-revision.md`; the gate §2 A21, A22.

#### S3 · A guide section populated and edited

**Destination.** A guide definition seeded from a template, its sections populated from concepts by expectation, its Brief edited on the page and never saving what did not change, each claim citing its concept by a footnote labelled by the include; a concept's owner named per domain; the Knowledge screen's review table.

**Rests on.** ADR 0004 (guides and compositions are records citing concepts; readers are levels; no publish state); ADR 0014 (`guide_definition` and `section` as rows, `composition` with two homes and its includes as rows, versions only where a person edits text, owners per domain with a per-concept override at mint, `usage` for what leaves); ADR 0015 (one stored form, one editor, the footnote labelled by the include, rows own membership and markers own placement); ADR 0012's 27/08 amendment (the *edit* kind decided by the target's owner or an Admin); ADR 0026 (the Kinds list on Knowledge); ADR 0002 (the manifest's owner is the bundle's); `docs/okf-v02.md` (no owner key in the file). Words: *guide*, *guide definition*, *template*, *section*, *layer (of a section)*, *prompt*, *composition*, *include*, *expectation*, *citation marker*, *skeleton projection*, *needs review*, *version (of a record)*, *owner (of a concept)*, *usage*, *export*, *type vocabulary*, *context wording*.

**Builds on.** `composition` and `composition_include`, the cascade's second level and the footnote read (T-055); the governed write with the person as author (T-052); `open` by IRI; the concept index and `concept_identity`; the Knowledge screen routed.

**Must carry.** **`concept_owner`** (the addendum's second obligation) as the owner's answer above fixes it — a record by IRI, never a file key — un-gating ADR 0012's owner arm and closing T-054's Admin-only gate. The no-op save decided by round-trip equality and the paste matrix **(map 19, 57)**. The skeleton projection written into the company's repository, regenerated when the definition changes (ADR 0004). The copy artefact with resolvable footnotes and its `usage` row. The Kinds list with counts per kind and per domain, read off the concept index. `[UX1]` and `[UX2]` on the first screen that has actions, and `[A11Y1]`. Mutation findings **§2.6 entire**: the audience cascade driven by an `audience`-only and an `audienceGroups`-only move; the crash-window state on the concept half; three more lines in the concept-file grammar's refusal table; RFC 8785's key sort with an out-of-band digest; `JOB_IS_OVER` emptied; a person's queue act re-reading its membership; a revocation for a person id nobody holds.

**Edges.** Blocked by nothing on the route: B5 stands, and a section populates from concepts an Editor typed or C1 imports. Blocks S5 and S6.

**Absorbs.** No open task.

**Seam sketch.** The core guides slice's interface — definition, sections, the composition and its versions, includes, the no-op save, the owner record and the edit arm's decision, the skeleton projection against a real bare repository; the api harness for tRPC; the browser suite for the Knowledge screen and the guide page — the editor, the paste matrix, the keystrokes, the budget; the invisibility suite gains the audience-only cascade rows.

**Sources to re-read at `/to-spec`.** Tickets 34, 19, 57, 16, 56, 33, 14, 45, 46; research `what-a-product-service-guide-is.md`, `knowledge-answers-guides-separation-in-platforms.md`.

#### S4 · Website and SharePoint bindings

**Destination.** The first client's public website, bound per URL prefix, and a SharePoint library are enumerated, reviewed with a priced extraction plan, published and kept fresh on a cadence — S1's path for two connectors whose sources change.

**Rests on.** ADR 0013 (the roster upload · website · SharePoint · referenced · file share; cadence with a start-date floor; the extraction plan accepted once at review; a run that would reprocess more than a set share waits for re-acceptance); ADR 0036 (memoisation, stable ids, target sync with deletes, `mount_each`); ADR 0020 (findings on the enumeration sample at review); ADR 0025 (ceiling and price-drift signals); ADR 0024 (one index at a time; step A's swap-in signal); no JavaScript rendering in the website connector **(gate §3, Q11)**. Words: *connector*, *provider*, *extraction plan*, *extraction ceiling*, *run key*, *source document* with its `gone_at`, *retention class* (mirror), *citation repair*, *evidence*.

**Builds on.** S1's path end to end; the source catalogue every run reconciles; the runs slice; a Microsoft Graph credential as the binding's credential — distinct from Microsoft sign-in, which is P1's.

**Must carry.** The **estate-size probe** — a slim enumeration of the real site before any plan is priced, the one number every throughput and retention conclusion moves with **(gate §4 probe 4)**. The plan priced at review from measured rates; prototype 52's price was three times low **(map 52)**. `MAX_CONCURRENT_RUNS=1` measured as an onboarding queue on the first index **(gate §8, SCALE3)**. ADR 0024's step-A signal read on that index. Evidence outliving its source — `gone_at`, the grace period, citation repair as the platform's own suggestion kind (ADR 0013, 0014 amendments for DF5). The referenced source and the share agent stay written triggers, not built.

**Edges.** Blocked by S1. Blocks S7.

**Absorbs.** No open task.

**Seam sketch.** S1's cross-tier document test extended to a changing source — a fixture site served locally, a fake at the Graph API for SharePoint (a third party) — asserting the incremental run re-embeds one chunk on a one-line edit and lists a gone document's cited note only **(map 52)**; the worker pytest harness for the converter per provider; the core interface for the review and publish acts and the plan; the Sources screen through the browser suite.

**Sources to re-read at `/to-spec`.** Tickets 17, 48, 52, 53, 54, 55; the gate §3 Q11 and §4 probe 4.

#### S5 · Suggestions and the promotion gate

**Destination.** Every waiting suggestion decided from one queue — set summaries re-rendered on open, per-item outcomes, returned sets — an answer saved as an `Answer` through the promotion gate, a poisoned run reversed by run in one governed write, a stuck workspace put right by one ops command; the Suggestions screen.

**Rests on.** ADR 0012 (the inbox, acceptance as the governed write, the owner arm, a forward revert never a history rewrite, a commit the index refuses stops the replay); ADR 0017 (the promotion gate one at a time against the closest existing `Answer`; feedback's routing; correction; the answer test replayed retrieval-only); ADR 0016; ADR 0019 (a trim makes the decider the generator); ADR 0015 (markers become `sources[]` footnotes at the gate); ADR 0025 (reconciler hits as a signal). Words: *suggestion*, *inbox*, *concept write request*, *merge key*, *promotion*, *promotion gate*, *feedback*, *correction*, *answer test*, *candidate concept*, *watermark*, *head check*, *reconciler hit*.

**Builds on.** The inbox, acceptance, *returned* as a third outcome and per-item outcomes (T-054); the reconciler and `reconcile-watermark` (T-056); the head check every thirty seconds; S3's owner record; S2's answers to promote and to flag; the Suggestions screen routed.

**Must carry.** T-023's three lines as written, with the 7 September shapes that bind the screen — per-item results, *returned* with its reason, an Admin or the set's own proposer and nobody else may open a set. T-108 as written — the grill first, then one `pnpm ops` command at the `runOps` seam. The **by-run filter** on Knowledge that makes a poisoned set reversible in one governed write **(gate §8, failure-recovery F4)**. The promotion gate's three acts and the three-label judge; an uncited answer promoted as `status: draft`. Mutation findings **§2.5 entire**: the five undriven stop conditions; a replayed creation whose merge key another concept holds; `stopped: undefined` on an up-to-date run; the commit reader's forgery guards; `history-diverged`; a lost commit that dropped or swapped a citation landing Restricted; the per-repository lock registry's growth — fixed or accepted in writing (§3.1). §2.4's api reconciler operator line — counts asserted, three log levels, the `finally`, `stop()` **(placed here)**.

**Edges.** Blocked by S2 and S3; by S7 for the by-run filter and by V1 for the flag-to-request routing. The Suggestions screen (T-023) is blocked by S3 alone and is the block's natural first tracer bullet.

**Absorbs.** T-023, T-108.

**Seam sketch.** The core concepts slice's interface — the gate's acts, the by-run revert, the stuck-ref act, the replay's stop conditions forged commit by commit against a real bare repository; `runOps` for T-108's command and its refusal on an unstuck workspace; the api harness for the reconciler's operator line; the browser suite for the Suggestions screen — accept, decline, returned.

**Sources to re-read at `/to-spec`.** Tickets 15, 37, 59, 19, 50; T-006's spec and T-054's close-out notes.

#### S6 · Answering a question set

**Destination.** A bid document's questions extracted as a suggestion, confirmed in a table before any answer is drafted, answered as a background job streamed per question, out as a response-set document through the one renderer, recorded as one usage per response.

**Rests on.** ADR 0016's consequence on the question set and its 27/08 amendment (the web's background job; the MCP `ask` entry links to it; a `.docx` with real footnotes beyond v0.1); ADR 0014 (`question_set` and `question` as rows; a response is a composition's second home; usage); ADR 0017 (each response is an answer-audit row; the promotion gate's candidate); ADR 0004 and 0015. Words: *question set*, *response*, *usage*, *composition*, *prompt*, *deferred principal*.

**Builds on.** S2's answer path and contract; S3's composition primitive and renderer; the queue.

**Must carry.** The question set confirmed by the person before any response is drafted; never a source and never company knowledge; unanswered questions sorted to the top; the response-set document as one `usage` row per response, never an export; the **deferred principal**'s first use — work that outlives a session runs under a named person's borrowed authority that expires with it (`CONTEXT.md`, *principal*; `[SEC2]`) — and, with it, the block spec's decision on **which tier runs the job**: the answer path is the app's and the queue is the worker's, and ADR 0005's control plane is rows **(placed here, for the block spec to settle)**.

**Edges.** Blocked by S2 and S3. Blocks C1.

**Absorbs.** No open task.

**Seam sketch.** The core interface — extraction to a suggestion, confirmation, the job, the responses, the document; the api harness for tRPC's stream per question; the browser suite for the question-set page, a reader surface beside Control Centre, with its budget.

**Sources to re-read at `/to-spec`.** Tickets 47 (Q10), 20, 58, 16; ADR 0016's question-set consequence.

#### S7 · The producer — extraction and enrichment

**Destination.** A run over a published binding extracts candidate concepts within the accepted plan and the ceiling, fills the inbox as one suggestion set whose summary names the kinds it introduces, raises conflicts and never edits a body in place; an Admin renames or merges a kind by one bulk commit.

**Rests on.** ADR 0011 (the minting rule; the graph derives from sources as source entities that are never concepts); ADR 0013 (a targeted binding extracts on every run within the ceiling); ADR 0026 (kinds emerge, folded for case and plural; the Kinds list's rename re-keys identity; alias merges proposed for confirmation; a link is the relation); ADR 0012 (a run may enrich its own candidates before submitting; nothing enters without acceptance); ADR 0020 (redaction before any route; a `Person` minted only from a Public source); ADR 0019 (`generated.by`; verifier ≠ generator); ADR 0014 (the `conflict` family); ADR 0025 (`llm_call`; the ceiling's signals); ADR 0036; `[OKF1]` and `[OKF2]` (written for the file). Words: *producer*, *candidate concept*, *extraction template*, *extraction plan*, *extraction ceiling*, *conflict*, *company language*, *kind*, *Term*, *Also known as*, *merge key*, *entity merge*, *source entity*.

**Builds on.** The inbox and the `concept_write_request` contract (T-054); the kind fold at write; S4's runs and catalogue; S2's model client, route record and `llm_call`.

**Must carry.** The ceiling with a hard stop naming who can raise it. Nothing minted from a search snippet; the website supplies the entity skeleton and the bid library the properties **(map 44)**. The extraction target — augment sources, mint new, raise conflicts, never edit a body or status in place, splits as supersession, alias merges proposed **(map 44, 46)**. The Kinds list's bulk rename and merge as one governed commit (ADR 0026). The enrichment agent never holds connector credentials — injected per run **(map 38)**. The summary naming new kinds and the count per kind. Conflicts recorded, never resolved by the pipeline. The graph's source-entity partition ships with the destination axis; the meeting-notes use case does not **(map 53)**. The extraction template per document kind, versioned, Hyper-Extract's YAML as the format **(map 53, 30)**.

**Edges.** Blocked by S4 and by S2's model client. Blocks S5 and V1.

**Absorbs.** No open task.

**Seam sketch.** The worker pytest harness with the Messages-API fake for extraction calls; S1's cross-tier document test extended — a run fills the inbox, an Admin accepts, the concept lands with its evidence, asserted from the app; the core interface for the Kinds rename; `contracts/`' existing `concept_write_request` agreement; the Knowledge screen's Kinds list through the browser suite.

**Sources to re-read at `/to-spec`.** Tickets 44, 30, 50, 76, 53, 46, 14; research `ontology-pipeline-and-extraction.md`, `website-enrichment-view.md`; the map's *OKF enrichment phase* entry, now placed.

#### P1 · People — the People screen and Microsoft sign-in

**Destination.** A workspace Admin lists members, changes roles, invites, removes and revokes in this workspace; groups with counts; a person on Microsoft 365 signs in with Microsoft on an exact invited-email match; a person mints a personal token on their Account page.

**Rests on.** ADR 0009 (workspace Admins manage people through the organisation plugin alone; the identity seam lint-enforced); ADR 0034 (one origin; sign-in is an email code or Microsoft, never a password; the `sso` shape a written trigger); ADR 0035 (one person id; revocation per membership by an instant; a fresh sign-in mints anew); ADR 0038 (groups flat and Entra-aligned; access requests); ADR 0039 (groups as what an audience names); ADR 0018 (the personal token on an Account page); ADR 0022 (the ingress fences). Words: *role*, *group*, *access request*, *revoke credentials*, *sign-in*, *person id*, *Account page*, *personal token*, *client (connected)*.

**Builds on.** Groups and access requests (T-060, T-061); the ledger (T-059); revocation per membership (T-075); the members slice; the platform's own auth hooks (T-046); the shell and the picker (T-022, T-037); the consent page and the authorization server (T-004, T-045).

**Must carry.** T-027's fourteen lines as written — tRPC through the members slice with the invitation-accept exception, the external UI's blocks with *teams* renamed to *groups*, the per-role per-verb matrix, the sessions count. T-047's eight lines as written. The Account page and personal tokens (ADR 0018). Mutation findings **§2.1 entire** — the same-origin fence on `/consent` with `sec-fetch-dest: document`, a declined consent, the still-a-member check, the CIMD allow-lists, `/token` refused and the snapshot honest (§3.4), the roles' permission statements (a decision), `storeOTP: "hashed"`, the consent page's escaping — and **§2.3 entire** — the per-IP limits on `/oauth2/*`, `/.well-known/*` and `/jwks`, the email throttle's folding, the IPv6 anchors, `PUBLIC_URL` with credentials and `SMTP_URL`'s scheme, HEAD and POST to an unknown path, the shell shadowing an auth path, `/health`'s query, the bare-hostname sentence as a literal. §2.4's audit-outcome and `jti` row, and its failed-tRPC-procedure row **(placed here)**.

**Edges.** Blocked by nothing on the route — T-027's dependencies are done. Blocks P2 and C1.

**Absorbs.** T-027, T-047.

**Seam sketch.** The api harness against the plugin's own endpoints — the matrix, the revoked session, every open session refused in this workspace, the consent fences and the flood limits; the core members slice's interface; the browser suite for the People screen, the sign-in screen with a stubbed Microsoft callback, and the Account page.

**Sources to re-read at `/to-spec`.** T-063's, T-048's and T-045's specs; research `t-022-better-auth-admin-plugin.md` §6; the identity grill of 05/09.

#### P2 · The platform console

**Destination.** The operator provisions a workspace and its first membership by one command, lists users across workspaces, revokes credentials everywhere and inspects sessions, with Better Auth's admin plugin reduced to what ADR 0009 permits; workspace-less acts leave the log for an identity-set ledger, or ADR 0009 says by date why not yet.

**Rests on.** ADR 0009 (the admin plugin refused as shipped; one cross-workspace read kept; the operator a third principal kind); ADR 0035 (revoke everywhere by an instant on the person); ADR 0038 (workspace-less acts stay log lines until the identity-set ledger; provisioning is a platform act in the workspace it creates); ADR 0020 (remove-user hard-deletes, so it is disabled); ADR 0014. Words: *operator*, *revoke credentials* (everywhere), *workspace* (provisioned by the platform, never a person), *platform principal*.

**Builds on.** `provisionWorkspace` under the platform principal; `revokeCredentials`; the `runOps` seam; the ledger; the shell.

**Must carry.** T-028's eight lines as written — `provision-workspace` at the `runOps` seam beside `replay-erasures`; first membership as an owned act; the disabled paths proven refused; the identity-set ledger or a dated deferral. §2.4's platform-actor-id row **(placed here)**.

**Edges.** Blocked by P1. Blocks C1 — the provisioning act and first membership only; the console's screens are not a release gate.

**Absorbs.** T-028.

**Seam sketch.** `runOps` for provisioning and its refusals; the api harness for the disabled paths, the one list, and revoke-everywhere across two workspaces; the browser suite for the console.

**Sources to re-read at `/to-spec`.** T-063's spec; research `t-022-better-auth-admin-plugin.md`; the identity grill Q3, Q15.

#### O1 · Signals, System's cards, `backup_run` and `platform_event`

**Destination.** System's eight cards over real rows — the worker heartbeat's host figures, the drill's `backup_run` written to production, `platform_event` alerting once and cleared, `llm_call` spend, thresholds as config rows an Admin changes — and the three channels each telling what only it can see.

**Rests on.** ADR 0025 (a signal is a query over rows the platform already keeps; eight cards in order; thresholds as config rows; alert-once; retention; the exporter key empty); ADR 0022 (the drill; `backup_run` written to production, A13); ADR 0024 (step A's signal); ADR 0017 (the thinning job); ADR 0014 (`platform_event`, `backup_run`, `worker_instance`); ADR 0009 (connected clients as cached metadata rows). Words: *signal*, *alert*, *backup run*, *restore drill*, *dead-man ping*, *client (connected)*, *release*.

**Builds on.** System's routes card (T-022); the worker heartbeat; healthchecks and the second alert channel (T-005); the release row; `pnpm ops smoke`; the drill scripts; `llm_call` from S2.

**Must carry.** **A13** — the drill's `backup_run` row written to production, the only source of the *last drill* signal **(gate §2)**. The 41-signal catalogue moved into one module's table, thresholds as rows **(map 42, ADR 0025)**. Alert once, cleared once. The LMDB-size signal and `double_claim` read from S1's rows; step A's swap-in signal from S4's first index. Retention as ADR 0025 sets it and the thinning job's own lag as a signal. §2.4's `pnpm ops smoke` row — each check forced wrong in turn **(placed here)**.

**Edges.** Blocked by nothing for its own tables; each card lands as the rows it reads exist, so the block completes after S2. Blocks C1: no client release without Control Centre **(map 15, D5)**.

**Absorbs.** No open task.

**Seam sketch.** The core interface for signals as queries over seeded rows with thresholds as rows; the drill scripts and `runOps` writing `backup_run`; the api harness for the email channel against a captured transport; the browser suite for the System screen.

**Sources to re-read at `/to-spec`.** Ticket 42 and briefing 42 §2; the gate §2 A13, §7 B4.

#### V1 · Verification, freshness and conflicts

**Destination.** A reader's flag or the review cadence raises a verification request in the owner's queue; a check moves trust and only a check does; shelf life and *changed since checked* are told in fixed words; a conflict is resolved by a person in one of four ways, each a governed write.

**Rests on.** ADR 0019 (trust derived from the file; verifier ≠ generator; the two riders; imported checks; supersession by the successor's `sources[]`); ADR 0014 (`verification`, `verification_request`, `conflict` families; `evidence_check`); ADR 0017 (a flag becomes a request or an edit suggestion); ADR 0040 (the Clock decides a `stale_after` read); ADR 0012 (citation repair). Words: *verify (a concept)*, *changed since checked*, *verification*, *verification request*, *review cadence*, *shelf life*, *conflict*, *actor alias*, *evidence pane*.

**Builds on.** `concept_verification`, the trust reading and the Clock (T-104, T-111); the trust words; the shelf-life read; the ledger; the Knowledge screen from S3.

**Must carry.** Verifier ≠ generator on the producer part. The four resolutions — supersede, deprecate, split by tier, dismiss — each the governed write it makes. The cadence per kind as a workspace setting with platform defaults, the cadence requests batched into the weekly digest. *Source moved on* from `evidence_check`; *imported* through an actor alias. A conflict raised by a run arrives with S7; the resolution is tested on a seeded conflict until then. Mutation findings: none.

**Edges.** Blocked by S2 (a flag on an answer). Blocks S5.

**Absorbs.** No open task (T-111 is done).

**Seam sketch.** The core interface — a check, a request, a resolution, every act a ledger row and a commit where it changes a file, the shelf-life read at a literal instant; the browser suite for Knowledge's saved filters and the guide page's badge and evidence pane.

**Sources to re-read at `/to-spec`.** Tickets 23, 16, 37; ADR 0019's amendment trail.

#### C1 · First-client onboarding

**Destination.** The first client's workspace provisioned, its people invited, its four bid libraries landed as `Answer` concepts through one normalising pass with their contradictions as conflicts, its website bound and enumerated, its guides seeded from templates, and the DPIA written from the platform's own input before the first real binding is published.

**Rests on.** ADR 0004 (Q&A pairs are `Answer` concepts); ADR 0011; ADR 0020 (the DPIA input, the sub-processor list, the four lawyer's questions); ADR 0027 (the hosted service is the product); ADR 0022 (the first drill before any client data — done). Words: *Q&A pair*, *template*, *platform bundle*, *domain*, *conflict*.

**Builds on.** Every block above.

**Must carry.** The four libraries — 232 entries and 89 variants — as `Answer` concepts, the variants as context wordings, one normalising pass; the 23 cross-file contradictions as conflicts; the PSC and bank data inline proving S0's seam on real material **(map 06)**. The platform bundle seeded into the repository as the first act (`CONTEXT.md`). The training-attendee list never bundle content **(map 44)**. The lawyer's four questions answered outside the repository before publish. The estate-size number recorded.

**Edges.** Blocked by S5, S6, P1, P2's provisioning act, O1, and S0 for the DPIA.

**Absorbs.** No open task.

**Seam sketch.** No new seam: the import is a governed write per concept through the core interface, rehearsed on staging with the synthetic seed, then run against production by the operator.

**Sources to re-read at `/to-spec`.** Tickets 06, 47, 63; research `first-client-content-inventory.md`.

### The hygiene lane

Off the route, one ordna task each, tagged `hygiene`: T-014, T-017, T-110; the T-106/T-107 remainder (nightlies 2 and 3; the summary's pairing fix and one clean nightly); the probe script's timed-out-versus-failed verdict (findings §1); the dead-guard clusters, each with whichever block next touches the file (§3.2); the `parseSince` docblock against its anchor (§3.3); the `blankedSpans` complexity property named (§3.6); the four self-referential oracles (§4). T-109 and T-111 are done.

## Testing Decisions

A good test drives external behaviour through the interface a caller uses and asserts what that caller can observe — commits, rows, refusals, invisibility, a passage, a screen — never internals (`[TEST1]`, `[DESIGN2]`). Real Postgres always (`[TEST2]`); our own code never mocked (`[TEST3]`); setup through factories (`[TEST4]`); a pair checked both ways (`[TEST7]`); an expected value written down (`[TEST9]`). A block's functional tests are named at its `/to-spec`, before a line is written, and every mutation finding a block carries is a runtime test in that block's acceptance criteria.

The seams, agreed 09/09/2026 — seven that exist and one new:

1. **The core slice interface** over real Postgres and, where a block writes the bundle, a real bare repository (prior art: the concepts, workspaces and members suites). Every block's acts and refusals.
2. **The api HTTP harness** for the MCP surface, tRPC and the authorization server (prior art: the MCP, oauth-flow and ops suites). Every block whose surface is a transport.
3. **The browser suite** over a served build, one spec per screen a block lands, with its ADR 0037 budget and the accessibility gate (prior art: the routes and picker specs; the browser-suite skill).
4. **The worker pytest harness** (prior art: the tier-contract, pg-harness and rebuild suites). S0's detector, S1's and S4's pipeline steps, S7's extraction.
5. **`contracts/` conformance**, both tiers' suites reading the same fixture; a fixture on disk but not in the manifest fails both (prior art: the eight agreements). S1 adds the first document-shaped agreement.
6. **The `runOps` seam** — *done · refused · not built* (prior art: the ops suite). S0's two commands, S5's stuck-ref command, P2's provisioning.
7. **Rebuild-equivalence, cross-tier and live** (T-057) — the enforceable meaning of *derived, never a source of truth*; every block that touches the graph keeps it green.
8. **The document-shaped cross-tier test** — new, S1's: the app's acts, the worker as a real process, the app's read; no fixture between the tiers. S4 and S7 extend it rather than adding a seam.

One third-party double on the route: a fetch-shaped fake at the Messages API for S2's model client, reused by S7. A SharePoint fake at the Graph API in S4 is the second, for the same reason.

## Out of Scope

- **The bids-and-proposals stage** (`docs/vision.md`, *Next*): opportunities, versioned packs, question sets with constraints and dependencies, submissions, outcomes, the outcome loop's opportunity records, bid portals, reference question sets. The knowledge-side contract they consume is fixed by S5 and S6.
- **The *Then* and *Later* stages**: renewal packs, intelligence feeds as sources, take-action in connected systems, proposals and prospecting, meeting notes, support-ticket sentiment, marketing, development documentation, the customer-hosted worker and deployment.
- **Referenced sources and the share agent** (ADR 0013; ticket 53) — the axis and the `/agent/v1` contract exist; the agent is built for the first on-prem client. HubSpot and Asana connectors stay dark.
- **Agent surfaces beyond the four read entries**: `act:*` scopes, Agent Auth, the approval layer, pinchtab, MCP Apps, the packaged client-side plugin; *MCP as the way in*.
- **Imported and vendor bundles**; the class-filtered bundle export; a read-only clone endpoint; scheduled exports to a client's store.
- **A `.docx` response set with real footnotes**; JavaScript-rendered pages in the website connector **(gate §3, Q11)**; local embedding on the first estate (ADR 0024's precondition); a metrics store, SLOs, tracing, a status page.
- **Ontology curation beyond the Kinds list** — lock, drift, alignment, reasoning — until a client asks.
- **Multi-process repository locking**, a second api process, a resize of the estate.
- Tagline and positioning copy; trade-mark work.

## Further Notes

- **The next session** takes S0 and S1 together to `/to-spec` as the first block spec — one session, about T-006's size — after the bounded review below has answered its second question. Each later block spec is one session and yields roughly five tickets.
- **A bounded architecture review follows this document**, so it has a question: *is what is built the right base for S0 to S7?* Four things have never been reviewed and matter for those blocks — the write path, the graph door and the synchronous cascade under the read load S2 puts on them; the worker's shape as a host for a composed cocoindex pipeline (ADR 0036), before any of it is added; whether the three stub slices' docblocks (sources, guides, answering) claim the right tables and seams for S1 to S3; whether the substrate's twenty-two migrations are the right base for the roughly twenty-two record families still missing from ADR 0014's thirty-seven. Run it as pass 2 was run — independent lenses, each briefed with this document's blocks, none reading another's report; the pass-2 brief is the template. Not repeated: the identity seam, the rules, test quality. The Cubic wiki is the reviewers' orientation and is never cited.
- **The staleness seed list** — tickets known to be overtaken in the specific, found while reading for the review; a block's `/to-spec` reads its own citations against this table first: 39 and 73 (graph engine) by ADR 0032, ADR 0023's write model standing; 21 (MCP surface) by ADR 0018 A26 four entries, A18 the token is `{workspace, user}`, ADR 0034 `mcp.` collapsed into `app.`; 41 and 22 (hostnames, staging, Cloudflare) by ADR 0022's amendments — three hostnames, staging on demand, Cloudflare Pro deferred; 23 and 24 (actor ids, the erasure target) by ADR 0035 — `human:<person id>`, the erasure pseudonym; 16 and 37 (audit partitioning, `team`) by ADR 0038; 17 and 51 (one `audience` column) by ADR 0039; 15 and 74 (Forgejo) by ADR 0024 — bare repositories under `GIT_STORE_DIR`; 13 (tree layout) by ADRs 0029 and 0031; the gate's §7 — B6 void, the worker's role the loop, the auditor and the rebuild, B10 dissolved.
- **What this document is not.** It is never ticketed and never a spec a builder codes from; a block spec is. It holds no decision the ADRs and the glossary do not — where it appears to, the marker says whose claim it is and the block spec settles it. It is edited when a block's status changes, when a block spec moves an edge, or when an ADR overtakes a claim here; the edit names the date and the source.
- **Two owed facts outside the repository** ride with C1: the first client's estate size (the gate's one open probe) and the lawyer's four questions (ADR 0020).

## Status — the frontier

*Status words: **unspecced** (this page only) · **specced** (a block spec exists) · **ticketed** (its tracer bullets are on the board) · **building** · **done**. A product session opens this table, picks the first block whose edges are all done and whose status is unspecced, and takes it to `/to-spec`. Updated in the same commit as the change it records.*

| Block | Destination in a line | Blocked by | Absorbs | v0.1 release gate | Status | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| **S0** | Personal data withheld at the seam; erasure truthful; the drill fully green | — | — | yes | unspecced — **next, with S1** | — |
| **S1** | One uploaded document to a cited passage; the Sources screen | S0; the bounded review's worker-host verdict | T-029, T-082 | yes | unspecced — **next, with S0** | — |
| **S2** | Ask answers cited or refuses honestly; the model client; the Questions screen | S1 | — | yes | unspecced | — |
| **S3** | A guide section populated and edited; `concept_owner`; the Knowledge screen | — | — | yes | unspecced | — |
| **S4** | Website and SharePoint bindings on a cadence with a priced plan | S1 | — | yes | unspecced | — |
| **S5** | Suggestions decided, the promotion gate, the by-run revert, the stuck-ref act; the Suggestions screen | S2, S3; S7, V1 for two lines | T-023, T-108 | yes | unspecced | — |
| **S6** | A question set answered as a job, out as a response-set document | S2, S3 | — | yes | unspecced | — |
| **S7** | The producer fills the inbox within the plan and the ceiling; the Kinds rename | S4, S2 | — | yes | unspecced | — |
| **P1** | The People screen, Microsoft sign-in, the Account page | — | T-027, T-047 | yes | unspecced | — |
| **P2** | The platform console; provisioning and first membership | P1 | T-028 | provisioning only | unspecced | — |
| **O1** | Signals, System's eight cards, `backup_run`, `platform_event` | — (cards land as rows exist) | — | yes | unspecced | — |
| **V1** | Verification requests, cadence, shelf life, conflicts resolved | S2 | — | yes | unspecced | — |
| **C1** | First-client onboarding | S5, S6, P1, P2 (provisioning), O1, S0 | — | yes | unspecced | — |
| Hygiene | Off the route | — | T-014, T-017, T-110, T-106/T-107 remainder | no | open | — |
