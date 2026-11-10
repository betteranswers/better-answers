import { boundarySchemas } from "@better-answers/schema";
import { foldConceptType } from "@better-answers/schema/concept-type";

import { action, declareActions, recordEach } from "../../audit/index.ts";
import { attempt, err, ok, type Result } from "../../kernel/index.ts";
import {
  scopeClause,
  scopeParameter,
  withScope,
  type PostgresDoor,
  type Tx,
} from "../../store/postgres/index.ts";
import { followedKeyOf } from "./merge-key.ts";
import type { ReconcilerPrincipal } from "./reconciler.ts";

const REFOLD_ACTIONS = declareActions("platform", {
  refolded: action("platform.concept.refolded", {}),
});

type StoredType = {
  readonly iri: string;
  readonly mergeKey: string;
  readonly conceptType: string | null;
  readonly title: string | null;
  readonly written: string | null;
};

type Refold = {
  readonly iri: string;
  readonly conceptType: string;
  readonly mergeKey: string;
};

type ConceptTypesRefolded = {
  readonly refolded: readonly Refold[];
  readonly clashed: readonly Refold[];
};

const wantedOf = (stored: StoredType): Refold | undefined => {
  if (stored.written === null || stored.title === null) return undefined;
  const conceptType = foldConceptType(stored.written);
  const mergeKey = followedKeyOf(
    { mergeKey: stored.mergeKey, title: stored.title },
    { conceptType, title: stored.title },
  );
  if (conceptType === stored.conceptType && mergeKey === stored.mergeKey) return undefined;
  return { iri: stored.iri, conceptType, mergeKey };
};

const refoldPlanOf = (stored: readonly StoredType[]): ConceptTypesRefolded => {
  let refolded = stored.flatMap((each) => wantedOf(each) ?? []);
  const clashed: Refold[] = [];
  for (;;) {
    const moving = new Map(refolded.map((each) => [each.iri, each.mergeKey]));
    const holders = Map.groupBy(stored, (each) => moving.get(each.iri) ?? each.mergeKey);
    const clashing = refolded.filter((each) => (holders.get(each.mergeKey)?.length ?? 0) > 1);
    if (clashing.length === 0) return { refolded, clashed };
    clashed.push(...clashing);
    refolded = refolded.filter((each) => !clashing.includes(each));
  }
};

const storedTypes = async (platform: ReconcilerPrincipal, tx: Tx): Promise<StoredType[]> => {
  const found = await tx.query<StoredType>(
    `SELECT i.iri, i.merge_key AS "mergeKey", c.concept_type AS "conceptType", c.title,
            c.frontmatter->>'type' AS written
       FROM concept_identity i
       LEFT JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
      WHERE i.workspace_id = ${scopeClause(1)}
      ORDER BY i.iri
        FOR UPDATE OF i`,
    [scopeParameter(platform)],
  );
  return found.rows;
};

const landRefolds = async (
  platform: ReconcilerPrincipal,
  tx: Tx,
  stored: readonly StoredType[],
  refolded: readonly Refold[],
): Promise<void> => {
  const keyed = new Map(stored.map((each) => [each.iri, each.mergeKey]));
  const rekeyed = refolded.filter((each) => keyed.get(each.iri) !== each.mergeKey);
  await tx.query(
    `UPDATE concept_identity SET merge_key = iri
      WHERE workspace_id = ${scopeClause(1)} AND iri = ANY($2::text[])`,
    [scopeParameter(platform), rekeyed.map((each) => each.iri)],
  );
  await tx.query(
    `UPDATE concept_identity AS i SET merge_key = m.merge_key
       FROM unnest($2::text[], $3::text[]) AS m(iri, merge_key)
      WHERE i.workspace_id = ${scopeClause(1)} AND i.iri = m.iri`,
    [
      scopeParameter(platform),
      rekeyed.map((each) => each.iri),
      rekeyed.map((each) => each.mergeKey),
    ],
  );
  await tx.query(
    `UPDATE concept_index AS c SET concept_type = m.concept_type
       FROM unnest($2::text[], $3::text[]) AS m(iri, concept_type)
      WHERE c.workspace_id = ${scopeClause(1)} AND c.iri = m.iri
        AND c.concept_type IS DISTINCT FROM m.concept_type`,
    [
      scopeParameter(platform),
      refolded.map((each) => each.iri),
      refolded.map((each) => each.conceptType),
    ],
  );
  await recordEach(
    platform,
    tx,
    REFOLD_ACTIONS.refolded,
    refolded.map((each) => ({ subjectId: each.iri, detail: {} })),
  );
};

export const refoldConceptTypes = async (
  platform: ReconcilerPrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string },
): Promise<Result<ConceptTypesRefolded, "malformed" | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const run = await attempt(() =>
    withScope(platform, door, workspace.data, async (tx) => {
      const stored = await storedTypes(platform, tx);
      const plan = refoldPlanOf(stored);
      if (plan.refolded.length > 0) await landRefolds(platform, tx, stored, plan.refolded);
      return plan;
    }),
  );
  return run.ok ? ok(run.value) : err(run.error);
};
