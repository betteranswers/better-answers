import type pg from "pg";
import type { z } from "zod";

import { ids, type ConceptIri } from "@better-answers/schema";
import type { MigratedPostgres } from "@better-answers/schema/testing";

import {
  ask,
  askInput,
  completeRecord,
  keepDraft,
  openRecord,
  planAnswer,
  reserveDrafting,
  reserveJudge,
  type AnswerResult,
  type AskCaps,
  type AskSteps,
  type DraftSteps,
} from "../src/answering/index.ts";
import type { PrincipalRefusal, Result, UserPrincipal } from "../src/kernel/index.ts";
import {
  openCredentials,
  type Credentials,
  type ModelClient,
  type StreamModel,
} from "../src/llm/index.ts";
import {
  openPostgres,
  withMember,
  withMemberUnheld,
  type Tx,
} from "../src/store/postgres/index.ts";
import { conceptCiting, type SourcedConcept } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { answered, seedingWith } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const flat = <Value, Inner, Outer>(
  opened: Result<Result<Value, Inner>, Outer>,
): Result<Value, Inner | Outer> => (opened.ok ? opened.value : opened);

/** Invented: it seals nothing outside the suites. */
export const SUITE_ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_byte, index) => 255 - index);

/** The judge's model client, and the keys it opens; a call with no client set fails its test. */
export type Judging = {
  readonly credentials?: Credentials;
  readonly callModel?: ModelClient["callModel"];
  readonly decide?: ModelClient["decide"];
};

const NO_MODEL_CALL = (): never => {
  throw new Error("a model was called where the test set up no model client");
};

/** The steps a transport hands `ask`: each one a transaction of its own, as the asker. */
export const stepsFor = (
  pool: pg.Pool,
  asker: UserPrincipal,
  judging: Judging = {},
): AskSteps<PrincipalRefusal> => {
  const door = openPostgres(pool);
  const credentials = judging.credentials ?? openCredentials(SUITE_ENVELOPE_KEY);
  return {
    openRecord: async (opening) =>
      flat(
        await withMember(asker, door, (member, tx) =>
          openRecord(member, tx, { ...opening, transport: "mcp" }),
        ),
      ),
    read: async (work) => flat(await withMemberUnheld(asker, door, (_member, tx) => work(tx))),
    reserve: async (reserving) =>
      flat(
        await withMember(asker, door, (member, tx) =>
          reserveJudge(member, tx, credentials, reserving),
        ),
      ),
    callModel: judging.callModel ?? NO_MODEL_CALL,
    decide: judging.decide ?? NO_MODEL_CALL,
    completeRecord: async (completion) =>
      flat(
        await withMember(asker, door, (member, tx) =>
          completeRecord(member, tx, { ...completion, completedAt: new Date() }),
        ),
      ),
  };
};

/** The drafter's steps as a transport hands them: each a transaction of its own, as the asker. */
export const draftStepsFor = (
  pool: pg.Pool,
  asker: UserPrincipal,
  streamModel: StreamModel,
): DraftSteps<PrincipalRefusal> => {
  const door = openPostgres(pool);
  const credentials = openCredentials(SUITE_ENVELOPE_KEY);
  return {
    read: async (work) => flat(await withMemberUnheld(asker, door, (_member, tx) => work(tx))),
    reserve: async (reserving) =>
      flat(
        await withMember(asker, door, (member, tx) =>
          reserveDrafting(member, tx, credentials, { ...reserving, now: new Date() }),
        ),
      ),
    streamModel,
    keepDraft: async (kept) =>
      flat(
        await withMember(asker, door, (member, tx) =>
          keepDraft(member, tx, { ...kept, now: new Date() }),
        ),
      ),
  };
};

export type Asking = z.input<typeof askInput>;

/** The tokens out each open reservation of the workspace holds, as `read` finds them when called. */
export const reservationsRead = (db: MigratedPostgres, workspaceId: string) => {
  const reserved: unknown[] = [];
  const read = async (): Promise<void> => {
    const open = await db.pool.query(
      "SELECT tokens_out FROM spend_reservation WHERE workspace_id = $1",
      [workspaceId],
    );
    reserved.push(...open.rows.map((row) => row.tokens_out));
  };
  return { reserved, read };
};

