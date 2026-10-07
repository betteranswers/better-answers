import { z } from "zod";

import {
  CONNECTED_SOURCE_INDEXED_STATE,
  CONNECTED_SOURCE_INDEXING_STATE,
  CONNECTED_SOURCE_RECEIVED_STATE,
  CONNECTED_SOURCE_PUBLISHED_STATE,
  boundarySchemas,
  DOCUMENT_QUARANTINED_OUTCOME,
  JOB_CLAIMED_STATUS,
  JOB_DONE_STATUS,
  type CONNECTED_SOURCE_STATES,
} from "@better-answers/schema";

import {
  attempt,
  err,
  ok,
  requireAdmin,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { latestRunsOf, type SubjectRun } from "../runs/index.ts";
import type { Tx } from "../store/postgres/index.ts";

type ConnectedSourceState = (typeof CONNECTED_SOURCE_STATES)[number];

type QuarantinedDocument = {
  readonly documentId: string;
  readonly title: string;

  readonly error: string;
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
  readonly lastRun: SubjectRun | null;
  readonly quarantined: readonly QuarantinedDocument[];

  readonly quarantinedByError: Readonly<Record<string, number>>;
};

export type ListConnectedSourcesRefusal = RoleRefusal | Error;

type QuarantineRow = {
  readonly connected_source_id: string;
  readonly id: string;
  readonly title: string;
  readonly quarantine_error: string;
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
 * The error is the converter's own name for why, so an Admin is told without a log being read.
 */
const QUARANTINED = `SELECT connected_source_id, id, title, quarantine_error FROM source_document
      WHERE workspace_id = $1 AND outcome = $2 AND quarantine_error IS NOT NULL
      ORDER BY connected_source_id, title, id`;

const UNREADABLE_CONNECTED_SOURCE = new Error(
  "a connected source's row is not the shape its table admits",
);

/**
 * The worker cannot write the connected source's state column, so everything short of a publish is read
 * off the connected source's latest run.
 */
const stateOf = (publishedAt: Date | null, lastRun: SubjectRun | null): ConnectedSourceState => {
  if (publishedAt !== null) return CONNECTED_SOURCE_PUBLISHED_STATE;
  if (lastRun?.status === JOB_DONE_STATUS) return CONNECTED_SOURCE_INDEXED_STATE;
  if (lastRun?.status === JOB_CLAIMED_STATUS) return CONNECTED_SOURCE_INDEXING_STATE;
  return CONNECTED_SOURCE_RECEIVED_STATE;
};

const countedByError = (quarantined: readonly QuarantinedDocument[]) => {
  const counts = new Map<string, number>();
  for (const { error } of quarantined) counts.set(error, (counts.get(error) ?? 0) + 1);
  return Object.fromEntries(counts);
};

export const listConnectedSources = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly ListedConnectedSource[], ListConnectedSourcesRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  const read = await attempt(async () => ({
    connectedSources: (await tx.query(CONNECTED_SOURCES, [workspaceId])).rows,
    quarantined: (
      await tx.query<QuarantineRow>(QUARANTINED, [workspaceId, DOCUMENT_QUARANTINED_OUTCOME])
    ).rows,
  }));
  if (!read.ok) return err(read.error);
  const parsed = z.array(LISTED_ROW).safeParse(read.value.connectedSources);
  if (!parsed.success) return err(UNREADABLE_CONNECTED_SOURCE);
  const rows = parsed.data;

  const lastRuns = await latestRunsOf(admin.value, tx, { subjectIds: rows.map((row) => row.id) });
  if (!lastRuns.ok) return err(lastRuns.error);

  return ok(
    rows.map(({ id, publishedAt, ...row }) => {
      const lastRun = lastRuns.value.get(id) ?? null;
      const quarantined = read.value.quarantined
        .filter((document) => document.connected_source_id === id)
        .map((document) => ({
          documentId: document.id,
          title: document.title,
          error: document.quarantine_error,
        }));
      return {
        connectedSourceId: id,
        ...row,
        state: stateOf(publishedAt, lastRun),
        publishedAt: publishedAt?.toISOString() ?? null,
        lastRun,
        quarantined,
        quarantinedByError: countedByError(quarantined),
      };
    }),
  );
};
