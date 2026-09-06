import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The concept write path's tables (ADRs 0011, 0012, 0014, 0019, 0023): the identity a
 * concept keeps across renames, the derived row per concept, the commit each act made, the
 * evidence recorded at commit time, and the record of one check.
 *
 * All five are ordinary tenant tables (`withRLS()`, ADR 0032) and all five are the concepts
 * slice's, which is what the table-ownership map records. **None of them is a knowledge
 * layer**: the bundle in git is the source of truth and every row here is derived from a
 * commit (ADR 0012), which is what makes the reconciler's replay a recovery rather than a
 * repair of two disagreeing truths.
 *
 * Every cross-table foreign key is **composite over `(workspace_id, …)`**, never over the id
 * alone: a foreign-key check runs as the table's owner and bypasses row-level security, so a
 * key on an id alone would let a caller confirm that some other tenant holds a given IRI
 * (the finding T-060 took on `group_member`). Keyed by the pair, the check can only ever
 * succeed inside the workspace the referring row already names.
 */

/** The four statuses a concept passes through (`CONTEXT.md`, *deprecate*, *discard*). */
export const CONCEPT_STATUSES = ["draft", "stable", "deprecated", "removed"] as const;

/** What a concept is born at, before anything has made it the company's word on a thing. */
export const CONCEPT_DRAFT_STATUS = "draft" satisfies (typeof CONCEPT_STATUSES)[number];

/**
 * The three confidentiality classes (`CONTEXT.md`, *sensitivity*), the one closed list, as
 * `ROLES` is for roles. Read by every readable unit's boundary — `index.chunk`'s and
 * `concept_index`'s — so the set is one fact and not one per table.
 */
export const SENSITIVITIES = ["Restricted", "Internal", "Public"] as const;

/**
 * What a concept is written at when the act names no class: the most restrictive of the
 * three, because a class is *derived from the evidence a concept cites* (ADR 0023) and this
 * task derives nothing — an unclassified concept that defaulted to *Internal* would be a
 * widening nobody decided. T-055's derivation is what moves it.
 */
export const SENSITIVITY_DEFAULT = "Restricted" satisfies (typeof SENSITIVITIES)[number];

/**
 * The audience every unit this task writes carries: everybody in the workspace. The closed
 * pair (`everyone` · `groups`), the `audience_groups` array and the CHECK tying them are
 * T-055's, and until a binding-management surface exists there is nothing to name in a
 * group list (T-006 spec, *Visibility derivation and audience*).
 */
export const AUDIENCE_EVERYONE = "everyone";

/**
 * Where a check came from (ADR 0019, ADR 0020, T-006 spec): the platform's own, one carried
 * in with an imported bundle, one the erasure routine re-hashed, and one the citation repair
 * made. A wide text column narrowed at the boundary to this closed set, exactly as
 * *sensitivity* is. Only *platform* and *imported* have a writer today; the other two are
 * declared here so the routines that write them need no migration, as `GROUP_ORIGINS`'
 * audience-minted kind is.
 */
export const VERIFICATION_ORIGINS = ["platform", "imported", "erasure-rewrite", "repair"] as const;

/** A check the platform itself recorded — the origin every check made here carries. */
export const VERIFICATION_PLATFORM_ORIGIN =
  "platform" satisfies (typeof VERIFICATION_ORIGINS)[number];

/** A check carried in with a bundle, which has no content hash (ADR 0019). */
export const VERIFICATION_IMPORTED_ORIGIN =
  "imported" satisfies (typeof VERIFICATION_ORIGINS)[number];

/**
 * A concept's **IRI** (ADR 0002): the platform-minted, dereferenceable HTTPS key that
 * survives a rename and is what every record about a concept refers to it by (ADR 0014).
 * The shape and nothing more — that it dereferences is the serving surface's business.
 */
export const IRI = /^https:\/\/\S+$/;

