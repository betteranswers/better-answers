---
title: "A secret belongs to one of seven credential classes, the bootstrap class read from the environment"
date: 2026-09-21
module: repository
problem_type: architecture_pattern
component: deploy
severity: high
applies_when:
  - "Adding, reading, storing or rotating a secret in either tier"
  - "Building the credentials provider, or the first slice that needs a credential other than bootstrap"
  - "Adding a setting to either tier's config module"
tags:
  - adr-0041
  - credential-class
  - secrets
  - bootstrap
  - envelope
  - credentials-provider
  - rotation
---

# A secret belongs to one of seven credential classes, the bootstrap class read from the environment

## The decision

A secret belongs to one of seven credential classes: bootstrap, ingestion, acting, agent, LLM provider, repository and object store.

- **Bootstrap** is read once from the environment by each tier's typed config module, `apps/api/src/config.ts` and `apps/worker/src/better_answers_worker/config.py`. It is never read at a call site and never logged. No other class comes from the environment.
- **The other six** are rows under the envelope, reached through a credentials provider. No task has built the provider. The first slice that needs one builds it.
- **The provider's shape** is fixed now: tokens stored hashed behind a lookup prefix, expiring and revocable, one rotation path per class, and every access audited.

What each class is for and where it is read is the table in `docs/operations/SECRETS.md`, under *The classes*. Which record owns that gloss has never been settled. Why seven classes rather than one is recorded nowhere, and is not invented here: treat it as open.

**Two conflicts are recorded unsettled.**

1. What *acting* means. `SECRETS.md` glosses it as writing back into a connected system as the user, approval-gated. ADR 0030 says it is never a credential for writing into a customer's other systems.
2. Whether all six below bootstrap are rows under the envelope. `SECRETS.md`'s *where it is read* column disagrees for three: the object store's write-and-list pair comes from the environment and its admin credential from escrow, the repository's keys are mounted read-only from the host, and the agent token is checked in the api.

Settling either is a new decision, an amendment to this record and to the record that loses.

The decision predates this record. It was moved out of the rule *Keep a secret to its credential class*, in the root `CODING_STANDARDS.md`, which keeps the sentence that classes are never mixed in one scope. The rule *Read the environment in the tier's one config module* keeps the seam.

## Why

- The class list was unchecked, unbuilt and invisible to a diff. As rule text it read as if something ran it, and nothing did. So the list is recorded as a decision, and the rules keep only the sentences that bind a change: the seam, and that classes are never mixed.
- Neither the credential-class rule, ADR 0013, ADR 0030 nor `SECRETS.md` argues for seven classes, or for never mixing them. A reason invented while moving a sentence would be a new decision, so none is given.
- The two conflicts were found by the audit that moved the list. Moving a sentence is not the moment to take a decision, so each is named and left open.

## Rejected

- Keeping the class list in the credential-class rule: a specification dressed as a coding rule, which a reader reasonably expects something to run.

## History

The full record, with no amendments; T-184 moved it out of the constitution: `docs/archive/adr/0041-secrets-in-seven-credential-classes.md`.
