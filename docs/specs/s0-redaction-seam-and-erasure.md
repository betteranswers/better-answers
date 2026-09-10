# S0 — The redaction seam and erasure

*Block spec written 10 September 2026 from the route spec's S0 block (`docs/specs/v01-route.md`), ADRs 0012, 0013, 0014, 0019, 0020, 0022, 0024, 0035, 0036, 0038 and 0039 through `docs/adr/README.md`, `CONTEXT.md`, the tree at `529e824`, discovery tickets 24 and 63, research 65 (`pii-detection-candidates.md`), the pre-build gate's §4 probe 1, T-113's worker-host findings F2 and F4 and record-families verdict 4, and probe 4 of 10/09/2026. The staleness pass over the sources the block cites is in Further Notes. Decisions recorded here are taken; do not re-open them. S1 is specced beside this block and the boundary between the two is stated in Further Notes.*

**The authority order** of the route spec binds this document: `docs/adr/README.md` · the ADR body with its amendments · `CONTEXT.md` · the tree · this spec · the gate · the map · a ticket body. This spec cites the first four for *what* and the rest for *why*.

## Problem Statement

A bid writer at the first client is about to bind the company's most useful file — and it carries a director's date of birth, a home address, a bank sort code and account number, a personal email and the DPO's phone number, flagged only by a "⚠️ SENSITIVE DATA" line. If the platform ingests it as it stands, those values reach four stores and, later, a model. If the platform quarantines it, the file the product exists to make useful is the one file it will not touch. Nothing between those two exists today: the worker's conversion step has no seam, no finding is ever recorded, and no binding carries a rule about what to withhold.

A person who has left the company, or who never worked there but is named in its files, can ask for their data to leave the platform. Today the platform cannot say what it would do. The erasure slice is an empty export. `pnpm ops replay-erasures` refuses the moment an `erasure_request` table exists, so a restore over a schema that could hold erasures cannot turn healthy; `erasure-rehearsal` answers *not built*; the quarterly rehearsal step in the restore drill records that line and moves on. The DPIA the first client's onboarding requires names categories of personal data — actor ids in files, `Person` concepts, the per-binding memo store, authored concept bodies — with no mechanism behind any of them.

## Solution

One seam in the worker and one routine in the app, with the records between them. The **redaction seam** is a deep module the worker calls on every span of normalised text before any store: it returns redacted text and findings, versioned by rule version and detector pin, taking the binding's rules in force and the applicable suppressions as arguments, so that when S1 wraps it inside the one memoised function no memo ever holds an unredacted value. The three tiers of redaction rule, the officer-block rule and the special-category narrowing are the seam's; reviewing what it found is the app's. Four record families land as four migrations — `finding`, `suppression`, `subject_request`, `erasure_request` — and the **erasure slice** fills in: a valid erasure request mints a per-workspace pseudonym, rewrites every actor id the platform wrote across the workspace's files and history, re-hashes the checks that moved, pseudonymises the user row on the person's last membership, re-derives the map, and writes a report in the fixed words ADR 0020 gives it, under `pg_advisory_lock(41)` so no dump is taken while it runs. The two ops commands answer *done*: `replay-erasures` re-applies every erasure completed after a dump before `api` turns healthy, and `erasure-rehearsal` runs the routine on a synthetic subject so every third drill proves the subject is in the copy taken before and gone from every live store after. The DPIA input gains its shape per binding and its hash, ready for S1's publish act. No screen lands: the People screen's erasure and suppression section is P1's, over this block's rows.

## User Stories

### The Admin — a bid writer, not a DPO

1. As an Admin, I want a document that carries a sort code, a date of birth or a home address to be ingested whole with those spans withheld, so that the useful file is searchable and the values never reach a store.
2. As an Admin, I want the safe set to be what I get by doing nothing — the always set withheld on every binding, the default-on set withheld unless I switch it off — so that I do not need to know data-protection law to bind a source safely.
3. As an Admin, I want a finding counted by category on the document — bank details, date of birth, home address, personal contact, special category — never the value itself, so that reviewing findings does not itself spread the data.
4. As an Admin, I want to restore one span of the always set with a reason when it is a business fact — a company's own bank details on a supplier form — so that policy does not blind the platform to what the company publishes anyway.
5. As an Admin, I want a document with a special-category finding to land Restricted whatever its binding's class, so that health-shaped content is never widened by accident.
6. As an Admin, I want a person's name to pass through untouched on an ordinary binding and to become a stable `[person A]` on a meeting-note, support-ticket or HR-shaped one, so that a capability statement still names its ISO lead and a meeting note still reads.
7. As an Admin, I want a name inside a PSC or officers block withheld with its block whatever the binding's rule, so that a filing's officer list is never indexed as named people.
8. As an Admin, I want a per-binding DPIA input — types of personal data, scope, class, rules in force, routes with processor, country and retention tail, retention class, audience — and its hash, so that the publish act can carry what I confirmed and a later reader can prove what the platform stated on that day.
9. As an Admin, I want to record a subject's erasure request on their behalf with the one-month clock started, so that the request is a fact the ledger keeps and the due date is not a diary entry.
10. As an Admin, I want the erasure report to say exactly what was done in every store and to list the names inside concept bodies for me to edit, so that I know what the routine rewrote and what is mine to change.
11. As an Admin, I want the report's wording never to imply total erasure, so that I do not promise a subject something the platform did not do.

