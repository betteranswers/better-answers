import { describe, expect, it } from "vitest";

import type { ConceptIri } from "@better-answers/schema";

import { draftAnswer, type AnswerResult, type DraftEvent } from "../src/answering/index.ts";
import type { PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import { openModelKeySetting, openStreamingClient } from "../src/llm/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { setModelKey, setModelPrice, setSpendingLimit } from "../src/workspaces/index.ts";
import {
  asked,
  conceptSeeded,
  draftStepsFor,
  SUITE_ENVELOPE_KEY,
  type SeededConcept,
} from "./asking.ts";
import {
  conceptNumbersIn as numbersIn,
  promptOf,
  streamedEventsOf,
  streamedResponse,
} from "./judge-wire.ts";
import { bootstrap, provisionedWorkspace } from "./platform.ts";
import { answered, postgresForSuite, seedingWith } from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

const db = postgresForSuite();

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };

const SONNET = "claude-sonnet-5-5";
const A_KEY = "sk-test-u17-invented-key-0002";

const QUESTION = "How long are audit logs kept?";

const RETENTION: SeededConcept = {
  collection: "audits",
  title: "Audit log retention",
  body: "Audit logs are kept for thirteen months, then deleted.\n",
};
const EXPORT: SeededConcept = {
  collection: "audits",
  title: "Audit log export",
  body: "Buyers export audit logs from the console as CSV.\n",
};
const LMS_LOGS: SeededConcept = {
  collection: "lms",
  title: "LMS audit logs",
  body: "The LMS keeps its audit logs for two years.\n",
};

const anAnswer = (title: string, body: string): SeededConcept => ({
  collection: "audits",
  kind: "Answer",
  title,
  body,
});

const USERS_ANSWER = anAnswer(
  "How long are buyers' audit logs kept?",
  "Buyers' audit logs are kept for thirteen months.\n",
);
const SUPPLIER_ANSWER = anAnswer(
  "How long are the supplier's audit logs kept?",
  "The supplier keeps its own audit logs for seven years.\n",
);

/** A workspace whose Admin asks, drafting on Sonnet with a key, priced, under `limitGbp`. */
const aDraftingWorkspace = async (limitGbp = "100") => {
  const workspace = await provisionedWorkspace(db(), "Acme");
  const { workspaceId } = workspace;
  const asker = await principalFor(db(), workspaceId, workspace.adminUserId);
  answered(
    await setModelPrice(PLATFORM, openPostgres(db().pool), {
      provider: "anthropic",
      model: SONNET,
      effectiveFrom: "2026-01-01",
      gbpPerMillionIn: "3",
      gbpPerMillionOut: "15",
    }),
  );
  await seedingWith(db().pool, (seed) =>
    seed.modelChoice({
      id: `answering-${workspaceId}`,
      workspaceId,
      purpose: "answering",
      provider: "anthropic",
      model: SONNET,
      dimensions: null,
    }),
  );
  answered(
    await setModelKey(bootstrap, openPostgres(db().pool), openModelKeySetting(SUITE_ENVELOPE_KEY), {
      workspaceId,
      provider: "anthropic",
      key: A_KEY,
    }),
  );
  answered(
    await setSpendingLimit(PLATFORM, openPostgres(db().pool), { workspaceId, gbp: limitGbp }),
  );
  return { workspaceId, asker };
};

type Writing = (numbers: ReadonlyMap<string, string>, prompt: string) => readonly string[];

type Streamed = {
  readonly prompts: string[];
  readonly signals: (AbortSignal | null | undefined)[];
};

/** A drafting model at the wire, writing each reply's lines from the numbers its prompt gave. */
const aDrafter = (
  writing: Writing,
  options: { readonly status?: number; readonly before?: (at: number) => Promise<void> } = {},
) => {
  const streamed: Streamed = { prompts: [], signals: [] };
  const client = openStreamingClient({
    fetch: async (_input, init) => {
      const prompt = promptOf(typeof init?.body === "string" ? init.body : "");
      streamed.prompts.push(prompt);
      streamed.signals.push(init?.signal);
      if (options.status !== undefined) return new Response("", { status: options.status });
      const lines = writing(numbersIn(prompt), prompt);
      return streamedResponse(streamedEventsOf(lines), {
        signal: init?.signal,
        ...(options.before === undefined ? {} : { before: options.before }),
      });
    },
    clock: { now: () => new Date() },
    log: { info: () => {} },
    wait: async () => {},
  });
  return { streamed, client };
};

