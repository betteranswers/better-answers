import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
import { readableRecordColumns, readableUnitChecks, SENSITIVITIES } from "./readable-columns.ts";
import { withRLS } from "./with-rls.ts";

/**
 * The sources slice's two tables (ADR 0013, ADR 0023, ADR 0039): the **source binding** an
 * Admin made — what it reaches, where its documents go, how long they are kept and where it
 * has got to — and the **source document** catalogue every run reconciles, one row per item a
 * binding yields. Both are ordinary tenant tables (`withRLS()`, ADR 0032).
 *
 * **No credential, scope or cadence column lands here.** An upload has none: the Admin hands
 * the platform the bytes, so there is nothing to authenticate against and nothing to poll. The
 * connectors that do have them arrive in S4 and bring their columns with them.
 *
 * The document row is the security claim of the visibility derivation: a concept's class is
 * read off **the binding the platform recorded a document under**, and where the document
 * carries a class of its own, off **the narrower of the two** — both reached through the
 * document id the evidence names, and never off a binding id a producer could supply beside
 * its citation. A caller that could name the binding could name a Public one for a Restricted
 * document, and widen a class by asserting it. A document's own class only ever narrows: it is
 * NULL until the seam's special-category verdict or an Admin's *narrow these documents* sets
 * it, and NULL means the binding's.
 */

/**
 * The connector a binding names (`CONTEXT.md`, *connector*). The roster is upload, website,
 * SharePoint, HubSpot, Asana, the share agent's file share and the referenced read tool —
 * **upload is the only one v0.1 has code for**, so it is the only word this column admits. The
 * rest are words on this same column, landing with the connectors that serve them (S4);
 * admitting one of them today would let an Admin make a binding no run could ever claim.
 */
export const CONNECTORS = ["upload"] as const;

/** v0.1's one connector: the Admin's own file, landed by the bind act. */
export const CONNECTOR_UPLOAD = "upload" satisfies (typeof CONNECTORS)[number];

/**
 * Which derived stores a binding's documents feed (`CONTEXT.md`, *destination of a binding*):
 * the chunk index, the bundle, the graph. At least one — a binding feeding nothing would be a
 * source the platform holds and can never answer from. The object store is where every
 * document lands first and is not a destination.
 *
 * The set is **recorded now and acted on later**: only the chunk index is fed in v0.1, the
 * bundle is S7's and the graph is S8's. Recording it on the binding is what lets the Sources
 * screen say where a binding's documents go on the day the Admin makes it, rather than
 * inferring it from whichever stores happen to hold rows.
 */
export const DESTINATIONS = ["chunk-index", "bundle", "graph"] as const;

/**
 * The upload's destination set, which is this column's own DEFAULT while upload is the only
 * connector: an uploaded document is the company's own record (the *keep* retention class), so
 * there is nothing to leave out of the map. A connector added in S4 brings its own set beside
 * this one and the bind act writes the column, because one column cannot carry a DEFAULT per
 * connector — which is why the default is named after the connector it belongs to.
 */
export const UPLOAD_DESTINATIONS = ["chunk-index", "bundle"] as const;

/**
 * What the platform keeps of a binding's documents, and for how long (`CONTEXT.md`, *retention
 * class*): **mirror** — the source holds the record — **keep** — the platform holds it, which
 * is what an upload is — and **transient** — the original bytes go after processing and the
 * normalised redacted text stays. *keep* is the default because upload is v0.1's connector and
 * an uploaded file has no source left to mirror. In every class cited evidence outlives its
 * source, which is the `evidence` key's job below and not this column's.
 */
export const RETENTION_CLASSES = ["mirror", "keep", "transient"] as const;

/** What a binding is born at: the platform holds the record, because an upload leaves none. */
export const RETENTION_CLASS_DEFAULT = "keep" satisfies (typeof RETENTION_CLASSES)[number];