### The person whose data the company holds

12. As a person named in the company's files, I want a valid erasure request to rewrite every actor id the platform wrote about me — in files, across history, in author lines, in commit and verification rows — so that the platform's own records stop naming me.
13. As a person who checked concepts before leaving, I want my checks to stand under the erasure pseudonym rather than vanish, so that the company's knowledge stays as trustworthy as it was without carrying my address.
14. As a person who belongs to two client workspaces, I want an erasure in one to mint a pseudonym that cannot be joined to the other's, so that two companies' rewritten histories never identify me together.
15. As a person who belongs to two client workspaces, I want an erasure in one to leave my sign-in to the other standing, so that one company's routine does not act for another.
16. As a person erased from their last workspace, I want my user row pseudonymised — email to a tombstone, name cleared, id kept — and my sessions, verification codes, invitations and linked accounts gone, so that the identity set holds nothing that names me while the ledger's references still resolve.
17. As a person making an access request, I want the same per-store finder that erasure uses to list where the platform holds me, so that the answer is complete rather than remembered.
18. As a person who asked for erasure, I want to be told that backup copies taken before the last dump are beyond use and when each tier expires, so that "gone" has dates.
19. As a person who asked for erasure, I want a later subject request about what was rewritten to still be answerable from the pseudonym the request keeps, so that the routine does not destroy the evidence of itself.

### The Editor and the Viewer

20. As an Editor, I want the placeholder words to be the glossary's — `[withheld]`, `[home address withheld]`, `[person A]` — so that I read one vocabulary in the app and over MCP alike.
21. As a Viewer inside a Restricted document's audience, I want to see the placeholders wearing *Restricted* and never the value, so that access to a document is not access to the personal data it carried.
22. As a Viewer, I want a redacted document's text to be what the index holds, so that nothing a search shows can ever be more than the seam let through.

### A person working from Claude

23. As a person reading over MCP, I want an unmapped passage of a document to carry the same placeholders the app shows, so that the connector is not a side door around the seam.

### The operator and the owner

24. As the operator restoring from a dump, I want `replay-erasures --since` to re-apply every erasure completed after that dump, reading both the restored rows and the copy each completed request left in the object store, so that "beyond use" is honest when a copy is restored.
25. As the operator restoring from a dump, I want the replay to run after the object store and the git store are back and before `api` is up, so that a rewrite has a repository to rewrite.
26. As the operator, I want the replay to refuse and stop the restore when a request cannot be re-applied, so that the platform never serves reads over data a subject was told is beyond use.
27. As the operator, I want the hourly dump to wait while the routine holds `pg_advisory_lock(41)`, so that no dump captures a half-rewritten workspace.
28. As the operator, I want every third drill to seed a synthetic subject, dump, run the routine, dump again, and grep both dumps and the bare repository for the subject's tokens, so that the drill proves *present before · absent after* rather than assuming it.
29. As the operator, I want the erasure rehearsal's report to have the same shape as a real erasure report, so that the quarterly rehearsal rehearses the document a subject would receive.
30. As the operator, I want the routine's git step to leave no reachable object for the old history on the bare repository, so that a clone after the routine cannot recover the email.
31. As the operator, I want the mirror on VPC 2 replaced by the next `--mirror` push and pruned there, so that the second copy follows the first within the report's first date.
32. As the owner, I want the detector's cost per page recorded on the fixture with the date and machine class, so that S1's timeout budget rests on a number.
33. As the owner, I want the four questions owed to a lawyer recorded as owed and never answered by this block, so that a legal sentence is not written by an engineer.
34. As the owner, I want every DPIA category the platform holds — `human:<email>` in files, the `Person` concept, the per-binding LMDB, authored concept bodies — named in the DPIA input whether or not a binding carries it, so that the input states what the platform does, not what a binding hopes.
35. As the owner, I want the embedding route and Mistral absent from every DPIA input until the day a workspace's embedding route is first called, so that the listing never precedes the processing.

