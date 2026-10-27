import { assert, describe, expect, it } from "vitest";

import { ASK_CAPS, decisionJudgeCall } from "../../src/answering/index.ts";
import type { PlatformPrincipal, UserPrincipal } from "../../src/kernel/index.ts";
import { openModelKeySetting } from "../../src/llm/index.ts";
import { openPostgres } from "../../src/store/postgres/index.ts";
import {
  setDecisionThreshold,
  setModelKey,
  setModelPrice,
  setSpendingLimit,
} from "../../src/workspaces/index.ts";
import { principalFor } from "../fixtures/workspace-with-bundle.ts";
import {
  A_CANDIDATE,
  clientAnswering,
  decisionCandidatesIn,
  decisionReplyTo,
} from "../support/judge-wire.ts";
import { bootstrap, provisionedWorkspace } from "../support/platform.ts";
import { openReservationsIn, rowsFrom } from "../support/rows.ts";
import { answered, postgresForSuite, seedingWith } from "../support/suite-postgres.ts";
import {
  asked,
  conceptSeeded,
  reservationsRead,
  SUITE_ENVELOPE_KEY,
  type SeededConcept,
} from "./asking.ts";

const db = postgresForSuite();

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };

const CLEF_FLASH = "clef-flash";

const A_WORKERS_AI_KEY = "0123456789abcdef0123456789abcdef:invented_Token-u15";

const PLACEHOLDER_LONGEST_ANSWER_CHARACTERS = 3_000;

const thresholdStored = async (threshold: string, model = CLEF_FLASH) =>
  answered(
    await setDecisionThreshold(PLATFORM, openPostgres(db().pool), {
      provider: "cloudflare",
      model,
      threshold,
    }),
  );

const aDecidingWorkspace = async ({
  model = CLEF_FLASH,
  threshold = "0.7",
}: { readonly model?: string; readonly threshold?: string | null } = {}) => {
  const workspace = await provisionedWorkspace(db(), "Acme");
  const { workspaceId } = workspace;
  const door = openPostgres(db().pool);
  answered(
    await setModelPrice(PLATFORM, door, {
      provider: "cloudflare",
      model,
      effectiveFrom: "2026-01-01",
      gbpPerMillionIn: "0.03",
      gbpPerMillionOut: "0",
    }),
  );
  if (threshold !== null) await thresholdStored(threshold, model);
  await seedingWith(db().pool, (seed) =>
    seed.modelChoice({
      id: `judge-${workspaceId}`,
      workspaceId,
      purpose: "judging",
      provider: "cloudflare",
      model,
      dimensions: null,
    }),
  );
  answered(
    await setModelKey(bootstrap, door, openModelKeySetting(SUITE_ENVELOPE_KEY), {
      workspaceId,
      provider: "cloudflare",
      key: A_WORKERS_AI_KEY,
    }),
  );
  answered(await setSpendingLimit(PLATFORM, door, { workspaceId, gbp: "100" }));
  return { workspaceId, asker: await principalFor(db(), workspaceId, workspace.adminUserId) };
};

const anAnswer = (title: string, body: string): SeededConcept => ({
  collection: "audits",
  kind: "Answer",
  title,
  body,
});

const USERS = anAnswer(
  "How do buyers access audit information about their users' actions?",
  "Buyers download their users' audit log from the console.\n",
);
const SUPPLIER = anAnswer(
  "How do buyers access audit information about the supplier's actions?",
  "The supplier sends its own audit report on request.\n",
);

const QUESTION = "How do buyers access audit information?";

const decidingWire = (
  yes: ReadonlyMap<string, number>,
  during: () => Promise<void> = async () => {},
) =>
  clientAnswering(async (body) => {
    await during();
    return new Response(decisionReplyTo(yes, body), { status: 200 });
  });

type Wire = ReturnType<typeof decidingWire>;

const askedWith = (asker: UserPrincipal, wire: Wire) =>
  asked(db(), asker, { question: QUESTION }, { judging: { decideYesNo: wire.client.decideYesNo } });

const seededIn = async (workspaceId: string, shapes: readonly SeededConcept[]) => {
  for (const shape of shapes) await conceptSeeded(db(), workspaceId, shape);
};

const spendOf = async (workspaceId: string) => {
  const calls = await db().pool.query(
    "SELECT outcome, tokens_in, tokens_out, cost_gbp FROM llm_call WHERE workspace_id = $1",
    [workspaceId],
  );
  return { open: await openReservationsIn(db().pool, workspaceId), calls: rowsFrom(calls) };
};

const titlesOf = (concepts: readonly { readonly title: string }[]) =>
  concepts.map(({ title }) => title).toSorted();

const outcomeOf = async (
  answer: { readonly verdict: string; readonly judgeState: string },
  wire: Wire,
  workspaceId: string,
) => ({
  judged: [answer.verdict, answer.judgeState],
  sent: wire.sent,
  spend: await spendOf(workspaceId),
});

const FAILED_UNSENT = {
  judged: ["related", "judging-failed"],
  sent: [],
  spend: { open: 0, calls: [] },
};

