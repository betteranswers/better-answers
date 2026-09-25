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

export const CONCEPT_STATUSES = ["draft", "stable", "deprecated", "removed"] as const;

export const CONCEPT_DRAFT_STATUS = "draft" satisfies (typeof CONCEPT_STATUSES)[number];

export const CONCEPT_DEPRECATED_STATUS = "deprecated" satisfies (typeof CONCEPT_STATUSES)[number];

export const VERIFICATION_ORIGINS = ["platform", "imported", "erasure-rewrite", "repair"] as const;

export const VERIFICATION_PLATFORM_ORIGIN =
  "platform" satisfies (typeof VERIFICATION_ORIGINS)[number];

export const VERIFICATION_IMPORTED_ORIGIN =
  "imported" satisfies (typeof VERIFICATION_ORIGINS)[number];

export const VERIFICATION_REPAIR_ORIGIN = "repair" satisfies (typeof VERIFICATION_ORIGINS)[number];

export const VERIFICATION_ERASURE_ORIGIN =
  "erasure-rewrite" satisfies (typeof VERIFICATION_ORIGINS)[number];

export const CONCEPT_IRI_PREFIX = "https://better-answers.com/c/";

export const IRI = new RegExp(
  `^${CONCEPT_IRI_PREFIX.replaceAll(".", String.raw`\.`)}${ULID_CHARACTERS}$`,
);

export const conceptIriOf = (minted: string): string => `${CONCEPT_IRI_PREFIX}${minted}`;

export const GIT_SHA = /^[0-9a-f]{40}$/;

export type CitedSource = {
  readonly resource: string;
  readonly locator: string | null;
};

type SourceEntry = Readonly<Record<string, string | number | boolean | null>>;

const citedByText = (entry: string): CitedSource | undefined => {
  const hash = entry.lastIndexOf("#");
  const resource = (hash === -1 ? entry : entry.slice(0, hash)).trim();
  return resource === ""
    ? undefined
    : { resource, locator: hash === -1 ? null : entry.slice(hash + 1) };
};

const citedByKeys = (entry: SourceEntry): CitedSource | undefined => {
  const resource = entry["resource"];
  if (typeof resource !== "string" || resource.trim() === "") return undefined;
  const locator = entry["locator"];

  return {
    resource: resource.trim(),
    locator: locator === undefined || locator === null ? null : String(locator),
  };
};

/**
 * Reads one `sources` entry: a string splits at its last `#`, and a record reads its `resource`
 * and `locator` keys. Undefined means the resource is missing or blank; it is trimmed, the
 * locator never. A record's locator is stringified, and one not given is null.
 */
export const citedSourceOf = (entry: SourceEntry | string): CitedSource | undefined =>
  typeof entry === "string" ? citedByText(entry) : citedByKeys(entry);

type SourcesValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly SourceEntry[]
  | undefined;

/** A value that is not a list cites nothing, and an entry naming no resource is skipped. */
export const citedSourcesOf = (value: SourcesValue): readonly CitedSource[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const cited = citedSourceOf(entry);
    return cited === undefined ? [] : [cited];
  });

/**
 * A URL, or a resource starting `//`, comes back unchanged. Any other resolves against the root
 * when it starts with `/`, else against the directory of `from`, which must hold a `/`. The
 * answer is rooted, with `.` and `..` folded; `..` stops at the root.
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

export const CONCEPT_PATH = /^knowledge\/(?!.*\/\.{1,2}\/)(?!\.{1,2}\/)[^/\s][^\s]*\.md$/;

export const PUBLISHED_STATUSES = ["stable", "deprecated"] as const;

export const CONCEPT_STABLE_STATUS = "stable" satisfies (typeof PUBLISHED_STATUSES)[number];

export const CONTENT_HASH = /^[0-9a-f]{64}$/;

/**
 * No CHECK over the stored jsonb: Postgres renders a numeric in full, so a bound there would
 * refuse payloads the boundary passed.
 */