### The platform acting as itself

36. As the platform running the erasure routine, I want to act under `process:better-answers-erasure` with every act audited under that id, so that a rewrite is never booked to a person.
37. As the platform, I want the routine to be idempotent — a second run over the same request finds nothing left to rewrite and writes nothing new — so that the replay on restore can run it again without a branch.
38. As the platform's reconciler, I want the rewritten history to leave `bundle_commit` pointing at the new hashes with the watermark consistent, so that a rewrite is never mistaken for a crash window.
39. As the platform, I want a `full-rebuild` job with reason *erasure* enqueued by the routine, so that the map is re-derived from the rewritten bundle as a new generation and flipped in one row update.

### The builder and the reviewer

40. As a builder, I want the seam to take and return plain types and to import no cocoindex, with the ban enforced by lint, so that S1 can wrap it inside the one memoised function and nothing beneath is ever memoised.
41. As a builder, I want every fixture span asserted back against the text by offset, so that the detector's offsets are proven, not trusted.
42. As a builder, I want the category list, the placeholder words and the version string's shape pinned in one `contracts/` fixture both tiers read, so that the worker writing `[withheld]` and the app showing it cannot drift.
43. As a builder, I want each of the four record families to be one migration with its zero-rows test and its grant refusals, so that verdict 4 of T-113 holds and `[SEC3]` is met table by table.
44. As a builder, I want the erasure map to be an exhaustive typed union over every store family that holds text, so that a family added later without a finder fails the type check rather than the subject.
45. As a reviewer, I want the ADR 0020 and ADR 0022 amendments this block needs in the same PRs as the code with the index rows updated, so that the live conclusions are never stale.
46. As a reviewer, I want the report's wording pinned by a literal in the test, so that a changed sentence is a failed test and never a quiet rewording of a promise.

## Implementation Decisions

### The seam — a deep module in the worker

- One module in the worker, named for the glossary's word (*redaction*), with one public function: it takes the normalised text of one document, the binding's **rules in force**, the applicable **suppressions** for that document, and a per-binding seed for stable name pseudonyms; it returns the redacted text, the list of **findings** (category · rule tier · rule id · offsets into the normalised text · detector score), the counts by category, the **narrowing verdict** (Restricted when a special-category finding is present), and the **version string** `rule_version:detector_pin`. Plain types in, plain types out (`[PIPE1]`). It memoises nothing and reads nothing but its arguments.
- **The memoised function is S1's; this module is what it wraps.** T-113's F2 stands as S1's acceptance line: conversion and this detector inside one `@coco.fn(memo=True)` whose return value is already redacted, versioned by this module's version string, with suppressions as an argument and never a `detect_change` key. S0's contribution is the shape that makes that possible, and a lint that keeps it so: a ruff `TID251` ban on `cocoindex` for the whole tier lands here (the mechanism the tier already uses for `unittest.mock`), and S1 lifts it for `pipeline/` alone by per-file ignore.
- **The detector** is what ADR 0020 fixes: Presidio's analyzer and anonymizer as the frame, GLiNER-PII as the NER inside it (the Presidio recogniser, CPU, `urchade/gliner_multi_pii-v1` first with `knowledgator/gliner-pii-base-v1.0` measured on the fixture), spaCy's small English pipeline for tokenisation and lemmas only with its own NER recogniser removed, the phone recogniser restricted to GB and US, and the six recognisers of ours: sort code with account number in context; date of birth in context (a bare date is never redacted — bid libraries are full of dates); the health cue list flagging the sentence as a special-category finding; the UK address promoting a postcode when a street pattern precedes it; the officer-block post-pass; the entity-to-category mapping table. Every version is a `[DEPS1]` pin read on the day of the change and one exported constant (`[DEPS2]`); the model weights are fetched at image build under the `HF_HOME` the compose file already sets, never at run time; the worker image's contents test (T-084) grows to assert the packages and the weights are present and no development dependency rode in.
- **The three tiers** are the glossary's. *Always* — special-category cues at sentence level, financial account identifiers, government identifiers — is policy: no binding switches it off, and the placeholder is one neutral `[withheld]` because a typed placeholder for the always set would tell the audience what class of data exists. *Default on* per binding — dates of birth, home addresses, personal contact on a consumer-domain list — with typed placeholders. *Default off* per binding — person names as a stable `[person A]` and job titles — seeded on for meeting-note, support-ticket and HR-shaped bindings. The officer-block rule always wins. Special category is never inferred by a prompt.
- **Rules in force live on the binding.** `source_binding` gains the rules in force as a column whose default is the safe set (always on, default-on on, default-off off); the shape-based seeding for HR-shaped bindings is a default the binding-management surface applies when it lands (S1 for upload, S4 for the connectors). The seam reads the column's value as an argument and never the binding.
- **Versioning.** `rule_version` is one exported constant in the worker bumped whenever a rule, the mapping table or a recogniser changes; `detector_pin` is derived from the pinned package versions and the model id. Both ride on every finding row and, from S1, on the document. A re-detection re-baselines the evidence resting on it as a platform act and never raises *source moved on* — so the document's `content_hash` stays the hash of the original normalised text computed before the seam (a hash holds no value), and the redacted text carries the version string beside it; the columns S1 lands follow this.
- **Offsets are proven.** Every fixture span is asserted back against the text by offset — the answer to research 65's open question 2 (Presidio's 64 % round-trip pass rate). The fixture is **synthetic**, shaped after the first client's eight flagged spans (PSC date of birth, home addresses, sort code with account number, personal emails, the DPO's phone) and prototype 52's health note, and never the client's text: the repository is public (ADR 0027) and staging holds nothing real.
- **A measurement, not a budget.** Milliseconds per page on the fixture for both GLiNER models, on the worker image, recorded in the test's docblock with the date and machine class as T-006's budget test records its number. S1 sets the seam's timeout from it.

