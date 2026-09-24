import { RESTRICTED_TO_ADMINS, type Visibility } from "../access/index.ts";
import { act, declareActs, type DetailOf } from "../audit/index.ts";
import type { Principal } from "../kernel/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";

export const RECONCILER_ACTS = declareActs("platform", {
  replayed: act("platform.reconciler.replayed", {
    commitSha: "gitSha",
    iri: "iri?",
    contentHash: "contentHash?",
    evidenceAgrees: "flag?",
    bundleId: "id?",
  }),
});

export const restsAlsoOnWhenReplayed = (evidenceAgrees: boolean): readonly Visibility[] =>
  evidenceAgrees ? [] : [RESTRICTED_TO_ADMINS];

const EVIDENCE_AGREES = "evidenceAgrees" satisfies keyof DetailOf<
  typeof RECONCILER_ACTS.replayed.detail
>;

// A cascade re-derives from the standing citations, not the ones the lost commit's file names,
// so only the hit still says they disagree.
export const restsAlsoOnItsReconcilerHit = async (
  principal: Principal,
  tx: Tx,
  iri: string,
): Promise<readonly Visibility[]> => {
  const hit = await tx.query<{ evidence_agrees: boolean | null }>(
    `SELECT (e.detail ->> $4)::boolean AS evidence_agrees
       FROM concept_index c
       JOIN bundle_commit bc ON bc.workspace_id = c.workspace_id AND bc.sha = c.commit_sha
       JOIN audit_event e ON e.workspace_id = bc.workspace_id AND e.id = bc.audit_event_id
      WHERE c.workspace_id = ${scopeClause(1)} AND c.iri = $2 AND e.act = $3`,
    [scopeParameter(principal), iri, RECONCILER_ACTS.replayed.name, EVIDENCE_AGREES],
  );
  return restsAlsoOnWhenReplayed(hit.rows[0]?.evidence_agrees ?? true);
};