describe("the decision judge's call", () => {
  const candidate = A_CANDIDATE;
  const ASK =
    "Does this approved answer answer the question in the state as it was asked? It does not if it answers a different question, a narrower or a wider one, or one about another product, module, plan or audience than the question names.";

  it("states the question, asking of each candidate apart", () => {
    const call = decisionJudgeCall("How long are audit logs kept?", [
      candidate,
      {
        ...candidate,
        title: "Who reads the audit log?",
        collection: null,
        body: "Admins read it.",
      },
    ]);

    expect(call.state).toBe("How long are audit logs kept?");
    expect(call.questions).toEqual({
      "1": {
        ask: ASK,
        collection: "audits",
        written_for: "How long are audit logs kept?",
        answer: "Audit logs are kept for thirteen months.",
      },
      "2": {
        ask: ASK,
        collection: "none",
        written_for: "Who reads the audit log?",
        answer: "Admins read it.",
      },
    });
    expect(call.withinMs).toBe(150_000);
  });

  it("reserves every byte stated and a little output each", () => {
    const call = decisionJudgeCall("Who pays the £50 fee?", [candidate, candidate]);

    expect(call.most).toEqual({ tokensIn: 2_778, tokensOut: 32 });
  });

  it("AE11: states a placeholder for a National Insurance number", () => {
    const call = decisionJudgeCall("Is my National Insurance number AB 12 34 56 C on file?", [
      candidate,
    ]);

    expect(call.state).toBe("Is my National Insurance number [withheld] on file?");
  });
});

describe("ask with a decision model", () => {
  it("sends the state and one question per candidate", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    await seededIn(workspaceId, [USERS]);
    const wire = decidingWire(new Map());

    await askedWith(asker, wire);

    expect(wire.sent.map(({ url }) => url)).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/cloudflare/clef-flash",
    ]);
    const [sent] = wire.sent;
    assert(sent !== undefined, "the decision call was sent");
    expect(JSON.parse(sent.body)).toEqual({
      model: "clef-flash",
      state: "How do buyers access audit information?",
      questions: {
        "1": {
          type: "noul",
          instructions: {
            ask: "Does this approved answer answer the question in the state as it was asked? It does not if it answers a different question, a narrower or a wider one, or one about another product, module, plan or audience than the question names.",
            collection: "audits",
            written_for: "How do buyers access audit information about their users' actions?",
            answer: "Buyers download their users' audit log from the console.",
          },
        },
      },
    });
  });

  it("takes a probability at the threshold as yes, below, no", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    await seededIn(workspaceId, [USERS, SUPPLIER]);
    const wire = decidingWire(
      new Map([
        [USERS.title, 0.7],
        [SUPPLIER.title, 0.699_999],
      ]),
    );

    const answer = await askedWith(asker, wire);

    expect([answer.verdict, answer.judgeState]).toEqual(["ok", "judged"]);
    expect(titlesOf(answer.answers)).toEqual([USERS.title]);
    expect(titlesOf(answer.related)).toEqual([SUPPLIER.title]);
  });

  it("judges at the threshold stored last, not the first", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    await seededIn(workspaceId, [USERS, SUPPLIER]);
    await thresholdStored("0.6");
    const wire = decidingWire(
      new Map([
        [USERS.title, 0.7],
        [SUPPLIER.title, 0.6],
      ]),
    );

    const answer = await askedWith(asker, wire);

    expect(titlesOf(answer.answers)).toEqual(titlesOf([USERS, SUPPLIER]));
  });

  it("fails judging, sending nothing, with no stored threshold", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace({ model: "clef", threshold: null });
    await seededIn(workspaceId, [USERS]);
    const wire = decidingWire(new Map([[USERS.title, 1]]));

    const answer = await askedWith(asker, wire);

    expect(await outcomeOf(answer, wire, workspaceId)).toEqual(FAILED_UNSENT);
    expect(wire.logged).toEqual([
      {
        line: {
          purpose: "judging",
          provider: "cloudflare",
          model: "clef",
          attempt: 0,
          status: null,
          read: "no-threshold",
          seconds: 0,
          request_id: null,
        },
        message: "llm: a model call never sent",
      },
    ]);
  });

  it("fails judging, sending nothing, over the model's window", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    const long = (title: string) => anAnswer(title, `${"Audit information. ".repeat(1_400)}\n`);
    await seededIn(workspaceId, [long(USERS.title), long(SUPPLIER.title), long(QUESTION)]);
    const wire = decidingWire(new Map());

    const answer = await askedWith(asker, wire);

    expect(await outcomeOf(answer, wire, workspaceId)).toEqual(FAILED_UNSENT);
  });

  it("sends twenty candidates at the longest Answer's placeholder length", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    const sentence = "Buyers read audit information in the console. ";
    const body = sentence.repeat(PLACEHOLDER_LONGEST_ANSWER_CHARACTERS / sentence.length + 1);
    const longest = Array.from({ length: ASK_CAPS.candidates }, (_none, place) =>
      anAnswer(
        `How do buyers access audit information, case ${String(place + 1)}?`,
        `${body.slice(0, PLACEHOLDER_LONGEST_ANSWER_CHARACTERS)}\n`,
      ),
    );
    await seededIn(workspaceId, longest);
    const wire = decidingWire(new Map());

    const answer = await askedWith(asker, wire);

    expect(answer.judgeState).toBe("judged");
    const [sent] = wire.sent;
    assert(sent !== undefined, "the decision call was sent");
    expect(wire.sent).toHaveLength(1);
    expect(decisionCandidatesIn(sent.body).size).toBe(20);
  });

  it("reserves the decision call's size, not the Messages call's", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    await seededIn(workspaceId, [USERS, SUPPLIER]);
    const { reserved, read } = reservationsRead(db(), workspaceId);

    await askedWith(asker, decidingWire(new Map(), read));

    expect(reserved).toEqual([32]);
  });

  it("settles a zero out-price at the input's cost alone", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    await seededIn(workspaceId, [USERS]);

    await askedWith(asker, decidingWire(new Map([[USERS.title, 0.9]])));

    expect(await spendOf(workspaceId)).toEqual({
      open: 0,
      calls: [{ outcome: "succeeded", tokens_in: 2_400, tokens_out: 3, cost_gbp: "0.000072" }],
    });
  });
});
