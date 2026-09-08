import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, text } from "drizzle-orm/pg-core";

import { conceptIdentity, readableRecordColumns, readableUnitChecks } from "./concept-tables.ts";
import { withRLS } from "./with-rls.ts";

/**
 * A **composition** and its **includes** as the visibility cascade and the footnote read
 * need them (ADRs 0004, 0015, 0023, 0039): a readable unit carrying the three visibility
 * columns — derived as the most restrictive among its includes, in the same transaction as
 * the narrowing that moved one of them — and the ordered concepts it includes, each an
 * include row labelled as ADR 0015's citation marker labels it. Both are ordinary tenant
 * tables (`withRLS()`, ADR 0032) and both are the guides slice's.
 *
 * **Minimal on purpose.** The prose, the versions, the wording heading and hash, the
 * concept's content hash at generation and the cited span (ADR 0015's consequences) are B8's,
 * on these same tables; what lands here is what lets a composition be derived and its
 * footnotes withheld through the one predicate.
 */

export const composition = withRLS(
  "composition",
  // The three visibility columns every readable unit carries (ADR 0023), the audience as its
  // word and its group-id array (ADR 0039), with fail-closed defaults, as everywhere.
  readableRecordColumns(),
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    ...readableUnitChecks("composition"),
  ],
);

/**
 * One **include** (`CONTEXT.md`): a concept a composition draws on, in order. Its `id` is the
 * label a citation marker in the prose carries (`[^i7]`, ADR 0015), so the footnote a reader
 * sees is rendered from this row and never stored; its `ordinal` is the include's place in
 * the composition's order.
 */
export const compositionInclude = withRLS(
  "composition_include",
  {
    workspaceId: text("workspace_id").notNull(),
    compositionId: text("composition_id").notNull(),
    id: text("id").notNull(),
    ordinal: integer("ordinal").notNull(),
    /** An include names a concept, never another composition (`CONTEXT.md`, *include*). */
    iri: text("iri").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.compositionId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.compositionId],
      foreignColumns: [composition.workspaceId, composition.id],
      name: "composition_include_composition_fk",
    }).onDelete("cascade"),
    // Keyed by the pair, so the check can only ever confirm a concept of the workspace the
    // include already names; an identity that leaves takes the includes naming it.
    foreignKey({
      columns: [table.workspaceId, table.iri],
      foreignColumns: [conceptIdentity.workspaceId, conceptIdentity.iri],
      name: "composition_include_identity_fk",
    }).onDelete("cascade"),
    // The cascade's read: every composition including one of the concepts a narrowing moved.
    index("composition_include_workspace_id_iri_idx").on(table.workspaceId, table.iri),
    check("composition_include_ordinal_check", sql.raw("ordinal >= 0")),
  ],
);
