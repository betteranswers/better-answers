---
status: superseded by 0026
date: 2026-08-25
---

> **Superseded 2026-08-29 by ADR 0026** (ticket 50, research 76): there is no vocabulary file; the type vocabulary is derived from the concepts and kinds emerge with them. Nothing below is current.

# The tenant's type vocabulary is authoritative in the bundle, not in a platform table

Every concept carries a `type`, checked closed-world against a per-tenant vocabulary (a SKOS-shaped Turtle file committed inside the tenant's bundle). We decided the committed file is the authoritative copy and every platform-side table or triple store is a derived read model rebuilt on sync — the same rule as the knowledge graph. The reason is atomicity: a vocabulary change and the concept `type` changes it forces are one reviewable, revertible change only when they share a commit, which a platform table cannot join. Enforcement still runs in the platform at write time (flag, never reject), reading the committed file.

## Considered options

- Platform table authoritative, `.ttl` exported — gives write-time referential integrity and row-level access control, but splits one governed change into two systems with no shared history.

## Consequences

- Admin is the vocabulary steward; a change arrives as an open-ontologies `plan` diff reviewed as a PR against the bundle.
- open-ontologies lock/drift state lives platform-side and pins the commit SHA of the file it locked.
- A vendored or imported bundle brings its own vocabulary; alignment between vocabularies is a later, separate decision.

## Amendment — 2026-08-26, alignment (ticket 47)

No human acts on the git forge directly (Liam, feedback on ticket 15): a vocabulary change is still one reviewable, revertible commit, but Admins review the open-ontologies `plan` diff in the platform's **Control Centre**; a pull request, where one exists underneath, is opened and merged by the platform bot. The vocabulary file's format — this ADR says a SKOS-shaped Turtle file; ADR 0010's draft and the ticket-14 prototype used `vocabulary.yaml` — is settled by ticket 30's slice (now ticket 50), not here; until then it is "the SKOS-shaped vocabulary file".
