import { z } from "zod";

import {
  anyWordMatch,
  boundarySchemas,
  CONCEPT_STABLE_STATUS,
  corpusCounts,
  ids,
  QUERY_WORDS,
  SUGGESTION_EDIT_KIND,
  SUGGESTION_SET_MAX,
  type BundleManifest,
  type ConceptIri,
  type CorpusCounts,
  type MatchBound,
  type MatchStrength,
  type SENSITIVITIES,
} from "@better-answers/schema";

import { readableClause, readableParameters, type Sensitivity } from "../access/index.ts";
import { batchIdFor } from "../audit/index.ts";
import {
  actorIdOfPerson,
  admit,
  ADMIN_ALONE,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  personOfActor,
  ulid,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import { fileAtHead, type CommitAuthor, type GitDoor } from "../store/git/index.ts";
import { analyseMap } from "../store/map/index.ts";
import { withMember, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import {
  contentHashOf,
  normalisedBody,
  parseConceptFile,
  type Frontmatter,
  type FrontmatterSource,
} from "./file.ts";
import { heldByIri, type Held } from "./landing.ts";
import { latestVerificationOf } from "./latest-verification.ts";
import {
  authorOf,
  countVerifications,
  IMPORT_SENSITIVITY_DEFAULT,
  personIdsByEmail,
  presentVerifications,
  readBundle,
  recordImportedVerifications,
  rewriteLinks,
  standingAt,
  type BundleTree,
  type VerificationsRecorded,
  type ImportedVerification,
  type LoadedConcept,
  type StandingConcept,
  type Unsound,
} from "./loader.ts";
import { manifestAtHead, writeManifest, type WriteManifestRefusal } from "./manifest.ts";
import { ownerAdmits, type OwnerRefusal } from "./owners.ts";
import {
  bodyLinksOf,
  paneOf,
  projectedFrontmatter,
  relationsOf,
  resolvedSourcesOf,
  type BodyLink,
  type EvidencePane,
  type PassageNamer,
  type PassageReader,
  type Relation,
} from "./read.ts";
import {
  payloadFor,
  returnToProposer,
  targetOfMergeKey,
  type SuggestionPayload,
} from "./suggestions.ts";
import {
  trustOf,
  trustWords,
  verificationOf,
  type ConceptVerification,
  type Trust,
  type VerificationRow,
} from "./trust.ts";
import {
  writeConcept,
  type ConceptWritten,
  type WriteConceptRefusal,
  type WriteDoors,
} from "./write.ts";

export {
  canonicalFrontmatter,
  contentHashOf,
  parseConceptFile,
  renderConceptFile,
  type Frontmatter,
  type FrontmatterValue,
} from "./file.ts";
export {
  kindConceptsInput,
  readKindConcepts,
  readKnowledgeTree,
  type KindConceptsInput,
} from "./browse.ts";
export { withBundleFenceAs } from "./fence.ts";
export {
  carryVerificationsOntoRewrite,
  foldKind,
  mergeKeyOf,
  moveBundleCommits,
} from "./landing.ts";
export {
  ERASURE_REHEARSAL_PATH,
  IMPORT_SENSITIVITY_DEFAULT,
  type BundleTree,
  type UnsoundReason,
} from "./loader.ts";
export { writeManifest, type ManifestWritten, type WriteManifestInput } from "./manifest.ts";
export {
  collectionsAndOwners,
  nameOwner,
  nameOwnerInput,
  ownedBy,
  ownerOf,
  type NameOwnerInput,
} from "./owners.ts";
/** @public S3 */
export type { OwnedConcept, OwnerNamed } from "./owners.ts";
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
} from "./suggestions.ts";
/** @public S3 */
export type {
  DecideSuggestionInput,
  DecideSuggestionRefusal,
  SubmitSuggestionSetInput,
  SubmitSuggestionSetRefusal,
  SuggestionDecided,
  SuggestionSetSubmitted,
} from "./suggestions.ts";
/** @public S5 */
export type { SuggestionSummaryItem } from "./suggestions.ts";
export { cascadingVisibility, overrideConceptSensitivity } from "./visibility.ts";
export {
  followSyncs,
  followSyncsInEveryWorkspace,
  SYNC_CASCADE,
  SYNC_CASCADE_ACTIONS,
  type WorkspaceSyncsFollowed,
} from "./sync-cascade.ts";
/** @public S3 */
export type {
  ConceptSensitivityOverridden,
  OverrideConceptSensitivityInput,
  OverrideConceptSensitivityRefusal,
} from "./visibility.ts";
export { conceptPageOf } from "./read.ts";
export {
  MAP_MAINTENANCE,
  mapCounts,
  rebuildMap,
  sweepMap,
  type MapMaintenanceRefusal,
} from "./map-maintenance.ts";
export type { SweptGeneration } from "../store/map/index.ts";
export {
  TRUST_RIDERS,
  TRUST_STATUSES,
  TRUST_TIERS,
  UNREVIEWED_TIERS,
  trustOf,
  trustWords,
  ukLongDate,
  type Trust,
  type TrustStatus,
} from "./trust.ts";
export { CONCEPT_REFUSALS } from "./vocabulary.ts";
export {
  writeConcept,
  writeConceptAction,
  type Acceptance,
  type ConceptWritten,
  type WriteConceptInput,
  type WriteConceptRefusal,
} from "./write.ts";

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

type AcceptSuggestionsInput = { readonly decisions: readonly AcceptanceDecision[] };

const acceptSuggestionsAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<AcceptSuggestionsInput>(),
  refuses: ["role-forbids", "malformed"],
});

