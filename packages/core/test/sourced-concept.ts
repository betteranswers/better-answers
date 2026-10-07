import type pg from "pg";

import { head } from "@better-answers/core/store/git";
import { testData, type MigratedPostgres, type TestData } from "@better-answers/schema/testing";

import {
  writeConcept,
  type ConceptWritten,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { addToGroup, createGroup } from "../src/members/index.ts";
import {
  passageIdOf,
  publishConnectedSource,
  publishConnectedSourceInput,
} from "../src/sources/index.ts";
import type { Foldable, Folded, Tx } from "../src/store/postgres/index.ts";
import { inputOf } from "./suite-input.ts";
import { answered, readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/** A suite over bundles whose `reading` works as a principal under row-level security. */
export const visibilitySuite = () => {
  const { db, arrange } = suiteWithBundles();
  return {
    db,
    arrange,
    reading: <T>(
      principal: UserPrincipal,
      work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
    ): Promise<Folded<T>> => readingAs(db().runtimePool, principal, work),
  };
};

/** Seeds rows straight into the tables on the privileged pool; no act runs. */
export const seededBy = async <T>(
  db: MigratedPostgres,
  work: (seed: TestData) => Promise<T>,
): Promise<T> => {
  const client = await db.pool.connect();
  try {
    return await work(testData(client));
  } finally {
    client.release();
  }
};

export type ConnectedSourceShape = {
  readonly sensitivity?: string;
  readonly audience?: string;
  readonly audienceGroups?: readonly string[] | null;
  readonly publishedAt?: Date | null;
};

export type Sourced = {
  readonly connectedSourceId: string;
  readonly documentId: string;
};

/** A connected source of one document; unset `shape` fields default to published, Internal, everyone. */
export const connectedSourceHolding = (
  db: MigratedPostgres,
  workspaceId: string,
  shape: ConnectedSourceShape = {},
): Promise<Sourced> =>
  seededBy(db, async (seed) => {
    const connectedSource = await seed.connectedSource({
      workspaceId,
      ...shape,
      audienceGroups: shape.audienceGroups == null ? null : [...shape.audienceGroups],
    });
    const document = await seed.sourceDocument({
      workspaceId,
      connectedSourceId: connectedSource.id,
    });
    return { connectedSourceId: connectedSource.id, documentId: document.id };
  });

const INDEXED_AT = new Date("2026-09-24T09:00:00.000Z");
const PUBLISHED_AT = new Date("2026-09-24T10:00:00.000Z");

/** Seeds a finished sync, then publishes as `admin`; the act's answer comes back unverified. */
export const publishedOnceIndexed = async (
  db: MigratedPostgres,
  admin: UserPrincipal,
  connectedSourceId: string,
) => {
  await seededBy(db, (seed) =>
    seed.job({
      workspaceId: admin.workspaceId,
      kind: "index",
      subjectId: connectedSourceId,
      reason: "connected",
      status: "done",
      enqueuedAt: INDEXED_AT,
      attempts: 1,
      claimedBy: "worker-1",
      claimedAt: INDEXED_AT,
      heartbeatAt: INDEXED_AT,
      finishedAt: INDEXED_AT,
      outcome: { passages: 1 },
    }),
  );
  return readingAs(db.runtimePool, admin, (principal, tx) =>
    publishConnectedSource(principal, tx, {
      ...inputOf(publishConnectedSourceInput, {
        connectedSourceId,
        confirmations: {
          lawfulBasisRecorded: true,
          privacyInformationUpdated: true,
          dpiaReferenced: true,
        },
      }),
      publishedAt: PUBLISHED_AT,
    }),
  );
};

export const connectedSourceForGroups = (
  db: MigratedPostgres,
  workspaceId: string,
  groups: readonly string[],
  sensitivity = "Internal",
): Promise<Sourced> =>
  connectedSourceHolding(db, workspaceId, {
    sensitivity,
    audience: "groups",
    audienceGroups: groups,
  });

/** `sensitivity` is the document's own class; `null` leaves it at its connected source's. */
export const documentUnder = (
  db: MigratedPostgres,
  workspaceId: string,
  connectedSourceId: string,
  sensitivity: string | null,
): Promise<Sourced> =>
  seededBy(db, async (seed) => {
    const document = await seed.sourceDocument({
      workspaceId,
      connectedSourceId,
      sensitivity,
    });
    return { connectedSourceId, documentId: document.id };
  });

export type PassageShape = {
  readonly content: string;

  readonly ordinal: number;
  readonly charStart: number;
  readonly charEnd: number;
};

/** The row's locator holds the span alone, without the document id. */
export const passageUnder = (
  db: MigratedPostgres,
  workspaceId: string,
  document: Sourced,
  shape: PassageShape,
): Promise<string> =>
  seededBy(db, async (seed) => {
    const row = await seed.passage({
      workspaceId,
      id: passageIdOf(document.documentId, shape.ordinal),
      connectedSourceId: document.connectedSourceId,
      sourceDocumentId: document.documentId,
      content: shape.content,

      locator: `chars:${shape.charStart}-${shape.charEnd}`,
      ordinal: shape.ordinal,
      charStart: shape.charStart,
      charEnd: shape.charEnd,
    });
    return row.id;
  });

/** Each passage row's `xmin`, in id order: it moves whenever the row is rewritten. */
export const passageVersionsOf = async (
  db: MigratedPostgres,
  workspaceId: string,
  connectedSourceId: string,
): Promise<readonly string[]> => {
  const read = await db.pool.query<{ version: string }>(
    `SELECT xmin::text AS version FROM "index".passage
      WHERE workspace_id = $1 AND connected_source_id = $2 ORDER BY id`,
    [workspaceId, connectedSourceId],
  );
  return read.rows.map((row) => row.version);
};

/** Documents under a Restricted and an Internal connected source, and a Restricted one under Internal. */
export const restrictedAndInternal = async (
  db: MigratedPostgres,
  workspaceId: string,
): Promise<{
  readonly restricted: Sourced;
  readonly internal: Sourced;
  readonly narrowedUnderInternal: Sourced;
}> => {
  const restricted = await connectedSourceHolding(db, workspaceId, {
    sensitivity: "Restricted",
  });
  const internal = await connectedSourceHolding(db, workspaceId);
  return {
    restricted,
    internal,
    narrowedUnderInternal: await documentUnder(
      db,
      workspaceId,
      internal.connectedSourceId,
      "Restricted",
    ),
  };
};

export const conceptOnBoth = async (
  db: MigratedPostgres,
  scenario: Scenario,
): Promise<{
  readonly restricted: Sourced;
  readonly internal: Sourced;
  readonly written: SourcedConcept;
}> => {
  const { restricted, internal } = await restrictedAndInternal(db, scenario.workspaceId);
  const written = await conceptCiting(scenario, scenario.editor, [
    internal.documentId,
    restricted.documentId,
  ]);
  return { restricted, internal, written };
};

export type SourcedConcept = ConceptWritten & {
  readonly path: string;
  readonly mergeKey: string;
  readonly title: string;
};

let sequence = 0;

/** Writes a stable Note citing each document once, through the act; throws on a refusal. */
export const conceptCiting = async (
  scenario: Scenario,
  writer: UserPrincipal,
  documents: readonly string[],
  overrides: Partial<WriteConceptInput> = {},
): Promise<SourcedConcept> => {
  sequence += 1;
  const path = overrides.path ?? `knowledge/sourced-${sequence}.md`;
  const title = overrides.title ?? `Sourced note ${sequence}`;
  const mergeKey = overrides.mergeKey ?? `note:sourced-${sequence}`;
  const written = await writeConcept(writer, doorsOf(scenario), {
    mergeKey,
    path,
    kind: "Note",
    title,
    frontmatter: { title, type: "Note" },
    body: `Note ${sequence} rests on what it cites.`,
    message: `Record sourced note ${sequence}`,
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: await head(writer, scenario.git) },
    status: "stable",
    evidence: documents.map((sourceDocumentId, at) => ({
      sourceDocumentId,
      locator: `p.${at + 1}`,
      resource: `Document ${at + 1}`,
    })),
    ...overrides,
  });
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return { ...written.value, path, mergeKey, title };
};

/** Makes a group of `people` and returns its id; throws when the create or an add is refused. */
export const groupNamed = async (
  db: MigratedPostgres,
  scenario: Scenario,
  name: string,
  people: readonly UserPrincipal[],
): Promise<string> =>
  answered(
    await readingAs(db.runtimePool, scenario.admin, async (admin, tx) => {
      const made = await createGroup(admin, tx, { name });
      if (!made.ok) throw new Error(`the group was not made: ${String(made.error)}`);
      for (const person of people) {
        const added = await addToGroup(admin, tx, {
          groupId: made.value.groupId,
          userId: person.userId,
        });
        if (!added.ok) throw new Error(`the person was not added: ${String(added.error)}`);
      }
      return made.value.groupId;
    }),
  );

/** Makes a group of `people`, and a concept citing the one document of a connected source for it alone. */
export const conceptForGroup = async (
  db: MigratedPostgres,
  scenario: Scenario,
  name: string,
  people: readonly UserPrincipal[],
): Promise<{ readonly groupId: string; readonly written: SourcedConcept }> => {
  const groupId = await groupNamed(db, scenario, name, people);
  const connectedSource = await connectedSourceForGroups(db, scenario.workspaceId, [groupId]);
  const written = await conceptCiting(scenario, scenario.editor, [connectedSource.documentId]);
  return { groupId, written };
};

export type HeldVisibility = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

const KEY_COLUMN = {
  concept_index: "iri",
  map_node: "uid",
  write_up: "id",
  connected_source: "id",
} as const;

export const visibilityHeld = async (
  pool: pg.Pool,
  table: keyof typeof KEY_COLUMN,
  workspaceId: string,
  key: string,
): Promise<HeldVisibility | undefined> => {
  const read = await pool.query<HeldVisibility>(
    `SELECT sensitivity, audience, audience_groups FROM ${table}
      WHERE workspace_id = $1 AND ${KEY_COLUMN[table]} = $2`,
    [workspaceId, key],
  );
  return read.rows[0];
};

export const edgeVisibilityHeld = async (
  pool: pg.Pool,
  workspaceId: string,
  fromUid: string,
): Promise<readonly HeldVisibility[]> => {
  const read = await pool.query<HeldVisibility>(
    "SELECT sensitivity, audience, audience_groups FROM map_edge WHERE workspace_id = $1 AND from_uid = $2 ORDER BY uid",
    [workspaceId, fromUid],
  );
  return read.rows;
};

export const auditEventRowsOf = async (
  pool: pg.Pool,
  workspaceId: string,
  act: string,
): Promise<
  readonly {
    readonly id: string;
    readonly actor: string;
    readonly subject_id: string;
    readonly detail: Record<string, unknown>;
  }[]
> => {
  const read = await pool.query<{
    id: string;
    actor: string;
    subject_id: string;
    detail: Record<string, unknown>;
  }>(
    "SELECT id, actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND action = $2 ORDER BY id",
    [workspaceId, act],
  );
  return read.rows;
};
