import { PERSON_PREFIX, type UserPrincipal } from "../../kernel/index.ts";
import type { Tx } from "../../store/postgres/index.ts";
import { verificationOf, type ConceptVerification, type VerificationRow } from "../trust.ts";

type SelectPart = { readonly columns: string; readonly joins: string };

const VERIFICATION_COLUMNS = `v.actor AS verified_by, v.verified_at, v.content_hash AS verified_hash,
              NULLIF(verifier.name, '') AS verified_by_name`;

const VERIFIER_JOIN = `LEFT JOIN "user" verifier
                ON starts_with(v.actor, '${PERSON_PREFIX}')
               AND verifier.id = substr(v.actor, ${PERSON_PREFIX.length + 1})`;

export const latestVerificationOf = (alias: string): SelectPart => ({
  columns: VERIFICATION_COLUMNS,
  joins: `LEFT JOIN LATERAL (
                SELECT actor, verified_at, content_hash
                  FROM concept_verification
                 WHERE workspace_id = ${alias}.workspace_id AND iri = ${alias}.iri
                 ORDER BY verified_at DESC, id DESC
                 LIMIT 1
              ) v ON true
         ${VERIFIER_JOIN}`,
});

const EVERY_VERIFICATION = `SELECT ${VERIFICATION_COLUMNS}
    FROM concept_verification v
    ${VERIFIER_JOIN}
   WHERE v.workspace_id = $1 AND v.iri = $2
   ORDER BY v.verified_at DESC, v.id DESC`;

/** Every verification of a concept the reader has already been shown, newest first. */
export const verificationsOf = async (
  reader: UserPrincipal,
  tx: Tx,
  iri: string,
): Promise<readonly ConceptVerification[]> => {
  const { rows } = await tx.query<VerificationRow>(EVERY_VERIFICATION, [reader.workspaceId, iri]);
  return rows.flatMap((row) => verificationOf(row) ?? []);
};
