---
title: "The tier contract is thirteen agreements in three forms, each proved by both tiers' suites"
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

# The tier contract is thirteen agreements in three forms, each proved by both tiers' suites

## The decision

Every answer the api and the worker must hold alike is an agreement in the tier contract. Each agreement lands in exactly one of three forms:

- *SQL function*: the behaviour is the database's, and both tiers call it.
- *fixtured*: a golden file in `contracts/` that both suites read.
- *generated*: produced from one source by ADR 0028's mechanism, with golden rows.

The agreements live in top-level `contracts/`, listed in `contracts/manifest.json`. Nothing imports the directory and nothing deploys it. There are thirteen:

- `queue` (SQL functions): claim, lease, heartbeat, reaper, attempt count and poison threshold; the kinds a claimant runs, a job's subject and the run key.
- `concept-inbox` (SQL function): submitting a suggestion set; what acceptance promises is fixtured.
- `model-choice` (SQL function): one model choice per workspace per purpose, resolved by the database.
- `cost-ledger` (generated): the `llm_call` row, its golden rows held to the purpose vocabulary both tiers speak.
- `credential-envelope`: the envelope's sealed vectors and the words an opener refuses with.
- `id-shape`: the one shape every minted id has.
- `concept-file`: the canonical text and content hash of a concept file.
- `redaction`: what the redaction seam withholds, under which word, and the version string's shape.
- `document-chunk`: the derived chunk id, the locator's span in code points, and how chunk rows partition a text.
- `upload-media-types`: the media types an upload is admitted under.
- `citation`: the patterns each tier's comment gate refuses.
- `emptying-a-binding`: the reasons on an index job that empty its binding.
- `erasure-match`: what counts as an occurrence of a suppressed identifier.

All but the first four are fixtured.

Each agreement is proved by both tiers' suites from its own side, in `packages/core/test/tier-contract.test.ts` and `apps/worker/tests/test_tier_contract.py`. Each tier holds its own code to the fixture, never to a copy of the other tier's, so a failure lands on the side that diverged. A manifest entry's form is held to the disk: a fixtured agreement has its fixture and a generated one its golden rows.

The contract's version is a digest of `contracts/`, which each tier computes at build. `migrate` stamps it, and the worker compares its own beside the schema stamp. A mismatch refuses the claim. Editing a fixture edits no version number. The worker also claims no job while its schema stamp does not match the migration journal.

The read predicate's logic is api-only. The worker's reads are a producer's reads and are never filtered by it. `visibility-columns` has retired: a chunk row carries none of the terms it named, since a chunk's visibility is read from its binding and its document (ADR 0044). What the worker writes on a map element it lands is left to the route block that first lands one. The full map rebuild is the worker's.

## Why

- Two codebases implementing the same prose drift. One survey found a shared helper at 39 lines in one repository and 115 in the other.
- A SQL function is schema. The api authors it in a migration and it lives in the shared store, so calling it shares no code across tiers (ADR 0005).
- A pnpm package cannot serve the seam, because the worker is Python. A directory both suites read can.
- A version constant beside each test could fail only by someone forgetting to edit a number, and nothing read it at run time. The digest makes a partial deploy loud.
- No worker behaviour reads under the predicate. The nightly parse audit compares against every row, and a filter would make it report false mismatches.
- The strict stamp check costs the minutes of a deploy already under way. Queued work is delayed, never lost. It reopens with a customer-hosted worker, whose redeploy we do not control.

## Rejected

- A pnpm package named `contracts`: a contract the Python tier cannot read.
- One boot-both-tiers suite in a third workspace: it cannot name the side that diverged.
- The read predicate as a cross-tier renderer contract: it tests behaviour the worker does not have and must not have.
- A narrower stamp check, or expand/contract migrations: machinery against a near-zero cost.
- A more specific directory name, `tier-contract/` or `conformance/`: the bare word is reserved for this seam.
- One "same commit" stamp for schema and contract: an api-only deploy would idle the worker.

## History

The full record, first written as six agreements, with the amendments that admit and retire agreements and adopt the digest (T-074, T-120, T-127, T-128, T-137, T-165, T-274, T-275, T-283, T-316, T-345, T-376, T-377): `docs/archive/adr/0031-tier-contract-is-six-agreements.md`.
