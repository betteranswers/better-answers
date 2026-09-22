import {
  AUDIENCE_EVERYONE,
  boundarySchemas,
  CONCEPT_DRAFT_STATUS,
  PUBLISHED_STATUSES,
  SENSITIVITY_DEFAULT,
  SUGGESTION_ACCEPTED_STATUS,
  SUGGESTION_REPAIR_KIND,
  SUGGESTION_WAITING_STATUS,
  VERIFICATION_ERASURE_ORIGIN,
  VERIFICATION_REPAIR_ORIGIN,
} from "@better-answers/schema";
import type { z } from "zod";

import {
  readableParameters,
  sensitivityAndAudienceClause,
  visibilityOf,
  type Visibility,
} from "../access/index.ts";
import type { ActorId, PlatformPrincipal, Principal } from "../kernel/index.ts";
import { fileAt, type Committed, type GitDoor } from "../store/git/index.ts";
import { recomputeCompositionsIncluding } from "../guides/index.ts";
import { writeConceptDelta } from "../store/graph/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";
import { contentHashOf, parseConceptFile, type Frontmatter, type HashedSource } from "./file.ts";
import { markDeciding } from "./inbox.ts";
import type { Acceptance } from "./index.ts";
import { conceptVisibilityFrom, replaceCitations } from "./visibility.ts";

export const foldKind = (kind: string): string =>
  kind.replaceAll(/\S+/g, (word) => {
    const cased = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    if (cased.endsWith("ies")) return `${cased.slice(0, -3)}y`;
    if (/(s|x|z|ch|sh)es$/.test(cased)) return cased.slice(0, -2);
    if (/(ss|us|is)$/.test(cased) || !cased.endsWith("s")) return cased;
    return cased.slice(0, -1);
  });

export const mergeKeyOf = (foldedKind: string, title: string): string =>
  `${foldedKind}:${title.trim().replaceAll(/\s+/g, " ").toLowerCase()}`;

const conceptRow = boundarySchemas.conceptIndex.insert.omit({ commitSha: true });

export const WRITE_CONSTRAINTS = {
  concept_index_workspace_id_path_uidx: "path-taken",
  concept_identity_merge_key_uidx: "merge-key-taken",
} as const;

export type Held = {
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly mergeKey: string;

  readonly sensitivity: string;
  readonly audience: string;
  readonly audienceGroups: readonly string[] | null;
  readonly status: string;

  readonly contentHash: string;

  readonly publishedAt: Date | null;
};

type HeldRow = {
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly merge_key: string;
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
  readonly status: string;
  readonly content_hash: string;
  readonly published_at: Date | null;
};

