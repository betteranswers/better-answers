---
title: "Records attach to concepts by IRI, are versioned where edited, and audited in one audit log"
date: 2026-09-24
module: packages/schema
problem_type: architecture_pattern
component: records
severity: high
applies_when:
  - "Adding a record family or a table that refers to a concept"
  - "Writing an act that must leave an audit event"
  - "Adding a version table for text a person edits"
  - "Removing a member or erasing a person on the identity set"
tags:
  - adr-0014
  - record-family
  - audit-log
  - audit-event
  - iri
  - version
  - concept-owner
---

# Records attach to concepts by IRI, are versioned where edited, and audited in one audit log

## The decision

Records attach to a concept by IRI and never restate it. A record keys to the concept index row by `(workspace_id, iri)`, a composite foreign key. Records keep versions only where a person edits text. Every act is audited in one audit log per workspace.

- A composition's includes, a guide definition's sections and a question set's questions are rows, never saved lists.
- A context wording is a named section of its concept's body, never a record.

The audit log, `audit_event`:

- is an ordinary tenant table, not partitioned until a row-count trigger reopens it;
- is insert-only, by revoked privilege;
- has a caller-minted id, and its family and subject kind are derived from the act;
- is unique on `(workspace_id, id)`, so a record may key to the audit row it was written with;
- is never rewritten.

Findings, subject requests and entity merges join the record families.

People on records:

- A person is `human:<person id>` on every record. The member row carries no id of ours.
- The user row is what erasure pseudonymises. It is never deleted.
- A member ends by an Admin's removal or by an erasure. Its row is deleted, and its audit event is the record of it.
- The identity set keeps no team record. A group may carry a team's name (ADR 0038).

Decided for the S3 block and not yet in the tree:

- `concept_owner` is a table on the `concepts` slice, keyed against `concept_identity`, with a per-domain default beside it.
- A composition declares its two homes, `section` and `response`, together, so the second home adds a writer and never a migration.
- The by-IRI key and the version column set are one helper each, `attachedByIri()` and `versionColumns()`.

## Why

- A saved list inside a column cannot be a foreign key, so a changed atom would reach its compositions by a scan or not at all.
- A version table with a mutable flag is not append-only.
- A wording kept as a record wears the concept's badge without ever being verified.
- Every one of these is a line now and a migration with user-visible churn later. Two reviewers reached the same verdicts independently.
- Partitioning a table that carries a policy changes the catalogue assertion the RLS suite proves. A retention delete would need a role that is not the api's.
- `audit_event.id` is a global key, so without the unique index no family could carry a composite key to the audit row it was written with.
- An owner as a column cannot hold both a per-domain default and a per-concept override.
- The member row's key is one the organisation plugin requires and nothing of ours references. A person has one id, the user row's (ADR 0035).

## Rejected

- A parties family now: a second home for facts the bundle already states, and personal data for a use case not in v0.1.
- Two composition families, or a response as an audit row only: the same columns twice, or no version to export.
- No question-set record, or an upload connected source as the question set: no title, order or re-run, or a buyer's document treated as company knowledge.
- Per-act audit tables, or audit in the application's own log: a union across tables, or nothing queryable by target.
- One generic JSON version table, or before and after in audit payloads: no types, and a history a UI cannot list, diff or restore.
- Verification as columns on the row: a second reviewer overwrites the first.
- Evidence derived by the worker after the commit: a second writer of derived rows, and a window with no evidence.
- Usage recording every answer citation: about 58 million rows a year at fifty workspaces, each naming a person.
- The context wording as its own family or as a third composition home: a record the company loses on leaving, with nothing to verify.
- An evidence-artefact family for certificates: a second expiry beside `stale_after`.
- Month partitions on the audit log: superseded by the tenant table above.

## History

The full record, with its amendments (tickets 23, 24, 39 and 50, T-073, T-059, T-113, and the T-027 and T-028 grill): `docs/archive/adr/0014-records-attach-by-iri.md`.