### The tier boundary

- The detector runs in the worker; the review of findings and the erasure request are the app's (the 9 September review's C4, confirmed here). Findings are rows the worker writes — the `finding` table is founded here with `worker_rt` granted INSERT and its refusal tested (`[SEC3]`); the first writer is S1's `index` job. The app never runs the detector; the worker never reviews a finding.
- **One new fixtured agreement in `contracts/`, `redaction`**: the category list, the placeholder word per tier and category, the special-category → Restricted rule, and the version string's shape. Both tiers' suites read it; a fixture on disk but not in the manifest fails both; `contract_version` bumps. The chunker's body-only rule is unchanged and stays where it is.

### The record families — four migrations

Verdict 4 of T-113: a family is one migration, nothing re-keys. Every table is a tenant table under `withRLS()` with its zero-rows test, a generated boundary schema with its parity test (ADR 0028), and a row in the table-ownership map.

- **`finding`** — owned by the `sources` slice. One row per span per document: the document, the category, the rule tier and rule id, the offsets, the score, `rule_version`, `detector_pin`, the review state (*unreviewed · kept in text · narrowed*, each with the acting Admin's actor id and reason where an act set it), and for the always set the restore — `restored_at`, the restoring Admin's actor id, the reason. It never holds the value. The worker inserts; the app reads and updates the review columns through the slice's acts.
- **`suppression`** — owned by the `erasure` slice. One row per document per erasure request: the identifiers to keep out on reprocess. It is restricted personal data itself — Admin-only read, in the erasure map, in every dump — and is applied per document by S1's reprocess, never as a binding-wide key.
- **`subject_request`** — owned by the `erasure` slice. The clock: kind ∈ *access · erasure*, the subject's person id, `received_at`, `due_at` one month on, `answered_at`, and the answer's text. The access arm answers from the per-store finder; the normalised text a graph-only binding keeps is S1's to add to that answer.
- **`erasure_request`** — owned by the `erasure` slice. Keyed to its subject request: the **erasure pseudonym**, the instant the lock was taken, the per-store actions and each outcome, the anchor and the four beyond-use dates, `completed_at`, and the report text. `VERIFICATION_ORIGINS` already carries `erasure-rewrite`; it is used from here.

### The acts on the ledger

Declared against the audit slice's template (`[AUDIT2]`), each landing with its rows in one transaction (`[AUDIT1]`), the detail carrying ids and role words and never an email or a name (`[AUDIT5]`):

- `sources.finding.restored` — an Admin restores one always-set span with a reason; refused for a non-Admin and for a finding outside the always set. The reprocess that lets the span back into the text is S1's, keyed on the finding.
- `people.subject_request.received` — an Admin records a subject's request; the subject is the detail's person id.
- `people.erasure.completed` — the routine's own event under `process:better-answers-erasure`, the second door's caller for a platform act (`[AUDIT4]`).
- `platform.erasure.replayed` and `platform.erasure.rehearsed` — the two ops commands' events under the same principal, in the platform family because a restore and a drill are the estate's acts.

The ledger is never rewritten (`[AUDIT3]`); the routine reaches files and never the ledger.

### The routine — the erasure slice, app tier

The slice sits at the top of the slice graph (ADR 0029 rule 4) and may import the others' interfaces. The routine runs under the platform principal, holds `pg_advisory_lock(41)` on its own session from first step to last so the hourly dump waits, and holds the per-repository lock through the git step. Its steps, in order:

1. **Mint the pseudonym** through the kernel's one minter and write it on the request. Never the person id (ADR 0035).
2. **Compute the erasure map** — the per-store finder over an **exhaustive typed union** of every store family that holds text about a person: concept files and their history (`generated.by`, `verified[].by`, git author lines), `bundle_commit` rows, verification rows, the identity set (the user row, sessions with IP and user agent, verification rows by identifier, invitations by email, linked accounts), and documents that mention the person (none until S1; the family is declared and its finder returns none). A family with no finder does not compile.
3. **The git step** on the bare repository: `git filter-repo` with a text replacement `human:<email>` → `human:<erasure pseudonym>` and a mailmap for author lines, then `git reflog expire --expire=now --all` and `git gc --prune=now`; the commit map filter-repo writes is read back and `bundle_commit` rows are rewritten old hash → new hash in the same transaction, so the head and the watermark agree and the reconciler finds nothing to replay. The api image gains `git-filter-repo` and the Python interpreter it needs, pinned (`[DEPS1]`): ADR 0020 fixes the tool, the app is the only writer (ADR 0012) and the worker holds no git credential (`[WRK1]`), so a dulwich rewrite in the worker is the recorded and rejected alternative.
4. **Re-hash the checks that moved**: every verification row whose file's canonical text changed is re-hashed under origin `erasure-rewrite`; the check stands and the hash moves, so *Checked by* never becomes *Changed since checked* because of an erasure.
5. **The identity set, on the person's last membership.** When the requesting workspace holds the person's only membership, the user row is pseudonymised — email to a unique tombstone, name cleared, id kept because ledger rows name it — and the person's sessions, verification rows, invitations and linked accounts are deleted, through the identity-write seam. When other memberships stand, this workspace's membership is ended and the identity set waits for the request that ends the last one; the report says which. This judgement is the platform principal's and is never shown to a workspace Admin, so it is not the cross-tenant oracle ADR 0035 rejected for revocation. *Decision taken here; owner may reverse — see Further Notes.*
6. **Suppressions** are written for every document the map found, per document, linked to the request.
7. **Re-derive**: a `full-rebuild` job with reason *erasure* is enqueued; for every binding the map found, the LMDB wipe is one act in order — the binding's chunk rows deleted in this transaction, the directory removed, an `index` job enqueued (ADR 0036, amended 2026-09-10; probe 4). No binding exists until S1; the step is present and finds none.
8. **The object store** is untouched: a company document that mentions a person is suppressed on reprocess, not deleted; documents that never reached git are suppressions, not a rewrite. The report says so.
9. **The report**, in the fixed words: the 30/08/2026 amendment's sentence on actor identifiers and names inside concept bodies, then the beyond-use paragraph with its four dates — 48 hours · 30 days · 8 weeks · 6 months from the anchor. **The anchor** is the instant the routine took the lock: the last dump precedes it, so dates from it are upper bounds on every copy's expiry; when O1 lands `backup_run`, the anchor becomes the last Postgres dump's stamp and the report says which anchor it used. Names inside concept bodies are listed by IRI for the owner to edit. Exports already issued are listed as not recalled — none exist. *The anchor is a decision taken here; see Further Notes.*
10. **The replay copy**: the completed request — workspace, subject person id, pseudonym, `completed_at`, the map — is written to the object store under a platform prefix, as the routine's last write. The nightly mirror carries it to the unlocked mirror bucket and a restore syncs it back before the replay runs. It holds the person id and the pseudonym and never an email or a name.
11. `completed_at` and the ledger event; the lock is released.

**Idempotent by construction.** A second run over the same request finds no `human:<email>` to replace, an already-tombstoned user row, nothing to prune, and the same pseudonym on the request; it writes a ledger event and nothing else. The replay relies on this and has no branch.

**The mirror.** The backup service's nightly `git push --mirror` replaces the mirror's refs with the rewritten history; the same job runs `git reflog expire --expire=now --all` and `git gc --prune=now` on the mirror after every push that replaced refs, so ADR 0020's "gc on both copies" is the backup service acting for the routine, within the report's first date. *Decision taken here; see Further Notes.*

### The two ops commands

- **`replay-erasures --since <dump stamp | ISO instant>`** — the set of requests completed after `since` is the union of the restored `erasure_request` rows and the replay copies under the object-store prefix, de-duplicated by request id. Each is run through the routine under the platform principal; one line per request; exit *done*, with *replayed 0 erasures* when the set is empty and the table exists. It **refuses** — exit 1, the restore stops — when the git root is absent, the object store is unreachable, or a request's routine fails, because `api` must never turn healthy over an un-replayed erasure. The existing behaviour when no `erasure_request` table exists stands.
- **`erasure-rehearsal --workspace <id> --synthetic --seed`** creates the synthetic subject in the workspace — a synthetic person with a synthetic address, a membership, one concept file naming them in `verified[].by`, one commit — and prints the subject's tokens on its last line. **`--run --report <file>`** records the request, runs the routine, writes the report to the file in the real report's shape, and prints the tokens again. Two phases so the drill can dump between them.
- **The drill and the production restore change order**: the replay moves after the object store and the git store are back and stays before `api` is up. The one-shot that runs it mounts the git store and carries the object-store environment. The drill's step 9 becomes: seed → host `pg_dump` → `dump-grep` (present, expected) → run → host `pg_dump` → `dump-grep` (absent, expected) → `git cat-file` on the pre-rewrite hashes fails on the bare repository. ADR 0022's recovery order and the backups document's list say the same.

### The DPIA input

- One function on the `sources` slice returns a binding's **DPIA input** as a typed document and its hash: types of personal data (the finding categories the binding's rules in force can raise), scope, class, rules in force, routes with processor, country and retention tail, retention class, audience — and, whatever the binding, the categories the platform holds: `human:<email>` in concept files, the `Person` concept, the per-binding LMDB, `authored concept bodies`. The special-category label carries its condition — *none until a health-sector client* (ticket 63, 29/08/2026).
- The hash lands on the publish audit row — S1's publish act calls the function. The routes' retention tail is read from the route row; the route table gains the slot here and S2's model client fills it. The embedding route and Mistral appear only from the day a workspace's embedding route is first called (ADR 0020, amended 2026-09-09) — in v0.1, never.

