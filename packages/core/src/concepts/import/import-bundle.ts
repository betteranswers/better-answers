import { z } from "zod";

import {
  CONCEPT_STABLE_STATUS,
  type BundleManifest,
  type SENSITIVITIES,
} from "@better-answers/schema";

import { type Sensitivity } from "../../access/index.ts";
import { authorOf } from "../../bundle/index.ts";
import {
  actorIdOfPerson,
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  ok,
  ulid,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../../kernel/index.ts";
import { type CommitAuthor, type GitDoor } from "../../store/git/index.ts";
import { withMember, type PostgresDoor } from "../../store/postgres/index.ts";
import { type FrontmatterSource } from "../file.ts";
import { writeConcept, type WriteConceptRefusal, type WriteDoors } from "../writes/write.ts";
import {
  countVerifications,
  IMPORT_SENSITIVITY_DEFAULT,
  personIdsByEmail,
  presentVerifications,
  readBundle,
  recordImportedVerifications,
  rewriteLinks,
  standingAt,
  type BundleTree,
  type ImportedVerification,
  type LoadedConcept,
  type StandingConcept,
  type Unsound,
  type VerificationsRecorded,
} from "./loader.ts";
import { manifestAtHead, writeManifest, type WriteManifestRefusal } from "./manifest.ts";

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

type ImportDoors = WriteDoors & {
  readonly log: ImportLog;
  readonly analyse: () => Promise<void>;
};

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

const MALFORMED_MANIFEST = ["malformed", "malformed-path", "malformed-message"] as const;

const isMalformedManifest = (refusal: string): refusal is (typeof MALFORMED_MANIFEST)[number] =>
  MALFORMED_MANIFEST.some((word) => word === refusal);

const manifestRefusalOf = (refusal: WriteManifestRefusal | Error): ImportBundleRefusal | Error => {
  if (refusal instanceof Error) return refusal;
  if (refusal === "path-taken") return "manifest-taken";
  if (isMalformedManifest(refusal)) {
    return new Error(`the manifest commit was refused: ${refusal}`);
  }
  return refusal;
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
      // oxlint-disable-next-line eslint/no-await-in-loop -- a concept landed earlier in the bundle is known to the ones after it
      const wrote = await landOne(principal, doors, run, concept);
      if (!wrote.ok) return stop(concept.file, wrote.error);
      landed.push(concept.path);
      held = wrote.value;
      known.set(concept.path, held);
    } else {
      skipped.push(concept.path);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the import stops at the first concept whose verifications fail to record
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
    // oxlint-disable-next-line eslint/no-await-in-loop -- each rewrite lands as its own commit, and the import stops at the first refused
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
      reuse: "confirmed",
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
  const analysed = await attempt(doors.analyse);
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
