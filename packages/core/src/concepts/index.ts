import { z } from "zod";

import {
  boundarySchemas,
  CONCEPT_STABLE_STATUS,
  conceptIriOf,
  SUGGESTION_EDIT_KIND,
  SUGGESTION_SET_MAX,
  type BundleManifest,
  type SENSITIVITIES,
} from "@better-answers/schema";

import {
  readableClause,
  readableParameters,
  readsSensitivity,
  widens,
  type Sensitivity,
  type Visibility,
} from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import {
  actorIdOf,
  actorIdOfPerson,
  attempt,
  err,
  isActorId,
  ok,
  PERSON_PREFIX,
  personOfActor,
  refusalFor,
  requireAdmin,
  ulid,
  type ActorId,
  type Clock,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  commit as commitToBundle,
  head,
  withRepositoryLock,
  type CommitAuthor,
  type CommitRefusal,
  type Committed,
  type GitDoor,
} from "../store/git/index.ts";
import { containing, withMembership, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import {
  hashedFileOf,
  renderConceptFile,
  type Frontmatter,
  type FrontmatterSource,
  type HashedSource,
} from "./file.ts";
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
  holderOfPath,
  holdsEveryDocument,
  indexRowOf,
  type IndexRow,
  landRows,
  WRITE_CONSTRAINTS,
  type Held,
} from "./landing.ts";
import {
  authorOf,
  countChecks,
  IMPORT_SENSITIVITY_DEFAULT,
  personIdsByEmail,
  presentChecks,
  readBundle,
  recordImportedChecks,
  rewriteLinks,
  standingAt,
  type BundleTree,
  type ChecksRecorded,
  type ImportedCheck,
  type LoadedConcept,
  type StandingConcept,
  type Unsound,
} from "./loader.ts";
import { manifestAtHead, writeManifest, type WriteManifestRefusal } from "./manifest.ts";
import { conceptVisibilityFrom } from "./visibility.ts";

export {
  canonicalFrontmatter,
  contentHashOf,
  parseConceptFile,
  renderConceptFile,
  type Frontmatter,
  type FrontmatterValue,
} from "./file.ts";
export { carryChecksOntoRewrite, foldKind, moveBundleCommits } from "./landing.ts";
export {
  ERASURE_REHEARSAL_PATH,
  IMPORT_SENSITIVITY_DEFAULT,
  type BundleTree,
  type UnsoundReason,
} from "./loader.ts";
export { writeManifest, type ManifestWritten, type WriteManifestInput } from "./manifest.ts";
export {
  RECONCILER,
  reconcile,
  reconcileEveryWorkspace,
  reconcilerHits,
  type Reconciled,
  type WorkspaceReconciled,
} from "./reconciler.ts";
/** @public S5 */
export type { ReconcilerHit } from "./reconciler.ts";
export {
  declineSuggestion,
  submitSuggestionSet,
  suggestionSetSummary,
  type SuggestionKind,
  type SuggestionRequest,
} from "./inbox.ts";
/** @public S3 */
export type {
  DecideSuggestionInput,
  DecideSuggestionRefusal,
  SubmitSuggestionSetInput,
  SubmitSuggestionSetRefusal,
  SuggestionDecided,
  SuggestionSetSubmitted,
} from "./inbox.ts";
/** @public S5 */
export type { SuggestionSummaryItem } from "./inbox.ts";
export {
  evidencePaneOf,
  overrideConceptClass,
  openingACascadeOverHeldGroups,
  recomputeVisibilitySourcedFrom,
} from "./visibility.ts";
/** @public S3 */
export type {
  ConceptClassOverridden,
  OverrideConceptClassInput,
  OverrideConceptClassRefusal,
} from "./visibility.ts";
/** @public S2 */
export type { EvidencePane } from "./visibility.ts";
export {
  GRAPH_MAINTENANCE,
  graphCounts,
  rebuildGraph,
  sweepGraph,
  type GraphMaintenanceRefusal,
} from "./graph-maintenance.ts";
export type { SweptGeneration } from "../store/graph/index.ts";

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

type EvidenceInput = {
  readonly sourceDocumentId: string;
  readonly locator: string;

  readonly resource: string;
  readonly contentVersion?: string;
};

