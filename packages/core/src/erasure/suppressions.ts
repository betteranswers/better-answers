import type { PlatformPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { ErasureFamily, ErasureMap } from "./map.ts";
import type { SubjectIdentifiers } from "./requests.ts";

/**
 * Step 6 of the erasure routine (ADR 0020; the S0 spec, *The routine*, step 6): one
 * **suppression** for every document the erasure map found, linked to the erasure request and
 * carrying the identifiers a reprocess has to keep out of every derived store.
 *
 * **This is the whole erasure for a subject with no user row.** Such a person has no history
 * to rewrite and no identity set to pseudonymise; what the platform holds about them is text
 * inside company documents, and the object store is never reached for those — a document that
 * mentions a person is suppressed when it is next reprocessed, never deleted, and a document
 * that never reached git is a suppression rather than a rewrite. So this arm is not a
 * bookkeeping line beside the git step; on that road it is the erasure.
 *
 * **Driven by the map and by no read of its own.** The documents come from the map's
 * `source-document` entry, which is the one place that decides which documents name the
 * person: an arm that ran its own query would be a second answer to the question the map
 * exists to answer, and the two would drift the day S1 writes the finder. Today that finder
 * answers none — the match is over the normalised text S1's indexing produces — so end to end
 * this arm writes no rows, and it says `found 0, suppressed 0` on the report's own line rather
 * than staying silent, which is S1 not having landed said out loud.
 */

/** The family the documents come from — the map's word, so the key is written once. */
const SOURCE_DOCUMENT: ErasureFamily = "source-document";

/**
 * The documents the map named, deduplicated and in the map's own order: what one suppression
 * is written for each of, and what step 7's wipe finds its bindings from.
 */
export const documentsTheMapFound = (map: ErasureMap): readonly string[] => [
  ...new Set(map.find((entry) => entry.family === SOURCE_DOCUMENT)?.locations ?? []),
];

/** What step 6 did, for the `source-document` line of the routine's record of itself. */
export type Suppressed = {
  /** How many suppressions stand for this request afterwards — this run's and any earlier run's. */
  readonly suppressed: number;
};

/** Whether the set names anything at all across its kinds. */
const holdsAnIdentifier = (identifiers: SubjectIdentifiers | null): boolean =>
  identifiers !== null && Object.values(identifiers).some((named) => named.length > 0);

/**
 * Write one suppression per document the map found.
 *
 * The **platform principal is the first argument and unread in the body**, as the git door's
 * `withRepositoryLockAs` and the Postgres door's `withSessionLock` leave their own: the
 * transaction is already scoped and already the platform's, and an entry on this slice's face
 * that could be called without naming who is making the write would be one a slice could reach
 * holding a person's Principal.
 *
 * **The identifiers are the request's set as it stood when the routine ran.** A second run
 * conflicts on the key and does nothing, so what a reprocess reads is always the copy the
 * first run took — which is what the replay copy names as the set the suppressions were
 * written from, and what makes a restore able to re-create them.
 *
 * **A set that names nothing writes no row.** `suppression_identifiers_check` refuses an empty
 * set, and refuses it because a reprocess reading one would act on it by doing nothing, which
 * is an erasure quietly undone at the next conversion. A request may legally name its subject
 * by person id alone and hold no identifiers at all (`subject_request_subject_check`), so the
 * arm answers for that here rather than letting a CHECK abort the whole routine halfway. The
 * pair cannot arise from the platform's own finder — S1 matches documents *by* the
 * identifiers, so no identifiers is no documents — and where it does arise the report's line
 * reads `found n, suppressed 0`, which is the gap written down rather than hidden.
 */
export const suppressTheDocuments = async (
  platform: PlatformPrincipal,
  tx: Tx,
  input: {
    readonly workspaceId: string;
    readonly erasureRequestId: string;
    readonly identifiers: SubjectIdentifiers | null;
    readonly map: ErasureMap;
  },
): Promise<Suppressed> => {
  const documents = documentsTheMapFound(input.map);
  if (documents.length > 0 && holdsAnIdentifier(input.identifiers)) {
    // One statement for the whole set rather than one per document: the rows differ in a
    // single column, and a loop would be as many round trips as an erasure found documents.
    await tx.query(
      `INSERT INTO suppression (workspace_id, erasure_request_id, document_id, identifiers)
       SELECT $1, $2, named.document_id, $4
         FROM unnest($3::text[]) AS named(document_id)
       ON CONFLICT (workspace_id, erasure_request_id, document_id) DO NOTHING`,
      [input.workspaceId, input.erasureRequestId, [...documents], input.identifiers],
    );
  }
  // What stands, not what this statement inserted: a replay re-runs every step and its insert
  // conflicts away, and a line saying `suppressed 0` there would describe the statement rather
  // than the request.
  const standing = await tx.query<{ suppressed: number }>(
    `SELECT count(*)::int AS suppressed
       FROM suppression WHERE workspace_id = $1 AND erasure_request_id = $2`,
    [input.workspaceId, input.erasureRequestId],
  );
  return { suppressed: standing.rows[0]?.suppressed ?? 0 };
};
