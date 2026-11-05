import { RESTRICTED_TO_ADMINS, type Visibility } from "../../access/index.ts";
import { action, declareActions, type DetailOf } from "../../audit/index.ts";
import type { Principal } from "../../kernel/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../../store/postgres/index.ts";

export const RECONCILER_ACTIONS = declareActions("platform", {
  replayed: action("platform.reconciler.replayed", {
    commitSha: "gitSha",
    iri: "iri?",
    contentHash: "contentHash?",
    evidenceAgrees: "flag?",
    bundleId: "id?",
  }),
});

export const restsAlsoOnUnlessEvidenceAgrees = (evidenceAgrees: boolean): readonly Visibility[] =>
  evidenceAgrees ? [] : [RESTRICTED_TO_ADMINS];

export const EVIDENCE_AGREES = "evidenceAgrees" satisfies keyof DetailOf<
  typeof RECONCILER_ACTIONS.replayed.detail
>;

export const restsAlsoOnItsCommit = async (
  principal: Principal,
  tx: Tx,
  iri: string,
): Promise<readonly Visibility[]> => {
  const hit = await tx.query<{ evidence_agrees: boolean | null }>(
    `SELECT (e.detail ->> $3)::boolean AS evidence_agrees
       FROM concept_index c
       JOIN bundle_commit bc ON bc.workspace_id = c.workspace_id AND bc.sha = c.commit_sha
       JOIN audit_event e ON e.workspace_id = bc.workspace_id AND e.id = bc.audit_event_id
      WHERE c.workspace_id = ${scopeClause(1)} AND c.iri = $2`,
    [scopeParameter(principal), iri, EVIDENCE_AGREES],
  );
  return restsAlsoOnUnlessEvidenceAgrees(hit.rows[0]?.evidence_agrees ?? true);
};
