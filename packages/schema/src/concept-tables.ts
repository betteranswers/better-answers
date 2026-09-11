import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { ACTOR_ID_PATTERN } from "./actor-id.ts";
import { listed, stamp } from "./column-helpers.ts";
import { AUDIENCE_CHECK, SENSITIVITIES, SENSITIVITY_DEFAULT } from "./readable-columns.ts";
import { sourceDocument } from "./source-tables.ts";
import { ULID_CHARACTERS } from "./ulid.ts";
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
 * No longer current, kept for history, its successor linked (`CONTEXT.md`, *Deprecated*) —
 * the status ADR 0019's lineage rule reads: a `sources[]` entry resolving to a deprecated
 * concept of the same kind is a succession, and to anything else a derivation.
 */
export const CONCEPT_DEPRECATED_STATUS = "deprecated" satisfies (typeof CONCEPT_STATUSES)[number];

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
 * A check whose **hash the citation repair moved** (ADR 0019's *erasure-rewrite* twin;
 * T-006 spec, *Evidence, verification and repair*). Repairing a locator changes what the
 * concept's content hash is over, so every standing check would read *Changed since
 * checked* the moment the repair commits — for a change nobody made to the fact. The
 * repair re-points those checks at the content it wrote and marks them with this origin,
 * so the row still says who checked and when, and says that a routine moved its hash.
 */
export const VERIFICATION_REPAIR_ORIGIN = "repair" satisfies (typeof VERIFICATION_ORIGINS)[number];

/**
 * A check whose **hash the erasure routine moved** (ADR 0019; ADR 0020; the S0 spec, step 4)
 * — the repair's twin above, for the same reason and with the same effect on the reader. A
 * concept whose body or whose cited resource named a person by their actor id has different
 * canonical text once that identifier is rewritten, so every standing check over it would read
 * *Changed since checked* for a change nobody made to the fact. The routine re-points those
 * checks at what the rewritten file says and marks them with this origin, so *Checked by Ada*
 * stays *Checked by Ada* and the row says that a routine moved its hash.
 */
export const VERIFICATION_ERASURE_ORIGIN =
  "erasure-rewrite" satisfies (typeof VERIFICATION_ORIGINS)[number];

/**
 * Where every concept IRI lives, and the whole of it (ADR 0002): the IRI is **opaque** —
 * `https://better-answers.com/c/<ulid>` — never derived from the path, the bundle or the
 * tenant, so it leaks no name wherever it appears.
 *
 * **The bare apex, and deliberately not the deploy unit's origin**, which is why pinning it
 * here reads nothing from the environment and is no deploy-unit configuration: the apex is
 * reserved for identity and redirection so that an IRI outlives every surface, so it is a
 * product constant like the platform bot's address and the same value in every estate on
 * purpose. A staging concept carries a production-shaped IRI, and a persistent redirector can
 * front it later without changing identities.
 */
export const CONCEPT_IRI_PREFIX = "https://better-answers.com/c/";

/**
 * A concept's **IRI** (ADR 0002): the platform-minted, dereferenceable HTTPS key that
 * survives a rename and is what every record about a concept refers to it by (ADR 0014).
 * The prefix above and a minted id, exactly — nothing else is a concept IRI.
 */
export const IRI = new RegExp(
  `^${CONCEPT_IRI_PREFIX.replaceAll(".", String.raw`\.`)}${ULID_CHARACTERS}$`,
);

/** The one way a concept IRI is made, so no caller composes the string by hand. */
export const conceptIriOf = (minted: string): string => `${CONCEPT_IRI_PREFIX}${minted}`;

/** A git object name: forty lowercase hex characters, the repository's object format. */
export const GIT_SHA = /^[0-9a-f]{40}$/;

/** What one `sources[]` entry cites: the resource, and the locator into it when it names one. */
export type CitedSource = {
  readonly resource: string;
  readonly locator: string | null;
};

