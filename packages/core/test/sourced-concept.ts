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
import type { Tx } from "../src/store/postgres/index.ts";
import { readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

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
 * The write path's footing (`suiteWithBundles`) plus the one thing every visibility suite
 * adds to it: a read as somebody, the way a transport makes it.
 */
export const visibilitySuite = () => {
  const { db, arrange } = suiteWithBundles();
  return {
    db,
    arrange,
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

/**
 * One more document under a binding that already stands, carrying a class of its own — the
 * word the redaction seam's special-category verdict or an Admin's *narrow these documents*
 * writes on the row (ADR 0013, amended 2026-09-11). `null` is what every other seeded
 * document takes, and means the binding's.
 */
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

/**
 * What one chunk row is seeded at: where the span sits in the document's normalised text, and
 * the four visibility columns a chunk carries its own copy of (ADR 0023, ADR 0039). The four
 * default to a chunk nobody may read yet — unpublished and Restricted — because that is what
 * a run lands under an unpublished binding, and a suite about what a publish opens up has to
 * start from the closed state rather than assert its way back to it.
 */
export type ChunkShape = {
  readonly content: string;
  /** The splitter's position, which is also what the row's id is derived from. */
  readonly ordinal: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly publishedAt?: Date | null;
  readonly sensitivity?: string;
  readonly audience?: string;
  readonly audienceGroups?: readonly string[] | null;
};

/**
 * One chunk of a document, as the run that split it would land the row — the derived id, the
 * span as both the locator and the pair of offsets, and the visibility columns copied from
 * the binding.
 *
 * **It is a factory and not a writer.** There is no chunk writer in `packages/core/src`: the
 * worker lands these rows (T-129), and a suite about an app act over chunks that already
 * exist seeds them here rather than through an act that would have to be invented to run the
 * test. The id comes from the slice's own derivation, so a seeded row is addressable exactly
 * as a written one is.
 */
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
      // The column holds the span alone; the document half of a wire locator is the row's
      // own `source_document_id` (`CONTEXT.md`, *locator*).
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

/**
 * The pair most proofs rest on: a Restricted binding and an Internal one, a document under
 * each — and beside them the same distinction one level down, a document of the Internal
 * binding narrowed to Restricted on its own row, whose sibling is `internal`'s document.
 */
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

/** A written concept, with the path, merge key and title the suite's links and re-writes name it by. */
export type SourcedConcept = ConceptWritten & {
  readonly path: string;
  readonly mergeKey: string;
  readonly title: string;
};

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
