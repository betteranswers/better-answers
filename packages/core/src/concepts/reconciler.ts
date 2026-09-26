import {
  boundarySchemas,
  BUNDLE_MANIFEST_PATH,
  IRI,
  resolvedResource,
  ULID,
} from "@better-answers/schema";

import { batchIdFor, eventsOfAct, record } from "../audit/index.ts";
import {
  attempt,
  attemptResult,
  err,
  isActorId,
  ok,
  refusalFor,
  type ActorId,
  type Clock,
  type PlatformPrincipal,
  type Result,
  type WorkspaceId,
} from "../kernel/index.ts";
import {
  commitsAfter,
  readCommit,
  withRepositoryLockAs,
  type CommitRead,
  type GitDoor,
} from "../store/git/index.ts";
import {
  scopeClause,
  scopeParameter,
  withScope,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";
import { workspaceIds } from "../workspaces/index.ts";
import { hashedFileOf, parseConceptFile, type Frontmatter, type HashedSource } from "./file.ts";
import { payloadFor, targetOfMergeKey } from "./inbox.ts";
import type { Acceptance } from "./index.ts";
import {
  heldByIri,
  indexRowOf,
  type IndexRow,
  landBundleCommit,
  landRows,
  mergeKeyOf,
  WRITE_CONSTRAINTS,
  type Held,
} from "./landing.ts";
import { parseBundleManifest } from "./manifest.ts";
import { RECONCILER_ACTS, restsAlsoOnWhenReplayed } from "./reconciler-hit.ts";

const RECONCILER_ACTOR = "process:better-answers-reconciler";

export type ReconcilerPrincipal = PlatformPrincipal & {
  readonly actorId: typeof RECONCILER_ACTOR;
};

export const RECONCILER: ReconcilerPrincipal = { kind: "platform", actorId: RECONCILER_ACTOR };

type ReplayRefusal = "unreadable-commit" | "rename-refused" | "path-taken" | "merge-key-taken";

export type Reconciled = {
  readonly workspaceId: string;

  readonly head: string | null;

  readonly watermark: string | null;

  readonly replayed: readonly string[];

  readonly skipped: readonly string[];

  readonly stopped: { readonly sha: string; readonly reason: ReplayRefusal | Error } | undefined;
};

export type ReconcileRefusal = "malformed" | "no-such-repository" | "history-diverged";

type Replayed = "landed" | "skipped";

type TrailerFacts = {
  readonly sha: string;
  readonly parent: string | null;
  readonly actor: ActorId;
  readonly auditEventId: string;
  readonly suggestionId: string | undefined;
};

type CommitFacts = TrailerFacts & {
  readonly path: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly iri: string;
};

const trailerFactsOf = (read: CommitRead): TrailerFacts | undefined => {
  const actor = read.trailers["Actor"];
  const audit = read.trailers["Audit"];
  if (actor === undefined || !isActorId(actor) || audit === undefined || !ULID.test(audit)) {
    return undefined;
  }
  return {
    sha: read.sha,
    parent: read.parent,
    actor,
    auditEventId: audit,
    suggestionId: read.trailers["Suggestion"],
  };
};

const factsOf = (read: CommitRead, trailers: TrailerFacts): CommitFacts | undefined => {
  if (read.change === undefined) return undefined;
  const parsed = parseConceptFile(read.change.content);
  if (!parsed.ok) return undefined;
  const iri = parsed.value.frontmatter["iri"];
  if (typeof iri !== "string" || !IRI.test(iri)) return undefined;
  return {
    ...trailers,
    path: read.change.path,
    frontmatter: parsed.value.frontmatter,
    body: parsed.value.body,
    iri,
  };
};

const alreadyLanded = async (
  platform: PlatformPrincipal,
  tx: Tx,
  trailers: TrailerFacts,
): Promise<boolean> => {
  const known = await tx.query(
    `SELECT 1 FROM bundle_commit
      WHERE workspace_id = ${scopeClause(1)} AND (sha = $2 OR audit_event_id = $3)`,
    [scopeParameter(platform), trailers.sha, trailers.auditEventId],
  );
  return (known.rowCount ?? 0) > 0;
};

const replayManifestCommit = async (
  platform: ReconcilerPrincipal,
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  content: string,
  trailers: TrailerFacts,
  batchId: string | undefined,
): Promise<Result<Replayed, ReplayRefusal | Error>> => {
  const manifest = parseBundleManifest(content);
  if (!manifest.ok) return err("unreadable-commit");
  const landed = await attempt(() =>
    withScope(platform, door, workspaceId, async (tx): Promise<Replayed> => {
      if (await alreadyLanded(platform, tx, trailers)) return "skipped";
      await record(platform, tx, {
        id: trailers.auditEventId,
        act: RECONCILER_ACTS.replayed,
        subjectId: trailers.sha,
        batchId,
        detail: { commitSha: trailers.sha, bundleId: manifest.value.id },
      });
      await landBundleCommit(platform, tx, {
        commit: { sha: trailers.sha, parent: trailers.parent },
        actor: trailers.actor,
        auditEventId: trailers.auditEventId,
      });
      return "landed";
    }),
  );
  return landed.ok ? ok(landed.value) : err(landed.error);
};

const stringIn = (frontmatter: Frontmatter, key: string): string | undefined => {
  const value = frontmatter[key];
  return typeof value === "string" ? value : undefined;
};

const derivedMergeKey = async (
  platform: PlatformPrincipal,
  tx: Tx,
  iri: string,
  kind: string,
  title: string,
): Promise<string> => {
  const derived = mergeKeyOf(kind, title);
  const holder = await targetOfMergeKey(platform, tx, derived);
  return holder === undefined || holder === iri ? derived : iri;
};

const fileCitesTheStandingEvidence = async (
  platform: PlatformPrincipal,
  tx: Tx,
  facts: CommitFacts,
  cited: readonly HashedSource[],
): Promise<boolean> => {
  const standing = await tx.query<{ resource: string; locator: string }>(
    `SELECT e.resource, ce.locator
       FROM concept_evidence ce
       JOIN evidence e ON e.workspace_id = ce.workspace_id
                      AND e.source_document_id = ce.source_document_id AND e.locator = ce.locator
      WHERE ce.workspace_id = ${scopeClause(1)} AND ce.iri = $2`,
    [scopeParameter(platform), facts.iri],
  );
  const pairs = (sources: readonly HashedSource[]) =>
    new Set(sources.map((pair) => JSON.stringify(pair)));
  const filed = pairs(cited);
  const held = pairs(
    standing.rows.map((row) => [resolvedResource(row.resource, facts.path), row.locator]),
  );
  return filed.size === held.size && [...filed].every((pair) => held.has(pair));
};

const lastRecordedCommit = async (platform: PlatformPrincipal, tx: Tx): Promise<string | null> => {
  const found = await tx.query<{ sha: string }>(
    `SELECT sha FROM bundle_commit WHERE workspace_id = ${scopeClause(1)}
      ORDER BY committed_at DESC, sha DESC LIMIT 1`,
    [scopeParameter(platform)],
  );
  return found.rows[0]?.sha ?? null;
};

type Suggested = {
  readonly mergeKey: string | undefined;
  readonly acceptance: Acceptance | undefined;
};

const suggestedBy = async (
  platform: PlatformPrincipal,
  tx: Tx,
  suggestionId: string | undefined,
): Promise<Suggested> => {
  const payload =
    suggestionId === undefined ? undefined : await payloadFor(platform, tx, suggestionId);
  return suggestionId === undefined || payload === undefined
    ? { mergeKey: undefined, acceptance: undefined }
    : {
        mergeKey: payload.mergeKey,
        acceptance: { suggestionId, setId: payload.setId, kind: payload.kind },
      };
};

type Replayable = { readonly row: IndexRow; readonly sources: readonly HashedSource[] };

const replayableOf = (
  workspaceId: WorkspaceId,
  facts: CommitFacts,
  held: Held | undefined,
  clock: Clock,
): Replayable | undefined => {
  const kind = stringIn(facts.frontmatter, "type") ?? held?.kind;
  const title = stringIn(facts.frontmatter, "title") ?? held?.title;
  if (kind === undefined || title === undefined) return undefined;
  const { contentHash, sources } = hashedFileOf(facts.frontmatter, facts.body, facts.path);

  const parsed = indexRowOf(
    {
      workspaceId,
      iri: facts.iri,
      path: facts.path,
      kind,
      title,
      frontmatter: facts.frontmatter,
      body: facts.body,
      contentHash,
      status: stringIn(facts.frontmatter, "status"),
      sensitivity: undefined,
    },
    held,
    clock.now(),
  );
  return parsed.success ? { row: parsed.data, sources } : undefined;
};

const replayCommit = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  workspaceId: WorkspaceId,
  sha: string,
  batchId: string | undefined,
): Promise<Result<Replayed, ReplayRefusal | Error>> => {
  const read = await attempt(() => readCommit(platform, doors.git, workspaceId, sha));
  if (!read.ok) return err(read.error);
  const trailers = trailerFactsOf(read.value);
  if (trailers === undefined) return err("unreadable-commit");
  if (read.value.change?.path === BUNDLE_MANIFEST_PATH) {
    return replayManifestCommit(
      platform,
      doors.postgres,
      workspaceId,
      read.value.change.content,
      trailers,
      batchId,
    );
  }
  const facts = factsOf(read.value, trailers);
  if (facts === undefined) return err("unreadable-commit");

  const landed = await attemptResult(() =>
    withScope(
      platform,
      doors.postgres,
      workspaceId,
      async (tx): Promise<Result<Replayed, ReplayRefusal>> => {
        if (await alreadyLanded(platform, tx, facts)) return ok("skipped");

        const held = await heldByIri(platform, tx, facts.iri);

        if (held !== undefined && held.path !== facts.path) return err("rename-refused");
        const suggested = await suggestedBy(platform, tx, facts.suggestionId);
        const replayable = replayableOf(workspaceId, facts, held, doors.clock);
        if (replayable === undefined) return err("unreadable-commit");
        const { row, sources } = replayable;
        const mergeKey =
          suggested.mergeKey ??
          held?.mergeKey ??
          (await derivedMergeKey(platform, tx, row.iri, row.kind, row.title));
        const evidenceAgrees = await fileCitesTheStandingEvidence(platform, tx, facts, sources);

        await record(platform, tx, {
          id: facts.auditEventId,
          act: RECONCILER_ACTS.replayed,
          subjectId: facts.sha,
          batchId,
          detail: {
            iri: row.iri,
            commitSha: facts.sha,
            contentHash: row.contentHash,
            evidenceAgrees,
          },
        });
        await landRows(platform, tx, {
          ...row,
          mergeKey,
          commit: { sha: facts.sha, parent: facts.parent },
          actor: facts.actor,
          auditEventId: facts.auditEventId,
          sources,

          evidence: undefined,

          restsAlsoOn: restsAlsoOnWhenReplayed(evidenceAgrees),
          acceptance: suggested.acceptance,
        });
        return ok("landed");
      },
    ),
  );
  if (!landed.ok && landed.error instanceof Error) {
    return err(refusalFor(landed.error, WRITE_CONSTRAINTS));
  }
  return landed;
};

