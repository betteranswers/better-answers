import { fileURLToPath } from "node:url";

import { z } from "zod";

import { CANDIDATE_VERDICTS, type CandidateVerdict } from "@better-answers/schema";
import type { MigratedPostgres } from "@better-answers/schema/testing";

import type { PlatformPrincipal, Result, UserPrincipal } from "../../src/kernel/index.ts";
import {
  openModelKeySetting,
  type ModelCall,
  type ModelClient,
  type ModelOutcome,
  type ModelToCall,
} from "../../src/llm/index.ts";
import { openPostgres } from "../../src/store/postgres/index.ts";
import {
  setModelChoice,
  setModelKey,
  setModelPrice,
  setSpendingLimit,
} from "../../src/workspaces/index.ts";
import { asked, conceptSeeded, SUITE_ENVELOPE_KEY } from "../asking.ts";
import { percentile } from "../figures.ts";
import { bootstrap, provisionedWorkspace } from "../platform.ts";
import { readAs } from "../recall.ts";
import { answered } from "../suite-postgres.ts";
import { principalFor } from "../workspace-with-bundle.ts";

const REUSE_SET = fileURLToPath(new URL("../fixtures/reuse-set.json", import.meta.url));

const answerKey = z.string().regex(/^[a-z0-9-]+$/);

const reuseQuestion = z
  .strictObject({
    question: z.string().min(1).max(500),
    /** Each `Answer` that answers the question as asked. */
    fits: z.array(answerKey),
    /** Each `Answer` that differs from the question in one qualifier. */
    negatives: z.array(answerKey),
  })
  .refine(
    ({ fits, negatives }) => fits.length + negatives.length > 0,
    "a question names no fit and no negative, so it reads nothing",
  )
  .refine(
    ({ fits, negatives }) =>
      new Set([...fits, ...negatives]).size === fits.length + negatives.length,
    "a question names an Answer twice, or as both a fit and a negative",
  );

const reuseSet = z
  .strictObject({
    note: z.string(),
    groups: z
      .array(
        z.strictObject({
          group: answerKey,
          answers: z
            .array(
              z.strictObject({ key: answerKey, title: z.string().min(1), body: z.string().min(1) }),
            )
            .min(1),
        }),
      )
      .min(1),
    questions: z.array(reuseQuestion).min(1),
  })
  .refine(({ groups, questions }) => {
    const held = new Set(groups.flatMap(({ answers }) => answers.map(({ key }) => key)));
    return questions.every(({ fits, negatives }) =>
      [...fits, ...negatives].every((key) => held.has(key)),
    );
  }, "a question names an Answer the set does not hold");

export type ReuseSet = z.infer<typeof reuseSet>;
type ReuseQuestion = z.infer<typeof reuseQuestion>;

/** The set at `path`, refused when it cannot be read, is not JSON, or names what it lacks. */
export const readReuseSet = (path: string): Promise<Result<ReuseSet, Error>> =>
  readAs(path, reuseSet);

/** The repository's set; throws when it does not read, as a suite's setup should. */
export const theReuseSet = async (): Promise<ReuseSet> => {
  const read = await readReuseSet(REUSE_SET);
  if (!read.ok) throw new Error(`the reuse set did not read: ${read.error.message}`);
  return read.value;
};

/** The model a reading judges with, its price in pounds, its key, and the client that calls it. */
export type ReuseJudge = {
  readonly model: string;
  readonly gbpPerMillionIn: string;
  readonly gbpPerMillionOut: string;
  readonly key: string;
  readonly callModel: ModelClient["callModel"];
};

/** How the judge said of the `Answer`s a reading named one way. */
type Tally = {
  readonly named: number;
  readonly yes: number;
  readonly no: number;
  /** Never reached the judge: the entry step did not find it, or the candidate cap cut it. */
  readonly unsent: number;
};

export type ReuseReading = {
  readonly asked: number;
  /** The questions whose judge answered; the tallies count only these. */
  readonly judged: number;
  readonly fits: Tally;
  readonly negatives: Tally;
  /** `Answer`s judged to fit that the question names neither way. */
  readonly othersTaken: number;
  readonly spentGbp: string;
  /** Each judging call, its retries included, from the client's call to its outcome. */
  readonly judgeMs: { readonly median: number; readonly worst: number };
  /** One line for each fit missed, negative taken, other taken and question unjudged. */
  readonly misses: readonly string[];
};

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };

