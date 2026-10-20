---
title: "The tier contract is a list of agreements in three forms, each proved by both tiers' suites"
date: 2026-09-24
module: contracts
problem_type: architecture_pattern
component: tier-contract
severity: high
applies_when:
  - "The api and the worker both read or write the same value, list or format"
  - "Adding a fixture, a SQL function or an agreement under contracts/"
  - "Changing a queue function, the credential envelope or the shape of an id"
  - "Deploying a schema or contract change the worker has to match"
tags:
  - adr-0031
  - tier-contract
  - contracts
  - fixture
  - contract-digest
  - schema-stamp
  - read-predicate
---

# The tier contract is a list of agreements in three forms, each proved by both tiers' suites

## The decision

Every answer the api and the worker must hold alike is an agreement in the tier contract. Each agreement lands in exactly one of three forms:

- *SQL function*: the behaviour is the database's, and both tiers call it.
- *fixtured*: a golden file in `contracts/` that both suites read.
- *generated*: produced from one source by ADR 0028's mechanism, with golden rows.

The agreements live in top-level `contracts/`, listed in `contracts/manifest.json`. Nothing imports the directory and nothing deploys it. The manifest names these:

- `queue` (SQL functions): claim, lease, heartbeat, reaper, attempt count and poison threshold; the kinds a claimant runs, a job's subject and the run key.
- `suggestions` (SQL function): submitting a suggestion set; what acceptance promises is fixtured.
- `model-choice` (SQL function): one model choice per workspace per purpose, resolved by the database.
- `cost-ledger` (generated): the `llm_call` row. Its golden rows are held to the migrated table's columns and outcomes, and to the purpose vocabulary both tiers speak.
- `credential-envelope`: the envelope's sealed vectors and the words an opener refuses with.
- `id-shape`: the one shape every minted id has.
- `concept-file`: the canonical text and content hash of a concept file.
- `redaction`: what the redaction seam withholds, under which word, the version string's shape, and what the always tier makes of a text a person types.
- `document-passage`: the derived passage id, the locator's span in code points, and how passage rows partition a text.
- `upload-media-types`: the media types an upload is admitted under.
- `citation`: the patterns each tier's comment gate refuses.
- `emptying-a-connected-source`: the reasons on an index job that empty its connected source.
- `erasure-match`: what counts as an occurrence of a suppressed identifier.
- `links`: which of a concept body's footnotes are citation marks and which are links, and the ordinals the links take.
- `sync-sensitivity-moves`: the key under which an index job's outcome names the documents its sync moved, which documents count as moved, and how the api reads the key.

All but the first four are fixtured. A SQL-function agreement keeps fixture cases too, and both suites run them against the live functions. An agreement's files live under `contracts/<agreement id>/`.

What the agreements hold, beyond their names:

- `queue`: `claim_job` takes the job kinds the claimant runs as a required argument with no default, and the filter applies to the poison arm too, so a claimant never poisons a kind it does not run. A subject has at most one queued job of a kind. A partial unique index refuses a second enqueue, and the enqueue returns the waiting job's id. A claim passes over a job whose subject already has a job of that kind under a lease that stands, and hands it out again once the lease lapses.
- `document-passage`: a passage id is its document's id and its ordinal, zero-padded to six digits and joined by `#`, derived and never minted. A malformed, out-of-range or unknown locator answers `not-found`, the word a withheld passage gets.
- `upload-media-types`: the api's connect action refuses any other type with `media-type-refused`. The keys of the worker's converter dispatch, `CONVERTERS`, are held to the same fixture, and the worker quarantines any other type as `UnsupportedMediaType`.
- `citation`: each tier compiles `contracts/citation/cases.json` once, and its lint rule, script and write-time hook all read that. A pattern uses only syntax both languages read alike, with no flags.
- `erasure-match`: every run of whitespace is one space, where whitespace is the listed code points and not JavaScript's `\s`. Matching uses full Unicode case folding and is bounded by characters that are not letters, marks or numbers. An email address that continues past a joining character is a different address. Both tiers fold and bound by Unicode 15.1, and two per-code-point digests fail the suite of a tier whose runtime's Unicode moves.
- `redaction`: a finding's version string is `rule_version:detector_pin`, with one colon, two non-empty parts and no whitespace. The fixture names no detector. The worker's one descriptor per category is held to it.
- `concept-file`: a content hash is SHA-256 over the canonical text. The worker's nightly audit and the full rebuild recompute it and report a concept as mismatched when it differs from the api's.
- The core suite holds `narrower_class`, the class ranking's SQL function, against core's own rank.

