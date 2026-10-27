import type pg from "pg";

import { head } from "@better-answers/core/store/git";
import { passageLocatorOf } from "@better-answers/schema";
import { testData, type MigratedPostgres, type TestData } from "@better-answers/schema/testing";

import {
  overrideConceptSensitivity,
  writeConcept,
  type ConceptWritten,
  type FrontmatterSource,
  type WriteConceptInput,
} from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { addToGroup, createGroup } from "../../src/members/index.ts";
import {
  passageIdOf,
  publishConnectedSource,
  publishConnectedSourceInput,
} from "../../src/sources/index.ts";
import type { Foldable, Folded, Tx } from "../../src/store/postgres/index.ts";
import { inputOf } from "../support/suite-input.ts";
import { answered, readingAs } from "../support/suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

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

export const writeUpIncluding = (
  db: MigratedPostgres,
  workspaceId: string,
  iris: readonly string[],
  held: { readonly sensitivity?: string; readonly audienceGroups?: readonly string[] } = {},
): Promise<string> =>
  seededBy(db, async (seed) => {
    const writeUp = await seed.writeUp({
      workspaceId,
      ...(held.sensitivity === undefined ? {} : { sensitivity: held.sensitivity }),
      ...(held.audienceGroups === undefined
        ? {}
        : { audience: "groups", audienceGroups: [...held.audienceGroups] }),
    });
    for (const [ordinal, iri] of iris.entries()) {
      await seed.writeUpInclude({ workspaceId, writeUpId: writeUp.id, iri, ordinal });
    }
    return writeUp.id;
  });

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

const sourcesCiting = (
  documents: readonly string[],
): { readonly sources?: readonly FrontmatterSource[] } =>
  documents.length === 0
    ? {}
    : {
        sources: documents.map((sourceDocumentId, at) => ({
          resource: `Document ${at + 1}`,
          locator: passageLocatorOf(sourceDocumentId, at, at + 1),
        })),
      };

export const conceptCiting = async (
  scenario: Scenario,
  writer: UserPrincipal,
  documents: readonly string[],
  overrides: Partial<WriteConceptInput> = {},
): Promise<SourcedConcept> => {
  sequence += 1;
  const path = overrides.path ?? `knowledge/policy/sourced-${sequence}.md`;
  const title = overrides.title ?? `Sourced note ${sequence}`;
  const mergeKey = overrides.mergeKey ?? `note:sourced-${sequence}`;
  const written = await writeConcept(writer, doorsOf(scenario), {
    mergeKey,
    path,
    kind: "Note",
    title,
    body: `Note ${sequence} rests on what it cites.`,
    message: `Record sourced note ${sequence}`,
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: await head(writer, scenario.git) },
    status: "stable",
    ...overrides,
    frontmatter: { title, type: "Note", ...sourcesCiting(documents), ...overrides.frontmatter },
  });
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return { ...written.value, path, mergeKey, title };
};

export const rewriteCiting = async (
  scenario: Scenario,
  writer: UserPrincipal,
  written: SourcedConcept,
  documents: readonly string[],
  overrides: Partial<WriteConceptInput> = {},
) =>
  writeConcept(writer, doorsOf(scenario), {
    iri: written.iri,
    mergeKey: written.mergeKey,
    path: written.path,
    kind: "Note",
    title: written.title,
    body: "The note says something else now.",
    message: "Re-write the note",
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: await head(writer, scenario.git) },
    ...overrides,
    frontmatter: {
      title: written.title,
      type: "Note",
      ...sourcesCiting(documents),
      ...overrides.frontmatter,
    },
  });

export const overriddenBy = (
  db: MigratedPostgres,
  scenario: Scenario,
  iri: string,
  sensitivity: string,
) =>
  readingAs(db.runtimePool, scenario.admin, (admin, tx) =>
    overrideConceptSensitivity(admin, tx, { iri, sensitivity, audience: "everyone" }),
  );

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
  action: string,
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
    [workspaceId, action],
  );
  return read.rows;
};