### The words and the ADRs

- `CONTEXT.md` gains **erasure map** (the per-store finder's answer: every store family and what in it names a person), **DPIA input** (the per-binding document and its hash the publish row carries) and **replay copy** (the completed erasure request's copy in the object store that a restore reads) before code names them (`[GLOSSARY1]`, the T-073 pattern). *Finding*, *redaction rule*, *withheld*, *sensitivity*, *erasure request*, *erasure pseudonym*, *suppression*, *subject request* and *platform principal* stand as written.
- **ADR 0020** gains a dated amendment recording: the report's anchor until `backup_run` lands; the identity-set arm on the last membership; the mirror's prune by the backup service; the replay copy; and the tools the routine uses in the api image. **ADR 0022** gains a dated amendment moving the replay after the stores are restored in the recovery order. The index rows change in the same commits.

## Testing Decisions

A good test drives external behaviour through the interface a caller uses and asserts what that caller can observe — redacted text, rows, refusals, a repository's objects, a report's sentence — never internals (`[TEST1]`, `[DESIGN2]`). Real Postgres always (`[TEST2]`); our own code never mocked (`[TEST3]`); setup through factories (`[TEST4]`); a pair checked both ways (`[TEST7]`); an expected value written down (`[TEST9]`) — the report's wording is a literal in the test, never the constant interpolated.