export type Told = { readonly caps?: AskCaps; readonly now?: Date; readonly judging?: Judging };

/** Asks as `asker` through steps on the runtime pool; `now` is this instant unless told. */
export const askedAsIs = async (
  db: MigratedPostgres,
  asker: UserPrincipal,
  asking: Asking,
  { caps, now = new Date(), judging }: Told = {},
): Promise<AnswerResult> =>
  answered(
    await ask(
      asker,
      stepsFor(db.runtimePool, asker, judging),
      inputOf(askInput, asking),
      now,
      caps,
    ),
  );

/** As `askedAsIs`, the map's tables counted first. */
export const asked = async (
  db: MigratedPostgres,
  asker: UserPrincipal,
  asking: Asking,
  told: Told = {},
): Promise<AnswerResult> => {
  // Uncounted, the planner joins every node to every step, and the walk nears its timeout.
  await db.pool.query("ANALYZE map_node, map_edge");
  return askedAsIs(db, asker, asking, told);
};

/** What `ask` would answer, planned on the one transaction its caller already holds. */
export const plannedOn = (reader: UserPrincipal, tx: Tx, asking: Asking) =>
  planAnswer(reader, (work) => work(tx), inputOf(askInput, asking), new Date());

/** What `ask` answers, apart from its record's id, where nothing bears on the question. */
export const REFUSED = {
  verdict: "refuse",
  judgeState: "not-judged",
  answers: [],
  related: [],
  conflicts: [],
  unmappedPassages: [],
  map: { state: "live" },
  collections: [],
  readableCollections: [],
};

/** An answer apart from its record's id, which no two answers share. */
export const withoutRecord = ({ recordId: _recordId, ...answer }: AnswerResult) => answer;

export type SeededConcept = {
  /** The folder under `knowledge/`, or null for none. */
  readonly collection: string | null;
  readonly kind?: string;
  readonly title: string;
  readonly body: string;
  readonly contentHash?: string;
  readonly sensitivity?: string;
  /** Minted by the caller where the order of two concepts' IRIs matters. */
  readonly iri?: ConceptIri;
  /** Each concept this one's node has an edge to. */
  readonly linksTo?: readonly ConceptIri[];
};

let seededConcepts = 0;

/** A published concept's index row with its node on the map, and an edge to each it links to. */
export const conceptSeeded = (
  db: MigratedPostgres,
  workspaceId: string,
  shape: SeededConcept,
): Promise<ConceptIri> =>
  seedingWith(db.pool, async (seed) => {
    seededConcepts += 1;
    const { kind = "Policy", title, body, sensitivity = "Internal", contentHash } = shape;
    const folder = shape.collection === null ? "" : `${shape.collection}/`;
    const { iri } = await seed.conceptIdentity({
      workspaceId,
      ...(shape.iri === undefined ? {} : { iri: shape.iri }),
    });
    const indexed = await seed.conceptIndex({
      workspaceId,
      iri,
      path: `knowledge/${folder}seeded-${seededConcepts}.md`,
      kind,
      title,
      body,
      frontmatter: { title, type: kind },
      sensitivity,
      ...(contentHash === undefined ? {} : { contentHash }),
    });
    await seed.mapNode({ workspaceId, uid: indexed.iri, kind, sensitivity });
    for (const toUid of shape.linksTo ?? []) {
      await seed.mapEdge({ workspaceId, fromUid: indexed.iri, toUid, sensitivity });
    }
    return ids.conceptIri.parse(indexed.iri);
  });

export type WrittenAnswer = {
  readonly collection: string;
  /** The file's name, and the merge key's. */
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly sensitivity?: "Internal" | "Restricted";
};

/** Writes a stable `Answer` under its collection through the governed write, citing nothing. */
export const answerWritten = (scenario: Scenario, shape: WrittenAnswer): Promise<SourcedConcept> =>
  conceptCiting(scenario, scenario.editor, [], {
    mergeKey: `answer:${shape.slug}`,
    path: `knowledge/${shape.collection}/${shape.slug}.md`,
    kind: "Answer",
    title: shape.title,
    frontmatter: { title: shape.title, type: "Answer" },
    body: shape.body,
    sensitivity: shape.sensitivity ?? "Internal",
  });
