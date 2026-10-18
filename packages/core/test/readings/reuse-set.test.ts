import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { openModelClient } from "../../src/llm/index.ts";
import {
  clientAnswering,
  decisionCandidatesIn,
  decisionReplyTo,
  judgeReplyTo,
  promptOf,
} from "../judge-wire.ts";
import { postgresForSuite } from "../suite-postgres.ts";
import {
  readReuse,
  readReuseSet,
  theReuseSet,
  withEffort,
  type Effort,
  type ReuseSet,
} from "./reuse-set.ts";

const db = postgresForSuite();

type Replying = (body: string, set: ReuseSet) => Response;

const questionIn = (body: string): string =>
  /<question>\n([^<]*)\n<\/question>/.exec(promptOf(body))?.[1] ?? "";

const titlesOf = (set: ReuseSet, keys: readonly string[]): readonly string[] =>
  set.groups.flatMap(({ answers }) =>
    answers.flatMap(({ key, title }) => (keys.includes(key) ? [title] : [])),
  );

const judgingAsLabelled: Replying = (body, set) => {
  const asked = set.questions.find(({ question }) => question === questionIn(body));
  return new Response(judgeReplyTo(titlesOf(set, asked?.fits ?? []), body), { status: 200 });
};

const judgingAllFit: Replying = (body, set) =>
  new Response(
    judgeReplyTo(
      titlesOf(
        set,
        set.groups.flatMap(({ answers }) => answers.map(({ key }) => key)),
      ),
      body,
    ),
    {
      status: 200,
    },
  );

const judgingRefused: Replying = () =>
  new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "no" } }), {
    status: 400,
  });

const readWith = async (set: ReuseSet, replying: Replying, effort?: Effort) => {
  const sent: string[] = [];
  const client = openModelClient({
    fetch: withEffort(async (_input, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      sent.push(body);
      return replying(body, set);
    }, effort),
    clock: { now: () => new Date() },
    log: { info: () => {} },
  });
  const reading = await readReuse(db(), set, {
    model: "claude-sonnet-5-5",
    gbpPerMillionIn: "2",
    gbpPerMillionOut: "10",
    key: "sk-test-u14-invented-key-0001",
    callModel: client.callModel,
  });
  return { reading, sent };
};

describe("the reuse reading", () => {
  let set: ReuseSet;

  beforeAll(async () => {
    set = await theReuseSet();
  });

  it("counts every fit found and no negative taken", async () => {
    const { reading } = await readWith(set, judgingAsLabelled);

    expect({ ...reading, judgeMs: undefined }).toEqual({
      asked: 34,
      judged: 34,
      fits: { named: 32, yes: 32, no: 0, unsent: 0 },
      negatives: { named: 36, yes: 0, no: 36, unsent: 0 },
      othersTaken: 0,
      spentGbp: "0.14008",
      judgeMs: undefined,
      misses: [],
    });
    expect(reading.judgeMs.worst).toBeGreaterThanOrEqual(reading.judgeMs.median);
  }, 300_000);

  it("names each negative a judge wrongly takes", async () => {
    const { reading } = await readWith(set, judgingAllFit);

    expect([reading.fits, reading.negatives]).toEqual([
      { named: 32, yes: 32, no: 0, unsent: 0 },
      { named: 36, yes: 36, no: 0, unsent: 0 },
    ]);
    expect(reading.misses).toContain(
      'negative taken: "Where is customer data hosted on the Starter plan?" / "Where is customer data hosted on the Enterprise plan?"',
    );
    expect(reading.misses).toContain(
      'other Answer taken: "Which country is our data hosted in if we buy the Standard plan?" / "What uptime does the Standard plan commit to?"',
    );
  }, 300_000);

  it("counts a question whose judge failed apart from the tallies", async () => {
    const { reading } = await readWith(
      { ...set, questions: set.questions.slice(0, 2) },
      judgingRefused,
    );

    expect(reading).toMatchObject({
      asked: 2,
      judged: 0,
      fits: { named: 0, yes: 0, no: 0, unsent: 0 },
      negatives: { named: 0, yes: 0, no: 0, unsent: 0 },
      misses: [
        'judge judging-failed: "Which country is our data hosted in if we buy the Standard plan?"',
        'judge judging-failed: "On the Enterprise plan, can we choose the region where our data is hosted?"',
      ],
    });
  }, 300_000);

  it("reads a decision model's verdicts at its given threshold", async () => {
    const { client } = clientAnswering(async (body) => {
      const state = z.object({ state: z.string() }).parse(JSON.parse(body)).state;
      const asked = set.questions.find(({ question }) => question === state);
      const fits = titlesOf(set, asked?.fits ?? []);
      const yes = new Map([...decisionCandidatesIn(body).keys()].map((title) => [title, 0.6]));
      for (const title of fits) yes.set(title, 0.8);
      return new Response(decisionReplyTo(yes, body), { status: 200 });
    });
    const reading = (threshold: number) =>
      readReuse(db(), set, {
        provider: "cloudflare",
        model: "clef-flash",
        gbpPerMillionIn: "0.03",
        gbpPerMillionOut: "0",
        key: "0123456789abcdef0123456789abcdef:invented_Token-u15",
        decide: client.decide,
        threshold,
      });

    const [atSevenTenths, atHalf] = [await reading(0.7), await reading(0.5)];

    expect([atSevenTenths.fits, atSevenTenths.negatives]).toEqual([
      { named: 32, yes: 32, no: 0, unsent: 0 },
      { named: 36, yes: 0, no: 36, unsent: 0 },
    ]);
    expect(atHalf.negatives).toEqual({ named: 36, yes: 36, no: 0, unsent: 0 });
    expect(atSevenTenths.spentGbp).toBe("0.002448");
  }, 300_000);

  it("sends a lower effort beside the answer's format", async () => {
    const { sent } = await readWith(
      { ...set, questions: set.questions.slice(0, 1) },
      judgingAsLabelled,
      "low",
    );

    expect(sent.map((body) => JSON.parse(body).output_config)).toEqual([
      { format: expect.objectContaining({ type: "json_schema" }), effort: "low" },
    ]);
  }, 300_000);
});

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "reuse-set-"));
});

afterAll(() => rm(scratch, { recursive: true }));

const altered = (held: ReuseSet, question: object): unknown => {
  const [first, ...rest] = held.questions;
  return { ...held, questions: [{ ...first, ...question }, ...rest] };
};

describe("the reuse set's reader", () => {
  it.each([
    ["a question naming no fit and no negative", { fits: [], negatives: [] }],
    [
      "an Answer named as both fit and negative",
      { fits: ["uptime-standard"], negatives: ["uptime-standard"] },
    ],
    ["an Answer the set does not hold", { fits: ["no-such-answer"], negatives: [] }],
  ])("refuses %s", async (refused, question) => {
    const path = join(scratch, `${refused.replaceAll(" ", "-")}.json`);
    await writeFile(path, JSON.stringify(altered(await theReuseSet(), question)));

    expect((await readReuseSet(path)).ok).toBe(false);
  });

  it("reads the set with nothing changed", async () => {
    const path = join(scratch, "the-set-unchanged.json");
    await writeFile(path, JSON.stringify(altered(await theReuseSet(), {})));

    expect((await readReuseSet(path)).ok).toBe(true);
  });
});
