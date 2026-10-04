---
title: "A concept is identified by an opaque platform-minted IRI, a bundle by its manifest"
date: 2026-08-30
module: packages/core
problem_type: architecture_pattern
component: knowledge-layer
severity: high
applies_when:
  - "Minting, storing or reading a concept's IRI"
  - "Writing a link from one concept to another, in the same bundle or another"
  - "Reading or adding a field of a bundle's manifest"
  - "Putting an okf:// URI anywhere other than an MCP message"
tags:
  - adr-0002
  - iri
  - concept
  - bundle-manifest
  - okf
  - identity
  - cross-bundle
---

# A concept is identified by an opaque platform-minted IRI, a bundle by its manifest

## The decision

A concept's identity is an IRI the platform mints when the concept is created: `https://better-answers.com/c/<ulid>`.

- It sits on the bare apex, `better-answers.com`, never on a product hostname such as `app.`.
- It is opaque. It is never derived from the path, the bundle or the workspace, so it leaks no name wherever it appears: in the bundle, in MCP output, in an exported skeleton.
- It is a code-owned `iri` key in the concept file. No caller sets it, and the governed write preserves it as it preserves `generated`.
- It is the stable key across renames and regeneration, the key verification history hangs on, and the form a concept in one bundle uses to refer to a concept in another.
- The file path stays OKF's own identity for a concept within its bundle.
- Until a resolver is designed, an unauthenticated request for an IRI answers the same 404 whether the IRI exists or not.
- v0.1 ships no cross-bundle links. The reference form is fixed now so nothing is rewritten when they arrive.

A bundle's identity lives in its manifest, a platform-reserved file at the bundle's root: `knowledge/manifest.yaml` inside the workspace repository. It carries the bundle's id, origin, ref or commit, owner and content version, and the platform's record of the bundle is derived from it. The manifest sits at the bundle's root, not the repository's, so an imported bundle carries its own under `imports/<vendor>/`.

`okf://` is an MCP wire URI and never a file reference. A concept file refers to another concept by its absolute HTTPS IRI. On the wire yes, in a file never.

## Why

- OKF identifies a concept only by its path within a bundle, and gives a bundle no identity at all: no id, owner, origin, version or cross-bundle reference.
- A workspace's bundle must describe itself outside the platform. Bulk review, rename-safe links and a future bundle estate of vendor bundles all need a key that survives what the path does not.
- The IRI is the one key that cannot be re-keyed, so its form was fixed before anything was built on it. Opaque, because a derived IRI would carry names into every place it is copied.
- The apex, because the IRI must outlive every product hostname. The apex is kept for identity and redirection, and a persistent redirector can front it later without changing any identity.
- `iri` says what the value is and drops straight into RDF as a subject.
- In a file, an absolute HTTPS IRI is spec-legal in links and in `sources[].resource` today, and a link checker can follow it. On the wire, `okf://` is what an MCP resource URI is for: a resource-capable host resolves it through the MCP surface that minted it (ADR 0018).

## Rejected

- Path only, with a platform rename log: verification history and cross-bundle references re-key on every move.
- `id` as the key name: it collides with `sources[].id` and with neo4j-okf's `Concept.id`, which is the path.
- `okf://` or a `cross_refs:` key for references inside a file: each needs a resolver everywhere or is invisible to link checkers.
- Bundle metadata in the root `index.md` frontmatter: the spec permits only `okf_version` there.

## History

The full record, with its three amendments (tickets 38, 22 and 79, the last applied by T-001): `docs/archive/adr/0002-concept-and-bundle-identity.md`.