/**
 * `head` expects the bundle's head commit, `null` for an empty bundle; `base` expects the
 * standing concept's content hash, `null` for a new concept.
 */
type WritePrecondition = { readonly head: string | null } | { readonly base: string | null };

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

type WriteDoors = { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock };

const requestRefusalOf = (
  principal: UserPrincipal,
  input: WriteConceptInput,
): WriteConceptRefusal | undefined => {
  if (!mayWrite(principal)) return "role-forbids";
  if (input.acceptance === undefined) return undefined;
  const admin = requireAdmin(principal);
  if (!admin.ok) return admin.error;
  return "base" in input.expects ? undefined : "malformed";
};

/**
 * Commits one concept file under the repository lock, then writes its rows and audit event in
 * one transaction. An `iri` edits a concept that must already stand; an `acceptance` asks for
 * an Admin and a `base` precondition.
 */
export const writeConcept = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  input: WriteConceptInput,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  const refused = requestRefusalOf(principal, input);
  if (refused !== undefined) return err(refused);

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

  return withRepositoryLock(principal, doors.git, () =>
    writeUnderLock(principal, doors, {
      input,
      iri,
      frontmatter,
      contentHash,
      sources,
      mergeKey: mergeKey.data,
      evidence: evidence.data,
      auditEventId,
    }),
  );
};

type ParsedWrite = {
  readonly input: WriteConceptInput;
  readonly iri: string;
  readonly frontmatter: Frontmatter;
  readonly contentHash: string;
  readonly sources: readonly HashedSource[];
  readonly mergeKey: string;
  readonly evidence: readonly z.infer<typeof boundarySchemas.evidence.insert>[];
  readonly auditEventId: string;
};

type Existing = {
  readonly held: Held | undefined;
  readonly derived: Visibility | undefined;
  readonly catalogued: boolean;
  readonly resolved: string | undefined;
  readonly holder: string | undefined;
  readonly waiting: boolean;
};

const writeUnderLock = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  write: ParsedWrite,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  const existing = await existingOf(principal, doors.postgres, write);
  if (!existing.ok) return err(existing.error);
  if (!existing.value.ok) return err(existing.value.error);
  const refusal = writeRefusalOf(write, existing.value.value);
  if (refusal !== undefined) return err(refusal);

  const now = doors.clock.now();
  const parsed = indexRowOf(
    {
      workspaceId: principal.workspaceId,
      iri: write.iri,
      path: write.input.path,
      kind: write.input.kind,
      title: write.input.title,
      frontmatter: write.frontmatter,
      body: write.input.body,
      contentHash: write.contentHash,
      status: write.input.status,
      sensitivity: write.input.sensitivity,
    },
    existing.value.value.held,
    now,
  );
  if (!parsed.success) return err("malformed");
  const row = parsed.data;

  const committed = await commitWrite(principal, doors.git, write, row.path, now);
  if (!committed.ok) return err(committed.error);

  const landed = await landWrite(principal, doors.postgres, write, row, committed.value);
  if (!landed.ok) return err(landed.error);

  return ok({
    iri: row.iri,
    sha: committed.value.sha,
    auditEventId: write.auditEventId,
    contentHash: write.contentHash,
  });
};

const existingOf = (principal: UserPrincipal, postgres: PostgresDoor, write: ParsedWrite) =>
  attempt(() =>
    withMembership(principal, postgres, async (fresh, tx): Promise<Existing> => {
      const { input, iri } = write;
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
                citing: write.evidence.map((piece) => piece.sourceDocumentId),
              }),

        catalogued: await holdsEveryDocument(
          fresh,
          tx,
          write.evidence.map((piece) => piece.sourceDocumentId),
        ),

        resolved: await targetOfMergeKey(fresh, tx, input.mergeKey),
        holder: await holderOfPath(fresh, tx, input.path),
        waiting:
          input.acceptance === undefined ||
          (await suggestionIsWaiting(fresh, tx, input.acceptance.suggestionId)),
      };
    }),
  );

