---
title: "The api and one Python worker share four stores and never code"
date: 2026-09-22
module: repository
problem_type: architecture_pattern
component: tier-contract
severity: high
applies_when:
  - "Adding anything the api and the worker must both read, write or agree on"
  - "Taking third-party code into the tree, or adding a Python dependency"
  - "Sealing or opening a credential, or changing the envelope's frame"
  - "Proposing an HTTP call or shared package between the api and the worker"
tags:
  - adr-0005
  - tier-contract
  - control-plane
  - envelope
  - lift
  - third-party-notices
  - contracts
---

# The api and one Python worker share four stores and never code

## The decision

The platform is our own application, not a fork, in two runtime tiers.

- The api, in TypeScript, owns everything a person or an agent touches and every policy decision.
- The worker, in Python, is one image and one container. It owns everything that turns sources into indexed, governed knowledge.

The tiers share four stores and never code: the Postgres schema, the object store, the git store (a bare repository per workspace) and the map.

- There is no HTTP between the api and the worker. The control plane is rows. The scheduler is a Postgres queue claimed with `FOR UPDATE SKIP LOCKED`, not Celery and Redis.
- The api is the bundle's only writer. A concept the worker produces reaches the bundle as a suggestion's payload, which the api commits when the suggestion is accepted. An Admin accepts the worker's suggestions one at a time or several at once, and each lands as its own commit. The worker holds no git credential.
- Each tier reaches the object store under its workspace's prefix.
- The tier contract's fixtures live in top-level `contracts/` (ADR 0031).
- Rust, Go and C are taken as compiled dependencies and never written here.

Decided and not yet in the tree:

- Each worker instance keeps a row that carries its image digest and its schema version. Today the worker compares the stamps before it claims, and keeps no row (ADR 0025 names the row's host figures).
- A sync is cancelled by a flag on its job row, never by a call.
- `LISTEN/NOTIFY` carries the control plane's latency, and the rows stay the truth.
- A connector keeps a `run(checkpoint)` contract, so that another caller can replace the scheduler later.

Third-party code is lifted by contract as pinned snapshots, never tracked as a fork or a submodule.

- Each lift's directory carries a `THIRD_PARTY_NOTICES.md`, as `apps/api/lifts/better-auth-cimd-node/` does.
- The lifts rule in `apps/api/AGENTS.md` says what that file holds and the contract test a refresh must pass.
- The licence posture is ADR 0027's own text.
- The constitution's rules on lifting are retired. Lifting by contract stands as this decision.
- Onyx's gateways are replaced, not lifted. Its database layer gives way to our own schema, its file store to the object store, and its Enterprise credential encryption to our own credentials provider.

Python is unavoidable because of cocoindex. Docling is a dependency of nothing. The DPIA input lists the worker's per-connected-source store as personal data.

The envelope a credential is sealed in has a written format:

- The cipher is AES-256-GCM, spelled `aes-256-gcm`. Its frame is versioned and holds the version (one byte), the nonce (twelve bytes), the ciphertext (the plaintext's length) and the tag (sixteen bytes). The key is thirty-two bytes.
- The version is the first byte and also the additional authenticated data. Version 1 is that frame under AES-256-GCM.
- Every seal draws a fresh random nonce, never a counter.
- A reader refuses a version it does not know rather than guessing. It opens every version it was taught, and seals under the newest.
- A new envelope version ships as one deploy, with both images built from one commit. Retiring a version re-seals every row under the new one and then deletes the old reader, in that order, and the retirement is a decision of its own.
- Sealing is not fixtured. Each tier opens the fixture's frames byte for byte, refuses its bad frames in the fixture's own words, and seals frames of the fixture's widths. The fixture's key is a test key that reads as one, in no deploy file and read from no environment.
- Each tier has an opener, `packages/core/src/kernel/envelope.ts` and `apps/worker/src/better_answers_worker/envelope.py`. When an opener cannot open a frame, it answers `envelope-version-unknown`, `envelope-malformed` or `envelope-not-authentic`. A key of the wrong length throws.
- The golden vector is at `contracts/credential-envelope/`.
- ADR 0041's credentials provider is built for the LLM-provider class alone (`packages/core/src/llm/credentials.ts`). The first slice that needs another class builds that class's part.

## Why

- No candidate works as a whole base. Onyx gates permission sync, tenancy and groups behind an Enterprise licence and needs 11 containers. Dust is a SaaS-entangled 1.1M-line codebase with no source-permission inheritance.
- Both move at 500 to 1,400 commits a month, so a fork diverges within weeks.
- Python is unavoidable (cocoindex has no TypeScript SDK) while the api's framework, the MCP SDK and tRPC are TypeScript.
- A contract of data lets a worker run on another network with nothing but a database connection string. A customer-hosted worker needs that shape.
- The envelope key (`KEK`) is set on the api alone, so the worker never holds it. The api is to decrypt a sync's credentials and hand them over; no connector reads one yet.
- AES-256-GCM is already in both tiers (Node's `node:crypto`, and `cryptography` in the worker's lock) and is hardware-accelerated on every machine in the estate. NIST SP 800-38D names it, which matters to public-body buyers.
- The version comes first so a reader refuses an unknown one before it decrypts a byte. As authenticated data it binds the tag to the layout, so a version 1 body re-framed as version 2 does not open.
- Two processes share a key, so a counter would hand out one nonce twice, and under GCM a repeated nonce gives the plaintexts away.
- One word covers a moved byte and a wrong key alike, because an opener that told them apart would be an oracle.

## Rejected

- Fork Onyx or Dust: Enterprise gates or SaaS entanglement on exactly the parts needed, and an operational floor far above a two-box estate.
- Several Python services from day one: more deploy units for one customer. Module seams keep this a compose-file change later.
- Minimise Python by rewriting in TypeScript: rewrites Python-only libraries for no v0.1 gain and still leaves two runtimes.
- Track upstream by submodules or long-lived fork branches: a refresh must be a deliberate, tested action.
- ChaCha20-Poly1305: equal strength and the same nonce discipline, with nothing gained for a second cipher.
- XChaCha20-Poly1305: the OpenSSL that Node exposes does not carry it, so it would need a lift or a second library.
- Celery and Redis, or Temporal, as the scheduler: a second system for what a Postgres queue does.
- An HTTP control plane between the tiers to start, stop and watch a sync: reversed by the amendment of 25/08/2026, which made the control plane rows.

## History

The full record, with its fourteen amendments (tickets 38, 47, 15, 53, 39, 41, 73, 74, 62 and 79, then T-020, T-078, T-130 and T-274): `docs/archive/adr/0005-own-app-in-two-tiers.md`.

Later decisions overturned three rules of the record. The worker wrote the map and the api read it, until the archived ADR 0023's amendment of 29/08/2026 put the map's delta in the api's commit transaction and left only the full rebuild to the worker. The worker connected with a role per workspace, and the map was Apache AGE, until ADR 0032 kept one worker role and plain tables. ADR 0041's credentials provider was not to land, until ADR 0041 built it for the LLM-provider class.

The queue, the suggestions' commits, the object-store prefix, the compiled languages, Onyx's gateways, the DPIA line, the envelope's versioning and fixture rules, and what is not yet built were missing from this doc until 20/10/2026 (BA-215). The same reading found that Google's OKF reference agent is no dependency of the worker, and that the api hands no sync a credential yet, so this doc no longer says either.
