import { sql } from "drizzle-orm";
import { check, text } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The visibility vocabulary every readable unit shares (ADR 0023, ADR 0039) and the column
 * sets written from it: the three classes, the two audience words, the CHECK that ties the
 * word to the array, and the columns a readable unit and a readable record are born with.
 *
 * They live here rather than in `concept-tables.ts`, where they were written, because a
 * **source document is keyed to by the concept write path's `evidence` and keyed from by the
 * source catalogue itself**. A binding is a readable record, so `source-tables.ts` needs these
 * helpers; `evidence` needs `source_document`'s columns for its own key. With both in
 * `concept-tables.ts` the two files import each other, and the file that runs second reaches
 * for a helper the first has not finished declaring — a module cycle that fails at import
 * rather than at a test. One module with no table of its own and no dependency on either is
 * what keeps the direction one-way.
 *
 * Deliberately not a barrel: it declares columns and checks, never a table, and holds only
 * what more than one table file writes.
 */

/**
 * The three confidentiality classes (`CONTEXT.md`, *sensitivity*), the one closed list, as
 * `ROLES` is for roles. Read by every readable unit's boundary — `index.chunk`'s and
 * `concept_index`'s — so the set is one fact and not one per table.
 */
export const SENSITIVITIES = ["Restricted", "Internal", "Public"] as const;

/**
 * What a concept is written at when nothing decides its class: the most restrictive of the
 * three, because a class is *derived from the evidence a concept cites* (ADR 0023), and a
 * concept whose evidence resolves to no binding has nothing to derive from — an unclassified
 * concept that defaulted to *Internal* would be a widening nobody decided.
 */
export const SENSITIVITY_DEFAULT = "Restricted" satisfies (typeof SENSITIVITIES)[number];

/**
 * The two words an audience is (`CONTEXT.md`, *audience*; ADR 0039): everybody in the
 * workspace, or the named groups whose ids `audience_groups` carries beside it. The closed
 * pair the boundary narrows to, as `SENSITIVITIES` is for the class, and the one
 * representation every readable unit shares — `concept_index`, `composition`, every
 * `index.chunk` row and the graph tables — so the read predicate's third arm has the same two
 * columns to test wherever it is applied.
 */
export const AUDIENCES = ["everyone", "groups"] as const;

/** The audience that means everybody in the workspace — what a unit is born with. */
export const AUDIENCE_EVERYONE = "everyone" satisfies (typeof AUDIENCES)[number];

/** The audience that is the named groups in `audience_groups`, and nobody else. */
export const AUDIENCE_GROUPS = "groups" satisfies (typeof AUDIENCES)[number];

/**
 * The CHECK that ties the word to the array (ADR 0039), written once: every readable unit's
 * declaration reads it, and the hand-written DDL of the graph and chunk tables copies it —
 * which the migration-ownership test reads back, so the copy cannot drift. *everyone*
 * carries no array at all and *groups* carries a non-empty one with no NULL element, so an
 * empty intersection is never stored (the derivation forces the unit Restricted instead) and
 * a row can never say *groups* while naming none. `IS NOT NULL` is spelled out before the
 * cardinality because a CHECK passes on NULL: `cardinality(NULL) > 0` is NULL, and a row that
 * said *groups* over no array would otherwise slip through.
 */
export const AUDIENCE_CHECK = `(audience = '${AUDIENCE_EVERYONE}' AND audience_groups IS NULL) OR (audience = '${AUDIENCE_GROUPS}' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL)`;

/**
 * The visibility columns a readable unit **born with fail-closed defaults** carries — a
 * binding, a composition: unpublished, Restricted, everyone — and the two checks that hold
 * them, written once (ADR 0023, ADR 0039). The concept index declares its own copy, because
 * its audience carries no default: the governed write derives the pair before it lands the
 * row, and a default there would be a value nobody decided.
 */
export const readableUnitColumns = () => ({
  publishedAt: stamp("published_at"),
  sensitivity: text("sensitivity").notNull().default(SENSITIVITY_DEFAULT),
  audience: text("audience").notNull().default(AUDIENCE_EVERYONE),
  audienceGroups: text("audience_groups").array(),
});

export const readableUnitChecks = (tableName: string) => [
  check(`${tableName}_sensitivity_check`, sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
  check(`${tableName}_audience_check`, sql.raw(AUDIENCE_CHECK)),
];

/**
 * A readable **record** of the platform's own — a binding, a composition — keyed by the
 * pair, born with the fail-closed visibility above, and stamped when it was made. The
 * columns the two tables share, written once; each adds its own beside them.
 */
export const readableRecordColumns = () => ({
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  ...readableUnitColumns(),
  createdAt: stamp("created_at").notNull().defaultNow(),
});