The seams, all agreed on 09/09/2026 and all existing; S0 adds none:

1. **The core slice interface** — the `erasure` slice and the `sources` slice's finding act, over real Postgres and a real bare repository in a temporary directory (prior art: the concepts, workspaces and members suites). Tests: the request row and its ledger row land in one transaction and fail together; the pseudonym is minted once, is never the person id, and differs for one person across two workspaces; after the routine no blob at any commit contains `human:<email>` and every author line is mailmapped; `git cat-file -e` on every pre-rewrite hash fails after the prune; `bundle_commit` rows name the rewritten hashes and the reconciler, run afterwards, replays nothing; every moved verification row carries origin `erasure-rewrite` and the concept's trust reading is unchanged; the user row is pseudonymised with its id kept and every ledger row still resolves to it; sessions, verification rows, invitations and linked accounts for the person are gone; a person with a second membership keeps their user row and loses this workspace's membership; the report equals the fixed wording with the four dates computed from the lock instant; a second connection's `pg_try_advisory_lock(41)` fails during the routine and succeeds after; a `full-rebuild` job with reason *erasure* is on the queue; a second run of the routine writes one ledger event and changes nothing else; the ledger is byte-identical before and after the routine; the finding restore act records the reason and is refused for a Viewer, an Editor and a non-always-set finding; the replay copy is in the object store and holds no email; each of the four tables' zero-rows test under the runtime role; `worker_rt` inserts into `finding` and is refused on the other three.
2. **The worker pytest harness** (prior art: the tier-contract, pg-harness and chunker suites). Tests: every fixture span is asserted back against the text by offset; the recall set — the eight synthetic spans and the health note — is found in full; the always set is withheld as `[withheld]` on a binding with every default-on rule off; a default-off name passes through on a plain binding and becomes `[person A]` on an HR-shaped one, the same letter for the same name within a binding and a different letter across bindings; a name inside an officers block is withheld with its block whatever the rules; a health cue flags the sentence and the verdict narrows to Restricted; a bare date is not a finding and a date beside *date of birth* is; a suppression argument changes the output for the named person only; the version string equals the two pinned constants; the same inputs twice give identical output; the tier imports no cocoindex (the lint, held by a test as the `unittest.mock` ban is); the image contents test asserts the packages and the weights; milliseconds per page recorded.
3. **`contracts/` conformance** (prior art: the eight agreements): the `redaction` fixture read by both suites; membership both ways; a fixture on disk but not in the manifest fails both.
4. **The `runOps` seam** (prior art: the ops suite): `replay-erasures` answers *done* with zero when nothing completed after `since`; runs and reports one request completed after `since` read from the rows; runs one read from the replay copy alone when the rows predate it; refuses when the git root is absent; `erasure-rehearsal --seed` prints tokens and `--run` writes a report in the fixed shape; both commands' ledger events under the platform principal; the drill and restore scripts' step order held by the deploy-tree test.

