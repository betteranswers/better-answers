---
title: "Groups are flat, an access request is answered neutrally, and the audit log is append-only"
date: 2026-09-27
module: packages/core
problem_type: architecture_pattern
component: identity
severity: high
applies_when:
  - "Adding a group, a member or a People page field"
  - "Writing an act that lands an audit event, or an act that belongs to no workspace"
  - "Changing how a non-member asks to join a workspace, or how an Admin answers"
  - "Porting a page whose fields assume teams, several roles or access that expires"
tags:
  - adr-0038
  - group
  - access-request
  - audit-log
  - audit-event
  - append-only
  - people
---

# Groups are flat, an access request is answered neutrally, and the audit log is append-only

## The decision

**Groups are flat and Entra-aligned, and they are the one grouping shape.** A group is a named set of members of one workspace: a platform-minted ULID id, a name unique per workspace, and no parent.

- A person may sit in several groups. Belonging to a group changes what a person may see, through audiences, never what they may do. `group_member` carries no role and no permission column.
- A member removed from the workspace cascades out of every group.
- A group carries an origin, Admin-curated or audience-minted, so a Restricted connected source's named people will be a row of this same table (ADR 0039).
- Deleting a group is allowed and fail-closed. An audience holds group ids with no foreign key, and a dangling id matches no caller, so content narrows.
- Teams, plural roles, dynamic roles and temporal access are not adopted. Nor are request expiry or a Suspended member state. A person holds one role in a workspace: Admin, Editor or Viewer.

**An access request is a signed-in non-member's ask, answered neutrally and approved by a direct invitation.**

- It names one workspace and carries a required reason. Its status is waiting, approved or declined, with one open request per workspace and requester.
- The act answers one neutral acknowledgement whether the slug resolves, does not resolve, names a workspace the person belongs to, or one they are already waiting on. Only the first case writes a row.
- It runs under the platform principal with the person as the actor.
- Approve mints the invitation row directly, in the same transaction, and never through Better Auth's endpoint. Decline records who said no.

**The audit log**, `audit_event`, is an unpartitioned tenant table the database keeps append-only. The migration revokes `UPDATE` and `DELETE` from `app_rt` and every privilege from the worker's role.

- Two doors write it, inside the caller's transaction: `record`, which derives the actor from the caller's Principal, and `recordFor`, which takes the platform principal and an explicit actor (`packages/core/src/audit/index.ts`). Both reject on any failure, so an act and its row land or fail together.
- Provisioning's row lands in the workspace it creates.
- A consent lands in its workspace's audit log.

**The identity-set audit log**, `identity_audit_event`, sits beside it, outside RLS and append-only the same way. It holds:

- a person's own display-name act
- a person's own second-factor acts: a passkey added, renamed or removed, and an authenticator added or removed (each by its id alone, since a name the person later changes never belongs on an append-only log), and recovery codes issued or used
- a person's confirm, naming only the kind of factor it used, `passkey` or `authenticator`; an operator's restore code accepted; and their factors replaced after a recovery or restore code, naming the new factor's kind the same way
- each sign-in, with its method as its one detail: `email_code` for a typed code, `email_link` for the sign-in link, `passkey` for a passkey
- every operator write, and the platform's restore of a person's sign-in for the operator
- an Admin's act that ends a person's grants (ADR 0009)

The sign-in and the consent are written after Better Auth's own write, and a failed row is a log line. A token's issue, refusal and refresh stay log lines. Both tables are declared in `packages/schema/src/audit-tables.ts`.

## Why

- A group that could nest would cost every visibility check a walk instead of a lookup, and would have to be reversed before Entra's model could be matched. Nesting stays an additive migration.
- Two grouping shapes would be two tables an audience could name and two cascades to keep honest.
- A request endpoint that answered differently for a real workspace and an unknown one would be an oracle over the tenant list, which a signed-in stranger must not have.
- A table outside the tenant guarantee would be the one table a workspace's rows could leak through. Inside it, a row always belongs to a workspace, which is why an act with none goes elsewhere.
- Append-only enforced in code is a convention the next migration forgets. A revoked privilege is refused by the database to every caller, including ones not yet written.
- Partitioning a policy-bearing table changes what the RLS suite proves, and a retention delete would need a role that is not the api's. A row-count trigger, not a date, reopens it.
- Every non-adoption is a concept the next port of the external People UI would otherwise bring back by accident.

## Rejected

- Nested groups, or teams beside groups: a walk per check and a second concept for one set of people.
- A second table for a connected source's named people: two grouping shapes an audience could name.
- A role or permission column on a group: a back door to a role.
- Refusing to delete a group an audience still names: the predicate is fail-closed, and a warning is the page's.
- The request under a user principal with a synthetic member, or under no principal: the first invents a member, the second a core function with no Principal.
- Different answers for an unknown slug and an existing member: an enumeration oracle.
- Approving through Better Auth's invitation endpoint: it would import the identity provider into core.
- Month partitioning, as ADR 0014 said: see above.
- Doors that return a `Result`: a value the act might not read would let its rows commit without their event.
- Plural roles, dynamic roles, temporal access, request expiry and a Suspended state: none has a v0.1 story.

## History

The full record, with its four amendments (T-355, the T-027 and T-028 grill, T-411, T-460), is `docs/archive/adr/0038-people-data-model-*.md`.
