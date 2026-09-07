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
import type { Tx } from "../src/store/postgres/index.ts";
import { bundlesForSuite } from "./bundle.ts";
import { postgresForSuite, readingAs } from "./suite-postgres.ts";
import { arrangeWorkspace, type Scenario } from "./workspace-with-bundle.ts";

/**
 * The arrange block of every suite about *who may see a concept* (T-055), written once: a
 * binding at a visibility with a document under it, a concept written **through the
 * governed write** citing such documents — never a hand-inserted row, because the
 * derivation runs inside the act and a row written past it would prove nothing about it —
 * a group with people in it, made through the members slice's own acts, and the three
 * visibility columns of any readable unit read back as the superuser so the policy cannot
 * hide what a row holds.
 */

/**
 * A suite's footing, registered once per file: one migrated Postgres, one bundle root, a
 * provisioned workspace per test, and a read as somebody the way a transport makes it.
 */
export const visibilitySuite = () => {
  const db = postgresForSuite();
  const bundles = bundlesForSuite();
  return {
    db,
    arrange: (): Promise<Scenario> => arrangeWorkspace(db(), bundles()),
    reading: <T>(
      principal: UserPrincipal,
      work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
    ): Promise<T> => readingAs(db().runtimePool, principal, work),
  };
};

/** Run `work` over the factory as the superuser — the only way a binding or a composition is seeded today (B7, B8). */
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

/** What a binding is seeded at: the three permission fields (ADR 0013), each optional. */
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

/** A binding at the shape given — Internal, everyone and published unless said — with one document it yielded. */
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

/** A binding for these named groups alone, at a class — Internal unless said. */
export const bindingForGroups = (
  db: MigratedPostgres,
  workspaceId: string,
  groups: readonly string[],
  sensitivity = "Internal",
): Promise<Sourced> =>
  bindingHolding(db, workspaceId, { sensitivity, audience: "groups", audienceGroups: groups });

/** The pair most proofs rest on: a Restricted binding and an Internal one, a document under each. */
export const restrictedAndInternal = async (
  db: MigratedPostgres,
  workspaceId: string,
): Promise<{ readonly restricted: Sourced; readonly internal: Sourced }> => ({
  restricted: await bindingHolding(db, workspaceId, { sensitivity: "Restricted" }),
  internal: await bindingHolding(db, workspaceId),
});

/** A concept resting on both of that pair: the Internal document first, the Restricted second. */
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

/** A written concept, with the path the suite's links and re-writes name it by, and its title. */
export type SourcedConcept = ConceptWritten & { readonly path: string; readonly title: string };

let sequence = 0;

/**
 * A stable concept citing the documents given, written by this person through the governed
 * write against the bundle's current head. Each is its own note under its own path; a
 * suite that needs a kind, a body or a title of its own says so in the overrides.
 */
export const conceptCiting = async (
  scenario: Scenario,
  writer: UserPrincipal,
  documents: readonly string[],
  overrides: Partial<WriteConceptInput> = {},
): Promise<SourcedConcept> => {
  sequence += 1;
  const path = overrides.path ?? `knowledge/sourced-${sequence}.md`;
  const title = overrides.title ?? `Sourced note ${sequence}`;
  const written = await writeConcept(
    writer,
    { git: scenario.git, postgres: scenario.postgres },
    {
      mergeKey: `note:sourced-${sequence}`,
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
    },
  );
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return { ...written.value, path, title };
};

/**
 * A group of this workspace with these people in it, made through the members slice's acts
 * as the Admin — the road an audience's ids are minted by (ADR 0038).
 */
export const groupNamed = async (
  db: MigratedPostgres,
  scenario: Scenario,
  name: string,
  people: readonly UserPrincipal[],
): Promise<string> =>
  readingAs(db.runtimePool, scenario.admin, async (admin, tx) => {
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
  });

/**
 * The shape most audience proofs start from: a group with these people in it, a binding
 * for that group alone, and a stable concept the Editor wrote citing its document.
 */
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

/** The three columns as one unit's row holds them, read as the superuser. */
export type HeldVisibility = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

/** Which readable units a suite reads the pair back off, and the column each is keyed by. */
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

/** Every edge the map holds from one concept, with the pair each wears, read as the superuser. */
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

/** The ledger rows of one act in a workspace, as the superuser: the actor and the detail each carries. */
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
