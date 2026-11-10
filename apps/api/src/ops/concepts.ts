import type { Sensitivity } from "@better-answers/core/access";
import {
  IMPORT_SENSITIVITY_DEFAULT,
  importBundle,
  RECONCILER,
  reconcile,
  refoldConceptTypes,
  updateConceptBody,
  type BundleImported,
  type BundleTree,
  type ConceptBodyRun,
  type ConceptBodyUpdate,
  type ConceptRewritten,
  type ImportBundleRefusal,
  type UnsoundReason,
  type UpdateConceptBodyRefusal,
} from "@better-answers/core/concepts";
import { attempt, err, ok, type Result, type UserPrincipal } from "@better-answers/core/kernel";
import { analyseMap } from "@better-answers/core/store/map";
import { principalOfMember } from "@better-answers/core/workspaces";
import { SENSITIVITIES } from "@better-answers/schema";

import type { Doors } from "../doors.ts";
import { bodyDiffLines } from "./body-diff.ts";
import {
  DONE,
  REFUSED,
  USAGE,
  type OpsIo,
  type Flags,
  flagValue,
  bundleStore,
  reasonOf,
  refused,
  counted,
} from "./cli.ts";

export const reconcileWatermark = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const git = bundleStore(doors, "the bundle cannot be opened");
  if (!git.ok) {
    io.say(`reconcile-watermark: REFUSED — ${git.error}`);
    return REFUSED;
  }
  const bundle = { git: git.value, postgres: doors.postgres, clock: doors.clock };
  const run = await reconcile(RECONCILER, bundle, { workspaceId });
  if (!run.ok) return refused("reconcile-watermark", workspaceId, run.error, io);
  const { head, watermark, replayed, skipped, stopped } = run.value;
  const found = `head ${head ?? "none"}, watermark ${watermark ?? "none"}, replayed ${replayed.length}, already landed ${skipped.length}`;
  if (stopped !== undefined) {
    io.say(
      `reconcile-watermark: REFUSED — stopped at ${stopped.sha} (${reasonOf(stopped.reason)}); ${found}. Every commit before it landed, and no later commit was tried. The workspace stays at that commit until someone fixes the cause: see RUNBOOK page 10.`,
    );
    return REFUSED;
  }
  io.say(`reconcile-watermark: done — ${found}`);
  return DONE;
};

export const refoldConceptTypesCommand = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const run = await refoldConceptTypes(RECONCILER, doors.postgres, { workspaceId });
  if (!run.ok) return refused("refold-concept-types", workspaceId, run.error, io);
  const { refolded, clashed } = run.value;
  for (const each of clashed) {
    io.say(
      `refold-concept-types: another concept holds ${each.mergeKey}, so ${each.iri} keeps its type and merge key`,
    );
  }
  io.say(
    `refold-concept-types: done — refolded ${counted(refolded.length, "concept")}, ${clashed.length} kept by a clash`,
  );
  if (refolded.length > 0) {
    io.say(
      `refold-concept-types: run map-rebuild --workspace ${workspaceId} to carry the new types into the map`,
    );
  }
  return DONE;
};

const UNSOUND_WORDS = {
  "manifest-missing": () => "the tree has no manifest.yaml at its root",
  "manifest-malformed": (about) =>
    `manifest.yaml is missing some of the five keys the platform reads (${about})`,
  "does-not-parse": (about) => `does not parse (${about})`,
  "type-or-title-missing": (about) => `has no ${about}`,
  "reserved-path": (about) => `is at a path the platform reserves (${about})`,
  "path-refused": (about) => `is at a path the platform cannot store (${about})`,
  "link-outside-tree": (about) => `links to ${about}, which is not a concept in the tree`,
  "verifier-not-a-member": (about) =>
    `is verified by ${about}, who is not a member of this workspace. Invite them first`,
  "document-not-catalogued": (about) =>
    `cites ${about}, which is not a document in this workspace's catalogue. Connect its source first, or remove the citation`,
  "merge-key-clash": (about) => `has the same merge key as ${about}`,
} satisfies Readonly<Record<UnsoundReason, (about: string) => string>>;