/** A git object name: forty lowercase hex characters, the repository's object format. */
export const GIT_SHA = /^[0-9a-f]{40}$/;

/**
 * A content hash the platform writes: SHA-256 over the canonical form ADR 0014 fixes, so a
 * check knows exactly what it confirmed and *Changed since checked* is a comparison and not
 * a guess.
 */
export const CONTENT_HASH = /^[0-9a-f]{64}$/;

const listed = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

/** Every instant this file records, in the one form the platform stores one (`identity-tables.ts`). */
const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * The identity record (ADR 0002): the IRI the platform minted, and the **merge key** it was
 * minted for — what an acceptance resolves a suggestion's target by, so a concept whose
 * identity moved between proposal and decision refuses the acceptance rather than landing on
 * the wrong concept (ADR 0012). The path and the kind live on the index row, which is
 * derived and rewritten on every commit; this row is the thing that does not move.
 */
export const conceptIdentity = withRLS(
  "concept_identity",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    iri: text("iri").notNull(),
    mergeKey: text("merge_key").notNull(),
    mintedAt: stamp("minted_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    // The pair, so it is also the target every other table's composite key points at.
    primaryKey({ columns: [table.workspaceId, table.iri] }),
    // One concept per merge key: the index the acceptance path reads its refusal off.
    uniqueIndex("concept_identity_merge_key_uidx").on(table.workspaceId, table.mergeKey),
  ],
);

/**
 * The **concept index** (`CONTEXT.md`): the derived row per concept, written in the same
 * transaction as the commit that made it and never edited (ADR 0012). It carries the file's
 * frontmatter and body verbatim, the content hash a check compares against, the commit it
 * was written at, and the three visibility columns every readable unit carries (ADR 0023) —
 * which is what lets the read predicate be tested against columns on the unit itself rather
 * than against three fields of a binding a concept does not have.
 */