/**
 * Replays, oldest first and under the repository lock, each bundle commit after the last one
 * the index recorded. The first commit it cannot replay ends the pass and is named in
 * `stopped`, not refused.
 */
export const reconcile = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  input: { readonly workspaceId: string },
): Promise<Result<Reconciled, ReconcileRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const workspaceId = workspace.data;

  return withRepositoryLockAs(platform, doors.git, workspaceId, async () => {
    const watermark = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, (tx) => lastRecordedCommit(platform, tx)),
    );
    if (!watermark.ok) return err(watermark.error);
    const scanned = await commitsAfter(platform, doors.git, workspaceId, watermark.value);
    if (!scanned.ok) return err(scanned.error);

    const batchId = batchIdFor(scanned.value.missed.length);
    const replayed: string[] = [];
    const skipped: string[] = [];
    let stopped: Reconciled["stopped"];
    for (const sha of scanned.value.missed) {
      const outcome = await replayCommit(platform, doors, workspaceId, sha, batchId);
      if (!outcome.ok) {
        stopped = { sha, reason: outcome.error };
        break;
      }
      (outcome.value === "landed" ? replayed : skipped).push(sha);
    }
    return ok({
      workspaceId,
      head: scanned.value.head,
      watermark: watermark.value,
      replayed,
      skipped,
      stopped,
    });
  });
};

