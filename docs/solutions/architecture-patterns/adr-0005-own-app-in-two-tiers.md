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

- There is no HTTP between the api and the worker. The control plane is rows.
- The api is the bundle's only writer. A concept the worker produces reaches the bundle as a suggestion's payload, which the api commits on acceptance. The worker holds no git credential.
- The tier contract's fixtures live in top-level `contracts/` (ADR 0031).

Third-party code is lifted by contract as pinned snapshots, never tracked as a fork or a submodule.

- Each lift's directory carries a `THIRD_PARTY_NOTICES.md`, as `apps/api/lifts/better-auth-cimd-node/` does.
- What that file holds, and the contract test a refresh must pass, is the api's rule *Test every lift by contract, never by trust*, in `apps/api/CODING_STANDARDS.md`.
- The licence posture is ADR 0027's own text.
- The constitution's rules on lifting are retired. Lifting by contract stands as this decision.

Python is unavoidable because of cocoindex and Google's OKF reference agent. Docling is a dependency of nothing.

The envelope a credential is sealed in has a written format:

- AES-256-GCM, spelled `aes-256-gcm`, in a versioned frame of version, nonce, ciphertext and tag: one byte, twelve bytes, the plaintext's length, sixteen bytes. The key is thirty-two bytes.
- The version is the first byte and also the additional authenticated data. Version 1 is that frame under AES-256-GCM.
- Every seal draws a fresh random nonce, never a counter.
- A reader refuses a version it does not know rather than guessing. It seals under the newest version it knows.
- Each tier has an opener, `packages/core/src/kernel/envelope.ts` and `apps/worker/src/better_answers_worker/envelope.py`. A frame it cannot open answers `envelope-version-unknown`, `envelope-malformed` or `envelope-not-authentic`. A key of the wrong length throws.
- The golden vector is at `contracts/credential-envelope/`.
- ADR 0041's credentials provider is not built. It lands with the first slice that needs a credential.

## Why

- No candidate works as a whole base. Onyx gates permission sync, tenancy and groups behind an Enterprise licence and needs 11 containers. Dust is a SaaS-entangled 1.1M-line codebase with no source-permission inheritance.
- Both move at 500 to 1,400 commits a month, so a fork diverges within weeks.
- Python is unavoidable (cocoindex has no TypeScript SDK) while the api's framework, the MCP SDK and tRPC are TypeScript.
- A contract of data lets a worker run on another network with nothing but a database connection string, the shape a customer-hosted worker needs.
- The api decrypts and hands a sync its credentials, so the worker never holds the master key.
- AES-256-GCM is already in both tiers (Node's `node:crypto`, and `cryptography` in the worker's lock), is hardware-accelerated on every machine in the estate, and is what NIST SP 800-38D names, which matters to public-body buyers.
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

## History

The full record, with its fourteen amendments (tickets 38, 47, 15, 53, 39, 41, 73, 74, 62 and 79, then T-020, T-078, T-130 and T-274): `docs/archive/adr/0005-own-app-in-two-tiers.md`.
