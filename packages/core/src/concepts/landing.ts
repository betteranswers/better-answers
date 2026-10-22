import type { z } from "zod";

import {
  AUDIENCE_EVERYONE,
  boundarySchemas,
  citedSourcesOf,
  IRI,
  LINKS_TO_LABEL,
  parsedPassageLocator,
  CONCEPT_DRAFT_STATUS,
  PUBLISHED_STATUSES,
  SENSITIVITY_DEFAULT,
  SUGGESTION_ACCEPTED_STATUS,
  SUGGESTION_CITATION_FIX_KIND,
  SUGGESTION_WAITING_STATUS,
  VERIFICATION_ERASURE_ORIGIN,
  VERIFICATION_CITATION_FIX_ORIGIN,
} from "@better-answers/schema";

import {
  readableParameters,
  sensitivityAndAudienceClause,
  visibilityOf,
  type Visibility,
} from "../access/index.ts";
import { foldKind, landBundleCommit } from "../bundle/index.ts";
import { flagWriteUpsCiting, recomputeWriteUpsIncluding } from "../guides/index.ts";
import type { ActorId, PlatformPrincipal, Principal } from "../kernel/index.ts";
import { fileAt, type Committed, type GitDoor } from "../store/git/index.ts";
import { writeConceptDelta } from "../store/map/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";
import { contentHashOf, parseConceptFile, type Frontmatter } from "./file.ts";
import type { Acceptance } from "./index.ts";
import { markDeciding } from "./suggestions.ts";
import { conceptVisibilityFrom, replaceCitations } from "./visibility.ts";

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

export const holderOfPath = async (
  principal: Principal,
  tx: Tx,
  path: string,
): Promise<string | undefined> => {
  const found = await tx.query<{ iri: string }>(
    `SELECT iri FROM concept_index WHERE workspace_id = ${scopeClause(1)} AND path = $2`,
    [scopeParameter(principal), path],
  );
  return found.rows[0]?.iri;
};

const PLACES_USING = `SELECT
    (SELECT count(DISTINCT i.write_up_id) FROM write_up_include i
      WHERE i.workspace_id = ${scopeClause(1)} AND i.iri = $2)
  + (SELECT count(DISTINCT e.from_uid)
       FROM map_generation g
       JOIN map_edge e ON e.workspace_id = g.workspace_id AND e.gen = g.live_gen
      WHERE g.workspace_id = ${scopeClause(1)} AND e.to_uid = $2 AND e.label = '${LINKS_TO_LABEL}'
        AND e.from_uid <> $2) AS places`;

export const placesUsingReadableOrNot = async (
  principal: Principal,
  tx: Tx,
  iri: string,
): Promise<number> => {
  const found = await tx.query<{ places: string }>(PLACES_USING, [scopeParameter(principal), iri]);
  return Number(found.rows[0]?.places ?? 0);
};

export const cataloguedOf = async (
  principal: Principal,
  tx: Tx,
  documentIds: readonly string[],
): Promise<ReadonlySet<string>> => {
  const distinct = [...new Set(documentIds)];
  if (distinct.length === 0) return new Set();
  const found = await tx.query<{ id: string }>(
    `SELECT id FROM source_document
      WHERE workspace_id = ${scopeClause(1)} AND id = ANY($2::text[])`,
    [scopeParameter(principal), distinct],
  );
  return new Set(found.rows.map((row) => row.id));
};

export const holdsEveryDocument = async (
  principal: Principal,
  tx: Tx,
  documentIds: readonly string[],
): Promise<boolean> =>
  (await cataloguedOf(principal, tx, documentIds)).size === new Set(documentIds).size;

export type EvidenceRow = z.infer<typeof boundarySchemas.evidence.insert>;

export const evidenceOfSources = (
  workspaceId: EvidenceRow["workspaceId"],
  frontmatter: Frontmatter,
): readonly EvidenceRow[] => {
  const rows = new Map<string, EvidenceRow>();
  for (const { resource, locator } of citedSourcesOf(frontmatter["sources"])) {
    const passage = locator === null ? undefined : parsedPassageLocator(locator);
    if (locator === null || passage === undefined || IRI.test(resource)) continue;
    rows.set(locator, {
      workspaceId,
      sourceDocumentId: passage.sourceDocumentId,
      locator,
      resource,
      contentVersion: null,
    });
  }
  return [...rows.values()];
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

const statusOf = (facts: RowFacts, held: Held | undefined): string => {
  const fileStatus = facts.frontmatter["status"];
  return (
    facts.status ??
    (typeof fileStatus === "string" ? fileStatus : undefined) ??
    held?.status ??
    CONCEPT_DRAFT_STATUS
  );
};

const publishedAtOf = (status: string, held: Held | undefined, now: Date): Date | null =>
  PUBLISHED_STATUSES.some((published) => published === status) ? (held?.publishedAt ?? now) : null;

const rowVisibilityOf = (facts: RowFacts, held: Held | undefined) =>
  held === undefined
    ? {
        sensitivity: facts.sensitivity ?? SENSITIVITY_DEFAULT,
        audience: AUDIENCE_EVERYONE,
        audienceGroups: null,
      }
    : {
        sensitivity: held.sensitivity,
        audience: held.audience,
        audienceGroups: held.audienceGroups,
      };

export const indexRowOf = (facts: RowFacts, held: Held | undefined, now: Date) => {
  const status = statusOf(facts, held);
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
    publishedAt: publishedAtOf(status, held, now),
    ...rowVisibilityOf(facts, held),
  });
};

