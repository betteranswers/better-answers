import { z } from "zod";

import {
  boundarySchemas,
  FEEDBACK_FLAG_VERDICT,
  type FEEDBACK_REASONS,
} from "@better-answers/schema";

import {
  attempt,
  err,
  ok,
  processActorId,
  type PlatformPrincipal,
  type Result,
} from "../kernel/index.ts";
import { withScopeRead, type PostgresDoor } from "../store/postgres/index.ts";

const MEASURES_ACTOR = processActorId("measures");

export type AnswerMeasuresPrincipal = PlatformPrincipal & {
  readonly actorId: typeof MEASURES_ACTOR;
};

export const ANSWER_MEASURES: AnswerMeasuresPrincipal = {
  kind: "platform",
  actorId: MEASURES_ACTOR,
};

const INCOMPLETE = "incomplete" satisfies (typeof FEEDBACK_REASONS)[number];

const theCounts = z.object({
  flaggedIncomplete: z.number().int(),
  showedUnmappedPassages: z.number().int(),
});

export type UnmappedPassageRate = z.output<typeof theCounts>;

const THE_COUNTS = `SELECT count(*)::int AS "flaggedIncomplete",
         count(*) FILTER (WHERE cardinality(a.unmapped_passages) > 0)::int
           AS "showedUnmappedPassages"
    FROM question_asked a
   WHERE a.workspace_id = $1
     AND EXISTS (SELECT 1 FROM question_feedback f
                  WHERE f.workspace_id = a.workspace_id AND f.record_id = a.id
                    AND f.verdict = '${FEEDBACK_FLAG_VERDICT}' AND f.reason = '${INCOMPLETE}')`;

export const unmappedPassageRate = async (
  platform: AnswerMeasuresPrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string },
): Promise<Result<UnmappedPassageRate, "malformed" | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const counted = await attempt(() =>
    withScopeRead(platform, door, workspace.data, async (tx) =>
      theCounts.parse((await tx.query(THE_COUNTS, [workspace.data])).rows[0]),
    ),
  );
  return counted.ok ? ok(counted.value) : err(counted.error);
};