Mutation findings carried by this block: none — the route spec places none here. Rebuild-equivalence (seam 7) stays green: the routine's rebuild is a `full-rebuild` the existing fence already covers.

## Out of Scope

- **Every surface over these rows**: the findings shown on the enumeration sample, at the extraction-plan review and in the publish dialog with the bulk acts *keep in text* and *narrow these documents* (S1 and S4); the Sources screen (S1); the People screen's erasure and suppression section (P1); the Personal data card (O1, over this block's rows).
- **Writing a finding for a real document**: conversion, the landing, the one memoised function, `index.chunk` rows, the reprocess keyed on findings, the rule-change reprocess, the LMDB and its wipe as a running thing — S1.
- **Widening a binding** and the rule that blocks it while special-category findings are unreviewed (S1, S4); the *should not have shown* report on a narrowing (V1).
- **Source entities** and their suppression-plus-reprocess on erasure; a `Person` source entity after pseudonymisation (S7). **Minting a `Person` concept** and *Left* (S3, V1); the per-kind floor already stands (T-055).
- **The referenced read tool's return path** — the share agent and referenced sources are out of v0.1.
- **Routes**: the ZDR guard, the model client and the retention tail's value (S2); any embedding and Mistral in the DPIA (S8's trigger only).
- **Imports and exports**, a bundle exported before a rewrite, exports recalled — none exist in v0.1.
- **`backup_run`** and the signals (O1); the report's anchor moves to the dump stamp when it lands.
- **The lawyer's four questions** — recorded as owed, never answered here (Further Notes).
- **Multi-process repository locking**; a second api process.

## Further Notes

