---
status: accepted
date: 2026-08-25
---

# Concept identity is the OKF path plus a platform-minted IRI; bundles carry an in-band manifest

OKF identifies a concept only by its file path within a bundle and gives a bundle no identity at all — no id, owner, origin, version or cross-bundle reference. We decided that (1) the path stays the format identity (estate key `<bundle-id>:<path>`), (2) the platform mints a code-owned `iri` extension key on creation — a dereferenceable HTTPS IRI on a platform-controlled domain — which is the stable key across renames and regeneration, the key verification history hangs on, and the form a concept in one bundle uses to reference a concept in another, and (3) each bundle carries a platform-reserved non-`.md` manifest file at its root (id, origin, ref/commit, owner, content version) from which the platform record is derived. The reason is portability plus scale: a tenant's bundle must describe itself outside the platform, and en-masse review, rename-safe links and a future estate of vendor bundles all need a key that survives what the path does not.

## Considered options

- Path only with a platform rename log — every consumer's assumption, but verification history and cross-bundle references re-key on every move.
- `id` as the key name — collides in meaning with `sources[].id` (spec footnote keys) and neo4j-okf's `Concept.id` (= path); `iri` states what the value is and drops straight into RDF as a subject.
- `okf://` scheme or a `cross_refs:` extension key for cross-bundle references — each needs a resolver everywhere or is invisible to link checkers; an absolute IRI is spec-legal in links and `sources[].resource` today.
- Bundle metadata in the root `index.md` frontmatter — the spec permits only `okf_version` there.

## Consequences

- `iri` is never caller-settable; the governed-write contract preserves it like `generated`.
- v0.1 ships no cross-bundle links; the reference form is fixed so nothing is rewritten when they arrive.
- The IRI's domain is platform-controlled; a persistent redirector can front it later without changing identities.

## Amendment — 2026-08-25, architecture review pass 1 (ticket 38)

The IRI is **opaque** — `https://<platform-domain>/c/<ulid>` — never derived from the path, the bundle or the tenant, so it leaks no name wherever it appears (in the bundle, in MCP output, in an exported skeleton). Until a resolver is designed, unauthenticated dereference returns the same 404 for existing and unknown IRIs. Decided now because the IRI is the one key that cannot be re-keyed.

## Amendment — 2026-08-27, product name (ticket 22)

`<platform-domain>` is `better-answers.com`: a concept IRI is `https://better-answers.com/c/<ulid>`. The bare apex, not a product hostname (`app.`, `mcp.`, `docs.`), because the IRI must outlive every surface; the apex is reserved for identity and redirection. Everything else in this ADR stands.

## Amendment — 2026-08-30, `okf://` on the wire, `knowledge/` as the bundle root (ticket 79, the pre-build gate; applied by T-001)

Two clarifications; neither reopens this ADR's decision.

**`okf://` stays rejected in a file, and is fixed on the wire.** The considered option above — "`okf://` scheme … needs a resolver everywhere or is invisible to link checkers" — governs **concept files**: a concept references another concept by an absolute HTTPS IRI, never by `okf://`, and a link checker can follow it. ADR 0018 uses `okf://` as an **MCP resource URI**, which is what MCP resource URIs are for and what a resource-capable host resolves through the server that minted it. Different places, no conflict: **on the wire yes, in a file never.** This becomes load-bearing the day MCP resources are adopted (ticket 84).

**The bundle root is `knowledge/`.** A workspace repository holds the OKF bundle under **`knowledge/`** — ticket 13's estate names, `knowledge/` · `platform/` · `imports/<vendor>/` — which is already what ADR 0012's export takes ("an archive of `knowledge/` at a commit"). This ADR's platform-reserved manifest sits at the **bundle's** root, `knowledge/manifest.yaml`, not the repository's, so an imported vendor bundle carries its own under `imports/<vendor>/`. Everything else in this ADR stands.