type Drafter = ReturnType<typeof aDrafter>;

const seededIn = async (workspaceId: string, shapes: readonly SeededConcept[]) => {
  const iris: ConceptIri[] = [];
  for (const shape of shapes) iris.push(await conceptSeeded(db(), workspaceId, shape));
  return iris;
};

/** Every event a draft sends, in order. */
const draftOf = async (
  asker: UserPrincipal,
  result: AnswerResult,
  drafter: Drafter,
  signal?: AbortSignal,
) => {
  const events: DraftEvent[] = [];
  const drafting = draftAnswer(
    asker,
    draftStepsFor(db().runtimePool, asker, drafter.client.streamModel),
    result,
    { question: QUESTION, ...(signal === undefined ? {} : { signal }) },
  );
  let step = await drafting.next();
  while (step.done !== true) {
    events.push(step.value);
    step = await drafting.next();
  }
  return { events, ended: step.value };
};

const draftKept = async (recordId: string) => {
  const read = await db().pool.query("SELECT drafted FROM question_content WHERE record_id = $1", [
    recordId,
  ]);
  return read.rows[0]?.drafted;
};

const spendOf = async (workspaceId: string) => {
  const open = await db().pool.query(
    "SELECT count(*)::integer AS open FROM spend_reservation WHERE workspace_id = $1",
    [workspaceId],
  );
  const calls = await db().pool.query(
    "SELECT purpose, outcome FROM llm_call WHERE workspace_id = $1 ORDER BY called_at",
    [workspaceId],
  );
  return { open: open.rows[0]?.open, calls: calls.rows };
};

/** An evidence result over `shapes`, with no judge to call. */
const arranged = async (shapes: readonly SeededConcept[], limitGbp?: string) => {
  const { workspaceId, asker } = await aDraftingWorkspace(limitGbp);
  const iris = await seededIn(workspaceId, shapes);
  const result = await asked(db(), asker, { question: QUESTION });
  return { workspaceId, asker, iris, result };
};

const numberOf = (numbers: ReadonlyMap<string, string>, shape: SeededConcept) =>
  numbers.get(shape.title) ?? "none";

