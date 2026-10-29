import type { Sensitivity } from "@better-answers/core/access";
import {
  IMPORT_SENSITIVITY_DEFAULT,
  importBundle,
  RECONCILER,
  reconcile,
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
      `reconcile-watermark: REFUSED — stopped at ${stopped.sha} (${reasonOf(stopped.reason)}); ${found}; every commit before it landed and nothing after it was attempted, and this workspace stays behind that commit until a person steps in`,
    );
    return REFUSED;
  }
  io.say(`reconcile-watermark: done — ${found}`);
  return DONE;
};

const UNSOUND_WORDS = {
  "manifest-missing": () => "the tree has no manifest.yaml at its root",
  "manifest-malformed": (about) =>
    `manifest.yaml does not carry the five keys the platform reads (${about})`,
  "does-not-parse": (about) => `does not parse (${about})`,
  "type-or-title-missing": (about) => `has no ${about}`,
  "reserved-path": (about) => `sits at a path the platform keeps for itself (${about})`,
  "path-refused": (about) => `sits at a path the platform cannot hold (${about})`,
  "link-outside-tree": (about) => `links to ${about}, which is not a concept in the tree`,
  "verifier-not-a-member": (about) =>
    `is verified by ${about}, who is not a member of this workspace; invite them first`,
  "merge-key-clash": (about) => `derives the same merge key as ${about}`,
} satisfies Readonly<Record<UnsoundReason, (about: string) => string>>;

const linksOf = (rewritten: readonly ConceptRewritten[]): number =>
  rewritten.reduce((sum, concept) => sum + concept.links, 0);

const IMPORT_WORDS = {
  "role-forbids": (email: string) =>
    `${email} is not an Admin of this workspace; the import runs as an Admin`,
  "manifest-taken": () =>
    "a manifest with another bundle id already stands in this workspace's bundle",
  "no-such-repository": () => "this workspace has no bundle repository; provision it first",
  "stale-precondition": () =>
    "this workspace's bundle could not be moved while the import was writing its manifest, because another writer moved it or holds its lock; nothing was written, so run the import again, and if it is refused the same way a lock was left on refs/heads/main",
};

const isWorded = (word: string): word is keyof typeof IMPORT_WORDS =>
  Object.hasOwn(IMPORT_WORDS, word);

const importWordSaid = (word: Extract<ImportBundleRefusal, string>, email: string): string =>
  isWorded(word) ? IMPORT_WORDS[word](email) : word;

const importReason = (refusal: ImportBundleRefusal | Error, email: string): string => {
  if (refusal instanceof Error) return refusal.message;
  if (typeof refusal === "string") return importWordSaid(refusal, email);
  if (refusal.kind === "unsound") {
    return `${refusal.file}: ${UNSOUND_WORDS[refusal.reason](refusal.about)}; nothing was written`;
  }
  const { landed, skipped, verifications, rewritten } = refusal.progress;
  return `stopped at ${refusal.file} (${reasonOf(refusal.reason)}); landed ${landed.length}, skipped ${skipped.length}, verifications ${verifications.recorded} recorded, ${counted(linksOf(rewritten), "link")} rewritten; what landed stays, and a rerun continues from there`;
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
      "this process has no way to read a directory, which is a wiring fault and not an operator's",
    );
  }
  const tree = await attempt(() => readTree(from));
  return tree.ok
    ? ok(tree.value)
    : err(`the directory ${from} could not be read: ${tree.error.message}`);
};

const sayImported = (io: OpsIo, imported: BundleImported, seconds: string): void => {
  const { bundleId, manifest, landed, skipped, verifications, rewritten, concepts } = imported;
  const recorded = `${counted(verifications.recorded, "verification")} recorded (${verifications.present} already present)`;
  const links = counted(linksOf(rewritten), "link");
  if (imported.dryRun) {
    const standing = manifest === "standing" ? "already stands" : "would be written first";
    io.say(
      `import-bundle: dry run — the tree is sound: ${counted(concepts, "concept")}, of which ${landed.length} would land and ${skipped.length} already stand; ${recorded.replace(" recorded", " would be recorded")}; ${links} in ${counted(rewritten.length, "concept")} would be rewritten; manifest ${bundleId} ${standing}; nothing was written`,
    );
    return;
  }
  io.say(
    `import-bundle: manifest ${bundleId} ${manifest === "written" ? "written as the bundle's first commit" : "already stands"}`,
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
      ? `${email} is not a member of workspace ${workspaceId}; invite them first`
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
    { git: git.value, postgres, clock: doors.clock, log: io.logger },
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
    return err("--iri <iri> and --as <member email> are required, with the new body on stdin");
  }
  if (dryRun !== undefined && dryRun !== true) return err("--dry-run takes no value");
  if (dryRun === true) return ok({ iri, email, run: { dryRun, base } });
  if (base === undefined) {
    return err(
      "--expect <content hash> is required on a write; run with --dry-run to read the hash the concept stands at",
    );
  }
  return ok({ iri, email, run: { dryRun: false, base } });
};

const BODY_KEPT = "frontmatter, status, verification and citations kept";

const BODY_WORDS: Partial<
  Record<
    Extract<UpdateConceptBodyRefusal, string>,
    (asked: BodyAsked, workspaceId: string) => string
  >
> = {
  "owner-forbids": (asked) =>
    `${asked.email} neither owns ${asked.iri} nor is an Admin of this workspace; nothing was written`,
  malformed: (asked) =>
    `--iri ${asked.iri} is not a concept iri, or the body is longer than a concept holds; nothing was written`,
  "no-such-concept": (asked, workspaceId) =>
    `no concept ${asked.iri} stands in workspace ${workspaceId} that ${asked.email} can read; a Restricted concept needs an Admin; nothing was written`,
  unchanged: (asked) => `the body given is the one ${asked.iri} already holds; nothing was written`,
  "widening-refused": (asked) =>
    `${asked.iri} is held narrower than the sources it cites, as after a replay whose file cited a document the catalogue no longer holds; a body update would widen it, so nothing was written`,
  "no-such-document": (asked) =>
    `${asked.iri} cites a document the catalogue no longer holds, so its file cannot be written again by this command; escalate it; nothing was written`,
  "body-locator-refused": (asked) =>
    `the body names a passage locator that ${asked.iri}'s sources do not cite; cite the passage in its sources first; nothing was written`,
  "stale-precondition": (asked) =>
    `${asked.iri} moved: ${asked.run.base === undefined ? "its" : `it no longer stands at ${asked.run.base}, or its`} file at the bundle's head is ahead of its row; nothing was written. Run with --dry-run again, and if that refuses the same way a minute later, the rows are behind the bundle: RUNBOOK page 10`,
  "no-such-repository": () => "this workspace has no bundle repository; provision it first",
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
    io.say(`update-concept-body: ${path} stands at ${from.contentHash}; pass it as --expect`);
    for (const line of bodyDiffLines(from.body, to.body)) io.say(line);
    io.say(
      `update-concept-body: dry run — the body would move ${path} from ${from.contentHash} to ${to.contentHash}; ${BODY_KEPT}; nothing was written`,
    );
    return;
  }
  io.say(
    `update-concept-body: done — ${path} moved from ${from.contentHash} to ${written.contentHash}, commit ${written.sha.slice(0, 7)}; ${BODY_KEPT}`,
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
    io.say("update-concept-body: the new body is read from stdin, and stdin was empty");
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
