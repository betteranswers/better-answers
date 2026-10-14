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
  - "Setting, reading or rotating a workspace's model key"
tags:
  - adr-0041
  - credential-class
  - secrets
  - bootstrap
  - envelope
  - credentials-provider
  - model-key
  - rotation
---

# A secret belongs to one of seven credential classes, the bootstrap class read from the environment

## The decision

A secret belongs to one of seven credential classes: bootstrap, ingestion, acting, agent, LLM provider, repository and object store.

- **Bootstrap** is read once from the environment by each tier's typed config module, `apps/api/src/config.ts` and `apps/worker/src/better_answers_worker/config.py`. It is never read at a call site and never logged. No other class comes from the environment.
- **The other six** are rows under the envelope, reached through a credentials provider. The provider is built for the LLM-provider class alone (*The LLM-provider class*, below). The first slice that needs another class builds that class's part.
- **The provider's shape** is fixed now: tokens stored hashed behind a lookup prefix, expiring and revocable, one rotation path per class, and every access audited.

What each class is for and where it is read is the table in `docs/operations/SECRETS.md`, under *The classes*. Which record owns that gloss has never been settled. Why seven classes rather than one is recorded nowhere, and is not invented here: treat it as open.

**Two conflicts are recorded unsettled.**

1. What *acting* means. `SECRETS.md` glosses it as writing back into a connected system as the user, approval-gated. ADR 0030 says it is never a credential for writing into a customer's other systems.
2. Whether all six below bootstrap are rows under the envelope. `SECRETS.md`'s *where it is read* column disagrees for three: the object store's write-and-list pair comes from the environment and its admin credential from escrow, the repository's keys are mounted read-only from the host, and the share agent token is checked in the api.

Settling either is a new decision, an amendment to this record and to the record that loses.

The decision predates this record. It was moved out of the rule *Keep a secret to its credential class*, in the root `CODING_STANDARDS.md`, which keeps the sentence that classes are never mixed in one scope. The rule *Read the environment in the tier's one config module* keeps the seam.

## The LLM-provider class

A workspace's key for a model provider is a **model key**, and it is the first class the provider holds. The shape above left three questions open for it. Each is answered here, for this class and no other.

1. **Sealed, never hashed.** A model key is sealed under the envelope. It is not hashed, because the platform sends it to the model provider with every call, and a hash cannot be sent. Hashing behind a lookup prefix stays the shape for a token the platform is shown and checks.
2. **The api tier reads it.** The api tier alone holds the envelope key, and it alone opens a model key, at the moment of a model call. The worker tier holds no grant on the table.
3. **Setting is an audit event, and a read is not.** Setting or replacing a model key writes one audit event, which names the model provider and never the key. A read writes none. The `llm_call` row of the call it served is the account of it (ADR 0025).

How a model key is kept:

- **One row per workspace and model provider**, in `model_key`, under forced row-level security. The model provider is one of a closed set, `anthropic` and `mistral` today. The row holds the sealed frame and nothing else.
- **Sealed directly under the envelope key**, the bootstrap secret `KEK`. ADR 0005's record of the envelope's format expected a data key per workspace between the two. That data key is not built, and whether to build it stays open.
- **The sealed text names its workspace and model provider.** A frame copied onto another workspace's row, or another provider's, does not open as that row's key.
- **No key reads as none.** A workspace with no model key for a provider has no model available from it. A frame that does not open is refused in the envelope's own word and is never read as none, so a key lost to a changed envelope key is seen.
- **The read and the store are held apart.** The side that calls a model is handed the read alone, and it reads the key of its own transaction's workspace, naming no other. A key is stored only together with the audit event that records it.
- **One ops command sets and replaces it**, taking the key on standard input. No page sets it, and nothing reads a model provider's key from the environment.
- **Rotation is replacement.** A new key is issued at the model provider, set with the command, and the old one revoked at the model provider. Expiry and revocation are the model provider's own. No command re-seals, so a new envelope key means every model key is set again. After a compromise of the envelope key, every model key sealed under it is treated as leaked and reissued at its model provider, not only sealed again.

## Why

- The class list was unenforced, unbuilt and invisible to a diff. As rule text it read as if something ran it, and nothing did. So the list is recorded as a decision, and the rules keep only the sentences that bind a change: the seam, and that classes are never mixed.
- Neither the credential-class rule, ADR 0013, ADR 0030 nor `SECRETS.md` argues for seven classes, or for never mixing them. A reason invented while moving a sentence would be a new decision, so none is given.
- The two conflicts were found by the audit that moved the list. Moving a sentence is not the moment to take a decision, so each is named and left open.
- A model key is sent to its model provider, and a hash cannot be sent. The provider's shape, written for tokens the platform checks, could not hold it as written, so the class is answered on its own.

## Rejected

- Keeping the class list in the credential-class rule: a specification dressed as a coding rule, which a reader reasonably expects something to run.

## History

The full record, with no amendments; T-184 moved it out of the constitution: `docs/archive/adr/0041-secrets-in-seven-credential-classes.md`.

Amended 14/10/2026 by the S2b ask plan (`docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, U9 and KTD11): the credentials provider is built for the LLM-provider class, and *The LLM-provider class* answers the three questions the provider's shape left open for it. The two conflicts recorded unsettled are untouched.
