import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, primaryKey, text } from "drizzle-orm/pg-core";

import { readableRecordColumns, readableUnitChecks } from "./concept-tables.ts";
import { withRLS } from "./with-rls.ts";

/**
 * The sources slice's two tables as the visibility derivation needs them (ADR 0013, ADR
 * 0023, ADR 0039): the **source binding** that carries the three permission fields a class
 * is derived from, and the **source document** row that ties a piece of evidence to the
 * binding that yielded it. Both are ordinary tenant tables (`withRLS()`, ADR 0032).
 *
 * **Minimal on purpose.** A binding is far more than this — connector, credential, scope,
 * domain, cadence, destination, retention (`CONTEXT.md`, *source binding*) — and a document
 * is the catalogue every run reconciles. Those columns are B7's, on these same tables; what
 * lands here is exactly what the cascade reads and nothing a binding-management surface
 * would need.
 *
 * The document row is the security claim of the derivation: a concept's class is read off
 * **the binding the platform recorded a document under**, reached through the document id
 * the evidence names, and never off a binding id a producer could supply beside its
 * citation. A caller that could name the binding could name a Public one for a Restricted
 * document, and widen a class by asserting it.
 */

/**
 * The **rules in force** on a binding, as the column's keys write them: the two tiers of the
 * glossary's *redaction rule* a binding switches, `default-on` and `default-off`, written
 * with an underscore because these are keys inside a value and not words of the glossary.
 * **Always** has no key, because no binding switches it off — a column that could hold one
 * would be a switch for the policy tier, which is the one thing the tier means.
 *
 * The unit is the tier and never the category. Which categories exist, which tier each sits
 * in and the placeholder word each carries is the `redaction` agreement's, in `contracts/`,
 * which nothing imports (ADR 0031): a category list on this column would be the same list in
 * a migration, where a rule change could not reach it. `REDACTION_TIERS` in
 * `finding-tables.ts` holds the three words; the correspondence between those words and these
 * keys is written down in `test/boundary-schemas.test.ts`, because an import of it here would
 * close a cycle with the table this file already lends that one.
 */
export const RULES_IN_FORCE_KEYS = ["default_on", "default_off"] as const;

/**
 * The safe set, which is what an unconfigured binding is entitled to: every tier the seam can
 * withhold under is on except the one a person has to ask for. So a binding created before
 * anybody thought about redaction withholds dates of birth, home addresses and personal
 * contact, and passes names and job titles through — and a binding that wants names withheld
 * is one flip of `default_off`, which is S1's binding-management surface (the S0 spec, *The
 * seam*). A default that read the other way would be a binding quietly withholding less than
 * the platform says it does.
 */
export const RULES_IN_FORCE_DEFAULT = { default_on: true, default_off: false } as const;

/**
 * The shape, held by the database as well as by the boundary. The boundary is the app's, and
 * this column is read by the worker's seam as an argument: `worker_rt` holds default DML on
 * every ordinary `public` table (migration `0000_substrate.sql`), so a shape stated at the
 * boundary alone would be a shape one tier could write around. Null-safe for the reason the
 * identifier set's is — `->` on an absent key is SQL NULL, `jsonb_typeof(NULL)` is NULL, and
 * a CHECK worth NULL passes — so a set missing a tier is refused here rather than discovered
 * by the seam at the moment it reads its argument. The object test refuses the JSON `null`,
 * which `jsonb NOT NULL` takes: it refuses SQL NULL, not the JSON value. A key beyond the two
 * is the boundary's to refuse, as a fourth kind of identifier is.
 */
const rulesInForceIsShaped = [
  `jsonb_typeof(rules_in_force) = 'object'`,
  ...RULES_IN_FORCE_KEYS.map(
    (key) => `jsonb_typeof(rules_in_force -> '${key}') IS NOT DISTINCT FROM 'boolean'`,
  ),
].join("\n         AND ");

export const sourceBinding = withRLS(
  "source_binding",
  // The id is platform-minted, so an audience's group ids and a document's binding share one
  // shape; the three permission fields (ADR 0013) are published by a recorded Admin act, the
  // class, and the audience as its word and its group-id array (ADR 0039), with fail-closed
  // defaults: unpublished, Restricted, everyone — which a Restricted class narrows to Admins.
  {
    ...readableRecordColumns(),
    /**
     * Which of the two switchable tiers this binding withholds under, on the row rather than
     * by convention. The seam takes the value as an argument and never reads the binding
     * (the S0 spec, *The seam*), so this is the whole of what a binding says about redaction.
     */
    rulesInForce: jsonb("rules_in_force").notNull().default(RULES_IN_FORCE_DEFAULT),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    ...readableUnitChecks("source_binding"),
    check("source_binding_rules_in_force_check", sql.raw(rulesInForceIsShaped)),
  ],
);

export const sourceDocument = withRLS(
  "source_document",
  {
    workspaceId: text("workspace_id").notNull(),
    /** What `evidence.source_document_id` names — the identity a locator points into. */
    id: text("id").notNull(),
    bindingId: text("binding_id").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    // Keyed by the pair, as every cross-table key in this package is: a foreign-key check
    // bypasses row-level security, so a key on the binding id alone would confirm that some
    // other tenant holds a given binding. A binding that leaves takes its documents with it.
    foreignKey({
      columns: [table.workspaceId, table.bindingId],
      foreignColumns: [sourceBinding.workspaceId, sourceBinding.id],
      name: "source_document_binding_fk",
    }).onDelete("cascade"),
    // The narrowing act's read: every document one binding yielded.
    index("source_document_workspace_id_binding_id_idx").on(table.workspaceId, table.bindingId),
  ],
);
