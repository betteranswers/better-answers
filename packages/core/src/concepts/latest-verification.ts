import { PERSON_PREFIX } from "../kernel/index.ts";

type SelectPart = { readonly columns: string; readonly joins: string };

export const latestVerificationOf = (alias: string): SelectPart => ({
  columns: `v.actor AS verified_by, v.verified_at, v.content_hash AS verified_hash,
              NULLIF(verifier.name, '') AS verified_by_name`,
  joins: `LEFT JOIN LATERAL (
                SELECT actor, verified_at, content_hash
                  FROM concept_verification
                 WHERE workspace_id = ${alias}.workspace_id AND iri = ${alias}.iri
                 ORDER BY verified_at DESC, id DESC
                 LIMIT 1
              ) v ON true
         LEFT JOIN "user" verifier
                ON starts_with(v.actor, '${PERSON_PREFIX}')
               AND verifier.id = substr(v.actor, ${PERSON_PREFIX.length + 1})`,
});
