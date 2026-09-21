import type { PlatformPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { ErasureFamily, ErasureMap } from "./map.ts";
import type { SubjectIdentifiers } from "./requests.ts";

const SOURCE_DOCUMENT: ErasureFamily = "source-document";

export const documentsTheMapFound = (map: ErasureMap): readonly string[] => [
  ...new Set(map.find((entry) => entry.family === SOURCE_DOCUMENT)?.locations ?? []),
];

export type Suppressed = {
  readonly suppressed: number;
};

const holdsAnIdentifier = (identifiers: SubjectIdentifiers | null): boolean =>
  identifiers !== null && Object.values(identifiers).some((named) => named.length > 0);

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
    await tx.query(
      `INSERT INTO suppression (workspace_id, erasure_request_id, document_id, identifiers)
       SELECT $1, $2, named.document_id, $4
         FROM unnest($3::text[]) AS named(document_id)
       ON CONFLICT (workspace_id, erasure_request_id, document_id) DO NOTHING`,
      [input.workspaceId, input.erasureRequestId, [...documents], input.identifiers],
    );
  }

  const standing = await tx.query<{ suppressed: number }>(
    `SELECT count(*)::int AS suppressed
       FROM suppression WHERE workspace_id = $1 AND erasure_request_id = $2`,
    [input.workspaceId, input.erasureRequestId],
  );
  return { suppressed: standing.rows[0]?.suppressed ?? 0 };
};