const linksOf = (rewritten: readonly ConceptRewritten[]): number =>
  rewritten.reduce((sum, concept) => sum + concept.links, 0);

const UNRECORDED_HEAD =
  "the bundle's latest commit has lost its database rows, and the reconciler has not replayed it yet. Nothing was written. Run again in a minute. If it refuses the same way, the replay has stopped: see RUNBOOK page 10.";

const IMPORT_WORDS = {
  "role-forbids": (email: string) =>
    `${email} is not an Admin of this workspace. Run the import as an Admin.`,
  "manifest-taken": () =>
    "this workspace's bundle already has a manifest with a different bundle id",
  "no-such-repository": () =>
    "this workspace has no bundle repository. Create it, then run this again.",
  "stale-precondition": () =>
    "another writer changed this workspace's bundle, or held its lock, while the import was writing the manifest. Nothing was written. Run the import again. If it refuses the same way, a stale lock is left on refs/heads/main.",
  "unrecorded-head": () => UNRECORDED_HEAD,
};

const isWorded = (word: string): word is keyof typeof IMPORT_WORDS =>
  Object.hasOwn(IMPORT_WORDS, word);

const importWordSaid = (word: Extract<ImportBundleRefusal, string>, email: string): string =>
  isWorded(word) ? IMPORT_WORDS[word](email) : word;

const importReason = (refusal: ImportBundleRefusal | Error, email: string): string => {
  if (refusal instanceof Error) return refusal.message;
  if (typeof refusal === "string") return importWordSaid(refusal, email);
  if (refusal.kind === "unsound") {
    return `${refusal.file}: ${UNSOUND_WORDS[refusal.reason](refusal.about)}. Nothing was written.`;
  }
  const { landed, skipped, verifications, rewritten } = refusal.progress;
  return `stopped at ${refusal.file} (${reasonOf(refusal.reason)}); landed ${landed.length}, skipped ${skipped.length}, verifications ${verifications.recorded} recorded, ${counted(linksOf(rewritten), "link")} rewritten. The concepts that landed stay, and a rerun continues from there.`;
};

const importRefused = (
  workspaceId: string,
  refusal: ImportBundleRefusal | Error,
  email: string,
  io: OpsIo,
): number => {
  const said = importReason(refusal, email);
  if (typeof refusal === "string") return refused("import-bundle", workspaceId, refusal, io, said);
  io.say(`import-bundle: REFUSED — ${said}`);
  return REFUSED;
};

type ImportAsked = {
  readonly from: string;
  readonly email: string;
  readonly sensitivity: Sensitivity;
  readonly dryRun: boolean;
};

export const importAskedOf = (flags: Flags): Result<ImportAsked, string> => {
  const from = flagValue(flags, "from");
  const email = flagValue(flags, "as");
  const asked = flagValue(flags, "sensitivity") ?? IMPORT_SENSITIVITY_DEFAULT;
  const sensitivity = SENSITIVITIES.find((word) => word === asked);
  const dryRun = flags.get("dry-run");
  if (from === undefined || email === undefined) {
    return err("--from <directory> and --as <member email> are required");
  }
  if (sensitivity === undefined) {
    return err(`--sensitivity must be one of ${SENSITIVITIES.join(", ")}`);
  }
  if (dryRun !== undefined && dryRun !== true) return err("--dry-run takes no value");
  return ok({ from, email, sensitivity, dryRun: dryRun === true });
};

const treeUnder = async (io: OpsIo, from: string): Promise<Result<BundleTree, string>> => {
  const readTree = io.readTree;
  if (readTree === undefined) {
    return err(
      "this process was started without a way to read directories. This is a bug in the ops entry point, not an operator error.",
    );
  }
  const tree = await attempt(() => readTree(from));
  return tree.ok ? ok(tree.value) : err(`cannot read the directory ${from}: ${tree.error.message}`);
};