describe("the drafter", () => {
  it("covers AE6: removes an uncited claim, keeping its neighbours", async () => {
    const { asker, result, iris } = await arranged([RETENTION, EXPORT]);
    const drafter = aDrafter((numbers) => [
      `Audit logs are kept for thirteen months.[^${numberOf(numbers, RETENTION)}]\n`,
      "They are kept forever in the archive.[^99]\n",
      `Buyers export them as CSV.[^${numberOf(numbers, EXPORT)}]\n`,
    ]);

    const { events, ended } = await draftOf(asker, result, drafter);

    const [retention, exported] = iris;
    const kept = [
      { sentence: "Audit logs are kept for thirteen months.", concepts: [retention] },
      { sentence: "Buyers export them as CSV.", concepts: [exported] },
    ];
    expect(ended).toEqual({ ok: true, value: undefined });
    expect(events).toEqual([
      ...kept.map((sentence) => ({ kind: "sentence", collection: "audits", ...sentence })),
      { kind: "part", collection: "audits", outcome: "drafted" },
    ]);
    expect(await draftKept(result.recordId)).toEqual(kept);
  });

  it("covers AE12: drafts each collection's part from its own", async () => {
    const { asker, result } = await arranged([RETENTION, LMS_LOGS]);
    const drafter = aDrafter((numbers) => {
      const own = [...numbers.values()];
      return [`Kept as stated.[^${own.join("][^")}]\n`, "Both agree.[^1][^2]\n"];
    });

    const { events } = await draftOf(asker, result, drafter);

    expect(drafter.streamed.prompts.map((prompt) => [...numbersIn(prompt).keys()])).toEqual([
      [RETENTION.title],
      [LMS_LOGS.title],
    ]);
    expect(events.map((event) => [event.kind, event.collection])).toEqual([
      ["sentence", "audits"],
      ["part", "audits"],
      ["sentence", "lms"],
      ["part", "lms"],
    ]);
    expect(events.filter((event) => event.kind === "sentence")).toEqual([
      expect.objectContaining({ concepts: [result.related[0]?.iri] }),
      expect.objectContaining({ concepts: [result.related[1]?.iri] }),
    ]);
  });

  it("ends a draft with every sentence removed in the refusal", async () => {
    const { asker, result } = await arranged([RETENTION]);
    const drafter = aDrafter(() => ["Kept a while.\n", "Kept forever.[^7]\n"]);

    const { events } = await draftOf(asker, result, drafter);

    expect(events).toEqual([{ kind: "part", collection: "audits", outcome: "refused" }]);
    expect(await draftKept(result.recordId)).toEqual([]);
  });

  it("sends its first sentence before the reply has ended", async () => {
    const { asker, result } = await arranged([RETENTION]);
    const held = Promise.withResolvers<void>();
    const firstSentenceAt = 3;
    const drafter = aDrafter(
      (numbers) => [
        `Kept thirteen months.[^${numberOf(numbers, RETENTION)}]\n`,
        `Then deleted.[^${numberOf(numbers, RETENTION)}]\n`,
      ],
      { before: (at) => (at === firstSentenceAt + 1 ? held.promise : Promise.resolve()) },
    );
    const drafting = draftAnswer(
      asker,
      draftStepsFor(db().runtimePool, asker, drafter.client.streamModel),
      result,
      { question: QUESTION },
    );

    const first = await drafting.next();
    held.resolve();
    for (let step = await drafting.next(); step.done !== true; step = await drafting.next());

    expect(first.value).toMatchObject({ kind: "sentence", sentence: "Kept thirteen months." });
  });

  it("leaves the result as it was when its call fails", async () => {
    const { workspaceId, asker, result } = await arranged([RETENTION]);
    const drafter = aDrafter(() => [], { status: 500 });

    const { events } = await draftOf(asker, result, drafter);

    expect(events).toEqual([{ kind: "part", collection: "audits", outcome: "failed" }]);
    expect(await spendOf(workspaceId)).toEqual({
      open: 0,
      calls: [
        { purpose: "answering", outcome: "failed" },
        { purpose: "answering", outcome: "failed" },
        { purpose: "answering", outcome: "failed" },
      ],
    });
  });

  it("pauses at the spending limit, sending nothing to the model", async () => {
    const { workspaceId, asker, result } = await arranged([RETENTION, LMS_LOGS], "0.0001");
    const drafter = aDrafter(() => ["Never written.[^1]\n"]);

    const { events, ended } = await draftOf(asker, result, drafter);

    expect(ended.ok).toBe(true);
    expect(events).toEqual([{ kind: "part", collection: "audits", outcome: "paused" }]);
    expect(drafter.streamed.prompts).toEqual([]);
    expect(await spendOf(workspaceId)).toEqual({ open: 0, calls: [] });
    const completed = await db().pool.query(
      "SELECT completed_at IS NOT NULL AS completed FROM question_asked WHERE id = $1",
      [result.recordId],
    );
    expect(completed.rows).toEqual([{ completed: true }]);
  });

  it("never drafts from an unjudged Answer, shown word for word", async () => {
    const { asker, result } = await arranged([USERS_ANSWER, SUPPLIER_ANSWER, RETENTION]);
    const drafter = aDrafter((numbers) => [
      `Kept thirteen months.[^${numberOf(numbers, RETENTION)}]\n`,
    ]);

    const { events } = await draftOf(asker, result, drafter);

    const [prompt = ""] = drafter.streamed.prompts;
    expect(prompt).not.toContain(USERS_ANSWER.body.trim());
    expect(prompt).not.toContain(SUPPLIER_ANSWER.body.trim());
    expect([...numbersIn(prompt).keys()]).toEqual([RETENTION.title]);
    expect(result.related.filter((concept) => "body" in concept)).toEqual([
      expect.objectContaining({ body: USERS_ANSWER.body }),
      expect.objectContaining({ body: SUPPLIER_ANSWER.body }),
    ]);
    expect(events).toHaveLength(2);
  });

  it("stops drafting once its asker leaves, settling the call", async () => {
    const { workspaceId, asker, result } = await arranged([RETENTION, LMS_LOGS]);
    const leaving = new AbortController();
    const drafter = aDrafter(
      (numbers) => [`Kept.[^${[...numbers.values()].join("")}]\n`, "More.\n"],
      {
        before: async (at) => {
          if (at === 4) leaving.abort();
        },
      },
    );

    const { events } = await draftOf(asker, result, drafter, leaving.signal);

    expect(drafter.streamed.signals.map((signal) => signal?.aborted)).toEqual([true]);
    expect(events.at(-1)).toEqual({ kind: "part", collection: "audits", outcome: "failed" });
    expect(await spendOf(workspaceId)).toEqual({
      open: 0,
      calls: [{ purpose: "answering", outcome: "failed" }],
    });
  });
});

