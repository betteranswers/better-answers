import type pg from "pg";
import type { z } from "zod";

import {
  CONCEPT_DRAFT_STATUS,
  ids,
  type CONCEPT_STATUSES,
  type ConceptIri,
} from "@better-answers/schema";
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
} from "../../src/answering/index.ts";
import type {
  PlatformPrincipal,
  PrincipalRefusal,
  Result,
  UserPrincipal,
} from "../../src/kernel/index.ts";
import {
  openCredentials,
  openModelKeySetting,
  type Credentials,
  type LlmPurpose,
  type ModelClient,
  type StreamModel,
} from "../../src/llm/index.ts";
import {
  openPostgres,
  withMember,
  withMemberUnheld,
  type Tx,
} from "../../src/store/postgres/index.ts";
import { setModelKey, setModelPrice, setSpendingLimit } from "../../src/workspaces/index.ts";
import { conceptCiting, type SourcedConcept } from "../fixtures/sourced-concept.ts";
import { principalFor, type Scenario } from "../fixtures/workspace-with-bundle.ts";
import { bootstrap, provisionedWorkspace } from "../support/platform.ts";
import { rowsFrom } from "../support/rows.ts";
import { inputOf } from "../support/suite-input.ts";
import { answered, seedingWith } from "../support/suite-postgres.ts";

const flat = <Value, Inner, Outer>(
  opened: Result<Result<Value, Inner>, Outer>,
): Result<Value, Inner | Outer> => (opened.ok ? opened.value : opened);

export const SUITE_ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_byte, index) => 255 - index);

export type Judging = {
  readonly credentials?: Credentials;
  readonly callModel?: ModelClient["callModel"];
  readonly decideYesNo?: ModelClient["decideYesNo"];
};

const NO_MODEL_CALL = (): never => {
  throw new Error("a model was called where the test set up no model client");
};

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
    decideYesNo: judging.decideYesNo ?? NO_MODEL_CALL,
    completeRecord: async (completion) =>
      flat(
        await withMember(asker, door, (member, tx) =>
          completeRecord(member, tx, { ...completion, completedAt: new Date() }),
        ),
      ),
  };
};

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

export const reservationsRead = (db: MigratedPostgres, workspaceId: string) => {
  const reserved: unknown[] = [];
  const read = async (): Promise<void> => {
    const open = await db.pool.query(
      "SELECT tokens_out FROM spend_reservation WHERE workspace_id = $1",
      [workspaceId],
    );
    reserved.push(...rowsFrom(open).map((row) => row["tokens_out"]));
  };
  return { reserved, read };
};

export type Told = { readonly caps?: AskCaps; readonly now?: Date; readonly judging?: Judging };

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

export const plannedOn = (reader: UserPrincipal, tx: Tx, asking: Asking) =>
  planAnswer(reader, (work) => work(tx), inputOf(askInput, asking), new Date());

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

export const withoutRecord = ({ recordId: _recordId, ...answer }: AnswerResult) => answer;

export type SeededConcept = {
  readonly collection: string | null;
  readonly kind?: string;
  readonly title: string;
  readonly body: string;
  readonly contentHash?: string;
  readonly sensitivity?: string;
  readonly iri?: ConceptIri;
  readonly linksTo?: readonly ConceptIri[];
  readonly status?: (typeof CONCEPT_STATUSES)[number];
};

let seededConcepts = 0;

const publishedAs = (status: SeededConcept["status"]) =>
  status === CONCEPT_DRAFT_STATUS ? { publishedAt: null } : {};

const statusAs = (status: SeededConcept["status"]) =>
  status === undefined ? {} : { status, ...publishedAs(status) };

export const conceptSeeded = (
  db: MigratedPostgres,
  workspaceId: string,
  shape: SeededConcept,
): Promise<ConceptIri> =>
  seedingWith(db.pool, async (seed) => {
    seededConcepts += 1;
    const { kind = "Policy", title, body, sensitivity = "Internal", contentHash, status } = shape;
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
      ...statusAs(status),
    });
    await seed.mapNode({
      workspaceId,
      uid: indexed.iri,
      kind,
      sensitivity,
      ...publishedAs(status),
    });
    for (const toUid of shape.linksTo ?? []) {
      await seed.mapEdge({ workspaceId, fromUid: indexed.iri, toUid, sensitivity });
    }
    return ids.conceptIri.parse(indexed.iri);
  });

export const conceptsSeeded = async (
  db: MigratedPostgres,
  workspaceId: string,
  shapes: readonly SeededConcept[],
): Promise<readonly ConceptIri[]> => {
  const iris: ConceptIri[] = [];
  for (const shape of shapes) iris.push(await conceptSeeded(db, workspaceId, shape));
  return iris;
};

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };

const SONNET = "claude-sonnet-5-5";

type SonnetSetUp = {
  readonly purpose: LlmPurpose | null;
  readonly limitGbp: string | null;
  readonly sealedUnder: Uint8Array | null;
  readonly key: string;
};

export const aSonnetWorkspace = async (
  db: MigratedPostgres,
  { purpose, limitGbp, sealedUnder, key }: SonnetSetUp,
) => {
  const workspace = await provisionedWorkspace(db, "Acme");
  const { workspaceId } = workspace;
  const asker = await principalFor(db, workspaceId, workspace.adminUserId);
  const door = openPostgres(db.pool);
  answered(
    await setModelPrice(PLATFORM, door, {
      provider: "anthropic",
      model: SONNET,
      effectiveFrom: "2026-01-01",
      gbpPerMillionIn: "3",
      gbpPerMillionOut: "15",
    }),
  );
  if (purpose !== null) {
    await seedingWith(db.pool, (seed) =>
      seed.modelChoice({
        id: `${purpose}-${workspaceId}`,
        workspaceId,
        purpose,
        provider: "anthropic",
        model: SONNET,
        dimensions: null,
      }),
    );
  }
  if (sealedUnder !== null) {
    const setting = openModelKeySetting(sealedUnder);
    answered(
      await setModelKey(bootstrap, door, setting, { workspaceId, provider: "anthropic", key }),
    );
  }
  if (limitGbp !== null) {
    answered(await setSpendingLimit(PLATFORM, door, { workspaceId, gbp: limitGbp }));
  }
  return { workspaceId, asker };
};

export type WrittenAnswer = {
  readonly collection: string;
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly sensitivity?: "Internal" | "Restricted";
};

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