/** Every call in a reading is priced from this day, whatever day it runs. */
const PRICED_FROM = "2026-01-01";

/** Far above a reading's spend; a run that reaches it is refused rather than spending on. */
const LIMIT_GBP = "20";

/** A workspace set up as the RUNBOOK sets one: priced, limited, keyed, then the judge chosen. */
const judgingWorkspace = async (db: MigratedPostgres, judge: ReuseJudge) => {
  const workspace = await provisionedWorkspace(db, "Tallyloom");
  const { workspaceId } = workspace;
  const door = openPostgres(db.pool);
  const { model, gbpPerMillionIn, gbpPerMillionOut, key } = judge;
  const provider = "anthropic";
  answered(
    await setModelPrice(PLATFORM, door, {
      provider,
      model,
      effectiveFrom: PRICED_FROM,
      gbpPerMillionIn,
      gbpPerMillionOut,
    }),
  );
  answered(await setSpendingLimit(PLATFORM, door, { workspaceId, gbp: LIMIT_GBP }));
  const sealing = openModelKeySetting(SUITE_ENVELOPE_KEY);
  answered(await setModelKey(bootstrap, door, sealing, { workspaceId, provider, key }));
  answered(
    await setModelChoice(PLATFORM, door, {
      workspaceId,
      purpose: "judging",
      provider,
      model,
      now: new Date(),
    }),
  );
  return { workspaceId, asker: await principalFor(db, workspaceId, workspace.adminUserId) };
};

/** Each `Answer` of the set as a published concept, by its key; one at a time, as the seeder numbers paths. */
const landed = async (db: MigratedPostgres, workspaceId: string, set: ReuseSet) => {
  const iris = new Map<string, { readonly iri: string; readonly title: string }>();
  for (const { group, answers } of set.groups) {
    for (const { key, title, body } of answers) {
      const iri = await conceptSeeded(db, workspaceId, {
        collection: group,
        kind: "Answer",
        title,
        body: `${body}\n`,
      });
      iris.set(key, { iri, title });
    }
  }
  return iris;
};

const recordedConcepts = z.array(
  z.object({ iri: z.string(), judged: z.enum(CANDIDATE_VERDICTS).optional() }),
);

/** The judge's verdict on each concept the record keeps; one never sent has none. */
const verdictsIn = async (db: MigratedPostgres, recordId: string) => {
  const read = await db.pool.query("SELECT concepts FROM question_asked WHERE id = $1", [recordId]);
  const concepts = recordedConcepts.parse(read.rows[0]?.concepts);
  return new Map(concepts.map(({ iri, judged }) => [iri, judged]));
};

const spentIn = async (db: MigratedPostgres, workspaceId: string): Promise<string> => {
  const read = await db.pool.query(
    "SELECT coalesce(sum(cost_gbp), 0)::text AS spent FROM llm_call WHERE workspace_id = $1",
    [workspaceId],
  );
  return z.object({ spent: z.string() }).parse(read.rows[0]).spent;
};

type Verdict = CandidateVerdict | undefined;

/** What one judged question said of each `Answer` it names, and of the rest it took. */
type Heard = {
  readonly fits: readonly Verdict[];
  readonly negatives: readonly Verdict[];
  readonly othersTaken: number;
  readonly misses: readonly string[];
};

/** Each verdict that is a miss, by the side the question names the `Answer` on. */
const MISSED: ReadonlyMap<string, string> = new Map([
  ["fit no", "fit judged no"],
  ["fit unsent", "fit never sent"],
  ["negative yes", "negative taken"],
  ["negative unsent", "negative never sent"],
]);

type Landed = ReadonlyMap<string, { readonly iri: string; readonly title: string }>;