type Labels = { readonly a: string; readonly b: string; readonly c: string };

/** The `audits` part's sentences from `pieces`; `a` and `b` are its labels, `c` the other part's. */
const sentOf = async (pieces: (labels: Labels) => readonly string[]) => {
  const { asker, result } = await arranged([RETENTION, EXPORT, LMS_LOGS]);
  const labelOf = (shape: SeededConcept) =>
    String(result.related.findIndex((concept) => concept.title === shape.title) + 1);
  const labels = { a: labelOf(RETENTION), b: labelOf(EXPORT), c: labelOf(LMS_LOGS) };
  const drafter = aDrafter((numbers) => (numbers.has(RETENTION.title) ? pieces(labels) : []));
  const { events } = await draftOf(asker, result, drafter);
  const iriOf = (shape: SeededConcept) =>
    result.related.find((concept) => concept.title === shape.title)?.iri;
  return {
    sent: events.flatMap((event) =>
      event.kind === "sentence" ? [{ sentence: event.sentence, concepts: event.concepts }] : [],
    ),
    retention: iriOf(RETENTION),
    exported: iriOf(EXPORT),
  };
};

describe("a drafted sentence's check", () => {
  it("shows a cited sentence without its marks", async () => {
    const { sent, retention, exported } = await sentOf(({ a, b }) => [
      `Claims close within 30 days.[^${a}]\n`,
      `Receipts are kept.[^${b}][^${a}][^${b}]\n`,
      `Exports run nightly [^${b}].\n`,
    ]);

    expect(sent).toEqual([
      { sentence: "Claims close within 30 days.", concepts: [retention] },
      { sentence: "Receipts are kept.", concepts: [exported, retention] },
      { sentence: "Exports run nightly.", concepts: [exported] },
    ]);
  });

  it("removes each sentence citing anything not given to it", async () => {
    const { sent } = await sentOf(({ a, b, c }) => [
      "Claims close within 30 days.\n",
      `Claims close within 30 days.[^${a}][^${c}]\n`,
      "Claims close within 30 days.[^99]\n",
      `[^${a}]: https://example.test/policy\n`,
      ` [^${a}] [^${b}] \n`,
      `Type \`[^${a}]\` to cite.\n`,
    ]);

    expect(sent).toEqual([]);
  });
});

describe("where a drafted sentence ends", () => {
  it("ends a sentence with its line, or after spaced marks", async () => {
    const { sent } = await sentOf(({ a, b }) => [
      `Claims close.[^${a}] Receipts are kept.[^${b}]\nExports run.[^${b}]\n`,
      `Logs are kept.[^${a}] [^${b}] Then deleted [^${a}]. Done.[^${b}]\n`,
    ]);

    expect(sent.map(({ sentence }) => sentence)).toEqual([
      "Claims close.",
      "Receipts are kept.",
      "Exports run.",
      "Logs are kept.",
      "Then deleted.",
      "Done.",
    ]);
  });

  it("waits across pieces for the marks a sentence ends with", async () => {
    const { sent, retention, exported } = await sentOf(({ a, b }) => [
      `Claims close.[^${a}]`,
      `[^${b}]`,
      " Receipts are",
      ` kept.[^${b}]`,
    ]);

    expect(sent).toEqual([
      { sentence: "Claims close.", concepts: [retention, exported] },
      { sentence: "Receipts are kept.", concepts: [exported] },
    ]);
  });

  it("ends a sentence at another part's mark, removing it", async () => {
    const { sent } = await sentOf(({ a, c }) => [`Elsewhere.[^${c}] Here.[^${a}]\n`]);

    expect(sent.map(({ sentence }) => sentence)).toEqual(["Here."]);
  });

  it("finishes what is left when the reply ends", async () => {
    const { sent } = await sentOf(({ a }) => [`Kept.[^${a}] Trailing words`]);

    expect(sent.map(({ sentence }) => sentence)).toEqual(["Kept."]);
  });

  it("drops blank lines", async () => {
    const { sent } = await sentOf(({ a }) => ["\n\n  \n", `Kept.[^${a}]`]);

    expect(sent.map(({ sentence }) => sentence)).toEqual(["Kept."]);
  });
});
