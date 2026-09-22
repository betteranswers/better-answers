import {
  boundarySchemas,
  conceptIriOf,
  SUGGESTION_EDIT_KIND,
  SUGGESTION_SET_MAX,
} from "@better-answers/schema";
import { z } from "zod";

import { readableClause, readableParameters, widens } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  isActorId,
  ok,
  personOfActor,
  refusalFor,
  requireAdmin,
  ulid,
  type ActorId,
  type Clock,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  commit as commitToBundle,
  head,
  withRepositoryLock,
  type CommitAuthor,
  type CommitRefusal,
  type GitDoor,
} from "../store/git/index.ts";
import { withMembership, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { hashedFileOf, renderConceptFile, type Frontmatter } from "./file.ts";
import {
  payloadFor,
  returnToProposer,
  suggestionIsWaiting,
  targetOfMergeKey,
  type SuggestionKind,
  type SuggestionPayload,
} from "./inbox.ts";
import {
  foldKind,
  heldByIri,
  heldVisibilityOf,
  holdsEveryDocument,
  indexRowOf,
  landRows,
  WRITE_CONSTRAINTS,
} from "./landing.ts";
import { conceptVisibilityFrom } from "./visibility.ts";

export {
  canonicalFrontmatter,
  contentHashOf,
  parseConceptFile,
  renderConceptFile,
  type Frontmatter,
  type FrontmatterSource,
  type FrontmatterValue,
} from "./file.ts";
export {
  carryChecksOntoRewrite,
  foldKind,
  moveBundleCommits,
  type ChecksCarried,
} from "./landing.ts";
export {
  writeManifest,
  type ManifestWritten,
  type WriteManifestInput,
  type WriteManifestRefusal,
} from "./manifest.ts";
export {
  RECONCILER,
  reconcile,
  reconcileEveryWorkspace,
  reconcilerHits,
  type ReconcileRefusal,
  type Reconciled,
  type ReconcilerHit,
  type ReconcilerPrincipal,
  type ReplayRefusal,
  type WorkspaceReconciled,
} from "./reconciler.ts";
export {
  declineSuggestion,
  submitSuggestionSet,
  suggestionSetSummary,
  type DecideSuggestionInput,
  type DecideSuggestionRefusal,
  type SubmitSuggestionSetInput,
  type SubmitSuggestionSetRefusal,
  type SuggestionDecided,
  type SuggestionKind,
  type SuggestionRequest,
  type SuggestionSetSubmitted,
  type SuggestionStatus,
  type SuggestionSummaryItem,
} from "./inbox.ts";
export {
  evidencePaneOf,
  overrideConceptClass,
  openingACascadeOverHeldGroups,
  recomputeVisibilitySourcedFrom,
  type ConceptClassOverridden,
  type EvidencePane,
  type OverrideConceptClassInput,
  type OverrideConceptClassRefusal,
  type ReadableEvidence,
} from "./visibility.ts";
export {
  GRAPH_MAINTENANCE,
  graphCounts,
  sweepGraph,
  type GraphMaintenancePrincipal,
  type GraphMaintenanceRefusal,
} from "./graph-maintenance.ts";
export type { GraphCounts, SweptGeneration } from "../store/graph/index.ts";

const CONCEPT_ACTS = declareActs("knowledge", {
  committed: act("knowledge.concept.committed", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
    evidenceCount: "count",
  }),
  accepted: act("knowledge.suggestion.accepted", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
    setId: "id",
  }),
});

export type EvidenceInput = {
  readonly sourceDocumentId: string;
  readonly locator: string;

  readonly resource: string;
  readonly contentVersion?: string;
};

export type WritePrecondition = { readonly head: string | null } | { readonly base: string | null };

export type Acceptance = {
  readonly suggestionId: string;
  readonly setId: string;
  readonly kind: SuggestionKind;

  readonly batchId?: string | undefined;
};

export type WriteConceptInput = {
  readonly iri?: string | undefined;

  readonly mergeKey: string;

  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;

  readonly message: string;

  readonly author: CommitAuthor;

  readonly expects: WritePrecondition;

  readonly acceptance?: Acceptance | undefined;

  readonly sensitivity?: string;
  readonly status?: string;
  readonly evidence?: readonly EvidenceInput[];
};

export type ConceptWritten = {
  readonly iri: string;

  readonly sha: string;

  readonly auditEventId: string;
  readonly contentHash: string;
};

export type WriteConceptRefusal =
  | RoleRefusal
  | CommitRefusal
  | PrincipalRefusal
  | "malformed"
  | "path-taken"
  | "merge-key-taken"
  | "rename-refused"
  | "reclassification-refused"
  | "widening-refused"
  | "no-such-concept"
  | "no-such-document"
  | "already-decided"
  | "resolution-moved";