export type IndexRow = Extract<ReturnType<typeof indexRowOf>, { readonly success: true }>["data"];

type Landing = z.infer<typeof conceptRow> & {
  readonly mergeKey: string;
  readonly commit: Committed;
  readonly actor: ActorId;
  readonly auditEventId: string;

  readonly evidence: readonly EvidenceRow[];

  readonly restsAlsoOn: readonly Visibility[];

  readonly acceptance: Acceptance | undefined;
};

const landEvidence = async (
  principal: Principal,
  tx: Tx,
  iri: string,
  evidence: readonly EvidenceRow[],
): Promise<void> => {
  for (const piece of evidence) {
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
  await replaceCitations(principal, tx, iri, evidence);
};

export const landRows = async (principal: Principal, tx: Tx, index: Landing): Promise<void> => {
  await tx.query(
    `INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, iri) DO UPDATE SET merge_key = EXCLUDED.merge_key`,
    [index.workspaceId, index.iri, index.mergeKey],
  );
  await landEvidence(principal, tx, index.iri, index.evidence);
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
  await flagWriteUpsCiting(principal, tx, { iri: index.iri, contentHash: index.contentHash });
  await landBundleCommit(principal, tx, index);

  await writeConceptDelta(principal, tx, {
    workspaceId: index.workspaceId,
    iri: index.iri,
    kind: index.kind,
    path: index.path,
    body: index.body,
    sources: citedSourcesOf(index.frontmatter?.["sources"]),
    publishedAt: index.publishedAt ?? null,
    ...visibility,
    status: index.status,
  });

  if (!sameVisibility(held, visibility)) {
    await recomputeWriteUpsIncluding(principal, tx, { iris: [index.iri] });
  }
  if (index.acceptance !== undefined) {
    await landAcceptance(tx, index, index.acceptance);
  }
};

const landAcceptance = async (tx: Tx, index: Landing, acceptance: Acceptance): Promise<void> => {
  await markDeciding(tx, acceptance.suggestionId);
  const decided = await tx.query<{ id: string }>(
    `UPDATE suggestion
        SET status = $3, decider = $4, decided_at = now(), target_iri = $5
      WHERE workspace_id = $1 AND id = $2 AND status = $6
    RETURNING id`,
    [
      index.workspaceId,
      acceptance.suggestionId,
      SUGGESTION_ACCEPTED_STATUS,
      index.actor,
      index.iri,
      SUGGESTION_WAITING_STATUS,
    ],
  );
  if (decided.rows.length === 0) {
    throw new Error("the suggestion was decided by somebody else while this action was in flight");
  }
  if (acceptance.kind !== SUGGESTION_CITATION_FIX_KIND) return;

  await tx.query(
    `UPDATE concept_verification SET content_hash = $3, origin = $4
      WHERE workspace_id = $1 AND iri = $2 AND content_hash IS NOT NULL`,
    [index.workspaceId, index.iri, index.contentHash, VERIFICATION_CITATION_FIX_ORIGIN],
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

export type VerificationsCarried = {
  readonly concepts: number;

  readonly verifications: number;
};

type RewrittenRow = {
  readonly iri: string;
  readonly path: string;
  readonly commit_sha: string;
  readonly content_hash: string;
};

export const carryVerificationsOntoRewrite = async (
  platform: PlatformPrincipal,
  tx: Tx,
  door: GitDoor,
  input: { readonly workspaceId: string; readonly paths: readonly string[] },
): Promise<VerificationsCarried> => {
  if (input.paths.length === 0) return { concepts: 0, verifications: 0 };
  const indexed = await tx.query<RewrittenRow>(
    `SELECT iri, path, commit_sha, content_hash
       FROM concept_index
      WHERE workspace_id = ${scopeClause(1)} AND path = ANY($2::text[])`,
    [scopeParameter(platform), [...input.paths]],
  );

  let concepts = 0;
  let verifications = 0;
  for (const row of indexed.rows) {
    const content = await fileAt(platform, door, input.workspaceId, row.commit_sha, row.path);

    if (content === null) continue;
    const read = parseConceptFile(content);
    if (!read.ok) {
      throw new Error(`concepts: the bundle holds a file the platform cannot read: ${row.path}`);
    }
    const contentHash = contentHashOf(read.value.frontmatter, read.value.body, row.path);

    const reindexed = await tx.query(
      `UPDATE concept_index SET frontmatter = $3, body = $4, content_hash = $5
        WHERE workspace_id = ${scopeClause(1)} AND iri = $2
          AND (frontmatter IS DISTINCT FROM $3::jsonb OR body IS DISTINCT FROM $4
               OR content_hash IS DISTINCT FROM $5)`,
      [scopeParameter(platform), row.iri, read.value.frontmatter, read.value.body, contentHash],
    );
    concepts += reindexed.rowCount ?? 0;
    if (contentHash === row.content_hash) continue;
    const moved = await tx.query(
      `UPDATE concept_verification SET content_hash = $3, origin = $4
        WHERE workspace_id = ${scopeClause(1)} AND iri = $2 AND content_hash IS NOT NULL`,
      [scopeParameter(platform), row.iri, contentHash, VERIFICATION_ERASURE_ORIGIN],
    );
    verifications += moved.rowCount ?? 0;
  }
  return { concepts, verifications };
};
