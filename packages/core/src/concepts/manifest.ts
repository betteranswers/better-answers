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
    const standing = await attempt(() => fileAtHead(principal, doors.git, BUNDLE_MANIFEST_PATH));
    if (!standing.ok) return err(standing.error);
    if (standing.value !== null) {
      const held = parseBundleManifest(standing.value);
      return held.ok && held.value.id === manifest.data.id
        ? ok({ written: false })
        : err("path-taken");
    }

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
