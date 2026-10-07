---
title: "A person has one platform-minted id, carried on every Principal and every record the platform keeps"
date: 2026-09-26
module: packages/core
problem_type: architecture_pattern
component: identity
severity: high
applies_when:
  - "Naming a person on a record, an audit event or a commit"
  - "Minting an id in either tier"
  - "Revoking a person's sessions or tokens, or removing a member"
  - "Writing an erasure step or declaring an audit act"
tags:
  - adr-0035
  - person-id
  - minter
  - actor-id
  - end-every-sign-in-and-token
  - erasure-pseudonym
  - audit-log
---

# A person has one platform-minted id, carried on every Principal and every record the platform keeps

## The decision

A person has one id: the id on the identity set's `user` row.

- The platform's one minter mints it: `ulid` in `packages/schema/src/ulid.ts`, re-exported by the kernel. Better Auth is handed the same function as its `generateId`, so every identity id has one shape, a time-ordered ULID. Session tokens, authorisation codes, client secrets and token `jti` values come from the library's own random paths, never from the minter.
- It is `userId` on every Principal. It is written `human:<person id>` on every record the platform keeps: the audit log's actor, a commit trailer's `Actor:`, a suggestion's proposer and decider, an access request's requester, a `group_member` key.
- It is never written into a concept file, which keeps `human:<email>`.
- The member row's key names nothing of ours. Every People act keys by workspace and person.
- A custom minter switches off Better Auth's opaque-invitation-id heuristic, so `requireEmailVerificationOnInvitation` is set to true explicitly.

Revocation has two scopes. Each deletes the tokens it ends rather than marking them, and a fresh sign-in mints anew.

- In a workspace, an Admin revokes by an instant on the member row. The act deletes the person's refresh and access tokens consented in that workspace and issued before the instant. Nothing outside the workspace changes, and the Admin never learns whether the person belongs to another.
- Everywhere, the operator revokes by an instant on the person. The act deletes every session and token the person was issued before the instant.
- Each act that deletes a person's tokens names the grants it ended, by id, in its audit event: `people.person.credentials_revoked`, `people.member.credentials_revoked` and `people.member.removed`. When a workspace act ended any, it also writes `people.person.grants_ended` to the identity-set audit log.
- No member state is put on and taken off. Revocation ends what was issued.

A person's second factor is theirs, across every workspace (ADR 0048). Being an Admin in any one workspace, or the operator, requires it at every sign-in, and a workspace Admin never acts on another person's factors.

- A session that must confirm one and has not is pending. An hour after a request first finds it so, it ends.
- Making a person an Admin or the operator, from needing no factor, clears every one of their sessions' confirmations in the same act, so each confirms again as an Admin.
- Removing a factor clears the confirmation of the person's other sessions: a confirmation never outlives the factor that may have made it.

Erasure rewrites `human:<email>` across a workspace's files, history, git author lines, `bundle_commit` rows and verification rows to `human:<erasure pseudonym>`. The pseudonym is minted at erasure, one per workspace, and kept on the erasure request. It is never the person id. The user row is pseudonymised: email to a unique tombstone, name cleared, id kept. The audit log holds ids and never an email or a name, and it is never rewritten.

The audit slice, `packages/core/src/audit/`, has two doors. `record` takes a Principal and derives the actor. `recordFor` takes the platform principal and an explicit actor. The kernel's actor id has three forms: `human:<person id>`, `process:better-answers-<purpose>`, or an agent's id. An audit act is named `family.subject.verb`, in four families: people, knowledge, sources and platform.

## Why

- A person named by three ids is joined by none of them. An audit log keyed on one, a trailer on another and a file on a third cannot say what that person did.
- A per-member id leaves acts taken before a person joins, a first sign-in or an access request, with no actor.
- One id shape means one boundary refinement, an audit log whose id order agrees with its timestamps, and one fixture both tiers pin, `contracts/id-shape/`.
- A workspace Admin ending a person's sessions elsewhere is one company's decision reaching another's. Any rule that counts the workspaces a person holds is an oracle over them.
- An erasure target shared across workspaces lets two exported histories be joined on the person the request was meant to unlink.
- A marked token, presented again, reaches the OAuth provider's replay path. That path deletes every refresh token the person holds for the client, with no workspace filter and no check of when each was issued. It ended grants in other workspaces, and a new grant taken after revoking everywhere. A deleted token answers "not found".
- Deleting a grant's rows left nothing to inspect, so each act records the grants it ended.
- A factor held per member would let one company's Admin decide how another's member signs in. Held per person, it follows the strongest role they hold anywhere.

## Rejected

- A per-workspace pseudonym as the everyday id: two ids per person on every record.
- Better Auth's own id shape: two shapes, two refinements, and a fixture the Python tier cannot pin.
- The one-workspace rule for revocation: a cross-tenant oracle, and a tenant Admin reaching other tenants' credentials.
- One global rewrite target on erasure: linkable across controllers.
- A member status a person is put into and taken out of: a second thing the resolver reads.
- Marking tokens revoked: it reaches the provider's replay path. A `before` hook on `/oauth2/token` and a patch of the provider were rejected too.

## History

The full record, with its three amendments (T-440, T-458, T-460): `docs/archive/adr/0035-one-id-per-person.md`.