const heardOf = (
  { question, fits, negatives }: ReuseQuestion,
  verdicts: ReadonlyMap<string, Verdict>,
  answers: Landed,
): Heard => {
  const verdictOf = (key: string): Verdict => verdicts.get(answers.get(key)?.iri ?? "");
  const named = new Set([...fits, ...negatives].map((key) => answers.get(key)?.iri));
  const titles = new Map([...answers.values()].map(({ iri, title }) => [iri, title]));
  const others = [...verdicts].flatMap(([iri, verdict]) =>
    verdict === "yes" && !named.has(iri) ? [titles.get(iri) ?? iri] : [],
  );
  const missesOf = (keys: readonly string[], side: "fit" | "negative") =>
    keys.flatMap((key) => {
      const said = MISSED.get(`${side} ${verdictOf(key) ?? "unsent"}`);
      return said === undefined ? [] : [`${said}: "${question}" / "${answers.get(key)?.title}"`];
    });
  return {
    fits: fits.map(verdictOf),
    negatives: negatives.map(verdictOf),
    othersTaken: others.length,
    misses: [
      ...missesOf(fits, "fit"),
      ...missesOf(negatives, "negative"),
      ...others.map((title) => `other Answer taken: "${question}" / "${title}"`),
    ],
  };
};

const tallyOf = (verdicts: readonly Verdict[]): Tally => ({
  named: verdicts.length,
  yes: verdicts.filter((verdict) => verdict === "yes").length,
  no: verdicts.filter((verdict) => verdict === "no").length,
  unsent: verdicts.filter((verdict) => verdict === undefined).length,
});

/** The client's `callModel`, and the time each call took from start to outcome. */
const timedBy = (callModel: ModelClient["callModel"]) => {
  const times: number[] = [];
  const timed = async <T>(to: ModelToCall, call: ModelCall<T>): Promise<ModelOutcome<T>> => {
    const started = performance.now();
    const outcome = await callModel(to, call);
    times.push(performance.now() - started);
    return outcome;
  };
  return { timed, times };
};

type Asked = { readonly unjudged: string } | Heard;

const askedOne = async (
  db: MigratedPostgres,
  asker: UserPrincipal,
  callModel: ModelClient["callModel"],
  answers: Landed,
  asking: ReuseQuestion,
): Promise<Asked> => {
  const answer = await asked(db, asker, { question: asking.question }, { judging: { callModel } });
  // With no candidate, nothing was sent: its fits and negatives count as never sent.
  if (answer.judgeState === "judging-failed") {
    return { unjudged: `judge ${answer.judgeState}: "${asking.question}"` };
  }
  return heardOf(asking, await verdictsIn(db, answer.recordId), answers);
};

/**
 * Asks each question through the product's own `ask`, entry step and judge, in a workspace of its
 * own judging with `judge`.
 */
export const readReuse = async (
  db: MigratedPostgres,
  set: ReuseSet,
  judge: ReuseJudge,
): Promise<ReuseReading> => {
  const { workspaceId, asker } = await judgingWorkspace(db, judge);
  const answers = await landed(db, workspaceId, set);
  const { timed, times } = timedBy(judge.callModel);
  const read: Asked[] = [];
  for (const asking of set.questions) {
    read.push(await askedOne(db, asker, timed, answers, asking));
  }
  const heard = read.flatMap((one) => ("unjudged" in one ? [] : [one]));
  return {
    asked: set.questions.length,
    judged: heard.length,
    fits: tallyOf(heard.flatMap(({ fits }) => fits)),
    negatives: tallyOf(heard.flatMap(({ negatives }) => negatives)),
    othersTaken: heard.reduce((sum, { othersTaken }) => sum + othersTaken, 0),
    spentGbp: await spentIn(db, workspaceId),
    judgeMs: { median: percentile(times, 0.5), worst: Math.max(0, ...times) },
    misses: read.flatMap((one) => ("unjudged" in one ? [one.unjudged] : one.misses)),
  };
};

/** The effort levels a reading may ask for; `undefined` sends none, so the model's default stands. */
export type Effort = "low" | undefined;

const requestBody = z.looseObject({ output_config: z.looseObject({}).optional() });

/** Adds `output_config.effort` at the wire, beside the client's own fields, so the client stays as the product runs it. */
export const withEffort = (send: typeof fetch, effort: Effort): typeof fetch => {
  if (effort === undefined) return send;
  return async (input, init) => {
    const body = requestBody.parse(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
    const sent = { ...body, output_config: { ...body.output_config, effort } };
    return send(input, { ...init, body: JSON.stringify(sent) });
  };
};