- **The staleness pass** (the route spec's rule; sources the S0 block cites, read 10/09/2026):

  | Source | Claim | Verdict |
  | --- | --- | --- |
  | Ticket 24, Q8 | `human:<email>` rewritten to the member id; the member row pseudonymised | **overtaken** by ADR 0035 (05/09): the erasure pseudonym; the user row |
  | Ticket 24, Q8 and ticket 41 notes | Forgejo's reflog, gc and indexer | **overtaken** by ADR 0024: bare repositories; no indexer |
  | Ticket 24, Q9 and the 28/08 amendment | Client one on the hosted embedding route; Mistral in the DPIA | **overtaken** by ADR 0020 (09/09): no v0.1 block embeds; listed from first call |
  | Ticket 24, Q11 | Presidio 2.2.364, gliner 0.2.28, the six recognisers | **stands** as the design; every version re-read on the day (`[DEPS1]`) |
  | Ticket 24, research 55 / 53 notes | Suppressions per document, never a `detect_change` key; the LMDB in the erasure map, never backed up | **stands**, sharpened by ADR 0036 (10/09): one memoised function; the wipe paired with row deletion |
  | Ticket 24, ticket 41 notes | `pg_advisory_lock(41)`; dates from the last dump; replay on restore; every third drill rehearses | **stands** (ADR 0022); the replay's position in the recovery order is corrected here |
  | Ticket 63 | Article 9: no special-category data by intention; the label's condition *none until a health-sector client* | **stands**; written into the DPIA input |
  | Ticket 63 | The remaining lawyer questions | **owed, unchanged** — listed below |
  | Ticket 63 | `mcp.` and `docs.` hostnames | **overtaken** by ADR 0034; irrelevant to this block |
  | Research 65 | Presidio's home is `data-privacy-stack`; MIT; the transition | **stands** |
  | Research 65 §5 | Memoised output in the LMDB is personal data | **stands**, sharpened by T-113 F2: the memo holds only redacted text |
  | Research 65, open question 2 | Presidio's offset drift | **carried**: the offset assertion is this block's acceptance |
  | ADR 0020, open for the spike (1) | Whether one LMDB entry can be removed | **overtaken** by ADR 0036 (10/09) and probe 4: never singly; wipe paired with row deletion |
  | ADR 0020, open for the spike (2) | What `content_hash` covers after redaction | **decided here**: the original normalised text; the redacted text carries the version string |
  | ADR 0020, open for the spike (3) | Reachable objects after `gc --prune=now` on either copy | **carried**: the `git cat-file -e` test on the bare repository; the mirror's prune by the backup service |
  | ADR 0020, open for the spike (4) | Re-import of a bundle exported before a rewrite | **out of scope** — no import or export in v0.1 |
  | ADR 0020, open for the spike (5) | A `Person` source entity after pseudonymisation | **S7's** |
  | ADR 0020, open for the spike (6) | GLiNER's health recall on UK text | **carried**: the fixture's health note; a number recorded |
  | Gate §4, probe 1 | Does the LMDB hold personal data; can one entry be removed | **answered** by design (ADR 0036, amended) and probe 4: only redacted text and findings; never singly |

- **Decisions taken here by default, which the owner may reverse before `/to-tickets`:** (1) the identity-set arm runs on the person's last membership and ends this workspace's membership otherwise; (2) the report's anchor is the lock instant until `backup_run` lands with O1; (3) the mirror's prune is the backup service's job after a `--mirror` push that replaced refs; (4) the replay copy lives in the object store under a platform prefix, so a restore from a copy older than the latest dump still learns of the requests that followed it; (5) the api image gains `git-filter-repo` and its interpreter. Each is recorded as an ADR 0020 amendment in the ticket that builds it.
- **The boundary with S1** (specced in the same session): S0 owns the seam module, its harness, the four record families, the `redaction` agreement, the erasure slice, the two commands, the drill's changes, the DPIA input's function, and the object-store door's first acts — the replay copy's put (step 10), and the replay's list under the platform prefix and get — with `./store/objects` added to `packages/core/package.json`'s exports map, because `better-answers/import-direction` refuses a face the map does not name (ADR 0029, amendment of 10/09/2026). S1 owns the one memoised function that wraps the seam, the `finding` rows' first writer, the landing's use of the narrowing verdict and the `content_hash` columns, the reprocess keyed on findings, the publish act that carries the DPIA hash, the LMDB wipe as a running act, and the surfaces. S1's `-d` on S0's tickets follows those lines.
- **Blocks:** S1 (the seam before the first ingest — the map's D1 order, visible as an edge), and O1 for the Personal data card over this block's erasure rows.
- **The lawyer's four questions, owed and not answered here** (ticket 63; ADR 0020's fourth): the first client's ZDR status on its hosted route; the DPF HR-data question for staff-naming bindings on a US route; the controller/processor split for the platform's own member data; whether a forward edit satisfies Article 17 for a name inside a concept body. They ride with C1.
- **Cut lines for `/to-tickets`**, about five: (1) words first and the four families — `CONTEXT.md`, the migrations, ownership, zero-rows and grant tests, the `redaction` agreement; (2) the seam — the module, the pins, the fixture, the harness, the image test, the measurement, the cocoindex ban; (3) the erasure slice — the request, the map, the routine's steps, the report, the identity arm, the object-store door's three acts and its exports entry, the ADR 0020 amendment; (4) the two commands, the drill and restore reorder, the rehearsal's two phases, the ADR 0022 amendment; (5) the finding restore act and the DPIA input's function. `/to-tickets` makes the split.
- **Where block specs live.** The route spec named a block spec's path under the old docs-site tree before `529e824` moved the docs to `docs/specs/`, where this is the first block spec written. The route spec's status table was corrected in the same commit as this file.
