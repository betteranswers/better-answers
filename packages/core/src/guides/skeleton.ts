import { z } from "zod";

import { GUIDE_LAYERS, ROLE_LABELS, ROLES, TRUST_TIERS } from "@better-answers/schema";

import { authorOf, commitAndLandAsMember, landBundleCommit } from "../bundle/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  ok,
  type Clock,
  type PrincipalRefusal,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  ANY_HEAD,
  fileAtHead,
  type CommitRefusal,
  type Committed,
  type GitDoor,
} from "../store/git/index.ts";
import { withMemberUnheld, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import type { GuideDefinition } from "./definition.ts";

export const SKELETON_PROJECTION = "guides";

const skeletonSection = z.strictObject({
  id: z.string(),
  prompt: z.string(),
  roleLabel: z.enum(ROLE_LABELS),
  expects: z.array(z.string()),
  includes: z.array(z.string()),
  get sections() {
    return z.array(skeletonSection);
  },
});

export const guideSkeleton = z.strictObject({
  guide: z.string(),
  template: z.string(),
  kind: z.string(),
  subject: z.string().nullable(),
  roles: z.array(
    z.strictObject({
      role: z.enum(ROLES),
      defaultLayer: z.enum(GUIDE_LAYERS),
      actionThreshold: z.enum(TRUST_TIERS),
    }),
  ),
  sections: z.array(skeletonSection),
});

type GuideSkeleton = z.output<typeof guideSkeleton>;

type SkeletonSection = z.output<typeof skeletonSection>;

export type SkeletonInclude = {
  readonly sectionId: string;
  readonly iri: string;
  readonly ordinal: number;
};

const byOrdinal = (one: { readonly ordinal: number }, other: { readonly ordinal: number }) =>
  one.ordinal - other.ordinal;

const sectionsUnder = (
  definition: GuideDefinition,
  includes: readonly SkeletonInclude[],
  parentId: string | null,
): SkeletonSection[] =>
  definition.sections
    .filter((section) => section.parentId === parentId)
    .toSorted(byOrdinal)
    .map((section) => ({
      id: section.id,
      prompt: section.prompt,
      roleLabel: section.roleLabel,
      expects: [...section.factNames],
      includes: includes
        .filter((include) => include.sectionId === section.id)
        .toSorted(byOrdinal)
        .map((include) => include.iri),
      sections: sectionsUnder(definition, includes, section.id),
    }));

export const skeletonOf = (
  definition: GuideDefinition,
  includes: readonly SkeletonInclude[],
): GuideSkeleton => ({
  guide: definition.id,
  template: definition.template,
  kind: definition.kind,
  subject: definition.subjectIri,
  roles: definition.roles
    .toSorted((one, other) => ROLES.indexOf(one.role) - ROLES.indexOf(other.role))
    .map(({ role, defaultLayer, actionThreshold }) => ({ role, defaultLayer, actionThreshold })),
  sections: sectionsUnder(definition, includes, null),
});

export const renderSkeleton = (
  definition: GuideDefinition,
  includes: readonly SkeletonInclude[],
): string => `${JSON.stringify(skeletonOf(definition, includes), null, 2)}\n`;

const skeletonPathOf = (guideId: string): string => `guides/${guideId}.yaml`;

export type SkeletonRefusal = CommitRefusal | PrincipalRefusal;

export type SkeletonWritten =
  | { readonly written: true; readonly sha: string }
  | { readonly written: false };

export type WriteSkeletonInput = {
  readonly guideId: string;
  readonly content: string;
  readonly auditEventId: string;
  readonly land: (fresh: UserPrincipal, tx: Tx, committed: Committed) => Promise<void>;
};

export type GuideDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly clock: Clock;
};

export const writeSkeleton = async (
  principal: UserPrincipal,
  doors: GuideDoors,
  input: WriteSkeletonInput,
): Promise<Result<SkeletonWritten, SkeletonRefusal | Error>> => {
  const path = skeletonPathOf(input.guideId);
  const standing = await attempt(() => fileAtHead(principal, doors.git, path));
  if (!standing.ok) return err(standing.error);
  if (standing.value === input.content) return ok({ written: false });

  const author = await attempt(() =>
    withMemberUnheld(principal, doors.postgres, (fresh, tx) => authorOf(fresh, tx, fresh.userId)),
  );
  if (!author.ok) return err(author.error);
  if (!author.value.ok) return err(author.value.error);

  const landed = await commitAndLandAsMember<never>(
    principal,
    doors,
    {
      path,
      content: input.content,
      message: `Project the skeleton of guide ${input.guideId}`,
      author: author.value.value,
      trailers: {
        actor: actorIdOf(principal),
        audit: input.auditEventId,
        projection: SKELETON_PROJECTION,
      },
      expectedHead: ANY_HEAD,
      at: doors.clock.now(),
    },
    async (fresh, tx, committed) => {
      await input.land(fresh, tx, committed);
      await landBundleCommit(fresh, tx, {
        commit: committed,
        actor: actorIdOf(fresh),
        auditEventId: input.auditEventId,
      });
    },
    async () => undefined,
  );
  if (!landed.ok) return err(landed.error);
  return ok({ written: true, sha: landed.value.sha });
};
