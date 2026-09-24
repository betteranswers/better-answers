import type pg from "pg";
import { beforeAll, expect } from "vitest";

import { ulid } from "../src/index.ts";
import {
  type CataloguedItem,
  type CataloguePlace,
  seedCataloguedDocument,
} from "./catalogue-statements.ts";
import { type MigratedPostgres } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

type Writer = Pick<pg.PoolClient, "query">;

export const postgresForSuite = (): (() => MigratedPostgres) => {
  let opened: MigratedPostgres | undefined;
  beforeAll(async () => {
    opened = await openMigratedPostgres();
    return async () => {
      await opened?.stop();
    };
  });
  return () => {
    if (opened === undefined) throw new Error("the suite's database has not been opened");
    return opened;
  };
};

const constraintOf = (error: unknown): string => {
  const named =
    typeof error === "object" && error !== null && "constraint" in error
      ? error.constraint
      : undefined;

  return typeof named === "string" ? named : `nothing named a constraint: ${String(error)}`;
};

// The closed set the pinned image has, so a privilege the journal never mentions is answered
// false rather than left out of the question.
const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
] as const;

export const privilegesHeld = async (
  client: Writer,
  role: string,
  table: string,
): Promise<Record<string, boolean>> => {
  const held = await client.query<{ privilege: string; held: boolean }>(
    "SELECT privilege, has_table_privilege($1, $2, privilege) AS held FROM unnest($3::text[]) AS privilege",
    [role, table, [...TABLE_PRIVILEGES]],
  );
  return Object.fromEntries(held.rows.map((row) => [row.privilege, row.held]));
};

export const UNMARK_THE_MATCH =
  "ALTER FUNCTION pg_catalog.ts_match_vq(tsvector, tsquery) NOT LEAKPROOF";

export const matchIsLeakproof = async (client: Writer): Promise<boolean | undefined> => {
  const read = await client.query<{ proleakproof: boolean }>(
    "SELECT proleakproof FROM pg_catalog.pg_proc WHERE oid = 'pg_catalog.ts_match_vq(tsvector, tsquery)'::regprocedure",
  );
  return read.rows[0]?.proleakproof;
};

export const ADMITTED = "admitted";

// A refusal's SQLSTATE outlives its message, which any author may reword.
export const sqlstateOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : "none";

export const refusalOf = async (
  client: pg.PoolClient,
  attempt: () => Promise<unknown>,
): Promise<string> => {
  await client.query("SAVEPOINT probe");
  try {
    await attempt();
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT probe");
    return constraintOf(error);
  }
  await client.query("ROLLBACK TO SAVEPOINT probe");
  return ADMITTED;
};

export type Refusal = readonly [
  statement: string,
  why: string,
  parameters?: readonly unknown[],
  message?: RegExp,
];

export const refusesEach = async (
  client: pg.PoolClient,
  refusals: readonly Refusal[],
): Promise<void> => {
  for (const [statement, why, parameters = [], message = /permission denied/] of refusals) {
    await client.query("SAVEPOINT refusal_probe");
    const outcome = await client
      .query(statement, [...parameters])
      .then(() => "allowed")
      .catch((cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));
    expect({ why, outcome }).toEqual({
      why,
      outcome: expect.stringMatching(message),
    });
    await client.query("ROLLBACK TO SAVEPOINT refusal_probe");
  }
};

export type BindingWords = {
  readonly connector: string;
  readonly destination: readonly (string | null)[];
  readonly retentionClass: string;
  readonly state: string;
};