/** Order is precedence: the first entry that holds is the word the caller reads. */
const WRITE_REFUSALS: readonly (readonly [
  WriteConceptRefusal,
  (write: ParsedWrite, existing: Existing) => boolean,
])[] = [
  ["no-such-concept", ({ input }, { held }) => input.iri !== undefined && held === undefined],
  ["no-such-document", (_, { catalogued }) => !catalogued],
  ["already-decided", (_, { waiting }) => !waiting],
  ["merge-key-taken", ({ iri }, { resolved }) => resolved !== undefined && resolved !== iri],
  [
    "resolution-moved",
    ({ input, iri }, { resolved }) =>
      input.acceptance !== undefined && input.iri !== undefined && resolved !== iri,
  ],
  [
    "stale-precondition",
    ({ input }, { held }) =>
      "base" in input.expects && (held?.contentHash ?? null) !== input.expects.base,
  ],
  ["rename-refused", ({ input }, { held }) => held !== undefined && held.path !== input.path],
  ["path-taken", ({ iri }, { holder }) => holder !== undefined && holder !== iri],
  [
    "reclassification-refused",
    ({ input }, { held }) =>
      held !== undefined &&
      input.sensitivity !== undefined &&
      input.sensitivity !== held.sensitivity,
  ],
  [
    "widening-refused",
    (_, { held, derived }) =>
      held !== undefined && derived !== undefined && widens(heldVisibilityOf(held), derived),
  ],
];

const writeRefusalOf = (write: ParsedWrite, existing: Existing): WriteConceptRefusal | undefined =>
  WRITE_REFUSALS.find(([, refuses]) => refuses(write, existing))?.[0];

const commitWrite = async (
  principal: UserPrincipal,
  git: GitDoor,
  write: ParsedWrite,
  path: string,
  at: Date,
) => {
  const { input } = write;
  return commitToBundle(principal, git, {
    path,
    content: renderConceptFile(write.frontmatter, input.body),
    message: input.message,
    author: input.author,
    trailers: {
      actor: actorIdOf(principal),
      audit: write.auditEventId,

      suggestion: input.acceptance?.suggestionId,
    },

    expectedHead: "head" in input.expects ? input.expects.head : await head(principal, git),
    at,
  });
};

