import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, text } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import {
  AUDIENCE_CHECK,
  AUDIENCE_EVERYONE,
  SENSITIVITIES,
  SENSITIVITY_DEFAULT,
} from "./concept-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

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

export const sourceBinding = withRLS(
  "source_binding",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Platform-minted, so an audience's group ids and a document's binding share one shape. */
    id: text("id").notNull(),
    // The three permission fields (ADR 0013): published by a recorded Admin act, the class,
    // and the audience as its word and its group-id array (ADR 0039). Fail-closed defaults:
    // unpublished, Restricted, everyone — which a Restricted class narrows to Admins.
    publishedAt: stamp("published_at"),
    sensitivity: text("sensitivity").notNull().default(SENSITIVITY_DEFAULT),
    audience: text("audience").notNull().default(AUDIENCE_EVERYONE),
    audienceGroups: text("audience_groups").array(),
    createdAt: stamp("created_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check("source_binding_sensitivity_check", sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
    check("source_binding_audience_check", sql.raw(AUDIENCE_CHECK)),
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
