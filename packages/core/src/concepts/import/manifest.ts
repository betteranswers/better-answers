import { z } from "zod";

import { BUNDLE_MANIFEST_PATH, bundleManifest, type BundleManifest } from "@better-answers/schema";

import { action, declareActions, record } from "../../audit/index.ts";
import { commitAndLandAsMember, landBundleCommit, withBundleWrite } from "../../bundle/index.ts";
import {
  actorIdOf,
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  ok,
  ulid,
  type Clock,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../../kernel/index.ts";
import { ANY_HEAD, fileAtHead, type CommitAuthor, type GitDoor } from "../../store/git/index.ts";
import type { PostgresDoor } from "../../store/postgres/index.ts";
import { scalarPairOf, type FrontmatterSource } from "../file.ts";
import type { PassedOnCommitRefusal } from "../vocabulary.ts";

const MANIFEST_ACTIONS = declareActions("knowledge", {
  written: action("knowledge.manifest.written", { bundleId: "id", commitSha: "gitSha" }),
});

const renderBundleManifest = (manifest: BundleManifest): string =>
  `${Object.entries(manifest)
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join("\n")}\n`;

export const parseBundleManifest = (content: string): Result<BundleManifest, "malformed"> => {
  const pairs = new Map<string, FrontmatterSource[string]>();
  for (const line of content.replace(/\n$/u, "").split("\n")) {
    const pair = scalarPairOf(line);
    if (pair === undefined || pairs.has(pair.key)) return err("malformed");
    pairs.set(pair.key, pair.value);
  }
  const parsed = bundleManifest.safeParse(Object.fromEntries(pairs));
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

const writeManifestAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.custom<WriteManifestInput>(),
  refuses: ["role-forbids", "malformed", "path-taken"],
});

export type WriteManifestRefusal =
  | RefusalOf<typeof writeManifestAction>
  | PassedOnCommitRefusal
  | PrincipalRefusal;

export const manifestAtHead = async (
  principal: UserPrincipal,
  git: GitDoor,
  manifest: BundleManifest,
): Promise<Result<"absent" | "standing" | "taken">> => {
  const standing = await attempt(() => fileAtHead(principal, git, BUNDLE_MANIFEST_PATH));
  if (!standing.ok) return err(standing.error);
  if (standing.value === null) return ok("absent");
  const held = parseBundleManifest(standing.value);
  return ok(held.ok && held.value.id === manifest.id ? "standing" : "taken");
};

/**
 * `written: false` when a manifest with the same id already stands, `path-taken` when anything
 * else holds the path.
 */
export const writeManifest = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  input: WriteManifestInput,
): Promise<Result<ManifestWritten, WriteManifestRefusal | Error>> => {
  const admitted = admit(writeManifestAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const manifest = bundleManifest.safeParse(input.manifest);
  if (!manifest.success) return err("malformed");

  const auditEventId = ulid();

  return withBundleWrite(principal, doors, async () => {
    const atHead = await manifestAtHead(principal, doors.git, manifest.data);
    if (!atHead.ok) return err(atHead.error);
    if (atHead.value === "standing") return ok({ written: false });
    if (atHead.value === "taken") return err("path-taken");

    // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- without it TypeScript infers Refused as string from the caller return type, not the default never
    const landed = await commitAndLandAsMember<never>(
      principal,
      doors,
      {
        path: BUNDLE_MANIFEST_PATH,
        content: renderBundleManifest(manifest.data),
        message: input.message,
        author: input.author,
        trailers: { actor: actorIdOf(principal), audit: auditEventId },
        expectedHead: ANY_HEAD,
        at: doors.clock.now(),
      },
      async (fresh, tx, committed) => {
        await record(fresh, tx, {
          id: auditEventId,
          action: MANIFEST_ACTIONS.written,
          subjectId: manifest.data.id,
          detail: { bundleId: manifest.data.id, commitSha: committed.sha },
        });
        await landBundleCommit(fresh, tx, {
          commit: committed,
          actor: actorIdOf(fresh),
          auditEventId,
        });
      },
      async () => undefined,
    );
    if (!landed.ok) return err(landed.error);

    return ok({ written: true, sha: landed.value.sha, auditEventId });
  });
};