export { citedSourceOf as citedSource } from "@better-answers/schema";

const mayWrite = (principal: UserPrincipal): boolean => principal.role !== "Viewer";

const fileFrontmatterOf = (input: WriteConceptInput, iri: string) => {
  const named = { ...input.frontmatter };
  if (typeof named["type"] !== "string") named["type"] = input.kind;
  if (typeof named["title"] !== "string") named["title"] = input.title;
  if (input.status !== undefined) named["status"] = input.status;
  named["iri"] = iri;
  return named;
};

export const writeConcept = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  input: WriteConceptInput,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  if (!mayWrite(principal)) return err("role-forbids");

  if (input.acceptance !== undefined) {
    const admin = requireAdmin(principal);
    if (!admin.ok) return err(admin.error);
    if (!("base" in input.expects)) return err("malformed");
  }

  const iri = input.iri ?? conceptIriOf(ulid());
  const frontmatter = fileFrontmatterOf(input, iri);
  const { contentHash, sources } = hashedFileOf(frontmatter, input.body, input.path);
  const mergeKey = boundarySchemas.conceptIdentity.insert.shape.mergeKey.safeParse(input.mergeKey);

  const evidence = boundarySchemas.evidence.insert.array().safeParse(
    (input.evidence ?? []).map((piece) => ({
      workspaceId: principal.workspaceId,
      sourceDocumentId: piece.sourceDocumentId,
      locator: piece.locator,
      resource: piece.resource,
      contentVersion: piece.contentVersion ?? null,
    })),
  );
  if (!mergeKey.success || !evidence.success) return err("malformed");

  const auditEventId = ulid();

  return withRepositoryLock(principal, doors.git, async () => {
    const existing = await attempt(() =>
      withMembership(principal, doors.postgres, async (fresh, tx) => {
        const held = await heldByIri(fresh, tx, iri);
        return {
          held,

          derived:
            held === undefined
              ? undefined
              : await conceptVisibilityFrom(fresh, tx, {
                  iri,
                  kind: foldKind(input.kind),
                  fallback: heldVisibilityOf(held),
                  citing: evidence.data.map((piece) => piece.sourceDocumentId),
                }),

          catalogued: await holdsEveryDocument(
            fresh,
            tx,
            evidence.data.map((piece) => piece.sourceDocumentId),
          ),

          resolved: await targetOfMergeKey(fresh, tx, input.mergeKey),
          waiting:
            input.acceptance === undefined ||
            (await suggestionIsWaiting(fresh, tx, input.acceptance.suggestionId)),
        };
      }),
    );
    if (!existing.ok) return err(existing.error);
    if (!existing.value.ok) return err(existing.value.error);
    const { held, derived, resolved, waiting, catalogued } = existing.value.value;

    if (input.iri !== undefined && held === undefined) return err("no-such-concept");

    if (!catalogued) return err("no-such-document");

    if (!waiting) return err("already-decided");

    if (resolved !== undefined && resolved !== iri) return err("merge-key-taken");

    if (input.acceptance !== undefined && input.iri !== undefined && resolved !== iri) {
      return err("resolution-moved");
    }

    if ("base" in input.expects && (held?.contentHash ?? null) !== input.expects.base) {
      return err("stale-precondition");
    }
    if (held !== undefined && held.path !== input.path) return err("rename-refused");
    if (
      held !== undefined &&
      input.sensitivity !== undefined &&
      input.sensitivity !== held.sensitivity
    ) {
      return err("reclassification-refused");
    }

    if (held !== undefined && derived !== undefined && widens(heldVisibilityOf(held), derived)) {
      return err("widening-refused");
    }

    const now = doors.clock.now();
    const parsed = indexRowOf(
      {
        workspaceId: principal.workspaceId,
        iri,
        path: input.path,
        kind: input.kind,
        title: input.title,
        frontmatter,
        body: input.body,
        contentHash,
        status: input.status,
        sensitivity: input.sensitivity,
      },
      held,
      now,
    );
    if (!parsed.success) return err("malformed");
    const row = parsed.data;

    const committed = await commitToBundle(principal, doors.git, {
      path: row.path,
      content: renderConceptFile(frontmatter, input.body),
      message: input.message,
      author: input.author,
      trailers: {
        actor: actorIdOf(principal),
        audit: auditEventId,

        suggestion: input.acceptance?.suggestionId,
      },

      expectedHead: "head" in input.expects ? input.expects.head : await head(principal, doors.git),
      at: now,
    });
    if (!committed.ok) return err(committed.error);

    const landed = await attempt(() =>
      withMembership(principal, doors.postgres, async (fresh, tx) => {
        const acceptance = input.acceptance;
        if (acceptance === undefined) {
          await record(fresh, tx, {
            id: auditEventId,
            act: CONCEPT_ACTS.committed,
            subjectId: row.iri,
            detail: {
              iri: row.iri,
              commitSha: committed.value.sha,
              contentHash,
              evidenceCount: evidence.data.length,
            },
          });
        } else {
          await record(fresh, tx, {
            id: auditEventId,
            act: CONCEPT_ACTS.accepted,
            subjectId: acceptance.suggestionId,
            batchId: acceptance.batchId,
            detail: {
              iri: row.iri,
              commitSha: committed.value.sha,
              contentHash,
              setId: acceptance.setId,
            },
          });
        }
        await landRows(fresh, tx, {
          ...row,
          mergeKey: mergeKey.data,
          commit: committed.value,
          actor: actorIdOf(fresh),
          auditEventId,
          sources,
          evidence: evidence.data,
          restsAlsoOn: [],
          acceptance,
        });
      }),
    );
    if (!landed.ok) {
      const named = refusalFor(landed.error, WRITE_CONSTRAINTS);
      return err(typeof named === "string" ? named : landed.error);
    }
    if (!landed.value.ok) return err(landed.value.error);

    return ok({ iri: row.iri, sha: committed.value.sha, auditEventId, contentHash });
  });
};

