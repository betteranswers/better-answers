---
title: "Records attach to concepts by IRI, are versioned where edited, and audited in one audit log"
date: 2026-09-24
module: packages/schema
problem_type: architecture_pattern
component: records
severity: high
applies_when:
  - "Adding a record family or a table that refers to a concept"
  - "Writing an action that must leave an audit event"
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

Records attach to a concept by IRI and never restate it. A record keys to the concept's `concept_identity` row by `(workspace_id, iri)`, a composite foreign key. Records keep versions only where a person edits text. Every action is audited in one audit log per workspace.

Every record is one of four kinds, sorted by the minting rule (ADR 0011):

- **derived from the bundle**: the concept index, `concept_identity`, `bundle_commit` and `evidence`, written by the api in the commit's transaction, rebuilt from git and never edited;
- **attached to a concept by IRI**: verifications, verification requests, the concept's owner, conflicts, usage, suggestions and exports;
- **use-case records**: guide definitions and their sections, write-ups and their includes, question sets and their questions, and *Questions asked* with its feedback;
- **platform state**: the connected-source families, suppressions, erasure requests, the identity set, `llm_call`, the worker's host row, backups, `platform_event` and the audit log.

Rules on the records:

- An organisation the company knows is a concept, and a contact is a later record attached to it. A certificate is a `Certification` concept, and its `stale_after` is its expiry.
- A write-up's includes, a guide definition's sections and a question set's questions are rows with platform-minted stable ids, never saved lists. A changed or discarded concept finds every write-up citing it by an index lookup, and "used by N" is a count over rows.
- Write-ups and guide definitions keep append-only `_version` tables that share one column set (version number, actor, at, note) beside typed content. `needs_review` and its reason live on the head row. Every other family is current state whose changes are audit events, and concept history is git.
- `conflict` is a record attached to a concept by IRI. `evidence` keeps its identity across commits, because conflicts point at it. Its key is the document and the locator, never a row id.
- The worker's re-fetch observations are append-only `evidence_check` rows.
- Each bundle commit has one `bundle_commit_concept` row for each concept it changed, with the hash before and after.
- A concept's owner override is written when the concept is minted.
- An agent's review of a guide waits as a write-up rewrite suggestion, and a person accepts it section by section.
- An entity merge is pending or confirmed. It is in the erasure map, because it keys contributions by a hash of a name.
- An include's section hash covers the section's subtree without its heading line, normalised as a concept body is. A body with two headings that fold to the same text is refused at commit. An imported bundle's duplicates are flagged instead.
- The opportunity layer attaches without new keys. An opportunity references an `Organization` concept by IRI. `pack_version_id` and `opportunity_id` are nullable references on a question set and on a response. A submission and an outcome attach to `usage` rows that name the write-up version copied. A question's hierarchy, classes, obligations and dependencies are later columns on `question`, a response's workflow is later columns on its write-up, and a reference question set is a later question-set kind.
- A question set's input object is Restricted by default, passes the redaction seam before extraction or any model call, is retained by rule and is in the erasure map.
- A context wording is a named section of its concept's body, never a record.

The audit log, `audit_event`:

- is an ordinary tenant table, not partitioned until a row-count trigger reopens it;
- is insert-only, by revoked privilege, as every `_version` table is;
- has a caller-minted id, and its family and subject kind are derived from the action;
- is unique on `(workspace_id, id)`, so a record may key to the audit row it was written with;
- is never rewritten;
- carries an action's typed detail, such as the publish's three confirmations.

Findings, subject requests and entity merges join the record families.

People on records:

- A person is `human:<person id>` on every record. The member row carries no id of ours.
- The user row is what erasure pseudonymises. It is never deleted.
- A member ends by an Admin's removal or by an erasure. Its row is deleted, and its audit event is the record of it.
- The identity set keeps no team record. A group may carry a team's name (ADR 0038).

Decided for the S3 block and not yet in the tree:

- `concept_owner` is a table on the `concepts` slice, keyed against `concept_identity`, with a per-collection default beside it.
- A write-up declares its two homes, `section` and `response`, together, so the second home adds a writer and never a migration.
- The by-IRI key and the version column set are one helper each, `attachedByIri()` and `versionColumns()`.

Also decided and not yet in the tree: the `_version` tables, `needs_review`, `bundle_commit_concept`, `evidence_check`, the entity merge, the section hash and the duplicate-heading refusal, and the families for verification requests, conflicts, usage, question sets, the worker's host row and backups.

## Why

- A saved list inside a column cannot be a foreign key, so a changed atom would reach its write-ups by a scan or not at all.
- A version table with a mutable flag is not append-only.
- A wording kept as a record wears the concept's badge without ever being verified.
- Every one of these is a line now and a migration with user-visible churn later. Two reviewers reached the same verdicts independently.
- Partitioning a table that carries a policy changes the catalogue assertion the RLS suite proves. A retention delete would need a role that is not the api's.
- `audit_event.id` is a global key, so without the unique index no family could carry a composite key to the audit row it was written with.
- An owner as a column cannot hold both a per-collection default and a per-concept override.
- The member row's key is one the organisation plugin requires and nothing of ours references. A person has one id, the user row's (ADR 0035).

## Rejected

- A parties family now: a second home for facts the bundle already states, and personal data for a use case not in v0.1.
- Two write-up families, or a response as an audit row only: the same columns twice, or no version to export.
- No question-set record, or an upload connected source as the question set: no title, order or re-run, or a buyer's document treated as company knowledge.
- Per-action audit tables, or audit in the application's own log: a union across tables, or nothing queryable by target.
- One generic JSON version table, or before and after in audit payloads: no types, and a history a UI cannot list, diff or restore.
- Verification as columns on the row: a second reviewer overwrites the first.
- Evidence derived by the worker after the commit: a second writer of derived rows, and a window with no evidence.
- Usage recording every answer citation: about 58 million rows a year at fifty workspaces, each naming a person.
- The context wording as its own family or as a third write-up home: a record the company loses on leaving, with nothing to verify.
- An evidence-artefact family for certificates: a second expiry beside `stale_after`.
- Month partitions on the audit log: superseded by the tenant table above.

## History

The full record, with its amendments (tickets 23, 24, 39 and 50, T-073, T-059, T-113, and the T-027 and T-028 grill): `docs/archive/adr/0014-records-attach-by-iri.md`.

The question set's input object, in the archived record, was missing from this doc until 20/10/2026, when a sample of the map tickets found S6 resting on it.

The four kinds of record and the rules listed with them were missing until 20/10/2026 too (BA-215). Later decisions overturned these rules of the archived record:

- The map's derive-and-sync was a `graph_sync_run` family, a verify commit skipped the map's stage-and-swap, and the map's record watermark was the audit-event id of the last record change. The archived ADR 0023's amendment of 29/08/2026 and ADR 0032 land the map's delta in the commit transaction and keep generations only for a full rebuild.
- An `Answer` minted at the promotion gate landed in the collection of the concept it chiefly cites, else `company/answers/`. ADR 0017 and ADR 0047 give each promotion to the owner of the one `Answer` collection.
