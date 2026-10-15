import { describe, expect, it } from "vitest";

import {
  draftAnswer,
  type AnswerResult,
  type DraftEvent,
  type DraftSteps,
} from "../src/answering/index.ts";
import { err, type PrincipalRefusal, type UserPrincipal } from "../src/kernel/index.ts";
import { openStreamingClient } from "../src/llm/index.ts";
import {
  aSonnetWorkspace,
  asked,
  conceptsSeeded,
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
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

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

type Drafting = {
  readonly limitGbp?: string;
  /** Whether an answering model is chosen at all. */
  readonly chosen?: boolean;
};

type Writing = (numbers: ReadonlyMap<string, string>, prompt: string) => readonly string[];

type Streamed = {
  readonly prompts: string[];
  readonly signals: (AbortSignal | null | undefined)[];
};

/** A drafting model at the wire, writing each reply's lines from the numbers its prompt gave. */
const aDrafter = (
  writing: Writing,
  options: {
    readonly status?: number;
    readonly before?: (at: number) => Promise<void>;
    readonly outputTokens?: number;
  } = {},
) => {
  const streamed: Streamed = { prompts: [], signals: [] };
  const client = openStreamingClient({
    fetch: async (_input, init) => {
      const prompt = promptOf(typeof init?.body === "string" ? init.body : "");
      streamed.prompts.push(prompt);
      streamed.signals.push(init?.signal);
      if (options.status !== undefined) return new Response("", { status: options.status });
      const lines = writing(numbersIn(prompt), prompt);
      const usage = { input_tokens: 2_100, output_tokens: options.outputTokens ?? 140 };
      return streamedResponse(streamedEventsOf(lines, usage), {
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

/** The titles of the concepts each drafting request gave the model. */
const titlesSent = (drafter: Drafter) =>
  drafter.streamed.prompts.map((prompt) => [...numbersIn(prompt).keys()]);

type Steps = DraftSteps<PrincipalRefusal>;

type Told = {
  readonly signal?: AbortSignal;
  /** Changes a step, as a store fault or a reader's lost access would. */
  readonly steps?: (steps: Steps) => Steps;
};

/** Every event a draft sends, in order. */
const draftOf = async (
  asker: UserPrincipal,
  result: AnswerResult,
  drafter: Drafter,
  { signal, steps = (given) => given }: Told = {},
) => {
  const events: DraftEvent[] = [];
  const drafting = draftAnswer(
    asker,
    steps(draftStepsFor(db().runtimePool, asker, drafter.client.streamModel)),
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
const arranged = async (
  shapes: readonly SeededConcept[],
  { limitGbp = "100", chosen = true }: Drafting = {},
) => {
  const { workspaceId, asker } = await aSonnetWorkspace(db(), {
    purpose: chosen ? "answering" : null,
    limitGbp,
    sealedUnder: SUITE_ENVELOPE_KEY,
    key: A_KEY,
  });
  const iris = await conceptsSeeded(db(), workspaceId, shapes);
  const result = await asked(db(), asker, { question: QUESTION });
  return { workspaceId, asker, iris, result };
};

/** Where a reply's second text delta sits among its events. */
const SECOND_DELTA = streamedEventsOf(["a", "b"]).findIndex((event) => event.includes('"b"'));

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

    expect(titlesSent(drafter)).toEqual([[RETENTION.title], [LMS_LOGS.title]]);
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
    const firstSentenceAt = streamedEventsOf(["x"]).findIndex((event) =>
      event.includes("text_delta"),
    );
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
    const { workspaceId, asker, result } = await arranged([RETENTION, LMS_LOGS], {
      limitGbp: "0.0001",
    });
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
          if (at === SECOND_DELTA) leaving.abort();
        },
      },
    );

    const { events } = await draftOf(asker, result, drafter, { signal: leaving.signal });

    expect(drafter.streamed.signals.map((signal) => signal?.aborted)).toEqual([true]);
    expect(events.at(-1)).toEqual({ kind: "part", collection: "audits", outcome: "failed" });
    expect(await spendOf(workspaceId)).toEqual({
      open: 0,
      calls: [{ purpose: "answering", outcome: "failed" }],
    });
  });
});

/** As if the concept were gone from the index: no reader can read it any longer. */
const unreadable = async (shape: SeededConcept, result: AnswerResult) => {
  const iri = result.related.find((concept) => concept.title === shape.title)?.iri;
  await db().pool.query("DELETE FROM concept_index WHERE iri = $1", [iri]);
};

describe("what the drafter reads and keeps", () => {
  it("drafts only from concepts the reader can still read", async () => {
    const { asker, result } = await arranged([RETENTION, EXPORT, LMS_LOGS]);
    await unreadable(EXPORT, result);
    await unreadable(LMS_LOGS, result);
    const drafter = aDrafter((numbers) => [
      `Kept thirteen months.[^${numberOf(numbers, RETENTION)}]\n`,
      `Exported as CSV.[^${String(result.related.findIndex(({ title }) => title === EXPORT.title) + 1)}]\n`,
    ]);

    const { events } = await draftOf(asker, result, drafter);

    expect(titlesSent(drafter)).toEqual([[RETENTION.title]]);
    expect(
      events.map((event) => (event.kind === "sentence" ? event.sentence : event.kind)),
    ).toEqual(["Kept thirteen months.", "part"]);
  });

  it("drafts nothing where no answering model is chosen", async () => {
    const { asker, result } = await arranged([RETENTION], { chosen: false });
    const drafter = aDrafter(() => ["Never written.[^1]\n"]);

    const { events, ended } = await draftOf(asker, result, drafter);

    expect([events, drafter.streamed.prompts, ended.ok]).toEqual([[], [], true]);
  });

  it("pauses a later part, keeping the earlier part's prose", async () => {
    const { workspaceId, asker, result } = await arranged([RETENTION, LMS_LOGS], {
      limitGbp: "0.40",
    });
    const drafter = aDrafter((numbers) => [`Kept.[^${[...numbers.values()].join("")}]\n`], {
      outputTokens: 16_000,
    });

    const { events } = await draftOf(asker, result, drafter);

    expect(events.map((event) => [event.kind, event.collection])).toEqual([
      ["sentence", "audits"],
      ["part", "audits"],
      ["part", "lms"],
    ]);
    expect(events.at(-1)).toMatchObject({ outcome: "paused" });
    expect(await draftKept(result.recordId)).toEqual([
      { sentence: "Kept.", concepts: [result.related[0]?.iri] },
    ]);
    expect((await spendOf(workspaceId)).calls).toHaveLength(1);
  });

  it("ends drafting failed when a part's prose cannot be kept", async () => {
    const { asker, result } = await arranged([RETENTION, LMS_LOGS]);
    const drafter = aDrafter((numbers) => [`Kept.[^${[...numbers.values()].join("")}]\n`]);
    const lost = new Error("the record's store is gone");

    const { events, ended } = await draftOf(asker, result, drafter, {
      steps: (given) => ({ ...given, keepDraft: async () => err(lost) }),
    });

    expect(events.at(-1)).toEqual({ kind: "part", collection: "audits", outcome: "failed" });
    expect([ended, drafter.streamed.prompts.length]).toEqual([err(lost), 1]);
  });

  it("ends drafting failed when a read or reserve fails", async () => {
    const { asker, result } = await arranged([RETENTION]);
    const drafter = aDrafter(() => ["Never written.[^1]\n"]);
    const lost = new Error("the store is gone");

    const read = await draftOf(asker, result, drafter, {
      steps: (given) => ({ ...given, read: async () => err("not-a-member" as const) }),
    });
    const reserved = await draftOf(asker, result, drafter, {
      steps: (given) => ({ ...given, reserve: async () => err(lost) }),
    });

    const failed = [{ kind: "part", collection: "audits", outcome: "failed" }];
    expect([read.events, read.ended]).toEqual([failed, err("not-a-member")]);
    expect([reserved.events, reserved.ended]).toEqual([failed, err(lost)]);
    expect(drafter.streamed.prompts).toEqual([]);
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
      `Exports run nightly  [^${b}].\n`,
      `Logs are kept 1.5 years.[^${a}]\n`,
      `Kept for 13[^${a}]-month terms.[^${b}]\n`,
    ]);

    expect(sent).toEqual([
      { sentence: "Claims close within 30 days.", concepts: [retention] },
      { sentence: "Receipts are kept.", concepts: [exported, retention] },
      { sentence: "Exports run nightly.", concepts: [exported] },
      { sentence: "Logs are kept 1.5 years.", concepts: [retention] },
      { sentence: "Kept for 13-month terms.", concepts: [retention, exported] },
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
      `Refunds are always free. Claims close in 30 days.[^${a}]\n`,
    ]);

    expect(sent).toEqual([]);
  });
});

describe("where a drafted sentence ends", () => {
  it("ends a sentence with its line, or after spaced marks", async () => {
    const { sent, retention, exported } = await sentOf(({ a, b }) => [
      `Claims close.[^${a}] Receipts are kept.[^${b}]\nExports run.[^${b}]\n`,
      `Logs are kept.[^${a}] [^${b}] Then deleted [^${a}]. Done.[^${b}]\n`,
    ]);

    expect(sent).toEqual([
      { sentence: "Claims close.", concepts: [retention] },
      { sentence: "Receipts are kept.", concepts: [exported] },
      { sentence: "Exports run.", concepts: [exported] },
      { sentence: "Logs are kept.", concepts: [retention, exported] },
      { sentence: "Then deleted.", concepts: [retention] },
      { sentence: "Done.", concepts: [exported] },
    ]);
  });

  it("waits across pieces for the marks a sentence ends with", async () => {
    const { sent, retention, exported } = await sentOf(({ a, b }) => [
      `Claims close.[^${a}] `,
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
