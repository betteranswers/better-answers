import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";
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

/**
 * A resource or a link target as ADR 0019 resolves it: **paths resolved to `/abs.md`**. A
 * file may name one concept four ways — `/abs.md`, an absolute spelling with dot segments,
 * `./rel.md`, a bare `dir/x.md` — and two spellings of one reference must land alike, for
 * the content hash (a link rewrite that only changes the spelling must not un-check the
 * concept) and for the map (two spellings are one edge), which is why an absolute path
 * goes through the same segment normalisation as a relative one. A URL is left as it
 * stands: it is already absolute and is not a path in this bundle.
 *
 * It lives here beside `citedSourceOf` for the same reason that does: the hash in the
 * concepts slice and the delta builder in the graph door both resolve, a slice may import
 * the boundary and the boundary may never import a slice (ADR 0029), and two resolutions
 * would be two chances to disagree about which concept a file names.
 */
export const resolvedResource = (resource: string, from: string): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(resource)) return resource;
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

// `listed` and `stamp` are `column-helpers.ts`'s, shared with the graph tables so the two
// files cannot drift on how a CHECK's list or an instant is written.

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