export const acceptSuggestions = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  input: AcceptSuggestionsInput,
): Promise<
  Result<
    readonly AcceptanceOutcome[],
    RefusalOf<typeof acceptSuggestionsAction> | PrincipalRefusal | Error
  >
> => {
  const admitted = admit(acceptSuggestionsAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const decisions = ACCEPTANCE_DECISIONS.safeParse(input.decisions);
  if (!decisions.success) return err("malformed");

  const batchId = batchIdFor(decisions.data.length);
  const outcomes: AcceptanceOutcome[] = [];
  for (const decision of decisions.data) {
    outcomes.push(await acceptOne(admitted.value, doors, decision, batchId));
  }
  return ok(outcomes);
};

const preparedFor = async (
  principal: UserPrincipal,
  postgres: PostgresDoor,
  suggestionId: string,
): Promise<Result<Prepared, AcceptSuggestionRefusal | Error>> => {
  const prepared = await attempt(() =>
    withMember(principal, postgres, async (fresh, tx) => {
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
  const keptWaiting =
    returned.ok || returned.error === "owner-forbids" || returned.error === "role-forbids";
  return { suggestionId, outcome: err(keptWaiting ? word : returned.error) };
};

export type ImportBundleInput = {
  readonly tree: BundleTree;

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
  readonly verifications: VerificationsRecorded;
  readonly rewritten: readonly ConceptRewritten[];
};

export type BundleImported = ImportProgress & {
  readonly bundleId: string;
  readonly manifest: "written" | "standing" | "would-write";
  readonly concepts: number;
  readonly dryRun: boolean;
};

export type MapNotAnalysedLine = {
  readonly workspace_id: string;
  readonly bundle_id: string;
  readonly error: string;
};

export type ImportLog = {
  readonly warn: (line: MapNotAnalysedLine, message: string) => void;
};

type ImportDoors = WriteDoors & { readonly log: ImportLog };

const importBundleAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.custom<ImportBundleInput>(),
  refuses: ["role-forbids", "no-such-repository", "manifest-taken", "stale-precondition"],
});

export type ImportBundleRefusal =
  | RefusalOf<typeof importBundleAction>
  | PrincipalRefusal
  | ({ readonly kind: "unsound" } & Unsound)
  | {
      readonly kind: "stopped";
      readonly file: string;
      readonly reason: WriteConceptRefusal | Error;
      readonly progress: ImportProgress;
    };

type ResolvedConcept = LoadedConcept & { readonly verifications: readonly ImportedVerification[] };

const withPersonsAsVerifiers = (
  concept: LoadedConcept,
  personOf: ReadonlyMap<string, UserId>,
): Result<ResolvedConcept, Unsound> => {
  const verifications: ImportedVerification[] = [];
  const verified: FrontmatterSource[] = [];
  for (const event of concept.verified) {
    const personId = personOf.get(event.email.toLowerCase());
    if (personId === undefined) {
      return err({ file: concept.file, reason: "verifier-not-a-member", about: event.email });
    }
    const actor = actorIdOfPerson(personId);
    verifications.push({ actor, at: event.at });
    verified.push({ ...event.entry, by: actor });
  }
  const frontmatter =
    concept.verified.length === 0 ? concept.frontmatter : { ...concept.frontmatter, verified };
  return ok({ ...concept, verifications, frontmatter });
};

const plus = (sum: VerificationsRecorded, more: VerificationsRecorded): VerificationsRecorded => ({
  recorded: sum.recorded + more.recorded,
  present: sum.present + more.present,
});

const manifestRefusalOf = (refusal: WriteManifestRefusal | Error): ImportBundleRefusal | Error => {
  if (refusal instanceof Error) return refusal;
  switch (refusal) {
    case "path-taken":
      return "manifest-taken";
    case "malformed":
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
  let verifications: VerificationsRecorded = { recorded: 0, present: 0 };
  const paths = new Set(concepts.map((concept) => concept.path));
  const rewritten: ConceptRewritten[] = [];
  for (const concept of concepts) {
    const held = standing.get(concept.path);
    (held === undefined ? landed : skipped).push(concept.path);
    verifications = plus(
      verifications,
      countVerifications(held?.iri, concept.verifications, present),
    );

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
    verifications,
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
    withMember(principal, postgres, async (fresh, tx) => {
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
            ? await presentVerifications(
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

const verificationsRecordedOn = async (
  principal: UserPrincipal,
  postgres: PostgresDoor,
  input: Parameters<typeof recordImportedVerifications>[2],
): Promise<Result<VerificationsRecorded, WriteConceptRefusal | Error>> => {
  const recorded = await attempt(() =>
    withMember(principal, postgres, (fresh, tx) => recordImportedVerifications(fresh, tx, input)),
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
  let verifications: VerificationsRecorded = { recorded: 0, present: 0 };
  const stop = (file: string, reason: WriteConceptRefusal | Error) =>
    stoppedAt(file, reason, { landed, skipped, verifications, rewritten: [] });
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
    const recorded = await verificationsRecordedOn(principal, doors.postgres, {
      iri: held.iri,
      verifications: concept.verifications,
      batchId: run.batchId,
    });
    if (!recorded.ok) return stop(concept.file, recorded.error);
    verifications = plus(verifications, recorded.value);
    holdings.push([concept, held]);
  }
  return ok({ progress: { landed, skipped, verifications }, known, holdings });
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
  doors: ImportDoors,
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
  const rewritten = landing.ok
    ? await rewriteEach(principal, doors, run, landing.value)
    : err(landing.error);
  const analysed = await attempt(() => analyseMap(doors.postgres.pool));
  if (!analysed.ok) {
    doors.log.warn(
      {
        workspace_id: principal.workspaceId,
        bundle_id: opened.manifest.id,
        error: analysed.error.message,
      },
      "import-bundle: the map was left unanalysed, so the planner waits for autovacuum",
    );
  }
  if (!landing.ok) return err(landing.error);
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

export const importBundle = async (
  principal: UserPrincipal,
  doors: ImportDoors,
  input: ImportBundleInput,
): Promise<Result<BundleImported, ImportBundleRefusal | Error>> => {
  const admitted = admit(importBundleAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const sensitivity = input.sensitivity ?? IMPORT_SENSITIVITY_DEFAULT;

  const opened = await openImport(principal, doors.postgres, input);
  if (!opened.ok) return err(opened.error);
  return input.dryRun === true
    ? dryRunImport(principal, doors.git, opened.value)
    : runImport(principal, doors, opened.value, sensitivity);
};

export type ConceptBodyRun =
  | { readonly dryRun: true; readonly base?: string | undefined }
  | { readonly dryRun: false; readonly base: string };

export type UpdateConceptBodyInput = {
  readonly iri: string;
  readonly body: string;
} & ConceptBodyRun;

type BodyAt = { readonly contentHash: string; readonly body: string };

export type ConceptBodyUpdate = {
  readonly iri: ConceptIri;
  readonly path: string;
  readonly from: BodyAt;
  readonly to: BodyAt;

  readonly written: ConceptWritten | undefined;
};

const updateConceptBodyAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<UpdateConceptBodyInput>(),
  refuses: [
    "role-forbids",
    "owner-forbids",
    "malformed",
    "no-such-concept",
    "unchanged",
    "stale-precondition",
  ],
});

export type UpdateConceptBodyRefusal =
  | RefusalOf<typeof updateConceptBodyAction>
  | WriteConceptRefusal;

type StandingBody = { readonly held: Held; readonly author: CommitAuthor };

const standingBodyOf = (principal: UserPrincipal, postgres: PostgresDoor, iri: ConceptIri) =>
  attempt(() =>
    withMember(
      principal,
      postgres,
      async (fresh, tx): Promise<Result<StandingBody, "no-such-concept" | OwnerRefusal>> => {
        const held = await heldByIri(fresh, tx, iri);
        if (held === undefined) return err("no-such-concept");
        const refusal = await ownerAdmits(fresh, tx, { iri, path: held.path });
        if (refusal !== undefined) return err(refusal);
        return ok({ held, author: await authorOf(fresh, tx, fresh.userId) });
      },
    ),
  );

const disagreement = (path: string, why: string): Error =>
  new Error(`the bundle and the index disagree: ${path} ${why}`);

type ConceptFile = { readonly frontmatter: Frontmatter; readonly body: string };

const fileHeldAt = async (
  principal: UserPrincipal,
  git: GitDoor,
  held: Held,
): Promise<Result<ConceptFile, "stale-precondition" | Error>> => {
  const content = await attempt(() => fileAtHead(principal, git, held.path));
  if (!content.ok) return err(content.error);
  if (content.value === null) return err(disagreement(held.path, "is not in the bundle's head"));
  const parsed = parseConceptFile(content.value);
  if (!parsed.ok) return err(disagreement(held.path, "does not parse at the bundle's head"));
  const { frontmatter, body } = parsed.value;
  // A write commits to git before its rows land, so a head ahead of the row is a write in flight.
  return contentHashOf(frontmatter, body, held.path) === held.contentHash
    ? ok(parsed.value)
    : err("stale-precondition");
};

type HeldBody = StandingBody & { readonly file: ConceptFile };

const heldBodyOf = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  iri: ConceptIri,
): Promise<Result<HeldBody, UpdateConceptBodyRefusal | Error>> => {
  const standing = await standingBodyOf(principal, doors.postgres, iri);
  if (!standing.ok) return err(standing.error);
  if (!standing.value.ok) return err(standing.value.error);
  if (!standing.value.value.ok) return err(standing.value.value.error);
  const found = standing.value.value.value;
  const file = await fileHeldAt(principal, doors.git, found.held);
  return file.ok ? ok({ ...found, file: file.value }) : err(file.error);
};

const wellFormedOf = (asked: string, body: string): ConceptIri | undefined => {
  const iri = ids.conceptIri.safeParse(asked);
  const fits = boundarySchemas.conceptIndex.insert.shape.body.safeParse(body);
  return iri.success && fits.success && body.trim() !== "" ? iri.data : undefined;
};

const bodyRefusalOf = (
  held: string,
  to: string,
  base: string | undefined,
): UpdateConceptBodyRefusal | undefined => {
  if (to === held) return "unchanged";
  return base !== undefined && base !== held ? "stale-precondition" : undefined;
};

/**
 * Replaces a standing concept's body and keeps everything else: its frontmatter as the file
 * holds it, its status, its verifications and its citations.
 */
export const updateConceptBody = async (
  principal: UserPrincipal,
  doors: WriteDoors,
  input: UpdateConceptBodyInput,
): Promise<Result<ConceptBodyUpdate, UpdateConceptBodyRefusal | Error>> => {
  const admitted = admit(updateConceptBodyAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const body = normalisedBody(input.body);
  const iri = wellFormedOf(input.iri, body);
  if (iri === undefined) return err("malformed");

  const standing = await heldBodyOf(admitted.value, doors, iri);
  if (!standing.ok) return err(standing.error);
  const { held, author, file } = standing.value;
  const to = contentHashOf(file.frontmatter, body, held.path);
  const refusal = bodyRefusalOf(held.contentHash, to, input.base);
  if (refusal !== undefined) return err(refusal);

  const update = {
    iri,
    path: held.path,
    from: { contentHash: held.contentHash, body: file.body },
    to: { contentHash: to, body },
  };
  if (input.dryRun) return ok({ ...update, written: undefined });

  const written = await writeConcept(admitted.value, doors, {
    iri,
    mergeKey: held.mergeKey,
    path: held.path,
    kind: held.kind,
    title: held.title,
    frontmatter: file.frontmatter,
    body,
    message: `Update the body of ${held.path} in place`,
    author,
    expects: { base: input.base },
    status: held.status,
  });
  if (!written.ok) return err(written.error);
  return ok({ ...update, written: written.value });
};

export type OpenedConcept = {
  readonly iri: ConceptIri;
  readonly path: string;
  readonly collection: string | null;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly status: string;
  readonly contentHash: string;
  readonly commitSha: string;
  readonly verification: ConceptVerification | undefined;
};

type ConceptRow = {
  readonly iri: string;
  readonly path: string;
  readonly collection: string | null;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly status: string;
  readonly content_hash: string;
  readonly commit_sha: string;
} & VerificationRow;

const LATEST_VERIFICATION = latestVerificationOf("c");

const conceptSelect = (
  ranked: { readonly columns: string; readonly joins: string } | undefined,
): string => `SELECT c.iri, c.path, c.collection, c.kind, c.title, c.frontmatter, c.body, c.status,
              c.content_hash, c.commit_sha,
              ${LATEST_VERIFICATION.columns}${ranked === undefined ? "" : `, ${ranked.columns}`}
         FROM concept_index c
         ${ranked?.joins ?? ""}
         ${LATEST_VERIFICATION.joins}
        WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}`;

const CONCEPT_SELECT = conceptSelect(undefined);

const openedOf = (row: ConceptRow): OpenedConcept => ({
  iri: ids.conceptIri.parse(row.iri),
  path: row.path,
  collection: row.collection,
  kind: row.kind,
  title: row.title,
  frontmatter: row.frontmatter,
  body: row.body,
  status: row.status,
  contentHash: row.content_hash,
  commitSha: row.commit_sha,
  verification: verificationOf(row),
});

const conceptByIriAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<ConceptIri>(),
  refuses: ["role-forbids"],
});

export const conceptByIri = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: ConceptIri,
): Promise<Result<OpenedConcept | undefined, RefusalOf<typeof conceptByIriAction> | Error>> => {
  const admitted = admit(conceptByIriAction, principal, iri);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  return attempt(async () => {
    const { rows } = await tx.query<ConceptRow>(`${CONCEPT_SELECT} AND c.iri = $4`, [
      reader.workspaceId,
      ...readableParameters(reader),
      iri,
    ]);
    const row = rows[0];
    return row === undefined ? undefined : openedOf(row);
  });
};

const conceptsByIrisAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<readonly ConceptIri[]>(),
  refuses: ["role-forbids"],
});

export const conceptsByIris = async (
  principal: UserPrincipal,
  tx: Tx,
  iris: readonly ConceptIri[],
): Promise<Result<readonly OpenedConcept[], RefusalOf<typeof conceptsByIrisAction> | Error>> => {
  const admitted = admit(conceptsByIrisAction, principal, iris);
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  return attempt(async () => {
    const { rows } = await tx.query<ConceptRow>(
      `${CONCEPT_SELECT} AND c.iri = ANY($4::text[]) ORDER BY c.iri`,
      [reader.workspaceId, ...readableParameters(reader), iris],
    );
    return rows.map((row) => openedOf(row));
  });
};

type ReadRow = ConceptRow & {
  readonly shared_by: string | null;
  readonly shared_at: Date | null;
};

const CONCEPT_READ = `${conceptSelect({
  columns: "o.actor AS shared_by, o.recorded_at AS shared_at",
  joins: `LEFT JOIN concept_sensitivity_override o
                 ON o.workspace_id = c.workspace_id AND o.iri = c.iri`,
})} AND c.iri = $4`;

export type ConceptRead = {
  readonly iri: ConceptIri;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly trust: Trust;
  readonly trustWords: string;
  readonly pane: EvidencePane;
  readonly relations: readonly Relation[];
  readonly bodyLinks: readonly BodyLink[];
};

const sharerOfRow = (row: ReadRow) =>
  // Stryker disable next-line ConditionalExpression,LogicalOperator: the override's actor and recorded_at are NOT NULL in one joined row; hides the condition → true, killed in concept-read.test.ts
  row.shared_by === null || row.shared_at === null
    ? undefined
    : { actor: row.shared_by, at: row.shared_at };

export const readConcept = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: ConceptIri,
  reads: {
    readonly passageAt: PassageReader;
    readonly namesPassage: PassageNamer;
    readonly now: Date;
  },
): Promise<Result<ConceptRead | undefined, Error>> => {
  const read = await attempt(() =>
    tx.query<ReadRow>(CONCEPT_READ, [principal.workspaceId, ...readableParameters(principal), iri]),
  );
  if (!read.ok) return err(read.error);
  const [row] = read.value.rows;
  if (row === undefined) return ok(undefined);
  const concept = openedOf(row);
  const sources = await resolvedSourcesOf(
    { principal, tx, passageAt: reads.passageAt, namesPassage: reads.namesPassage },
    concept.frontmatter,
  );
  if (!sources.ok) return err(sources.error);
  const relations = await relationsOf(principal, tx, concept.iri);
  if (!relations.ok) return err(relations.error);
  const bodyLinks = await bodyLinksOf(principal, tx, concept);
  if (!bodyLinks.ok) return err(bodyLinks.error);
  const trust = trustOf(concept, reads.now);
  return ok({
    iri: concept.iri,
    frontmatter: projectedFrontmatter(concept.frontmatter, sources.value),
    body: concept.body,
    trust,
    trustWords: trustWords(trust),
    pane: paneOf(sources.value, sharerOfRow(row)),
    relations: relations.value,
    bodyLinks: bodyLinks.value,
  });
};

export const evidenceOf = async (
  principal: UserPrincipal,
  tx: Tx,
  frontmatter: Frontmatter,
  reads: { readonly passageAt: PassageReader; readonly namesPassage: PassageNamer },
): Promise<Result<EvidencePane["evidence"], Error>> => {
  const sources = await resolvedSourcesOf({ principal, tx, ...reads }, frontmatter);
  return sources.ok ? ok(sources.value.map((source) => source.item)) : err(sources.error);
};

export const corpusCountsOf = (
  tx: Tx,
  documents: string,
  parameters: readonly unknown[],
  query: string,
): Promise<Result<CorpusCounts, Error>> =>
  attempt(async () => {
    const words = await tx.query<{ readonly word: string }>(QUERY_WORDS, [query]);
    if (words.rows.length === 0) return { size: 0, frequencies: [] };
    const counted = await tx.query<CorpusCounts>(
      corpusCounts(documents, words.rows.length, parameters.length + 1),
      [...parameters, ...words.rows.map(({ word }) => word)],
    );
    const [counts] = counted.rows;
    if (counts === undefined) throw new Error("a count answered no row");
    return counts;
  });

export const conceptCountsOf = (
  principal: UserPrincipal,
  tx: Tx,
  query: string,
): Promise<Result<CorpusCounts, Error>> =>
  corpusCountsOf(
    tx,
    `SELECT d.search FROM concept_index d WHERE d.workspace_id = $1 AND ${readableClause("d", 2)}`,
    [principal.workspaceId, ...readableParameters(principal)],
    query,
  );

const MATCH = anyWordMatch("c.search", "$4", ["c.iri"], { size: "$5", frequencies: "$6" });

const matchingConcepts = (strength: MatchStrength, narrowed: boolean, after: boolean): string => {
  const bound = narrowed ? 9 : 8;
  const placed = (at: number): `$${number}` => `$${bound + at}`;
  return `${conceptSelect(MATCH)}
      AND ${MATCH.matches}
      AND ${MATCH.strength(strength)}
      ${narrowed ? "AND c.collection = ANY($8::text[])" : ""}
      ${after ? `AND ${MATCH.after({ weight: placed(0), rank: placed(1), key: [placed(2)] })}` : ""}
    ORDER BY ${MATCH.order}
    LIMIT $7`;
};

export type ConceptBound = MatchBound<ConceptIri>;

export type ConceptFound = { readonly concept: OpenedConcept; readonly bound: ConceptBound };

type MatchingConceptRow = ConceptRow & { readonly weight: number; readonly rank: number };

export const findConcepts = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ConceptSearch & { readonly counts?: CorpusCounts | undefined },
): Promise<Result<readonly ConceptFound[], Error>> => {
  const counts =
    input.counts === undefined
      ? await conceptCountsOf(principal, tx, input.query)
      : ok(input.counts);
  return counts.ok ? conceptsWeighed(principal, tx, input, counts.value) : counts;
};

type ConceptSearch = {
  readonly query: string;
  readonly strength: MatchStrength;
  readonly limit: number;
  readonly after?: ConceptBound | undefined;
  readonly collections?: readonly string[] | undefined;
};

const conceptsWeighed = (
  principal: UserPrincipal,
  tx: Tx,
  input: ConceptSearch,
  counts: CorpusCounts,
): Promise<Result<readonly ConceptFound[], Error>> =>
  attempt(async () => {
    const { after, collections } = input;
    const { rows } = await tx.query<MatchingConceptRow>(
      matchingConcepts(input.strength, collections !== undefined, after !== undefined),
      [
        principal.workspaceId,
        ...readableParameters(principal),
        input.query,
        counts.size,
        counts.frequencies,
        input.limit,
        ...(collections === undefined ? [] : [collections]),
        ...(after === undefined ? [] : [after.weight, after.rank, after.key]),
      ],
    );
    return rows.map((row) => {
      const concept = openedOf(row);
      return { concept, bound: { weight: row.weight, rank: row.rank, key: concept.iri } };
    });
  });

const readableCollectionsAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

export const readableCollections = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly string[], RefusalOf<typeof readableCollectionsAction> | Error>> => {
  const admitted = admit(readableCollectionsAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;

  return attempt(async () => {
    const { rows } = await tx.query<{ readonly collection: string }>(
      `SELECT DISTINCT c.collection
         FROM concept_index c
        WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}
          AND c.collection IS NOT NULL
        ORDER BY c.collection`,
      [reader.workspaceId, ...readableParameters(reader)],
    );
    return rows.map((row) => row.collection);
  });
};

export const evidenceForAReadableConcept = (alias: string, roleParameter: number): string =>
  `EXISTS (SELECT 1
             FROM concept_evidence ce
             JOIN concept_index ci ON ci.workspace_id = ce.workspace_id AND ci.iri = ce.iri
            WHERE ce.workspace_id = ${alias}.workspace_id
              AND ce.source_document_id = ${alias}.source_document_id
              AND ${readableClause("ci", roleParameter)})`;