/**
 * One `sources[]` entry as everything that reads one reads it — **the single definition of
 * how a file's citation is understood**, so the boundary that validates an entry and the hash
 * that reduces it can never part company (ADR 0019 reduces every entry to a
 * `(resource, locator)` pair, and a validator that disagreed with the reducer would accept a
 * citation nobody could hash).
 *
 * Two forms: OKF's provenance object, and the legacy `<resource>#<locator>` string a bundle
 * may still carry, whose locator is everything after the **last** `#` — a resource may hold
 * one of its own. A resource is required, so an entry without a non-empty one answers
 * `undefined`: there is nothing here to cite.
 *
 * The resource is **trimmed in both forms**. Padding is not part of what a file cites, and an
 * asymmetry there would give two spellings of one citation two different hashes — which is a
 * concept un-checking itself over whitespace.
 *
 * It lives in this package, not in the slice that hashes, because a slice may import the
 * boundary and the boundary may never import a slice (ADR 0029); and it belongs to the shape
 * rather than to either reader, which is what the boundary is for (ADR 0028).
 */
export const citedSourceOf = (
  entry: Readonly<Record<string, string | number | boolean | null>> | string,
): CitedSource | undefined => {
  if (typeof entry === "string") {
    const hash = entry.lastIndexOf("#");
    const resource = (hash === -1 ? entry : entry.slice(0, hash)).trim();
    return resource === ""
      ? undefined
      : { resource, locator: hash === -1 ? null : entry.slice(hash + 1) };
  }
  const resource = entry["resource"];
  if (typeof resource !== "string" || resource.trim() === "") return undefined;
  const locator = entry["locator"];
  // Whatever scalar carried the locator is kept as its string: YAML renders a bare page
  // number as a number, and dropping it would be the platform deciding a citation points at a
  // whole document when the file said page four.
  return {
    resource: resource.trim(),
    locator: locator === undefined || locator === null ? null : String(locator),
  };
};

/** What a frontmatter's `sources` key may hold: the list, or a scalar that is no list at all. */
type SourcesValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly Readonly<Record<string, string | number | boolean | null>>[]
  | undefined;

/**
 * Every entry of `sources[]` the reader can read, in the file's order — **the one loop over
 * the list**, beside the one reader of an entry, so a caller in either tier's application
 * code takes the pairs and never asks the question per entry again: the content hash's
 * reduction and the graph door's lineage both consume what this answers (ADR 0019). An entry
 * naming no resource is skipped here and refused by the boundary's own refinement, which
 * asks `citedSourceOf` the same question — one refusal, at the boundary, and one reduction
 * after it. A scalar under `sources` is no list and cites nothing.
 */
export const citedSourcesOf = (value: SourcesValue): readonly CitedSource[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const cited = citedSourceOf(entry);
    return cited === undefined ? [] : [cited];
  });

/**
 * A resource or a link target as ADR 0019 resolves it: **paths resolved to `/abs.md`**. A
 * file may name one concept four ways — `/abs.md`, an absolute spelling with dot segments,
 * `./rel.md`, a bare `dir/x.md` — and two spellings of one reference must land alike, for
 * the content hash (a link rewrite that only changes the spelling must not un-check the
 * concept) and for the map (two spellings are one edge), which is why an absolute path
 * goes through the same segment normalisation as a relative one. A URL — scheme'd or
 * protocol-relative (`//host/…`) — is left as it stands: it is already absolute and is
 * not a path in this bundle, so folding it into one would let an external reference
 * collide with a local concept's citation.
 *
 * It lives here beside `citedSourceOf` for the same reason that does: the hash in the
 * concepts slice and the delta builder in the graph door both resolve, a slice may import
 * the boundary and the boundary may never import a slice (ADR 0029), and two resolutions
 * would be two chances to disagree about which concept a file names.
 */
