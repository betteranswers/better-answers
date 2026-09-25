import { BUNDLE_MANIFEST_PATH, bundleManifest, type BundleManifest } from "@better-answers/schema";

import { act, declareActs, record } from "../audit/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  ok,
  ulid,
  type Clock,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  commit as commitToBundle,
  fileAtHead,
  head,
  withRepositoryLock,
  type CommitAuthor,
  type CommitRefusal,
  type GitDoor,
} from "../store/git/index.ts";
import { withMembership, type PostgresDoor } from "../store/postgres/index.ts";
import { scalarPairOf, type FrontmatterSource } from "./file.ts";
import { landBundleCommit } from "./landing.ts";

const MANIFEST_ACTS = declareActs("knowledge", {
  written: act("knowledge.manifest.written", { bundleId: "id", commitSha: "gitSha" }),
});

const renderBundleManifest = (manifest: BundleManifest): string =>
  `${Object.entries(manifest)
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join("\n")}\n`;

export const parseBundleManifest = (content: string): Result<BundleManifest, "malformed"> => {
  const pairs: Record<string, FrontmatterSource[string]> = {};
  for (const line of content.replace(/\n$/, "").split("\n")) {
    const pair = scalarPairOf(line);
    if (pair === undefined || Object.hasOwn(pairs, pair.key)) return err("malformed");
    pairs[pair.key] = pair.value;
  }
  const parsed = bundleManifest.safeParse(pairs);
  return parsed.success ? ok(parsed.data) : err("malformed");
};

export type WriteManifestInput = {
  readonly manifest: BundleManifest;

  readonly message: string;

  readonly author: CommitAuthor;
};

export type ManifestWritten =
  | { readonly written: true; readonly sha: string; readonly auditEventId: string }
  | { readonly written: false };

export type WriteManifestRefusal =
  | RoleRefusal
  | CommitRefusal
  | PrincipalRefusal
  | "malformed"
  | "path-taken";

/**
 * Reads the bundle's head against `manifest`: `absent` when no manifest stands, `standing` when
 * one with the same id does, and `taken` when anything else holds the path, a malformed file
 * included.
 */
export const manifestAtHead = async (
  principal: UserPrincipal,
  git: GitDoor,
  manifest: BundleManifest,
): Promise<Result<"absent" | "standing" | "taken", Error>> => {
  const standing = await attempt(() => fileAtHead(principal, git, BUNDLE_MANIFEST_PATH));
  if (!standing.ok) return err(standing.error);
  if (standing.value === null) return ok("absent");
  const held = parseBundleManifest(standing.value);
  return ok(held.ok && held.value.id === manifest.id ? "standing" : "taken");
};

/**
 * Writes the manifest as a commit of its own, once: `written: false` when a manifest with the
 * same id already stands, `path-taken` when anything else holds the path.
 */
export const writeManifest = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  input: WriteManifestInput,
): Promise<Result<ManifestWritten, WriteManifestRefusal | Error>> => {
  if (principal.role === "Viewer") return err("role-forbids");
  const manifest = bundleManifest.safeParse(input.manifest);
  if (!manifest.success) return err("malformed");

  const auditEventId = ulid();

  return withRepositoryLock(principal, doors.git, async () => {
    const atHead = await manifestAtHead(principal, doors.git, manifest.data);
    if (!atHead.ok) return err(atHead.error);
    if (atHead.value === "standing") return ok({ written: false });
    if (atHead.value === "taken") return err("path-taken");

    const committed = await commitToBundle(principal, doors.git, {
      path: BUNDLE_MANIFEST_PATH,
      content: renderBundleManifest(manifest.data),
      message: input.message,
      author: input.author,
      trailers: { actor: actorIdOf(principal), audit: auditEventId },
      expectedHead: await head(principal, doors.git),
      at: doors.clock.now(),
    });
    if (!committed.ok) return err(committed.error);

    const landed = await attempt(() =>
      withMembership(principal, doors.postgres, async (fresh, tx) => {
        await record(fresh, tx, {
          id: auditEventId,
          act: MANIFEST_ACTS.written,
          subjectId: manifest.data.id,
          detail: { bundleId: manifest.data.id, commitSha: committed.value.sha },
        });
        await landBundleCommit(fresh, tx, {
          commit: committed.value,
          actor: actorIdOf(fresh),
          auditEventId,
        });
      }),
    );
    if (!landed.ok) return err(landed.error);
    if (!landed.value.ok) return err(landed.value.error);

    return ok({ written: true, sha: committed.value.sha, auditEventId });
  });
};
