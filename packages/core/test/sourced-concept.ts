import { AUDIENCE_EVERYONE } from "@better-answers/schema";
import { testData, type MigratedPostgres, type TestData } from "@better-answers/schema/testing";
import type pg from "pg";

import { head } from "@better-answers/core/store/git";

import {
  writeConcept,
  type ConceptWritten,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { addToGroup, createGroup } from "../src/members/index.ts";
import { chunkIdOf } from "../src/sources/index.ts";
import type { Opened, Tx } from "../src/store/postgres/index.ts";
import { answered, readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

export const visibilitySuite = () => {
  const { db, arrange } = suiteWithBundles();
  return {
    db,
    arrange,
    reading: <T>(
      principal: UserPrincipal,
      work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
    ): Promise<Opened<T>> => readingAs(db().runtimePool, principal, work),
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

export type BindingShape = {
  readonly sensitivity?: string;
  readonly audience?: string;
  readonly audienceGroups?: readonly string[] | null;
  readonly publishedAt?: Date | null;
};

export type Sourced = {
  readonly bindingId: string;
  readonly documentId: string;
};

export const bindingHolding = (
  db: MigratedPostgres,
  workspaceId: string,
  shape: BindingShape = {},
): Promise<Sourced> =>
  seededBy(db, async (seed) => {
    const binding = await seed.sourceBinding({
      workspaceId,
      ...shape,
      audienceGroups: shape.audienceGroups == null ? null : [...shape.audienceGroups],
    });
    const document = await seed.sourceDocument({ workspaceId, bindingId: binding.id });
    return { bindingId: binding.id, documentId: document.id };
  });

export const bindingForGroups = (
  db: MigratedPostgres,
  workspaceId: string,
  groups: readonly string[],
  sensitivity = "Internal",
): Promise<Sourced> =>
  bindingHolding(db, workspaceId, { sensitivity, audience: "groups", audienceGroups: groups });

export const documentUnder = (
  db: MigratedPostgres,
  workspaceId: string,
  bindingId: string,
  sensitivity: string | null,
): Promise<Sourced> =>
  seededBy(db, async (seed) => {
    const document = await seed.sourceDocument({
      workspaceId,
      bindingId,
      sensitivity,
    });
    return { bindingId, documentId: document.id };
  });

export type ChunkShape = {
  readonly content: string;

  readonly ordinal: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly publishedAt?: Date | null;
  readonly sensitivity?: string;
  readonly audience?: string;
  readonly audienceGroups?: readonly string[] | null;
};

export const chunkUnder = (
  db: MigratedPostgres,
  workspaceId: string,
  document: Sourced,
  shape: ChunkShape,
): Promise<string> =>
  seededBy(db, async (seed) => {
    const row = await seed.chunk({
      workspaceId,
      id: chunkIdOf(document.documentId, shape.ordinal),
      bindingId: document.bindingId,
      sourceDocumentId: document.documentId,
      content: shape.content,

      locator: `chars:${shape.charStart}-${shape.charEnd}`,
      ordinal: shape.ordinal,
      charStart: shape.charStart,
      charEnd: shape.charEnd,
      publishedAt: shape.publishedAt ?? null,
      sensitivity: shape.sensitivity ?? "Restricted",
      audience: shape.audience ?? AUDIENCE_EVERYONE,
      audienceGroups: shape.audienceGroups == null ? null : [...shape.audienceGroups],
    });
    return row.id;
  });

export const restrictedAndInternal = async (
  db: MigratedPostgres,
  workspaceId: string,
): Promise<{
  readonly restricted: Sourced;
  readonly internal: Sourced;
  readonly narrowedUnderInternal: Sourced;
}> => {
  const restricted = await bindingHolding(db, workspaceId, {
    sensitivity: "Restricted",
  });
  const internal = await bindingHolding(db, workspaceId);
  return {
    restricted,
    internal,
    narrowedUnderInternal: await documentUnder(db, workspaceId, internal.bindingId, "Restricted"),
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
  const binding = await bindingForGroups(db, scenario.workspaceId, [groupId]);
  const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
  return { groupId, written };
};

export type HeldVisibility = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

const KEY_COLUMN = {
  concept_index: "iri",
  graph_node: "uid",
  composition: "id",
  source_binding: "id",
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
    "SELECT sensitivity, audience, audience_groups FROM graph_edge WHERE workspace_id = $1 AND from_uid = $2 ORDER BY uid",
    [workspaceId, fromUid],
  );
  return read.rows;
};

export const ledgerRowsOf = async (
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
    "SELECT id, actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY id",
    [workspaceId, act],
  );
  return read.rows;
};