export type AcceptanceDecision = {
  readonly suggestionId: string;
  readonly expectedTarget: string | null;
};

const ACCEPTANCE_DECISIONS = z
  .object({
    suggestionId: boundarySchemas.suggestion.select.shape.id,
    expectedTarget: boundarySchemas.suggestion.select.shape.targetIri,
  })
  .array()
  .nonempty()
  .max(SUGGESTION_SET_MAX);

export type AcceptSuggestionRefusal =
  | WriteConceptRefusal
  | "no-such-suggestion"
  | "already-decided"
  | "resolution-moved";

export type AcceptanceOutcome = {
  readonly suggestionId: string;
  readonly outcome: Result<ConceptWritten, AcceptSuggestionRefusal | Error>;
};

type AuthorRow = { readonly name: string; readonly email: string };

const authorFor = async (
  principal: UserPrincipal,
  tx: Tx,
  payload: SuggestionPayload,
): Promise<CommitAuthor | undefined> => {
  const proposer =
    payload.kind === SUGGESTION_EDIT_KIND ? personOfActor(payload.proposer) : undefined;
  for (const personId of proposer === undefined
    ? [principal.userId]
    : [proposer, principal.userId]) {
    const found = await tx.query<AuthorRow>(
      `SELECT u.name, u.email FROM "user" u
         JOIN member m ON m.user_id = u.id AND m.workspace_id = $2
        WHERE u.id = $1`,
      [personId, principal.workspaceId],
    );
    const row = found.rows[0];
    if (row !== undefined) return { name: row.name, email: row.email };
  }
  return undefined;
};

type Prepared = {
  readonly payload: SuggestionPayload;
  readonly target: string | undefined;
  readonly author: CommitAuthor;
};

const acceptanceMessage = (title: string): string =>
  `Accept the suggested change to ${title.replaceAll(/\s+/gu, " ").trim()}`;

export const acceptSuggestions = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  input: { readonly decisions: readonly AcceptanceDecision[] },
): Promise<
  Result<readonly AcceptanceOutcome[], RoleRefusal | PrincipalRefusal | "malformed" | Error>
> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);

  const decisions = ACCEPTANCE_DECISIONS.safeParse(input.decisions);
  if (!decisions.success) return err("malformed");

  const batchId = decisions.data.length > 1 ? ulid() : undefined;
  const outcomes: AcceptanceOutcome[] = [];
  for (const decision of decisions.data) {
    outcomes.push(await acceptOne(principal, doors, decision, batchId));
  }
  return ok(outcomes);
};