const sayImported = (io: OpsIo, imported: BundleImported, seconds: string): void => {
  const { bundleId, manifest, landed, skipped, verifications, rewritten, concepts } = imported;
  const recorded = `${counted(verifications.recorded, "verification")} recorded (${verifications.present} already present)`;
  const links = counted(linksOf(rewritten), "link");
  if (imported.dryRun) {
    const standing = manifest === "standing" ? "is already written" : "would be written first";
    io.say(
      `import-bundle: dry run — the tree is sound. Of ${counted(concepts, "concept")}, ${landed.length} would land and ${skipped.length} are already in the bundle. ${recorded.replace(" recorded", " would be recorded")}. ${links} in ${counted(rewritten.length, "concept")} would be rewritten. Manifest ${bundleId} ${standing}. Nothing was written.`,
    );
    return;
  }
  io.say(
    `import-bundle: manifest ${bundleId} ${manifest === "written" ? "written as the bundle's first commit" : "is already written"}`,
  );
  const outcomes = [
    ...landed.map((path) => [path, `landed ${path}`] as const),
    ...skipped.map((path) => [path, `skipped ${path} — already landed`] as const),
  ].toSorted(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0));
  for (const [, line] of outcomes) io.say(`import-bundle: ${line}`);
  for (const concept of rewritten) {
    io.say(`import-bundle: rewrote ${concept.path} — ${counted(concept.links, "link")}`);
  }
  io.say(
    `import-bundle: done — landed ${landed.length}, skipped ${skipped.length}, ${recorded}, ${links} rewritten, ${seconds} seconds`,
  );
};

const memberOf = async (
  command: string,
  doors: Doors,
  workspaceId: string,
  email: string,
  io: OpsIo,
): Promise<Result<UserPrincipal, number>> => {
  const principal = await principalOfMember(doors.postgres, {
    workspaceId,
    email,
    at: doors.clock.now(),
  });
  if (principal.ok) return ok(principal.value);
  const said =
    principal.error === "not-a-member"
      ? `${email} is not a member of workspace ${workspaceId}. Invite them first.`
      : undefined;
  return err(refused(command, workspaceId, principal.error, io, said));
};

export const importBundleCommand = async (
  doors: Doors,
  workspaceId: string,
  { from, email, sensitivity, dryRun }: ImportAsked,
  io: OpsIo,
): Promise<number> => {
  const git = bundleStore(doors, "the bundle the import writes into cannot be opened");
  if (!git.ok) {
    io.say(`import-bundle: REFUSED — ${git.error}`);
    return REFUSED;
  }
  const tree = await treeUnder(io, from);
  if (!tree.ok) {
    io.say(`import-bundle: REFUSED — ${tree.error}`);
    return REFUSED;
  }
  const postgres = doors.postgres;
  const principal = await memberOf("import-bundle", doors, workspaceId, email, io);
  if (!principal.ok) return principal.error;
  const started = doors.clock.now();
  const run = await importBundle(
    principal.value,
    {
      git: git.value,
      postgres,
      clock: doors.clock,
      log: io.logger,
      analyse: () => analyseMap(postgres.pool),
    },
    { tree: tree.value, sensitivity, dryRun },
  );
  const seconds = ((doors.clock.now().getTime() - started.getTime()) / 1_000).toFixed(1);
  if (!run.ok) return importRefused(workspaceId, run.error, email, io);
  sayImported(io, run.value, seconds);
  return DONE;
};

type BodyAsked = {
  readonly iri: string;
  readonly email: string;
  readonly run: ConceptBodyRun;
};

export const bodyAskedOf = (flags: Flags): Result<BodyAsked, string> => {
  const iri = flagValue(flags, "iri");
  const email = flagValue(flags, "as");
  const base = flagValue(flags, "expect");
  const dryRun = flags.get("dry-run");
  if (iri === undefined || email === undefined) {
    return err("--iri <iri> and --as <member email> are required, and the new body goes on stdin");
  }
  if (dryRun !== undefined && dryRun !== true) return err("--dry-run takes no value");
  if (dryRun === true) return ok({ iri, email, run: { dryRun, base } });
  if (base === undefined) {
    return err(
      "--expect <content hash> is required unless you pass --dry-run. Run with --dry-run to print the concept's current hash.",
    );
  }
  return ok({ iri, email, run: { dryRun: false, base } });
};

const BODY_KEPT = "The frontmatter, status, verification and citations are kept.";

const BODY_WORDS: Partial<
  Record<
    Extract<UpdateConceptBodyRefusal, string>,
    (asked: BodyAsked, workspaceId: string) => string
  >