export const CONCEPT_FRONTMATTER_MAX = 64_000;

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
    primaryKey({ columns: [table.workspaceId, table.iri] }),

    uniqueIndex("concept_identity_merge_key_uidx").on(table.workspaceId, table.mergeKey),
  ],
);

/**
 * Every cross-table key names the workspace beside the id: a foreign-key check bypasses
 * row-level security and would confirm another tenant's row.
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

export const bundleCommit = withRLS(
  "bundle_commit",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),

    parentSha: text("parent_sha"),
    auditEventId: text("audit_event_id").notNull(),

    actor: text("actor").notNull(),
    committedAt: stamp("committed_at").notNull().defaultNow(),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.sha] }),

    uniqueIndex("bundle_commit_audit_event_uidx").on(table.workspaceId, table.auditEventId),

    foreignKey({
      columns: [table.workspaceId, table.parentSha],
      foreignColumns: [table.workspaceId, table.sha],
      name: "bundle_commit_parent_fk",
    }),

    index("bundle_commit_workspace_id_committed_at_idx").on(table.workspaceId, table.committedAt),
  ],
);

export const conceptIndex = withRLS(
  "concept_index",
  {
    workspaceId: text("workspace_id").notNull(),
    iri: text("iri").notNull(),

    path: text("path").notNull(),

    kind: text("kind").notNull(),
    title: text("title").notNull(),
    frontmatter: jsonb("frontmatter").notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    commitSha: text("commit_sha").notNull(),
    status: text("status").notNull().default(CONCEPT_DRAFT_STATUS),

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

    uniqueIndex("concept_index_workspace_id_path_uidx").on(table.workspaceId, table.path),

    foreignKey({
      columns: [table.workspaceId, table.commitSha],
      foreignColumns: [bundleCommit.workspaceId, bundleCommit.sha],
      name: "concept_index_bundle_commit_fk",
    }),
    check("concept_index_status_check", sql.raw(`status IN (${listed(CONCEPT_STATUSES)})`)),
    check("concept_index_sensitivity_check", sql.raw(`sensitivity IN (${listed(SENSITIVITIES)})`)),

    check(
      "concept_index_published_check",
      sql.raw(`(status IN (${listed(PUBLISHED_STATUSES)})) = (published_at IS NOT NULL)`),
    ),
  ],
);

export const evidence = withRLS(
  "evidence",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sourceDocumentId: text("source_document_id").notNull(),
    locator: text("locator").notNull(),
    resource: text("resource").notNull(),

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

export const conceptVerification = withRLS(
  "concept_verification",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),

    iri: text("iri").notNull(),

    actor: text("actor").notNull(),
    checkedAt: stamp("checked_at").notNull().defaultNow(),

    contentHash: text("content_hash"),
    origin: text("origin").notNull().default(VERIFICATION_PLATFORM_ORIGIN),
  },
  "workspaceId",
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    identityKey(table, "concept_verification_identity_fk"),

    index("concept_verification_workspace_id_iri_checked_at_idx").on(
      table.workspaceId,
      table.iri,
      table.checkedAt,
    ),
    check(
      "concept_verification_origin_check",
      sql.raw(`origin IN (${listed(VERIFICATION_ORIGINS)})`),
    ),

    check(
      "concept_verification_imported_check",
      sql.raw(`(origin = '${VERIFICATION_IMPORTED_ORIGIN}') = (content_hash IS NULL)`),
    ),
  ],
);

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

    index("concept_evidence_workspace_id_source_document_id_idx").on(
      table.workspaceId,
      table.sourceDocumentId,
    ),
  ],
);

export const conceptClassOverride = withRLS(
  "concept_class_override",
  {
    workspaceId: text("workspace_id").notNull(),
    iri: text("iri").notNull(),
    sensitivity: text("sensitivity").notNull(),
    audience: text("audience").notNull(),
    audienceGroups: text("audience_groups").array(),

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
