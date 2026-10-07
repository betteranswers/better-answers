import type pg from "pg";

import { JOB_DONE_STATUS, JOB_QUEUED_STATUS, ulid } from "../src/index.ts";
import { type TestData, testData } from "./factory.ts";

export type CataloguePlace = {
  readonly workspaceId: string;
  readonly connectedSourceId: string;
};

export type CataloguedItem = CataloguePlace & {
  readonly id: string;
  readonly sourceSystemId: string;
};

const CONNECTED_SOURCE_OF_A_CONNECTOR_ALONE =
  "INSERT INTO connected_source (workspace_id, id, name, connector) VALUES ($1, $2, 'The handbook', 'upload')";

const CATALOGUED_DOCUMENT = `INSERT INTO source_document
    (workspace_id, id, connected_source_id, source_system_id, title, media_type, byte_size, original_key)
  VALUES ($1, $2, $3, $4, 'The handbook', 'text/markdown', 1024, 'documents/x/original')`;

export const seedConnectedSourceOfAConnectorAlone = async (
  client: pg.PoolClient,
  workspaceId: string,
  id: string,
): Promise<string> => {
  await client.query(CONNECTED_SOURCE_OF_A_CONNECTOR_ALONE, [workspaceId, id]);
  return id;
};

const CONNECTED_SOURCE_IN = `INSERT INTO connected_source (workspace_id, id, name, connector, state)
  VALUES ($1, $2, 'The handbook', 'upload', $3)`;

/** Raw, so a state word a CHECK of the day admits can be seeded beneath a later one. */
export const seedConnectedSourceIn = async (
  client: pg.PoolClient,
  workspaceId: string,
  id: string,
  state: string,
): Promise<string> => {
  await client.query(CONNECTED_SOURCE_IN, [workspaceId, id, state]);
  return id;
};

const CONNECTED_SOURCE_TO = `INSERT INTO connected_source (workspace_id, id, name, connector, destination)
  VALUES ($1, $2, 'The handbook', 'upload', $3::text[])`;

/** Raw, so a destination word a CHECK of the day admits can be seeded beneath a later one. */
export const seedConnectedSourceTo = async (
  client: pg.PoolClient,
  workspaceId: string,
  id: string,
  destination: readonly string[],
): Promise<string> => {
  await client.query(CONNECTED_SOURCE_TO, [workspaceId, id, destination]);
  return id;
};

export const seedCataloguedDocument = async (
  client: pg.PoolClient,
  item: CataloguedItem,
): Promise<string> => {
  await client.query(CATALOGUED_DOCUMENT, [
    item.workspaceId,
    item.id,
    item.connectedSourceId,
    item.sourceSystemId,
  ]);
  return item.id;
};

export const citeDocument = (
  client: pg.PoolClient,
  workspaceId: string,
  sourceDocumentId: string,
): ReturnType<TestData["evidence"]> =>
  testData(client).evidence({
    workspaceId,
    sourceDocumentId,
    locator: "chars:0-42",
    resource: "The handbook",
  });

const PASSAGE_THROUGH_THE_PARENT = `INSERT INTO "index".passage
     (workspace_id, id, content, connected_source_id,
      source_document_id, locator, ordinal, char_start, char_end)
   VALUES ($1, $2, 'a paragraph of the handbook', 'connected-source-1',
           $3, 'chars:0-40', 0, 0, 40)`;

export const passageWrittenThroughTheParent = async (
  client: pg.PoolClient,
  workspaceId: string,
  sourceDocumentId: string,
): Promise<string> => {
  const id = `passage-${ulid()}`;
  await client.query(PASSAGE_THROUGH_THE_PARENT, [workspaceId, id, sourceDocumentId]);
  return id;
};

export type JobProbeRow = {
  readonly kind: string;
  readonly reason?: string | null;
  readonly subjectId?: string | null;

  readonly enqueuedAgoSeconds?: number;
};

const QUEUED_JOB = `INSERT INTO job (workspace_id, id, kind, reason, subject_id, status, enqueued_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() - ($7 || ' seconds')::interval)`;

const CLAIMED_JOB = `INSERT INTO job (workspace_id, id, kind, reason, subject_id, status, attempts,
                      enqueued_at, claimed_by, claimed_at, lease_expires_at, heartbeat_at)
       VALUES ($1, $2, $3, $4, $5, 'claimed', 1,
               now() - ($6 || ' seconds')::interval, 'worker-holding', now(),
               now() + ($7 || ' seconds')::interval, now())`;

export const seedQueuedJob = async (
  client: pg.PoolClient,
  workspaceId: string,
  row: JobProbeRow,
): Promise<string> => {
  const id = ulid();
  await client.query(QUEUED_JOB, [
    workspaceId,
    id,
    row.kind,
    row.reason ?? null,
    row.subjectId ?? null,
    JOB_QUEUED_STATUS,
    String(row.enqueuedAgoSeconds ?? 0),
  ]);
  return id;
};

const FINISHED_JOB = `INSERT INTO job (workspace_id, id, kind, reason, subject_id, status, attempts,
                      enqueued_at, claimed_by, claimed_at, finished_at, outcome)
       VALUES ($1, $2, $3, $4, $5, '${JOB_DONE_STATUS}', 1,
               now() - ($6 || ' seconds')::interval, 'worker-that-ran', now(), now(),
               '{"passages": 0}'::jsonb)`;

export const seedFinishedJob = async (
  client: pg.PoolClient,
  workspaceId: string,
  row: JobProbeRow,
): Promise<string> => {
  const id = ulid();
  await client.query(FINISHED_JOB, [
    workspaceId,
    id,
    row.kind,
    row.reason ?? null,
    row.subjectId ?? null,
    String(row.enqueuedAgoSeconds ?? 0),
  ]);
  return id;
};

export const seedClaimedJob = async (
  client: pg.PoolClient,
  workspaceId: string,
  row: JobProbeRow,
  leaseInSeconds: number,
): Promise<string> => {
  const id = ulid();
  await client.query(CLAIMED_JOB, [
    workspaceId,
    id,
    row.kind,
    row.reason ?? null,
    row.subjectId ?? null,
    String(row.enqueuedAgoSeconds ?? 0),
    String(leaseInSeconds),
  ]);
  return id;
};