/**
 * The state word a binding wears, in the order it wears them (`CONTEXT.md`, *source binding*):
 * **landed** — its documents are in the object store — **indexing** — a run is turning them
 * into chunks — **indexed** — the run has finished and there is something to review — and
 * **published**, which is an Admin's act over a reviewed binding. A publish is refused until
 * the binding is indexed, which is the act's rule and not this column's: the column records
 * where a binding has got to, and the refusal reads it.
 */
export const BINDING_STATES = ["landed", "indexing", "indexed", "published"] as const;

/** What a binding is born at — the bind act landed the bytes and no run has claimed them. */
export const BINDING_LANDED_STATE = "landed" satisfies (typeof BINDING_STATES)[number];

/**
 * How a run left one document: **converted** — the normalised redacted text is in the object
 * store and its chunks are in the index — or **quarantined**, which is the outcome of a
 * document the converter could not read or gave up on. NULL until a run has been over it, so
 * *not yet converted* and *could not be converted* are two different facts on the row.
 */
export const DOCUMENT_OUTCOMES = ["converted", "quarantined"] as const;

/** What a run writes when the document became a normalised copy and the chunks over it. */
export const DOCUMENT_CONVERTED_OUTCOME = "converted" satisfies (typeof DOCUMENT_OUTCOMES)[number];

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

/**
 * At least one destination, every element one of the three words, and no NULL among them.
 * `array_position(… , NULL) IS NULL` is spelled out for the reason the audience array's is: a
 * NULL element makes the containment test itself NULL, and a CHECK worth NULL passes, so a
 * binding whose destinations were `{bundle, NULL}` would otherwise be stored as a binding
 * feeding a store nobody can name.
 */
const destinationIsAKnownSet = `cardinality(destination) > 0
         AND array_position(destination, NULL) IS NULL
         AND destination <@ ARRAY[${listed(DESTINATIONS)}]::text[]`;

export const sourceBinding = withRLS(
  "source_binding",
  // The id is platform-minted, so an audience's group ids and a document's binding share one
  // shape; the three permission fields (ADR 0013) are published by a recorded Admin act, the
  // class, and the audience as its word and its group-id array (ADR 0039), with fail-closed
  // defaults: unpublished, Restricted, everyone — which a Restricted class narrows to Admins.
  {
    ...readableRecordColumns(),
    /**
     * What the Sources screen lists a binding by: the Admin's own words for the source, never
     * the platform's rendering of a connector and a domain. No default — a binding nobody
     * named would be a row the screen has to invent a line for.
     */
    name: text("name").notNull(),
    /** Which kind of source system this binding reaches. `upload` is v0.1's only word. */
    connector: text("connector").notNull(),
    /**
     * Which derived stores this binding's documents feed. A set, because a binding may feed
     * more than one, and a set is what the screen states in words.
     */
    destination: text("destination")
      .array()
      .notNull()
      .default([...UPLOAD_DESTINATIONS]),
    /** What the platform keeps of this binding's documents, and for how long. */
    retentionClass: text("retention_class").notNull().default(RETENTION_CLASS_DEFAULT),
    /** Where the binding has got to, as the Sources screen reads it. */
    state: text("state").notNull().default(BINDING_LANDED_STATE),
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
    // One word per closed set, each held by the database rather than by the boundary alone:
    // the worker holds DML on this table by default privilege (migration `0000_substrate.sql`),
    // so a set stated only at the app's boundary is a set the other tier could write around.
    check("source_binding_connector_check", sql.raw(`connector IN (${listed(CONNECTORS)})`)),
    check("source_binding_destination_check", sql.raw(destinationIsAKnownSet)),
    check(
      "source_binding_retention_class_check",
      sql.raw(`retention_class IN (${listed(RETENTION_CLASSES)})`),
    ),
    // landed, then indexing, then indexed, then published: the bytes are in the object store,
    // a run is turning them into chunks, the run has finished and there is something to
    // review, an Admin published it. Which word may follow which is the act's rule; that a
    // word outside the four can never be stored is this one's.
    check("source_binding_state_check", sql.raw(`state IN (${listed(BINDING_STATES)})`)),
  ],
);