> = {
  "owner-forbids": (asked) =>
    `${asked.email} does not own ${asked.iri} and is not an Admin of this workspace. Nothing was written.`,
  malformed: (asked) =>
    `--iri ${asked.iri} is not a concept IRI, or the body is longer than a concept allows. Nothing was written.`,
  "no-such-concept": (asked, workspaceId) =>
    `${asked.email} cannot read a concept ${asked.iri} in workspace ${workspaceId}. It does not exist, or it is Restricted and only an Admin can read it. Nothing was written.`,
  unchanged: (asked) =>
    `the new body is the same as the body ${asked.iri} already has. Nothing was written.`,
  "widening-refused": (asked) =>
    `${asked.iri} has narrower access than the sources it cites, which happens after a replay of a file that cites a document no longer in the catalogue. Updating the body would widen its access, so nothing was written.`,
  "no-such-document": (asked) =>
    `${asked.iri} cites a document that is no longer in the catalogue, so this command cannot rewrite its file. Escalate it. Nothing was written.`,
  "body-locator-refused": (asked) =>
    `the body names a passage locator that ${asked.iri}'s sources do not cite. Add the passage to its sources first. Nothing was written.`,
  "stale-precondition": (asked) =>
    `${asked.iri} has changed: ${asked.run.base === undefined ? "its" : `its content hash is no longer ${asked.run.base}, or its`} file in the bundle is newer than its database row. Nothing was written. Run with --dry-run again. If it refuses the same way a minute later, the database rows are behind the bundle: see RUNBOOK page 10.`,
  "no-such-repository": () =>
    "this workspace has no bundle repository. Create it, then run this again.",
  "unrecorded-head": () => UNRECORDED_HEAD,
};

const bodyWordSaid = (
  word: Extract<UpdateConceptBodyRefusal, string>,
  asked: BodyAsked,
  workspaceId: string,
): string => BODY_WORDS[word]?.(asked, workspaceId) ?? word;

const bodyUpdateRefused = (
  workspaceId: string,
  refusal: UpdateConceptBodyRefusal | Error,
  asked: BodyAsked,
  io: OpsIo,
): number =>
  refused(
    "update-concept-body",
    workspaceId,
    refusal,
    io,
    refusal instanceof Error ? undefined : bodyWordSaid(refusal, asked, workspaceId),
  );

const sayBodyUpdate = (io: OpsIo, update: ConceptBodyUpdate): void => {
  const { path, from, to, written } = update;
  if (written === undefined) {
    io.say(
      `update-concept-body: ${path} has content hash ${from.contentHash}. Pass it as --expect.`,
    );
    for (const line of bodyDiffLines(from.body, to.body)) io.say(line);
    io.say(
      `update-concept-body: dry run — the new body would change ${path} from ${from.contentHash} to ${to.contentHash}. ${BODY_KEPT} Nothing was written.`,
    );
    return;
  }
  io.say(
    `update-concept-body: done — ${path} changed from ${from.contentHash} to ${written.contentHash} in commit ${written.sha.slice(0, 7)}. ${BODY_KEPT}`,
  );
};

export const updateConceptBodyCommand = async (
  doors: Doors,
  workspaceId: string,
  asked: BodyAsked,
  io: OpsIo,
): Promise<number> => {
  const body = await io.stdin();
  if (body.trim() === "") {
    io.say("update-concept-body: stdin was empty. Pipe the new body to stdin.");
    return USAGE;
  }
  const git = bundleStore(doors, "the bundle the update writes into cannot be opened");
  if (!git.ok) {
    io.say(`update-concept-body: REFUSED — ${git.error}`);
    return REFUSED;
  }
  const { iri, email, run } = asked;
  const principal = await memberOf("update-concept-body", doors, workspaceId, email, io);
  if (!principal.ok) return principal.error;
  const bundle = { git: git.value, postgres: doors.postgres, clock: doors.clock };
  const updated = await updateConceptBody(principal.value, bundle, { iri, body, ...run });
  if (!updated.ok) return bodyUpdateRefused(workspaceId, updated.error, asked, io);
  sayBodyUpdate(io, updated.value);
  return DONE;
};