Both tiers' suites prove each agreement, each from its own side, in `packages/core/test/tier-contract.test.ts` and `apps/worker/tests/test_tier_contract.py`, with per-agreement suites beside them. Each tier holds its own code to the fixture, never to a copy of the other tier's, so a failure lands on the side that diverged. A manifest entry's form is held to the disk: a fixtured agreement has its fixture and a generated one its golden rows. Each suite hard-codes the agreements it speaks, and the manifest must list exactly those. A fixture missing from the manifest, a listed fixture that is absent, and a directory no agreement claims each fail both suites.

The contract's version is a digest of `contracts/`. Each tier carries it as a generated, committed constant, because neither image copies `contracts/`. An edit to `contracts/` regenerates both constants in the same commit, and each tier's `check` regenerates and compares them. `migrate` stamps it, and the worker compares its own beside the schema stamp. A mismatch refuses the claim. Editing a fixture edits no version number. The worker also claims no job while its schema stamp does not match the migration journal.

The read predicate's logic is api-only. The worker's reads are a producer's reads and are never filtered by it. `visibility-columns` has retired: a passage row carries none of the terms it named, since a passage's visibility is read from its connected source and its document (ADR 0044). What the worker writes on a map element it lands is left to the route block that first lands one. The full map rebuild is the worker's.

## Why

- Two codebases implementing the same prose drift. One survey found a shared helper at 39 lines in one repository and 115 in the other.
- A SQL function is schema. The api authors it in a migration and it lives in the shared store, so calling it shares no code across tiers (ADR 0005).
- A pnpm package cannot serve the seam, because the worker is Python. A directory both suites read can.
- A version constant beside each test could fail only by someone forgetting to edit a number, and nothing read it at run time. The digest makes a partial deploy loud.
- No worker behaviour reads under the predicate. The nightly parse audit compares against every row, and a filter would make it report false mismatches.
- The strict stamp check costs the minutes of a deploy already under way. Queued work is delayed, never lost. The strict check reopens with a customer-hosted worker, whose redeploy we do not control.

## Rejected

- A pnpm package named `contracts`: a contract the Python tier cannot read.
- One boot-both-tiers suite in a third workspace: it cannot name the side that diverged.
- The read predicate as a cross-tier renderer contract: it tests behaviour the worker does not have and must not have.
- A narrower stamp check, or expand/contract migrations: machinery against a near-zero cost.
- A more specific directory name, `tier-contract/` or `conformance/`: the bare word is reserved for this seam.
- One "same commit" stamp for schema and contract: an api-only deploy would idle the worker.
- Fixturing sealed output: a fresh nonce per seal makes no frame reproducible.
- A media-type list written beside the converter dispatch: a third copy of one list.
- The emptying reasons as a case inside `queue`'s fixture, or bound by behaviour alone: the owner ruled for a fixture of their own on 23/09/2026.

## History

The full record, first written as six agreements, with the amendments that admit and retire agreements and adopt the digest (T-074, T-120, T-127, T-128, T-137, T-165, T-274, T-275, T-283, T-316, T-345, T-376, T-377): `docs/archive/adr/0031-tier-contract-is-six-agreements.md`. S2a's plan admitted `links` (`docs/plans/2026-10-09-1344-feat-s2a-search-and-concept-page-plan.md`, KTD5). BA-85's plan admitted `sync-sensitivity-moves` (`docs/plans/2026-10-09-1517-fix-sync-narrows-citing-concepts-plan.md`), so the api's tick can re-derive the concepts citing a document the worker's sync narrowed or lifted.

Later decisions overturned two rules of the record. The worker read platform rows under a workspace-scoped role, until ADR 0032 kept one worker role. The ops command's foreground rebuild claimed with the rebuild kind alone, until the rebuild became a job the worker runs: `pnpm ops map-rebuild` enqueues it and waits. The agreements' detail, the per-agreement suites, the inventories, the directory rule and the committed digest constants were missing from this doc until 20/10/2026 (BA-215). The same reading found that no tier computes the digest at build, so this doc no longer says so.