const BINDING_OF_WORDS = `INSERT INTO source_binding
    (workspace_id, id, name, connector, destination, retention_class, state)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

export const attemptBindingOf = (
  client: pg.PoolClient,
  workspaceId: string,
  words: BindingWords,
): Promise<string> =>
  refusalOf(client, () =>
    client.query(BINDING_OF_WORDS, [
      workspaceId,
      ulid(),
      "The handbook",
      words.connector,
      [...words.destination],
      words.retentionClass,
      words.state,
    ]),
  );

const documentCarrying = (column: string, word: string): string =>
  `INSERT INTO source_document
     (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size,
      original_key, ${column})
   VALUES ($1, $2, $3, $4, 'The handbook', 'text/markdown', 1024, 'documents/x/original', '${word}')`;

const documentReporting = (outcome: string | null, quarantineError: string | null): string =>
  `INSERT INTO source_document
     (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size,
      original_key, outcome, quarantine_error)
   VALUES ($1, $2, $3, $4, 'The handbook', 'text/markdown', 1024, 'documents/x/original',
           ${outcome === null ? "NULL" : `'${outcome}'`},
           ${quarantineError === null ? "NULL" : `'${quarantineError}'`})`;

const documentSized = (bytes: number): string =>
  `INSERT INTO source_document
     (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
   VALUES ($1, $2, $3, $4, 'The handbook', 'text/markdown', ${String(bytes)}, 'documents/x/original')`;

const anotherItemUnder = (place: CataloguePlace): readonly unknown[] => [
  place.workspaceId,
  ulid(),
  place.bindingId,
  ulid(),
];

export const attemptCataloguedDocument = (
  client: pg.PoolClient,
  item: CataloguedItem,
): Promise<string> => refusalOf(client, () => seedCataloguedDocument(client, item));

export const attemptDocumentClassed = (
  client: pg.PoolClient,
  place: CataloguePlace,
  sensitivity: string,
): Promise<string> =>
  refusalOf(client, () =>
    client.query(documentCarrying("sensitivity", sensitivity), [...anotherItemUnder(place)]),
  );

export const attemptDocumentConcluded = (
  client: pg.PoolClient,
  place: CataloguePlace,
  outcome: string,
): Promise<string> =>
  refusalOf(client, () =>
    client.query(documentCarrying("outcome", outcome), [...anotherItemUnder(place)]),
  );

export const attemptQuarantinePair = (
  client: pg.PoolClient,
  place: CataloguePlace,
  outcome: string | null,
  quarantineError: string | null,
): Promise<string> =>
  refusalOf(client, () =>
    client.query(documentReporting(outcome, quarantineError), [...anotherItemUnder(place)]),
  );

export const attemptDocumentSized = (
  client: pg.PoolClient,
  place: CataloguePlace,
  bytes: number,
): Promise<string> =>
  refusalOf(client, () => client.query(documentSized(bytes), [...anotherItemUnder(place)]));

export const attemptRowKeyedToTheLedger = (
  client: pg.PoolClient,
  workspaceId: string,
  auditEventId: string,
): Promise<string> =>
  refusalOf(client, () =>
    client.query("INSERT INTO keyed_to_the_ledger (workspace_id, audit_event_id) VALUES ($1, $2)", [
      workspaceId,
      auditEventId,
    ]),
  );

export const attemptLedgerRowReusingAnId = (
  client: pg.PoolClient,
  workspaceId: string,
  id: string,
): Promise<string> =>
  refusalOf(client, () =>
    client.query(
      `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
           VALUES ($1, $2, 'sources.binding.created', 'process:better-answers-test', $3, '{}'::jsonb)`,
      [id, workspaceId, ulid()],
    ),
  );

const CHUNK_AND_ITS_EMBEDDING = `INSERT INTO "index".chunk
    (workspace_id, id, content, embedding, embedding_route_id, binding_id)
  VALUES ($1, $2, 'a paragraph of the handbook', $3, $4, $5)`;

const CHUNK_CARRYING_ITS_OWN_FULL_TEXT = `INSERT INTO "index".chunk
     (workspace_id, id, content, binding_id, search)
   VALUES ($1, $2, 'a paragraph', 'binding-1', to_tsvector('english', 'something else'))`;

export const attemptChunkEmbeddedBy = (
  client: pg.PoolClient,
  workspaceId: string,
  bindingId: string,
  embedding: string | null,
  route: string | null,
): Promise<string> =>
  refusalOf(client, () =>
    client.query(CHUNK_AND_ITS_EMBEDDING, [
      workspaceId,
      `chunk-${ulid()}`,
      embedding,
      route,
      bindingId,
    ]),
  );

export const chunkWritingItsOwnFullText = (
  role: string,
  workspaceId: string,
  chunkId: string,
): Refusal => [
  CHUNK_CARRYING_ITS_OWN_FULL_TEXT,
  `${role} writing a full-text vector of its own on a new row`,
  [workspaceId, chunkId],
  /non-DEFAULT value/,
];

export const groupNameTakenAgain = (
  client: Writer,
  workspaceId: string,
  name: string,
): Promise<unknown> =>
  client.query(
    `INSERT INTO "group" (id, workspace_id, name, origin) VALUES ($1, $2, $3, 'admin-curated')`,
    [ulid(), workspaceId, name],
  );

export const configProbeWritten = (
  client: Writer,
  workspaceId: string,
  key: string,
): Promise<unknown> =>
  client.query("INSERT INTO workspace_config (workspace_id, key, value) VALUES ($1, $2, '1')", [
    workspaceId,
    key,
  ]);

export const bindingIdTakenAgain = (
  client: Writer,
  workspaceId: string,
  binding: { readonly bindingId: string; readonly name: string; readonly sensitivity: string },
): Promise<unknown> =>
  client.query(
    `INSERT INTO source_binding (workspace_id, id, name, connector, sensitivity, audience)
     VALUES ($1, $2, $3, 'upload', $4, 'everyone')`,
    [workspaceId, binding.bindingId, binding.name, binding.sensitivity],
  );

export const conceptIriTakenAgain = (
  client: Writer,
  workspaceId: string,
  iri: string,
): Promise<unknown> =>
  client.query("INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, 'x')", [
    workspaceId,
    iri,
  ]);

export const enqueueAttempted = async (
  client: Writer,
  job: {
    readonly workspaceId: string;
    readonly id: string;
    readonly kind: string;
    readonly reason: string | null;
    readonly subjectId: string | null;
  },
): Promise<string> => {
  await client.query("SAVEPOINT refused_enqueue");
  try {
    await client.query(
      `INSERT INTO job (workspace_id, id, kind, reason, subject_id, status)
         VALUES ($1, $2, $3, $4, $5, 'queued')`,
      [job.workspaceId, job.id, job.kind, job.reason, job.subjectId],
    );
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT refused_enqueue");
    return sqlstateOf(error);
  }
  await client.query("ROLLBACK TO SAVEPOINT refused_enqueue");
  return ADMITTED;
};