const landWrite = async (
  principal: UserPrincipal,
  postgres: PostgresDoor,
  write: ParsedWrite,
  row: IndexRow,
  committed: Committed,
): Promise<Result<void, WriteConceptRefusal | Error>> => {
  const landed = await attempt(() =>
    withMembership(principal, postgres, async (fresh, tx) => {
      const acceptance = write.input.acceptance;
      if (acceptance === undefined) {
        await record(fresh, tx, {
          id: write.auditEventId,
          act: CONCEPT_ACTS.committed,
          subjectId: row.iri,
          detail: {
            iri: row.iri,
            commitSha: committed.sha,
            contentHash: write.contentHash,
            evidenceCount: write.evidence.length,
          },
        });
      } else {
        await record(fresh, tx, {
          id: write.auditEventId,
          act: CONCEPT_ACTS.accepted,
          subjectId: acceptance.suggestionId,
          batchId: acceptance.batchId,
          detail: {
            iri: row.iri,
            commitSha: committed.sha,
            contentHash: write.contentHash,
            setId: acceptance.setId,
          },
        });
      }
      await landRows(fresh, tx, {
        ...row,
        mergeKey: write.mergeKey,
        commit: committed,
        actor: actorIdOf(fresh),
        auditEventId: write.auditEventId,
        sources: write.sources,
        evidence: write.evidence,
        restsAlsoOn: [],
        acceptance,
      });
    }),
  );
  if (landed.ok) return landed.value;
  const named = refusalFor(landed.error, WRITE_CONSTRAINTS);
  return err(typeof named === "string" ? named : landed.error);
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

/** @public S3 */
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

/**
 * Accepts each decision on its own, in order: one refused leaves the rest to go ahead. A
 * suggestion whose concept moved or went stale goes back to its proposer. Two or more decisions
 * share one audit batch.
 */
export const acceptSuggestions = async (
  principal: UserPrincipal,
  doors: WriteDoors,
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

const preparedFor = async (
  principal: UserPrincipal,
  postgres: PostgresDoor,
  suggestionId: string,
): Promise<Result<Prepared, AcceptSuggestionRefusal | Error>> => {
  const prepared = await attempt(() =>
    withMembership(principal, postgres, async (fresh, tx) => {
      const payload = await payloadFor(fresh, tx, suggestionId);
      if (payload === undefined) return undefined;
      const target = await targetOfMergeKey(fresh, tx, payload.mergeKey);
      const author = await authorFor(fresh, tx, payload);
      return author === undefined ? undefined : { payload, target, author };
    }),
  );
  if (!prepared.ok) return err(prepared.error);
  if (!prepared.value.ok) return err(prepared.value.error);
  const found: Prepared | undefined = prepared.value.value;
  return found === undefined ? err("no-such-suggestion") : ok(found);
};

const acceptanceOf = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  decision: AcceptanceDecision,
  found: Prepared,
  batchId: string | undefined,
): Promise<Result<ConceptWritten, AcceptSuggestionRefusal | Error>> => {
  if ((found.target ?? null) !== decision.expectedTarget) return err("resolution-moved");

  return writeConcept(principal, doors, {
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
};

const returnedToProposerOn = (
  refusal: AcceptSuggestionRefusal | Error,
): readonly [word: AcceptSuggestionRefusal, reason: string] | undefined => {
  if (refusal === "merge-key-taken" || refusal === "resolution-moved") {
    return [
      "resolution-moved",
      "the concept this suggestion resolves to moved after the set was opened",
    ];
  }
  if (refusal === "stale-precondition") {
    return ["stale-precondition", "the concept moved after this suggestion was written"];
  }
  return undefined;
};

const acceptOne = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  decision: AcceptanceDecision,
  batchId: string | undefined,
): Promise<AcceptanceOutcome> => {
  const { suggestionId } = decision;
  const prepared = await preparedFor(principal, doors.postgres, suggestionId);
  if (!prepared.ok) return { suggestionId, outcome: err(prepared.error) };

  const accepted = await acceptanceOf(principal, doors, decision, prepared.value, batchId);
  const returning = accepted.ok ? undefined : returnedToProposerOn(accepted.error);
  if (returning === undefined) return { suggestionId, outcome: accepted };

  const [word, reason] = returning;
  const returned = await returnToProposer(principal, doors, { suggestionId, reason });
  return { suggestionId, outcome: err(returned.ok ? word : returned.error) };
};

export type ImportBundleInput = {
  readonly tree: BundleTree;

  /** The class every landed concept takes; `IMPORT_SENSITIVITY_DEFAULT` when absent. */
  readonly sensitivity?: (typeof SENSITIVITIES)[number] | undefined;

  readonly dryRun?: boolean | undefined;
};

export type ConceptRewritten = {
  readonly path: string;
  readonly links: number;
};

export type ImportProgress = {
  readonly landed: readonly string[];
  readonly skipped: readonly string[];
  readonly checks: ChecksRecorded;
  readonly rewritten: readonly ConceptRewritten[];
};

export type BundleImported = ImportProgress & {
  readonly bundleId: string;
  readonly manifest: "written" | "standing" | "would-write";
  readonly concepts: number;
  readonly dryRun: boolean;
};

export type ImportBundleRefusal =
  | RoleRefusal
  | PrincipalRefusal
  | "no-such-repository"
  | "manifest-taken"
  | "class-unreadable"
  | ({ readonly kind: "unsound" } & Unsound)
  | {
      readonly kind: "stopped";
      readonly file: string;
      readonly reason: WriteConceptRefusal | Error;
      readonly progress: ImportProgress;
    };

type ResolvedConcept = LoadedConcept & { readonly checks: readonly ImportedCheck[] };

const withPersonsAsVerifiers = (
  concept: LoadedConcept,
  personOf: ReadonlyMap<string, UserId>,
): Result<ResolvedConcept, Unsound> => {
  const checks: ImportedCheck[] = [];
  const verified: FrontmatterSource[] = [];
  for (const event of concept.verified) {
    const personId = personOf.get(event.email.toLowerCase());
    if (personId === undefined) {
      return err({ file: concept.file, reason: "verifier-not-a-member", about: event.email });
    }
    const actor = actorIdOfPerson(personId);
    checks.push({ actor, at: event.at });
    verified.push({ ...event.entry, by: actor });
  }
  const frontmatter =
    concept.verified.length === 0 ? concept.frontmatter : { ...concept.frontmatter, verified };
  return ok({ ...concept, checks, frontmatter });
};

const plus = (sum: ChecksRecorded, more: ChecksRecorded): ChecksRecorded => ({
  recorded: sum.recorded + more.recorded,
  present: sum.present + more.present,
});

const manifestRefusalOf = (refusal: WriteManifestRefusal | Error): ImportBundleRefusal | Error => {
  if (refusal instanceof Error) return refusal;
  switch (refusal) {
    case "path-taken":
      return "manifest-taken";
    case "malformed":
    case "stale-precondition":
    case "malformed-path":
    case "malformed-message":
      return new Error(`the manifest commit was refused: ${refusal}`);
    default:
      return refusal;
  }
};

const dryRunOf = (
  bundleId: string,
  manifest: "standing" | "would-write",
  concepts: readonly ResolvedConcept[],
  standing: ReadonlyMap<string, StandingConcept>,
  present: ReadonlySet<string>,
): BundleImported => {
  const landed: string[] = [];
  const skipped: string[] = [];
  let checks: ChecksRecorded = { recorded: 0, present: 0 };
  const paths = new Set(concepts.map((concept) => concept.path));
  const rewritten: ConceptRewritten[] = [];
  for (const concept of concepts) {
    const held = standing.get(concept.path);
    (held === undefined ? landed : skipped).push(concept.path);
    checks = plus(checks, countChecks(held?.iri, concept.checks, present));

    /** No iri is minted on a dry run, so the target's path stands in and only the count is read. */
    const { links } = rewriteLinks(held?.body ?? concept.body, concept.path, (target) =>
      paths.has(target) ? target : undefined,
    );
    if (links > 0) rewritten.push({ path: concept.path, links });
  }
  return {
    bundleId,
    manifest,
    landed,
    skipped,
    checks,
    rewritten,
    concepts: concepts.length,
    dryRun: true,
  };
};

type OpenedImport = {
  readonly manifest: BundleManifest;
  readonly resolved: readonly ResolvedConcept[];
  readonly standing: ReadonlyMap<string, StandingConcept>;
  readonly author: CommitAuthor;
  readonly present: ReadonlySet<string>;
};

const importContextOf = (
  principal: UserPrincipal,
  postgres: PostgresDoor,
  input: ImportBundleInput,
  concepts: readonly LoadedConcept[],
) =>
  attempt(() =>
    withMembership(principal, postgres, async (fresh, tx) => {
      const standing = await standingAt(
        fresh,
        tx,
        concepts.map((concept) => concept.path),
      );
      return {
        standing,
        persons: await personIdsByEmail(
          fresh,
          tx,
          concepts.flatMap((concept) => concept.verified.map((event) => event.email)),
        ),
        author: await authorOf(fresh, tx, fresh.userId),
        present:
          input.dryRun === true
            ? await presentChecks(
                fresh,
                tx,
                [...standing.values()].map((held) => held.iri),
              )
            : new Set<string>(),
      };
    }),
  );

const resolvedOf = (
  concepts: readonly LoadedConcept[],
  persons: ReadonlyMap<string, UserId>,
): Result<readonly ResolvedConcept[], Unsound> => {
  const resolved: ResolvedConcept[] = [];
  for (const concept of concepts) {
    const one = withPersonsAsVerifiers(concept, persons);
    if (!one.ok) return err(one.error);
    resolved.push(one.value);
  }
  return ok(resolved);
};

const openImport = async (
  principal: UserPrincipal,
  postgres: PostgresDoor,
  input: ImportBundleInput,
): Promise<Result<OpenedImport, ImportBundleRefusal | Error>> => {
  const loaded = readBundle(input.tree);
  if (!loaded.ok) return err({ kind: "unsound", ...loaded.error });
  const { manifest, concepts } = loaded.value;

  const read = await importContextOf(principal, postgres, input, concepts);
  if (!read.ok) return err(read.error);
  if (!read.value.ok) return err(read.value.error);
  const { persons, ...context } = read.value.value;

  const resolved = resolvedOf(concepts, persons);
  if (!resolved.ok) return err({ kind: "unsound", ...resolved.error });
  return ok({ manifest, resolved: resolved.value, ...context });
};

const dryRunImport = async (
  principal: UserPrincipal,
  git: GitDoor,
  opened: OpenedImport,
): Promise<Result<BundleImported, ImportBundleRefusal | Error>> => {
  const state = await manifestAtHead(principal, git, opened.manifest);
  if (!state.ok) return err(state.error);
  if (state.value === "taken") return err("manifest-taken");
  const { manifest, resolved, standing, present } = opened;
  const willBe = state.value === "absent" ? "would-write" : "standing";
  return ok(dryRunOf(manifest.id, willBe, resolved, standing, present));
};

type ImportRun = {
  readonly author: CommitAuthor;
  readonly sensitivity: Sensitivity;
  readonly batchId: string;
};

type Holding = readonly [concept: ResolvedConcept, held: StandingConcept];

type Landing = {
  readonly progress: Omit<ImportProgress, "rewritten">;
  readonly known: ReadonlyMap<string, StandingConcept>;
  readonly holdings: readonly Holding[];
};

const stoppedAt = (file: string, reason: WriteConceptRefusal | Error, progress: ImportProgress) =>
  err({ kind: "stopped" as const, file, reason, progress });

const landOne = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  run: ImportRun,
  concept: ResolvedConcept,
): Promise<Result<StandingConcept, WriteConceptRefusal | Error>> => {
  const wrote = await writeConcept(principal, doors, {
    mergeKey: concept.mergeKey,
    path: concept.path,
    kind: concept.kind,
    title: concept.title,
    frontmatter: concept.frontmatter,
    body: concept.body,
    message: `Import ${concept.path} from ${concept.entry}`,
    author: run.author,
    expects: { base: null },
    sensitivity: run.sensitivity,
    status: CONCEPT_STABLE_STATUS,
  });
  if (!wrote.ok) return err(wrote.error);
  return ok({
    iri: wrote.value.iri,
    mergeKey: concept.mergeKey,
    status: CONCEPT_STABLE_STATUS,
    body: concept.body,
    contentHash: wrote.value.contentHash,
  });
};

const checksRecordedOn = async (
  principal: UserPrincipal,
  postgres: PostgresDoor,
  input: Parameters<typeof recordImportedChecks>[2],
): Promise<Result<ChecksRecorded, WriteConceptRefusal | Error>> => {
  const recorded = await attempt(() =>
    withMembership(principal, postgres, (fresh, tx) => recordImportedChecks(fresh, tx, input)),
  );
  if (!recorded.ok) return err(recorded.error);
  return recorded.value;
};

const landEach = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  run: ImportRun,
  opened: OpenedImport,
): Promise<Result<Landing, ImportBundleRefusal>> => {
  const landed: string[] = [];
  const skipped: string[] = [];
  let checks: ChecksRecorded = { recorded: 0, present: 0 };
  const stop = (file: string, reason: WriteConceptRefusal | Error) =>
    stoppedAt(file, reason, { landed, skipped, checks, rewritten: [] });
  const known = new Map<string, StandingConcept>(opened.standing);
  const holdings: Holding[] = [];
  for (const concept of opened.resolved) {
    let held = known.get(concept.path);
    if (held === undefined) {
      const wrote = await landOne(principal, doors, run, concept);
      if (!wrote.ok) return stop(concept.file, wrote.error);
      landed.push(concept.path);
      held = wrote.value;
      known.set(concept.path, held);
    } else {
      skipped.push(concept.path);
    }
    const recorded = await checksRecordedOn(principal, doors.postgres, {
      iri: held.iri,
      checks: concept.checks,
      batchId: run.batchId,
    });
    if (!recorded.ok) return stop(concept.file, recorded.error);
    checks = plus(checks, recorded.value);
    holdings.push([concept, held]);
  }
  return ok({ progress: { landed, skipped, checks }, known, holdings });
};