export const sourceDocument = withRLS(
  "source_document",
  {
    workspaceId: text("workspace_id").notNull(),
    /** What `evidence.source_document_id` names — the identity a locator points into. */
    id: text("id").notNull(),
    bindingId: text("binding_id").notNull(),
    /**
     * What the source system calls this item — an upload's file name. Unique per binding, so
     * a second run over the same source finds the row it wrote last time rather than making a
     * second one: the catalogue is reconciled by this id and never by the title.
     */
    sourceSystemId: text("source_system_id").notNull(),
    /** What a passage is served under, and what a hit is listed by. */
    title: text("title").notNull(),
    /** What the bytes are, as the bind act read them — the converter dispatches on it. */
    mediaType: text("media_type").notNull(),
    /**
     * How big the original is. `integer` and not a wider type on purpose: the bind act's cap
     * refuses a file orders of magnitude below this column's ceiling, so a row that could not
     * fit here is a row the act already refused.
     */
    byteSize: integer("byte_size").notNull(),
    /**
     * The two **landed copies** (`CONTEXT.md`), as keys into the object store: the original as
     * the bind act put it there, and the normalised redacted text the run wrote beside it.
     * These are keys and never *locators* — a locator is a span into the normalised redacted
     * text, one sense of the word and one only. The normalised copy's key is NULL until a run
     * has converted the document.
     */
    originalKey: text("original_key").notNull(),
    normalisedKey: text("normalised_key"),
    /**
     * Over the original normalised text, before the redaction seam ran (the S0 spec): the
     * fact a second run compares against to answer *unchanged*. NULL until a run has read it.
     */
    contentHash: text("content_hash"),
    /** The version string the seam returned, which is what a locator's offsets are against. */
    redactionVersion: text("redaction_version"),
    /** When the platform first saw this item, and when a run last found it at the source. */
    firstSeen: stamp("first_seen").notNull().defaultNow(),
    lastSeen: stamp("last_seen").notNull().defaultNow(),
    /** What the source says it was last changed — NULL when the source records none. */
    lastModified: stamp("last_modified"),
    /** When a run found it gone from the source; NULL while it is still there. */
    goneAt: stamp("gone_at"),
    /** How the last run left it. NULL means no run has been over it yet. */
    outcome: text("outcome"),
    /**
     * The document's **own** class, narrower than its binding's or nothing at all. NULL is the
     * ordinary case and means *the binding's*; a word here is the seam's special-category
     * verdict or an Admin's narrowing. The derivation folds the narrower of the two, so this
     * column can only ever take visibility away.
     */
    sensitivity: text("sensitivity"),
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
    // One row per item per binding — the reconcile's key. Two bindings over the same source
    // system keep their own rows, because a document belongs to the binding that yielded it.
    uniqueIndex("source_document_workspace_id_binding_id_source_system_id_uidx").on(
      table.workspaceId,
      table.bindingId,
      table.sourceSystemId,
    ),
    // Both closed word sets are null-guarded, because NULL is a fact on each of these columns:
    // no run has been over the document yet, and the document has no class of its own.
    check(
      "source_document_outcome_check",
      sql.raw(`outcome IS NULL OR outcome IN (${listed(DOCUMENT_OUTCOMES)})`),
    ),
    check(
      "source_document_sensitivity_check",
      sql.raw(`sensitivity IS NULL OR sensitivity IN (${listed(SENSITIVITIES)})`),
    ),
    // A file has a size, and an empty one has none of it. A negative size would be a byte
    // count nothing measured, and the cap the bind act enforces reads this column back.
    check("source_document_byte_size_check", sql.raw("byte_size >= 0")),
  ],
);
