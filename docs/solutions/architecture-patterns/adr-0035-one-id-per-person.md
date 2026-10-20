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
  - "Writing an erasure step or declaring an audit action"
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

- The platform's one minter mints it: `ulid` in `packages/schema/src/ulid.ts`, re-exported by the kernel. Better Auth is handed the same function as its `generateId`, so every identity id has one shape, a time-ordered ULID: 48 bits of milliseconds, then 80 bits of randomness, in Crockford base32, 26 characters, monotonic within a millisecond. Session tokens, authorisation codes, client secrets and token `jti` values come from the library's own random paths, never from the minter.
- It is `userId` on every Principal. It is written `human:<person id>` on every record the platform keeps: the audit log's actor, a commit trailer's `Actor:`, a suggestion's proposer and decider, an access request's requester, a `group_member` key.
- It is never written into a concept file, which keeps `human:<email>`. Erasure still rewrites a person id it finds in one.
- Nothing of ours references the member row's key, joins on it or shows it. Every People action keys by workspace and person.
- A custom minter switches off Better Auth's opaque-invitation-id heuristic, so `requireEmailVerificationOnInvitation` is set to true explicitly.

Revocation has two scopes. Each deletes the tokens it ends rather than marking them, and a fresh sign-in mints anew.

- In a workspace, an Admin revokes by an instant on the member row. The action deletes the person's refresh and access tokens consented in that workspace and issued before the instant. Nothing outside the workspace changes, and the Admin never learns whether the person belongs to another.
- Everywhere, the operator revokes by an instant on the person. The action deletes every session and token the person was issued before the instant, and answers `revokedAt`, the instant it held. Only the operator can revoke everywhere. No workspace Admin's procedure reaches it.
- Revoking in a workspace, removing a member and revoking everywhere also delete refresh tokens already rotated. Access tokens hanging off a deleted refresh token go with it, through `refresh_id ON DELETE CASCADE`.
- Each action that deletes a person's tokens names the grants it ended, by id, in its audit event: `people.person.credentials_revoked`, `people.member.credentials_revoked` and `people.member.removed`. A grant is one authorisation's family of refresh tokens, issued at the family's earliest row, and each carries the assistant's id, the workspace it was consented in (or none) and when it was issued. The list is read from the rows the delete removed. It names only the grants in the action's scope that were still open, and an action that ended none records an empty list.
- When a workspace action ended any, it also writes `people.person.grants_ended` to the identity-set audit log, in the action's own transaction after its own row, under the Admin, with the person as subject and the workspace's id and the same grants as detail.
- The operator's inspection lists each ended grant newest first: when it ended, who ended it, and in which scope. A grant's names are read when it is shown, by one read of `oauth_client` and one of `workspace`, so an assistant gone since reads as its id. An Admin's audit log view names its workspace's grants the same way.
- No member state is put on and taken off. Revocation ends what was issued.

A person's second factor is theirs, across every workspace (ADR 0048). Being an Admin in any one workspace, or the operator, requires it at every sign-in. A workspace Admin never acts on another person's factors.

- A session that must confirm a factor and has not is pending. It ends an hour after a request first finds it pending.
- When a person who needed no factor is made an Admin or the operator, the same action clears the confirmation on every one of their sessions, so each confirms again as an Admin.
- Removing a factor clears the confirmation of the person's other sessions: a confirmation never outlives the factor that may have made it.

Erasure rewrites `human:<email>` and `human:<person id>` to `human:<erasure pseudonym>` across a workspace's files, history (git author lines and commit trailers), `bundle_commit` rows and verification rows. The pseudonym is minted at erasure, one per workspace, and kept on the erasure request. It is never the person id. The user row is pseudonymised: email to a unique tombstone, name cleared, id kept. The audit log holds ids and never an email or a name, and it is never rewritten.

The audit slice, `packages/core/src/audit/`, has two doors. `record` takes a Principal and derives the actor. `recordFor` takes the platform principal and an explicit actor. The kernel's actor id has three forms: `human:<person id>`, `process:better-answers-<purpose>`, or an agent's id. An audit action is named `family.subject.verb`, in four families: people, knowledge, sources and platform. Corrections and decisions on suggestions are knowledge actions. Routes, ceilings, exports and provisioning are platform actions. One test holds each declared action's family to its name's prefix, both ways.

## Why

- A person named by three ids is joined by none of them. An audit log keyed on one, a trailer on another and a file on a third cannot say what that person did.
- A per-member id leaves actions taken before a person joins with no actor: a first sign-in, or an access request.
- One id shape means one boundary refinement, an audit log whose id order agrees with its timestamps, and one fixture both tiers pin, `contracts/id-shape/`.
- A workspace Admin ending a person's sessions elsewhere is one company's decision reaching another's. Any rule that counts the workspaces a person holds is an oracle over them.
- An erasure target shared across workspaces lets two exported histories be joined on the person the request was meant to unlink.
- A marked token, presented again, reaches the OAuth provider's replay path. That path deletes every refresh token the person holds for the assistant, with no workspace filter and no check of when each was issued. It ended grants in other workspaces, and a new grant taken after revoking everywhere. A deleted token answers "not found".
- Deleting a grant's rows left nothing to inspect, so each action records the grants it ended.
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

Later decisions overturned two rules of the record. The operator's revoke-everywhere ran under the platform principal, until ADR 0009 made the operator a principal kind of its own. `recordFor` had one caller, the access request, until ADR 0009 and ADR 0038 gave it the sign-in, the consent, the display name and the second-factor actions. The ULID's shape, the operator's sole reach, the rotated tokens' deletion, the grants' shape and record, the inspection's order and names, `revokedAt`, the families of actions and their test were missing from this doc until 20/10/2026 (BA-215).