const rewriteEach = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  run: ImportRun,
  landing: Landing,
): Promise<Result<readonly ConceptRewritten[], ImportBundleRefusal>> => {
  const rewritten: ConceptRewritten[] = [];
  const iriOf = (target: string): string | undefined => landing.known.get(target)?.iri;
  for (const [concept, held] of landing.holdings) {
    const linked = rewriteLinks(held.body, concept.path, iriOf);
    if (linked.links === 0) continue;
    const wrote = await writeConcept(principal, doors, {
      iri: held.iri,
      mergeKey: held.mergeKey,
      path: concept.path,
      kind: concept.kind,
      title: concept.title,
      frontmatter: concept.frontmatter,
      body: linked.body,
      message: `Rewrite the links in ${concept.path} to the iris of the concepts they name`,
      author: run.author,
      expects: { base: held.contentHash },
      status: held.status,
    });
    if (!wrote.ok) return stoppedAt(concept.file, wrote.error, { ...landing.progress, rewritten });
    rewritten.push({ path: concept.path, links: linked.links });
  }
  return ok(rewritten);
};

const runImport = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  opened: OpenedImport,
  sensitivity: Sensitivity,
): Promise<Result<BundleImported, ImportBundleRefusal | Error>> => {
  const written = await writeManifest(principal, doors, {
    manifest: opened.manifest,
    message: "Write the bundle's manifest",
    author: opened.author,
  });
  if (!written.ok) return err(manifestRefusalOf(written.error));

  const run: ImportRun = { author: opened.author, sensitivity, batchId: ulid() };
  const landing = await landEach(principal, doors, run, opened);
  if (!landing.ok) return err(landing.error);
  const rewritten = await rewriteEach(principal, doors, run, landing.value);
  if (!rewritten.ok) return err(rewritten.error);
  return ok({
    bundleId: opened.manifest.id,
    manifest: written.value.written ? "written" : "standing",
    ...landing.value.progress,
    rewritten: rewritten.value,
    concepts: opened.resolved.length,
    dryRun: false,
  });
};

