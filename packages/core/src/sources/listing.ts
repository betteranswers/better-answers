import { z } from "zod";

import {
  CONNECTED_SOURCE_INDEXED_STATE,
  CONNECTED_SOURCE_INDEXING_STATE,
  CONNECTED_SOURCE_RECEIVED_STATE,
  CONNECTED_SOURCE_PUBLISHED_STATE,
  boundarySchemas,
  DOCUMENT_UNREADABLE_OUTCOME,
  JOB_CLAIMED_STATUS,
  JOB_DONE_STATUS,
  type CONNECTED_SOURCE_STATES,
} from "@better-answers/schema";

import {
  admit,
  ADMIN_ALONE,
  attempt,
  declareAction,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { latestRunsOf, type SubjectRun } from "../runs/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { SourceRefusal } from "./vocabulary.ts";

type ConnectedSourceState = (typeof CONNECTED_SOURCE_STATES)[number];

type UnreadableDocument = {
  readonly documentId: string;
  readonly title: string;

  readonly reason: string;
};

const LISTED_ROW = boundarySchemas.connectedSource.select
  .pick({
    id: true,
    name: true,
    connector: true,
    sensitivity: true,
    audience: true,
    audienceGroups: true,
    destination: true,
    retentionClass: true,
    publishedAt: true,
  })
  .extend({ documentCount: z.int().nonnegative(), passageCount: z.int().nonnegative() });

type ListedRow = z.output<typeof LISTED_ROW>;

export type ListedConnectedSource = Omit<ListedRow, "id" | "publishedAt"> & {
  readonly connectedSourceId: ListedRow["id"];
  readonly state: ConnectedSourceState;
  readonly publishedAt: string | null;
  readonly lastSync: SubjectRun | null;
  readonly unreadable: readonly UnreadableDocument[];

  readonly unreadableByReason: Readonly<Record<string, number>>;
};

const listConnectedSourcesAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

export type ListConnectedSourcesRefusal =
  | SourceRefusal<RefusalOf<typeof listConnectedSourcesAction>>
  | Error;

type UnreadableRow = {
  readonly connected_source_id: string;
  readonly id: string;
  readonly title: string;
  readonly unreadable_reason: string;
};

const CONNECTED_SOURCES = `SELECT b.id, b.name, b.connector, b.sensitivity, b.audience,
            b.audience_groups AS "audienceGroups", b.destination,
            b.retention_class AS "retentionClass", b.published_at AS "publishedAt",
            (SELECT count(*)::int FROM source_document d
              WHERE d.workspace_id = b.workspace_id AND d.connected_source_id = b.id) AS "documentCount",
            (SELECT count(*)::int FROM "index".passage c
              WHERE c.workspace_id = b.workspace_id AND c.connected_source_id = b.id) AS "passageCount"
       FROM connected_source b
      WHERE b.workspace_id = $1
      ORDER BY b.name, b.id`;

/**
 * The reason is the converter's own name for why, so an Admin is told without a log being read.
 */
const UNREADABLE = `SELECT connected_source_id, id, title, unreadable_reason FROM source_document
      WHERE workspace_id = $1 AND outcome = $2 AND unreadable_reason IS NOT NULL
      ORDER BY connected_source_id, title, id`;

const UNREADABLE_CONNECTED_SOURCE = new Error(
  "a connected source's row is not the shape its table admits",
);

/**
 * The worker cannot write the connected source's state column, so everything short of a publish is read
 * off the connected source's latest sync.
 */
const stateOf = (publishedAt: Date | null, lastSync: SubjectRun | null): ConnectedSourceState => {
  if (publishedAt !== null) return CONNECTED_SOURCE_PUBLISHED_STATE;
  if (lastSync?.status === JOB_DONE_STATUS) return CONNECTED_SOURCE_INDEXED_STATE;
  if (lastSync?.status === JOB_CLAIMED_STATUS) return CONNECTED_SOURCE_INDEXING_STATE;
  return CONNECTED_SOURCE_RECEIVED_STATE;
};

const countedByReason = (unreadable: readonly UnreadableDocument[]) => {
  const counts = new Map<string, number>();
  for (const { reason } of unreadable) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return Object.fromEntries(counts);
};

export const listConnectedSources = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly ListedConnectedSource[], ListConnectedSourcesRefusal>> => {
  const admin = admit(listConnectedSourcesAction, principal, {});
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  const read = await attempt(async () => ({
    connectedSources: (await tx.query(CONNECTED_SOURCES, [workspaceId])).rows,
    unreadable: (
      await tx.query<UnreadableRow>(UNREADABLE, [workspaceId, DOCUMENT_UNREADABLE_OUTCOME])
    ).rows,
  }));
  if (!read.ok) return err(read.error);
  const parsed = z.array(LISTED_ROW).safeParse(read.value.connectedSources);
  if (!parsed.success) return err(UNREADABLE_CONNECTED_SOURCE);
  const rows = parsed.data;

  const lastSyncs = await latestRunsOf(admin.value, tx, { subjectIds: rows.map((row) => row.id) });
  if (!lastSyncs.ok) return err(lastSyncs.error);

  return ok(
    rows.map(({ id, publishedAt, ...row }) => {
      const lastSync = lastSyncs.value.get(id) ?? null;
      const unreadable = read.value.unreadable
        .filter((document) => document.connected_source_id === id)
        .map((document) => ({
          documentId: document.id,
          title: document.title,
          reason: document.unreadable_reason,
        }));
      return {
        connectedSourceId: id,
        ...row,
        state: stateOf(publishedAt, lastSync),
        publishedAt: publishedAt?.toISOString() ?? null,
        lastSync,
        unreadable,
        unreadableByReason: countedByReason(unreadable),
      };
    }),
  );
};