export const heldByIri = async (
  principal: Principal,
  tx: Tx,
  iri: string,
): Promise<Held | undefined> => {
  const predicate = principal.kind === "user" ? `AND ${sensitivityAndAudienceClause("c", 3)}` : "";
  const found = await tx.query<HeldRow>(
    `SELECT c.path, c.kind, c.title, i.merge_key, c.sensitivity, c.audience, c.audience_groups,
            c.status, c.content_hash, c.published_at
       FROM concept_index c
       JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
      WHERE c.workspace_id = ${scopeClause(1)} AND c.iri = $2
        ${predicate}`,
    [
      scopeParameter(principal),
      iri,
      ...(principal.kind === "user" ? readableParameters(principal) : []),
    ],
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : {
        path: row.path,
        kind: row.kind,
        title: row.title,
        mergeKey: row.merge_key,
        sensitivity: row.sensitivity,
        audience: row.audience,
        audienceGroups: row.audience_groups,
        status: row.status,
        contentHash: row.content_hash,
        publishedAt: row.published_at,
      };
};

export const holdsEveryDocument = async (
  principal: Principal,
  tx: Tx,
  documentIds: readonly string[],
): Promise<boolean> => {
  const distinct = [...new Set(documentIds)];
  if (distinct.length === 0) return true;
  const found = await tx.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM source_document
      WHERE workspace_id = ${scopeClause(1)} AND id = ANY($2::text[])`,
    [scopeParameter(principal), distinct],
  );
  return found.rows[0]?.held === distinct.length;
};

const sameVisibility = (one: Visibility, other: Visibility): boolean =>
  one.sensitivity === other.sensitivity &&
  one.audience === other.audience &&
  (one.audienceGroups ?? []).join(" ") === (other.audienceGroups ?? []).join(" ");

export const heldVisibilityOf = (held: Held) =>
  visibilityOf({
    sensitivity: held.sensitivity,
    audience: held.audience,
    audience_groups: held.audienceGroups,
  });

type RowFacts = {
  readonly workspaceId: string;
  readonly iri: string;
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly contentHash: string;
  readonly status: string | undefined;
  readonly sensitivity: string | undefined;
};

export const indexRowOf = (facts: RowFacts, held: Held | undefined, now: Date) => {
  const fileStatus = facts.frontmatter["status"];
  const status =
    facts.status ??
    (typeof fileStatus === "string" ? fileStatus : undefined) ??
    held?.status ??
    CONCEPT_DRAFT_STATUS;
  return conceptRow.safeParse({
    workspaceId: facts.workspaceId,
    iri: facts.iri,
    path: facts.path,
    kind: foldKind(facts.kind),
    title: facts.title,
    frontmatter: facts.frontmatter,
    body: facts.body,
    contentHash: facts.contentHash,
    status,
    publishedAt: PUBLISHED_STATUSES.some((published) => published === status)
      ? (held?.publishedAt ?? now)
      : null,
    sensitivity: held?.sensitivity ?? facts.sensitivity ?? SENSITIVITY_DEFAULT,
    audience: held?.audience ?? AUDIENCE_EVERYONE,
    audienceGroups: held?.audienceGroups ?? null,
  });
};

type Landing = z.infer<typeof conceptRow> & {
  readonly mergeKey: string;
  readonly commit: Committed;
  readonly actor: ActorId;
  readonly auditEventId: string;

  readonly sources: readonly HashedSource[];

  readonly evidence: readonly z.infer<typeof boundarySchemas.evidence.insert>[] | undefined;

  readonly restsAlsoOn: readonly Visibility[];

  readonly acceptance: Acceptance | undefined;
};

type CommitLanding = {
  readonly commit: Committed;
  readonly actor: ActorId;
  readonly auditEventId: string;
};

export const landBundleCommit = async (
  principal: Principal,
  tx: Tx,
  landing: CommitLanding,
): Promise<void> => {
  await tx.query(
    `INSERT INTO bundle_commit (workspace_id, sha, parent_sha, audit_event_id, actor)
     VALUES (${scopeClause(1)}, $2, $3, $4, $5)`,
    [
      scopeParameter(principal),
      landing.commit.sha,
      landing.commit.parent,
      landing.auditEventId,
      landing.actor,
    ],
  );
};

export const landRows = async (principal: Principal, tx: Tx, index: Landing): Promise<void> => {
  await tx.query(
    `INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, iri) DO UPDATE SET merge_key = EXCLUDED.merge_key`,
    [index.workspaceId, index.iri, index.mergeKey],
  );
  for (const piece of index.evidence ?? []) {
    await tx.query(
      `INSERT INTO evidence (workspace_id, source_document_id, locator, resource, content_version)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, source_document_id, locator) DO UPDATE
          SET resource = EXCLUDED.resource, content_version = EXCLUDED.content_version`,
      [
        piece.workspaceId,
        piece.sourceDocumentId,
        piece.locator,
        piece.resource,
        piece.contentVersion ?? null,
      ],
    );
  }
  if (index.evidence !== undefined) {
    await replaceCitations(principal, tx, index.iri, index.evidence);
  }
  const held = visibilityOf({
    sensitivity: index.sensitivity,
    audience: index.audience,
    audience_groups: index.audienceGroups ?? null,
  });

  const visibility = await conceptVisibilityFrom(principal, tx, {
    iri: index.iri,
    kind: index.kind,
    fallback: held,
    alsoOn: index.restsAlsoOn,
    onTheRow: true,
  });
  await tx.query(
    `INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter, body,
                                content_hash, commit_sha, status, published_at, sensitivity,
                                audience, audience_groups)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (workspace_id, iri) DO UPDATE
        SET path = EXCLUDED.path, kind = EXCLUDED.kind, title = EXCLUDED.title,
            frontmatter = EXCLUDED.frontmatter, body = EXCLUDED.body,
            content_hash = EXCLUDED.content_hash, commit_sha = EXCLUDED.commit_sha,
            status = EXCLUDED.status, published_at = EXCLUDED.published_at,
            sensitivity = EXCLUDED.sensitivity, audience = EXCLUDED.audience,
            audience_groups = EXCLUDED.audience_groups, updated_at = now()`,
    [
      index.workspaceId,
      index.iri,
      index.path,
      index.kind,
      index.title,
      index.frontmatter,
      index.body,
      index.contentHash,
      index.commit.sha,
      index.status,
      index.publishedAt,
      visibility.sensitivity,
      visibility.audience,
      visibility.audienceGroups,
    ],
  );
  await landBundleCommit(principal, tx, index);

  await writeConceptDelta(principal, tx, {
    workspaceId: index.workspaceId,
    iri: index.iri,
    kind: index.kind,
    path: index.path,
    body: index.body,
    sources: index.sources.map(([resource, locator]) => ({ resource, locator })),
    publishedAt: index.publishedAt ?? null,
    ...visibility,
    status: index.status,
  });

  if (!sameVisibility(held, visibility)) {
    await recomputeCompositionsIncluding(principal, tx, { iris: [index.iri] });
  }
  if (index.acceptance === undefined) return;

  await markDeciding(tx, index.acceptance.suggestionId);
  const decided = await tx.query<{ id: string }>(
    `UPDATE suggestion
        SET status = $3, decider = $4, decided_at = now(), target_iri = $5
      WHERE workspace_id = $1 AND id = $2 AND status = $6
    RETURNING id`,
    [
      index.workspaceId,
      index.acceptance.suggestionId,
      SUGGESTION_ACCEPTED_STATUS,
      index.actor,
      index.iri,
      SUGGESTION_WAITING_STATUS,
    ],
  );
  if (decided.rows.length === 0) {
    throw new Error("the suggestion was decided by somebody else while this act was in flight");
  }
  if (index.acceptance.kind !== SUGGESTION_REPAIR_KIND) return;

  await tx.query(
    `UPDATE concept_verification SET content_hash = $3, origin = $4
      WHERE workspace_id = $1 AND iri = $2 AND content_hash IS NOT NULL`,
    [index.workspaceId, index.iri, index.contentHash, VERIFICATION_REPAIR_ORIGIN],
  );
};

export const moveBundleCommits = async (
  platform: PlatformPrincipal,
  tx: Tx,
  moved: readonly (readonly [string, string])[],
): Promise<number> => {
  if (moved.length === 0) return 0;
  const before = moved.map(([old]) => old);
  const after = moved.map(([, now]) => now);
  const rows = await tx.query(
    `WITH moved(before_sha, after_sha) AS (SELECT * FROM unnest($2::text[], $3::text[]))
     UPDATE bundle_commit AS c
        SET sha = COALESCE((SELECT m.after_sha FROM moved m WHERE m.before_sha = c.sha), c.sha),
            parent_sha = COALESCE(
              (SELECT m.after_sha FROM moved m WHERE m.before_sha = c.parent_sha),
              c.parent_sha
            )
      WHERE c.workspace_id = ${scopeClause(1)}
        AND (c.sha = ANY($2::text[]) OR c.parent_sha = ANY($2::text[]))`,
    [scopeParameter(platform), before, after],
  );
  await tx.query(
    `WITH moved(before_sha, after_sha) AS (SELECT * FROM unnest($2::text[], $3::text[]))
     UPDATE concept_index AS i
        SET commit_sha = m.after_sha
       FROM moved m
      WHERE i.workspace_id = ${scopeClause(1)} AND i.commit_sha = m.before_sha`,
    [scopeParameter(platform), before, after],
  );
  return rows.rowCount ?? 0;
};

export type ChecksCarried = {
  readonly concepts: number;

  readonly checks: number;
};

type RewrittenRow = {
  readonly iri: string;
  readonly path: string;
  readonly commit_sha: string;
  readonly content_hash: string;
};

export const carryChecksOntoRewrite = async (
  platform: PlatformPrincipal,
  tx: Tx,
  door: GitDoor,
  input: { readonly workspaceId: string; readonly paths: readonly string[] },
): Promise<ChecksCarried> => {
  if (input.paths.length === 0) return { concepts: 0, checks: 0 };
  const indexed = await tx.query<RewrittenRow>(
    `SELECT iri, path, commit_sha, content_hash
       FROM concept_index
      WHERE workspace_id = ${scopeClause(1)} AND path = ANY($2::text[])`,
    [scopeParameter(platform), [...input.paths]],
  );

  let concepts = 0;
  let checks = 0;
  for (const row of indexed.rows) {
    const content = await fileAt(platform, door, input.workspaceId, row.commit_sha, row.path);

    if (content === null) continue;
    const read = parseConceptFile(content);
    if (!read.ok) {
      throw new Error(`concepts: the bundle holds a file the platform cannot read: ${row.path}`);
    }
    const contentHash = contentHashOf(read.value.frontmatter, read.value.body, row.path);
    if (contentHash === row.content_hash) continue;

    await tx.query(
      `UPDATE concept_index SET frontmatter = $3, body = $4, content_hash = $5
        WHERE workspace_id = ${scopeClause(1)} AND iri = $2`,
      [scopeParameter(platform), row.iri, read.value.frontmatter, read.value.body, contentHash],
    );
    concepts += 1;
    const moved = await tx.query(
      `UPDATE concept_verification SET content_hash = $3, origin = $4
        WHERE workspace_id = ${scopeClause(1)} AND iri = $2 AND content_hash IS NOT NULL`,
      [scopeParameter(platform), row.iri, contentHash, VERIFICATION_ERASURE_ORIGIN],
    );
    checks += moved.rowCount ?? 0;
  }
  return { concepts, checks };
};