/**
 * Not one transaction: a run stopped part way keeps what landed and names it in `progress`, and
 * a rerun skips it. A dry run writes nothing and counts what a run would do.
 */
export const importBundle = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  input: ImportBundleInput,
): Promise<Result<BundleImported, ImportBundleRefusal | Error>> => {
  if (!mayWrite(principal)) return err("role-forbids");
  const sensitivity = input.sensitivity ?? IMPORT_SENSITIVITY_DEFAULT;

  // The second pass reads back what the first landed; a class the runner cannot read would stop
  // the run after everything was written.
  if (!readsSensitivity(principal, sensitivity)) return err("class-unreadable");
  const opened = await openImport(principal, doors.postgres, input);
  if (!opened.ok) return err(opened.error);
  return input.dryRun === true
    ? dryRunImport(principal, doors.git, opened.value)
    : runImport(principal, doors, opened.value, sensitivity);
};

type ConceptCheck = {
  readonly actor: ActorId;
  readonly at: Date;

  readonly contentHash: string | null;

  /** Read by person id, so it outlives the membership; null once erasure clears the name. */
  readonly checkerName: string | null;
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
  readonly checked_by_name: string | null;
};

const CONCEPT_SELECT = `SELECT c.iri, c.path, c.kind, c.title, c.frontmatter, c.body, c.status,
              c.content_hash, c.commit_sha,
              v.actor AS checked_by, v.checked_at, v.content_hash AS checked_hash,
              NULLIF(checker.name, '') AS checked_by_name
         FROM concept_index c
         LEFT JOIN LATERAL (
                SELECT actor, checked_at, content_hash
                  FROM concept_verification
                 WHERE workspace_id = c.workspace_id AND iri = c.iri
                 ORDER BY checked_at DESC, id DESC
                 LIMIT 1
              ) v ON true
         LEFT JOIN "user" checker
                ON starts_with(v.actor, '${PERSON_PREFIX}')
               AND checker.id = substr(v.actor, ${PERSON_PREFIX.length + 1})
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

/** `undefined` both when no concept holds the iri and when this principal may not read it. */
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

/**
 * Matches the trimmed query as literal text, ignoring case, in a readable concept's title or
 * body, ordered by title. A blank query or a `limit` under 1 finds nothing.
 */
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
      [principal.workspaceId, ...readableParameters(principal), containing(query), input.limit],
    ),
  );
  if (!found.ok) return err(found.error);
  return ok(found.value.rows.map(openedOf));
};

const checkOf = (row: ConceptRow): ConceptCheck | undefined => {
  if (row.checked_by === null || row.checked_at === null || !isActorId(row.checked_by)) {
    return undefined;
  }
  return {
    actor: row.checked_by,
    at: row.checked_at,
    contentHash: row.checked_hash,
    checkerName: row.checked_by_name,
  };
};