const acceptOne = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  decision: AcceptanceDecision,
  batchId: string | undefined,
): Promise<AcceptanceOutcome> => {
  const refused = (why: AcceptSuggestionRefusal | Error): AcceptanceOutcome => ({
    suggestionId: decision.suggestionId,
    outcome: err(why),
  });

  const returning = async (why: AcceptSuggestionRefusal, reason: string) => {
    const returned = await returnToProposer(principal, doors, {
      suggestionId: decision.suggestionId,
      reason,
    });
    return refused(returned.ok ? why : returned.error);
  };

  const prepared = await attempt(() =>
    withMembership(principal, doors.postgres, async (fresh, tx) => {
      const payload = await payloadFor(fresh, tx, decision.suggestionId);
      if (payload === undefined) return undefined;
      const target = await targetOfMergeKey(fresh, tx, payload.mergeKey);
      const author = await authorFor(fresh, tx, payload);
      return author === undefined ? undefined : { payload, target, author };
    }),
  );
  if (!prepared.ok) return refused(prepared.error);
  if (!prepared.value.ok) return refused(prepared.value.error);
  const found: Prepared | undefined = prepared.value.value;
  if (found === undefined) return refused("no-such-suggestion");

  const moved = "the concept this suggestion resolves to moved after the set was opened";

  if ((found.target ?? null) !== decision.expectedTarget) {
    return returning("resolution-moved", moved);
  }

  const written = await writeConcept(principal, doors, {
    iri: found.target,
    mergeKey: found.payload.mergeKey,
    path: found.payload.path,
    kind: found.payload.conceptKind,
    title: found.payload.title,
    frontmatter: found.payload.frontmatter,
    body: found.payload.body,
    message: acceptanceMessage(found.payload.title),
    author: found.author,
    expects: { base: found.payload.baseContentHash },
    acceptance: {
      suggestionId: decision.suggestionId,
      setId: found.payload.setId,
      kind: found.payload.kind,
      batchId,
    },
  });
  if (written.ok) return { suggestionId: decision.suggestionId, outcome: ok(written.value) };

  if (written.error === "merge-key-taken" || written.error === "resolution-moved") {
    return returning("resolution-moved", moved);
  }
  if (written.error === "stale-precondition") {
    return returning("stale-precondition", "the concept moved after this suggestion was written");
  }
  return refused(written.error);
};

export type ConceptCheck = {
  readonly actor: ActorId;
  readonly at: Date;

  readonly contentHash: string | null;
};

export type OpenedConcept = {
  readonly iri: string;
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly status: string;
  readonly contentHash: string;
  readonly commitSha: string;
  readonly check: ConceptCheck | undefined;
};

type ConceptRow = {
  readonly iri: string;
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly status: string;
  readonly content_hash: string;
  readonly commit_sha: string;
  readonly checked_by: string | null;
  readonly checked_at: Date | null;
  readonly checked_hash: string | null;
};

const CONCEPT_SELECT = `SELECT c.iri, c.path, c.kind, c.title, c.frontmatter, c.body, c.status,
              c.content_hash, c.commit_sha,
              v.actor AS checked_by, v.checked_at, v.content_hash AS checked_hash
         FROM concept_index c
         LEFT JOIN LATERAL (
                SELECT actor, checked_at, content_hash
                  FROM concept_verification
                 WHERE workspace_id = c.workspace_id AND iri = c.iri
                 ORDER BY checked_at DESC, id DESC
                 LIMIT 1
              ) v ON true
        WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}`;

const openedOf = (row: ConceptRow): OpenedConcept => ({
  iri: row.iri,
  path: row.path,
  kind: row.kind,
  title: row.title,
  frontmatter: row.frontmatter,
  body: row.body,
  status: row.status,
  contentHash: row.content_hash,
  commitSha: row.commit_sha,
  check: checkOf(row),
});

export const conceptByIri = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: string,
): Promise<Result<OpenedConcept | undefined, Error>> => {
  const found = await attempt(() =>
    tx.query<ConceptRow>(`${CONCEPT_SELECT} AND c.iri = $4`, [
      principal.workspaceId,
      ...readableParameters(principal),
      iri,
    ]),
  );
  if (!found.ok) return err(found.error);
  const row = found.value.rows[0];
  return ok(row === undefined ? undefined : openedOf(row));
};

const likeEscaped = (text: string): string => text.replaceAll(/[\\%_]/g, String.raw`\$&`);

export const findConcepts = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly query: string; readonly limit: number },
): Promise<Result<readonly OpenedConcept[], Error>> => {
  const query = input.query.trim();
  if (query === "" || input.limit < 1) return ok([]);
  const found = await attempt(() =>
    tx.query<ConceptRow>(
      `${CONCEPT_SELECT} AND (c.title ILIKE $4 OR c.body ILIKE $4)
        ORDER BY c.title, c.iri LIMIT $5`,
      [
        principal.workspaceId,
        ...readableParameters(principal),
        `%${likeEscaped(query)}%`,
        input.limit,
      ],
    ),
  );
  if (!found.ok) return err(found.error);
  return ok(found.value.rows.map(openedOf));
};

const checkOf = (row: ConceptRow): ConceptCheck | undefined => {
  if (row.checked_by === null || row.checked_at === null || !isActorId(row.checked_by)) {
    return undefined;
  }
  return { actor: row.checked_by, at: row.checked_at, contentHash: row.checked_hash };
};