export const resolvedResource = (resource: string, from: string): string => {
  if (resource.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(resource)) return resource;
  const directory = resource.startsWith("/") ? "" : from.slice(0, from.lastIndexOf("/"));
  const segments: string[] = [];
  for (const segment of `${directory}/${resource}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
};

/**
 * Where a bundle's concepts live and what one is called. The bundle root is `knowledge/`
 * and its manifest — the platform-reserved, non-`.md` file ADR 0002 puts at that root
 * (`knowledge/manifest.yaml`) — is excluded by the `.md` ending rather than by name, so a
 * second reserved file of any other kind is excluded the same way and this pattern does not
 * become a list to keep. No `.` or `..` segment, so a path is a place in the tree and never
 * a way out of it.
 */
export const CONCEPT_PATH = /^knowledge\/(?!.*\/\.{1,2}\/)(?!\.{1,2}\/)[^/\s][^\s]*\.md$/;

/**
 * The statuses whose rows a reader may reach. A **draft** is a concept nobody has made the
 * company's word on yet and a **removed** one has left the bundle (`CONTEXT.md`, *discard*);
 * *stable* and *deprecated* are both readable, because deprecation is a trust word shown to a
 * reader and not a way of hiding a concept from them (ADR 0019).
 */
export const PUBLISHED_STATUSES = ["stable", "deprecated"] as const;

/**
 * What a concept reaches when somebody makes it the company's word on a thing — the status a
 * seeded or published concept carries, named rather than reached by position, so a reader
 * never has to know which end of the list above means what.
 */
export const CONCEPT_STABLE_STATUS = "stable" satisfies (typeof PUBLISHED_STATUSES)[number];

/**
 * A content hash the platform writes: SHA-256 over the canonical form ADR 0014 fixes, so a
 * check knows exactly what it confirmed and *Changed since checked* is a comparison and not
 * a guess.
 */
export const CONTENT_HASH = /^[0-9a-f]{64}$/;

/**
 * How large a concept's frontmatter may be, measured **as the producer wrote it** — the JSON
 * text a producer serialized, in **characters**, which is what Postgres's `char_length` counts
 * and so what the boundary counts too (JavaScript's `.length` would count an astral
 * character twice and make one bound into two numbers). OKF's keys plus whatever else the
 * file carried is open by design (ADR 0019), so nothing about the shape bounds it, and a
 * producer who chooses the size of what the platform stores is the defect
 * `SUGGESTION_BODY_MAX` closes for the body. Sixty-four thousand characters is a wide margin
 * over a `sources[]` list a person would ever write.
 *
 * **One number and one measurement, in two places that measure the same characters**: the
 * boundary, where a producer is told; and `submit_suggestion_set`, which is the only road to a
 * payload row (both runtime roles hold `REVOKE ALL` on the table) and which takes the
 * frontmatter as the producer's own text so that it can measure exactly that.
 *
 * There is deliberately **no CHECK over the stored `jsonb`**. A row can only measure what
 * Postgres renders, and a rendering is not the producer's text within any multiplier:
 * `{"a":1e-100}` is twelve characters sent and a hundred and nine read back, because `jsonb`
 * keeps a numeric and prints it in full. A CHECK over the rendering would refuse payloads the
 * boundary had already passed — a backstop that fires on good input is worse than none —
 * and it would be guarding a storage cost that is not there, since the numeric it renders
 * long is stored short.
 */
export const CONCEPT_FRONTMATTER_MAX = 64_000;

// `listed` and `stamp` are `column-helpers.ts`'s, shared with the graph and inbox tables so
// the files cannot drift on how a CHECK's list or an instant is written.

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
 * The composite key to the identity every record about a concept carries, cascading: a
 * concept that has left the bundle takes its index row, its checks, its citations and its
 * override with it. Written once, so four tables cannot disagree about which pair a
 * concept is keyed by.
 */
const identityKey = (
  table: { readonly workspaceId: AnyPgColumn; readonly iri: AnyPgColumn },
  name: string,
) =>
  foreignKey({
    columns: [table.workspaceId, table.iri],
    foreignColumns: [conceptIdentity.workspaceId, conceptIdentity.iri],
    name,
  }).onDelete("cascade");

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
    // The chain, made the database's: a commit's parent is a commit this workspace already
    // recorded, so the prefix invariant cannot be broken by a row that names a stranger. A
    // bundle's first commit has no parent, and a composite key with a NULL column is not
    // checked at all — which is the shape the first commit needs and gets for free.
    foreignKey({
      columns: [table.workspaceId, table.parentSha],
      foreignColumns: [table.workspaceId, table.sha],
      name: "bundle_commit_parent_fk",
    }),
    // The watermark scan's index: the last commit this workspace's rows know about.
    index("bundle_commit_workspace_id_committed_at_idx").on(table.workspaceId, table.committedAt),
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
    // The three visibility columns (ADR 0023), as `index.chunk` carries them — the audience
    // as its word and its group-id array (ADR 0039).
    publishedAt: stamp("published_at"),
    sensitivity: text("sensitivity").notNull().default(SENSITIVITY_DEFAULT),
    audience: text("audience").notNull(),
    audienceGroups: text("audience_groups").array(),
    updatedAt: stamp("updated_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.iri] }),
    identityKey(table, "concept_index_identity_fk"),
    check("concept_index_audience_check", sql.raw(AUDIENCE_CHECK)),
    // One concept per path: the format identity is a key too, and two rows claiming one
    // file would be a bundle the index could not be checked against.
    uniqueIndex("concept_index_workspace_id_path_uidx").on(table.workspaceId, table.path),
    // The commit this row was written at is a commit this workspace recorded. **Deferred**,
    // because the two land in one transaction and the index row is written before the commit
    // row it names — the order is the act's, and the constraint is checked when the act ends.
    foreignKey({
      columns: [table.workspaceId, table.commitSha],
      foreignColumns: [bundleCommit.workspaceId, bundleCommit.sha],
      name: "concept_index_bundle_commit_fk",
    }),
    check("concept_index_status_check", sql.raw(`status IN (${listed(CONCEPT_STATUSES)})`)),
    check("concept_index_sensitivity_check", sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),
    // Published exactly when the status says a reader may reach it, made the database's
    // sentence: a *draft* or *removed* row carrying an instant would pass the read
    // predicate's first arm, and a *stable* row without one would be invisible to everybody.
    check(
      "concept_index_published_check",
      sql.raw(`(status IN (${listed(PUBLISHED_STATUSES)})) = (published_at IS NOT NULL)`),
    ),
  ],
);

/**
 * **Evidence** (`CONTEXT.md`): a locator into a source, with the content's version, recorded
 * when the concept citing it is committed and kept until nothing cites it.
 *
 * Keyed `(workspace_id, source_document_id, locator)` so **identity follows the document
 * rather than the URL** (T-006 spec): a document that moves keeps its evidence, and
 * `resource` is a rendered projection off the document — what a reader is shown, never the
 * key. The key to `source_document` is the one this docblock deferred while the catalogue had
 * no table: it is composite over `(workspace_id, source_document_id)` like every other key
 * here, and it **restricts** rather than cascades (owner D5) — a document cannot be deleted
 * while cited evidence names it, because *cited evidence outlives its source* (ADR 0013). The
 * act that removes a document is S4's; what S1 lands is the refusal.
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
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.sourceDocumentId, table.locator] }),
    foreignKey({
      columns: [table.workspaceId, table.sourceDocumentId],
      foreignColumns: [sourceDocument.workspaceId, sourceDocument.id],
      name: "evidence_source_document_fk",
    }).onDelete("restrict"),
  ],
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
    id: text("id").notNull(),
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
    // Keyed by the pair, as every other key in this file is: an id alone would be the one
    // global key here, and a caller who could probe it would learn that some workspace holds
    // a given check. The minter makes the id unique on its own; the pair is what makes that
    // uniqueness unaskable from outside the workspace.
    primaryKey({ columns: [table.workspaceId, table.id] }),
    identityKey(table, "concept_verification_identity_fk"),
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
    // **Imported, and only imported, has no content hash** (ADR 0019), made the database's
    // sentence in both directions: a row that carried one would show *Changed since checked*
    // for a check nobody here made, and a *platform*, *repair* or *erasure-rewrite* row
    // without one would be a check that had confirmed nothing in particular — each of those
    // three is written by a routine that hashes what it confirmed.
    check(
      "concept_verification_imported_check",
      sql.raw(`(origin = '${VERIFICATION_IMPORTED_ORIGIN}') = (content_hash IS NULL)`),
    ),
  ],
);

/**
 * **Which evidence a concept cites** — the relation the class derivation reads (ADR 0023: a
 * concept's class is the most restrictive among the bindings of the evidence it cites; ADR
 * 0039). `evidence` is keyed by document and locator and shared across every concept that
 * cites one, so which concept cites which is this row and not a column on the evidence.
 * Replaced whole by the governed write on every commit, in the same transaction as the
 * index row, from the evidence the act was handed.
 *
 * The key to `evidence` is deliberately **not** a cascade: *cited evidence outlives its
 * source* (ADR 0013), and a row that could be deleted while a citation still named it would
 * be the leak that rule closes. The key to the identity cascades, because a concept that
 * has left the bundle cites nothing.
 */
export const conceptEvidence = withRLS(
  "concept_evidence",
  {
    workspaceId: text("workspace_id").notNull(),
    iri: text("iri").notNull(),
    sourceDocumentId: text("source_document_id").notNull(),
    locator: text("locator").notNull(),
  },
  "workspaceId",
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.iri, table.sourceDocumentId, table.locator],
    }),
    identityKey(table, "concept_evidence_identity_fk"),
    foreignKey({
      columns: [table.workspaceId, table.sourceDocumentId, table.locator],
      foreignColumns: [evidence.workspaceId, evidence.sourceDocumentId, evidence.locator],
      name: "concept_evidence_evidence_fk",
    }),
    // The cascade's read: every concept citing evidence from one binding's documents.
    index("concept_evidence_workspace_id_source_document_id_idx").on(
      table.workspaceId,
      table.sourceDocumentId,
    ),
  ],
);

/**
 * **A recorded Admin override** of a concept's derived class (ADR 0023: only a recorded
 * override may widen past what the evidence and the per-kind floor derive; ADR 0039). One
 * standing override per concept — a later one replaces it — carrying the class and audience
 * the Admin decided, the Admin in the ledger's actor form, and the ledger row's id, so the
 * override is *an audit event and a row* and the evidence pane can name who created the
 * *shared beyond its evidence* state (`CONTEXT.md`). Never a rider and never a trust signal:
 * nothing here touches a check or a tier.
 */
export const conceptClassOverride = withRLS(
  "concept_class_override",
  {
    workspaceId: text("workspace_id").notNull(),
    iri: text("iri").notNull(),
    sensitivity: text("sensitivity").notNull(),
    audience: text("audience").notNull(),
    audienceGroups: text("audience_groups").array(),
    /** The overriding Admin, as `human:<person id>` — what the evidence pane names. */
    actor: text("actor").notNull(),
    auditEventId: text("audit_event_id").notNull(),
    recordedAt: stamp("recorded_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.iri] }),
    identityKey(table, "concept_class_override_identity_fk"),
    check(
      "concept_class_override_sensitivity_check",
      sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`),
    ),
    check("concept_class_override_audience_check", sql.raw(AUDIENCE_CHECK)),
    check("concept_class_override_actor_check", sql.raw(`actor ~ '^${ACTOR_ID_PATTERN}$'`)),
  ],
);
