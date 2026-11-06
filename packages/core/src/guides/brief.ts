import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";
import { markersOf } from "@better-answers/schema/brief-marker";

import { readableClause, readableParameters } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { withBundleWrite } from "../bundle/index.ts";
import {
  admit,
  attempt,
  declareAction,
  err,
  ok,
  ulid,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { folded, withMember, type Tx } from "../store/postgres/index.ts";
import type { GuideDoors } from "./skeleton.ts";
import { shownClause } from "./withheld.ts";
import {
  GUIDE_ACTIONS,
  includeSnapshot,
  insertWriteUpVersions,
  SECTION_HOME,
  snapshotEntryOf,
  type IncludeRow,
} from "./write-ups.ts";

const BRIEF_MARKDOWN_MAX = 20_000;

export const saveBriefInput = z.strictObject({
  writeUpId: boundarySchemas.writeUp.select.shape.id,
  markdown: z.string().max(BRIEF_MARKDOWN_MAX),
  base: boundarySchemas.writeUpVersion.select.shape.version,
});

type SaveBriefInput = z.input<typeof saveBriefInput>;

const saveBriefAction = declareAction({
  admits: { role: "Editor", purposes: [] },
  input: z.custom<SaveBriefInput>(),
  refuses: ["role-forbids", "not-found", "marker-without-include", "stale-precondition"],
});

export type SaveBriefRefusal = RefusalOf<typeof saveBriefAction> | PrincipalRefusal | Error;

export type BriefSaved = { readonly saved: boolean; readonly version: number };

type BriefRefusal = Exclude<RefusalOf<typeof saveBriefAction>, "role-forbids">;

const HELD_WRITE_UP = `
  SELECT w.guide_id FROM write_up w
   WHERE w.workspace_id = $1 AND w.id = $2 AND w.home = '${SECTION_HOME}'
     AND ${readableClause("w", 3)}
     AND ${shownClause({ guide: "w.guide_id", section: "w.section_id" }, 3)}
     FOR UPDATE OF w`;

const LATEST_VERSION = `
  SELECT version, markdown, includes FROM write_up_version
   WHERE workspace_id = $1 AND write_up_id = $2
   ORDER BY version DESC LIMIT 1`;

const INCLUDES = `
  SELECT write_up_id AS "writeUpId", id, ordinal, iri, content_hash AS "contentHash",
         expected_fact_id AS "expectedFactId", wording_heading AS "wordingHeading",
         wording_hash AS "wordingHash"
    FROM write_up_include
   WHERE workspace_id = $1 AND write_up_id = $2
   ORDER BY ordinal, id`;

type LatestRow = {
  readonly version: number;
  readonly markdown: string;
  readonly includes: unknown;
};

type Snapshot = z.output<typeof includeSnapshot>;

const sameInclude = (one: Snapshot[number], other: Snapshot[number]): boolean =>
  one.id === other.id &&
  one.iri === other.iri &&
  one.contentHash === other.contentHash &&
  one.expectedFactId === other.expectedFactId &&
  one.ordinal === other.ordinal &&
  one.wordingHeading === other.wordingHeading &&
  one.wordingHash === other.wordingHash;

const sameIncludes = (stored: Snapshot, standing: readonly IncludeRow[]): boolean => {
  const entries = standing.map(snapshotEntryOf);
  return (
    stored.length === entries.length &&
    stored.every((entry, at) => {
      const other = entries[at];
      return other !== undefined && sameInclude(entry, other);
    })
  );
};

const refusalOf = (
  input: SaveBriefInput,
  latest: LatestRow,
  standing: readonly IncludeRow[],
): BriefRefusal | undefined => {
  const named = new Set(standing.map((include) => include.id));
  if (markersOf(input.markdown).some((label) => !named.has(label))) {
    return "marker-without-include";
  }
  return input.base === latest.version ? undefined : "stale-precondition";
};

const saved = async (
  fresh: UserPrincipal,
  tx: Tx,
  input: SaveBriefInput,
): Promise<Result<BriefSaved, BriefRefusal>> => {
  const { workspaceId } = fresh;
  const held = await tx.query<{ guide_id: string }>(HELD_WRITE_UP, [
    workspaceId,
    input.writeUpId,
    ...readableParameters(fresh),
  ]);
  const guideId = held.rows[0]?.guide_id;
  if (guideId === undefined) return err("not-found");

  const latest = (await tx.query<LatestRow>(LATEST_VERSION, [workspaceId, input.writeUpId]))
    .rows[0];
  if (latest === undefined) throw new Error(`write-up ${input.writeUpId} has no version`);
  const standing = (await tx.query<IncludeRow>(INCLUDES, [workspaceId, input.writeUpId])).rows;

  const refused = refusalOf(input, latest, standing);
  if (refused !== undefined) return err(refused);
  const unchangedIncludes = sameIncludes(includeSnapshot.parse(latest.includes), standing);
  if (input.markdown === latest.markdown && unchangedIncludes) {
    return ok({ saved: false, version: latest.version });
  }

  const version = latest.version + 1;
  await insertWriteUpVersions(fresh, tx, [
    { writeUpId: input.writeUpId, version, markdown: input.markdown, includes: standing },
  ]);
  await record(fresh, tx, {
    id: ulid(),
    action: GUIDE_ACTIONS.briefSaved,
    subjectId: guideId,
    detail: { guideId, writeUpId: input.writeUpId, version },
  });
  return ok({ saved: true, version });
};

export const saveBrief = async (
  principal: UserPrincipal,
  doors: GuideDoors,
  input: SaveBriefInput,
): Promise<Result<BriefSaved, SaveBriefRefusal>> => {
  const admitted = admit(saveBriefAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  return withBundleWrite(principal, doors, async () => {
    const written = await attempt(() =>
      withMember(admitted.value, doors.postgres, (fresh, tx) => saved(fresh, tx, input)),
    );
    return written.ok ? folded(written.value) : err(written.error);
  });
};