export const conceptIndex = withRLS(
  "concept_index",
  {
    workspaceId: text("workspace_id").notNull(),
    iri: text("iri").notNull(),
    /** Where the file sits in the bundle — the format identity (ADR 0002), which moves. */
    path: text("path").notNull(),
    /** The OKF `type`, folded at write for case and plural only (ADR 0012's amendment). */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    frontmatter: jsonb("frontmatter").notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    commitSha: text("commit_sha").notNull(),
    status: text("status").notNull().default(CONCEPT_DRAFT_STATUS),
    // The three visibility columns (ADR 0023), as `index.chunk` carries them.
    publishedAt: stamp("published_at"),
    sensitivity: text("sensitivity").notNull().default(SENSITIVITY_DEFAULT),
    audience: text("audience").notNull(),
    updatedAt: stamp("updated_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.iri] }),
    foreignKey({
      columns: [table.workspaceId, table.iri],
      foreignColumns: [conceptIdentity.workspaceId, conceptIdentity.iri],
      name: "concept_index_identity_fk",
    }).onDelete("cascade"),
    // One concept per path: the format identity is a key too, and two rows claiming one
    // file would be a bundle the index could not be checked against.
    uniqueIndex("concept_index_workspace_id_path_uidx").on(table.workspaceId, table.path),
    check("concept_index_status_check", sql.raw(`status IN (${listed(CONCEPT_STATUSES)})`)),
    check("concept_index_sensitivity_check", sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
  ],
);

/**
 * A **bundle commit** (`CONTEXT.md`): one change to a bundle, recorded in the same
 * transaction as the rows it produced. Its `audit_event_id` is the id the act minted
 * *before* the commit and the commit carries in its `Audit:` trailer, which is what makes
 * the reconciler's replay idempotent — a trailer id already on a row is a commit that landed
 * (ADR 0012's amendment).
 *
 * There is no foreign key to `audit_event`, deliberately: a key on the ledger's id alone
 * would confirm another tenant's row through a check that bypasses row-level security, and a
 * composite key would need a second unique index on the ledger to point at. The join is by
 * the pair of ids, and the pair is written in one transaction.
 */
export const bundleCommit = withRLS(
  "bundle_commit",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    /** What the ref held when the precondition was checked; NULL for a bundle's first commit. */
    parentSha: text("parent_sha"),
    auditEventId: text("audit_event_id").notNull(),
    /** The `Actor:` trailer's value — the kernel's `ActorId`, never the git author line. */
    actor: text("actor").notNull(),
    committedAt: stamp("committed_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.sha] }),
    // One commit per ledger row: the replay's idempotency, made the database's, so a second
    // replay of the same commit is refused by the index rather than by remembering to check.
    uniqueIndex("bundle_commit_audit_event_uidx").on(table.workspaceId, table.auditEventId),
    // The watermark scan's index: the last commit this workspace's rows know about.
    index("bundle_commit_workspace_id_committed_at_idx").on(table.workspaceId, table.committedAt),
  ],
);

/**
 * **Evidence** (`CONTEXT.md`): a locator into a source, with the content's version, recorded
 * when the concept citing it is committed and kept until nothing cites it.
 *
 * Keyed `(workspace_id, source_document_id, locator)` so **identity follows the document
 * rather than the URL** (T-006 spec): a document that moves keeps its evidence, and
 * `resource` is a rendered projection off the document — what a reader is shown, never the
 * key. No foreign key on `source_document_id`: the source catalogue is the sources slice's
 * and has no table yet, and a key to a table that does not exist is a promise, not a
 * constraint.
 */
export const evidence = withRLS(
  "evidence",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sourceDocumentId: text("source_document_id").notNull(),
    locator: text("locator").notNull(),
    resource: text("resource").notNull(),
    /** The version of the content the locator pointed at; NULL when the source names none. */
    contentVersion: text("content_version"),
    recordedAt: stamp("recorded_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [primaryKey({ columns: [table.workspaceId, table.sourceDocumentId, table.locator] })],
);

/**
 * A **verification** (`CONTEXT.md`): the platform's record of one check of a concept against
 * its sources — who, when, and the content confirmed. A concept file's `verified` event is
 * its projection (ADR 0019), which is why the hash lives here and never in the file.
 *
 * The table is `concept_verification` and not `verification`, because Better Auth's identity
 * set already declares a `verification` table in `public` (ADR 0009) and two tables cannot
 * share a name in one schema. The glossary's word is unchanged; the prefix says which of the
 * two a statement means.
 */
export const conceptVerification = withRLS(
  "concept_verification",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    /** The concept checked, by IRI — every record attaches by IRI and restates nothing (ADR 0014). */
    iri: text("iri").notNull(),
    /** Who checked: an `ActorId`, so *verifier ≠ generator* is visible on the string alone. */
    actor: text("actor").notNull(),
    checkedAt: stamp("checked_at").notNull().defaultNow(),
    /** What was confirmed; NULL on an imported event, which never reads *Changed since checked*. */
    contentHash: text("content_hash"),
    origin: text("origin").notNull().default(VERIFICATION_PLATFORM_ORIGIN),
  },
  "workspaceId",
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.iri],
      foreignColumns: [conceptIdentity.workspaceId, conceptIdentity.iri],
      name: "concept_verification_identity_fk",
    }).onDelete("cascade"),
    // The trust projection's read: this concept's checks, latest first.
    index("concept_verification_workspace_id_iri_checked_at_idx").on(
      table.workspaceId,
      table.iri,
      table.checkedAt,
    ),
    check(
      "concept_verification_origin_check",
      sql.raw(`origin IN (${listed(VERIFICATION_ORIGINS)})`),
    ),
    // An imported event has no content hash (ADR 0019), made the database's sentence: a row
    // that carried one would show *Changed since checked* for a check nobody here made.
    check(
      "concept_verification_imported_check",
      sql.raw(`origin <> '${VERIFICATION_IMPORTED_ORIGIN}' OR content_hash IS NULL`),
    ),
  ],
);