export type ReconcilerHit = {
  readonly commitSha: string;

  readonly auditEventId: string;
  readonly at: Date;

  readonly batchId: string | null;
};

/** Oldest first; `since` is inclusive. */
export const reconcilerHits = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string; readonly since?: Date | undefined },
): Promise<Result<readonly ReconcilerHit[], "malformed" | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const read = await attempt(() =>
    withScope(platform, door, workspace.data, (tx) =>
      eventsOfAct(platform, tx, RECONCILER_ACTS.replayed, input.since),
    ),
  );
  if (!read.ok) return err(read.error);
  return ok(
    read.value.map((row) => ({
      commitSha: row.subjectId,
      auditEventId: row.id,
      at: row.at,
      batchId: row.batchId,
    })),
  );
};

export type WorkspaceReconciled = {
  readonly workspaceId: string;
  readonly outcome: Result<Reconciled, ReconcileRefusal | Error>;
};

export const reconcileEveryWorkspace = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
): Promise<Result<readonly WorkspaceReconciled[], Error>> => {
  const held = await workspaceIds(platform, doors.postgres);
  if (!held.ok) return err(held.error);
  const outcomes: WorkspaceReconciled[] = [];
  for (const workspaceId of held.value) {
    outcomes.push({ workspaceId, outcome: await reconcile(platform, doors, { workspaceId }) });
  }
  return ok(outcomes);
};
