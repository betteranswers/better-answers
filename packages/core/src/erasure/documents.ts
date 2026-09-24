import type { PlatformPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { erasureMatchesIn, type SoughtIdentifier } from "./identifiers.ts";

// Any one word makes a candidate, since a name split between two chunks leaves no chunk holding
// all its words.
const PROBE = `SELECT string_agg(probe::text, ' | ') AS probe
     FROM (SELECT plainto_tsquery('english', word) AS probe
             FROM unnest($1::text[]) AS word) AS words
    WHERE numnode(probe) > 0`;

const LIVE = `FROM "index".chunk c
     JOIN source_document d ON d.workspace_id = c.workspace_id AND d.id = c.source_document_id
    WHERE c.workspace_id = $1 AND d.gone_at IS NULL`;

const LIVE_DOCUMENTS_PROBED = `SELECT DISTINCT c.source_document_id AS id ${LIVE}
      AND c.search @@ $2::tsquery`;

const EVERY_LIVE_DOCUMENT = `SELECT DISTINCT c.source_document_id AS id ${LIVE}`;

// Chunks are contiguous slices, so joined in order they are the document's indexed text.
const INDEXED_TEXT = `SELECT string_agg(content, '' ORDER BY ordinal) AS text
     FROM "index".chunk
    WHERE workspace_id = $1 AND source_document_id = $2`;

const candidatesFor = async (
  tx: Tx,
  workspaceId: string,
  identifier: SoughtIdentifier,
): Promise<readonly string[]> => {
  const words = new Set([...identifier.normalised.split(" "), ...identifier.recorded.split(" ")]);
  const probed = await tx.query<{ probe: string | null }>(PROBE, [[...words]]);
  const probe = probed.rows[0]?.probe ?? null;
  const found =
    probe === null
      ? await tx.query<{ id: string }>(EVERY_LIVE_DOCUMENT, [workspaceId])
      : await tx.query<{ id: string }>(LIVE_DOCUMENTS_PROBED, [workspaceId, probe]);
  return found.rows.map((row) => row.id);
};

const indexedTextOf = async (tx: Tx, workspaceId: string, documentId: string): Promise<string> => {
  const read = await tx.query<{ text: string | null }>(INDEXED_TEXT, [workspaceId, documentId]);
  return read.rows[0]?.text ?? "";
};

export const documentsNaming = async (
  platform: PlatformPrincipal,
  tx: Tx,
  subject: {
    readonly workspaceId: string;
    readonly identifiers: readonly SoughtIdentifier[];
  },
): Promise<readonly string[]> => {
  const { workspaceId, identifiers } = subject;
  const candidates = new Set<string>();
  for (const identifier of identifiers) {
    for (const id of await candidatesFor(tx, workspaceId, identifier)) candidates.add(id);
  }
  const named: string[] = [];
  for (const id of candidates) {
    const text = await indexedTextOf(tx, workspaceId, id);
    if (erasureMatchesIn(text, identifiers).length > 0) named.push(id);
  }
  return named;
};
