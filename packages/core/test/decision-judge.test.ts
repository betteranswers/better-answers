import { describe, expect, it } from "vitest";

import { conceptIriOf } from "@better-answers/schema";

import {
  ASK_CAPS,
  decisionJudgeCall,
  type AskCaps,
  type DecisionThresholds,
  type ReturnedConcept,
} from "../src/answering/index.ts";
import type { PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import { openModelClient, openModelKeySetting } from "../src/llm/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { setModelKey, setModelPrice, setSpendingLimit } from "../src/workspaces/index.ts";
import { asked, conceptSeeded, SUITE_ENVELOPE_KEY, type SeededConcept } from "./asking.ts";
import { decisionCandidatesIn, decisionReplyTo } from "./judge-wire.ts";
import { bootstrap, provisionedWorkspace } from "./platform.ts";
import { answered, postgresForSuite, seedingWith } from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

const db = postgresForSuite();

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-ops" };

const CLEF_FLASH = "clef-flash";

/** Invented: an account id, a colon, then a token. */
const A_WORKERS_AI_KEY = "0123456789abcdef0123456789abcdef:invented_Token-u15";

/** The suite's own: no decision model's threshold is calibrated. */
const AT_SEVEN_TENTHS: DecisionThresholds = new Map([["cloudflare", new Map([[CLEF_FLASH, 0.7]])]]);

const CAPS: AskCaps = { ...ASK_CAPS, decisionThresholds: AT_SEVEN_TENTHS };

/**
 * A placeholder until the owner measures the real bundle's longest `Answer`s: about 500 words,
 * as a long answer on a procurement form runs.
 */
const PLACEHOLDER_LONGEST_ANSWER_CHARACTERS = 3_000;

/** A workspace whose Admin asks, judging on Clef-flash with a key, priced for input alone. */
const aDecidingWorkspace = async () => {
  const workspace = await provisionedWorkspace(db(), "Acme");
  const { workspaceId } = workspace;
  const door = openPostgres(db().pool);
  answered(
    await setModelPrice(PLATFORM, door, {
      provider: "cloudflare",
      model: CLEF_FLASH,
      effectiveFrom: "2026-01-01",
      gbpPerMillionIn: "0.03",
      gbpPerMillionOut: "0",
    }),
  );
  await seedingWith(db().pool, (seed) =>
    seed.modelChoice({
      id: `judge-${workspaceId}`,
      workspaceId,
      purpose: "judging",
      provider: "cloudflare",
      model: CLEF_FLASH,
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

type Sent = { readonly url: string; readonly body: string };

/** Workers AI at the wire, answering each candidate the probability `yes` holds for its title. */
const decidingWire = (
  yes: ReadonlyMap<string, number>,
  during: () => Promise<void> = async () => {},
) => {
  const sent: Sent[] = [];
  const client = openModelClient({
    fetch: async (input, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      sent.push({ url: input instanceof Request ? input.url : input.toString(), body });
      await during();
      return new Response(decisionReplyTo(yes, body), { status: 200 });
    },
    clock: { now: () => new Date() },
    log: { info: () => {} },
  });
  return { sent, client };
};

type Wire = ReturnType<typeof decidingWire>;

const askedWith = (asker: UserPrincipal, wire: Wire, caps: AskCaps = CAPS) =>
  asked(db(), asker, { question: QUESTION }, { judging: { decide: wire.client.decide }, caps });

const seededIn = async (workspaceId: string, shapes: readonly SeededConcept[]) => {
  for (const shape of shapes) await conceptSeeded(db(), workspaceId, shape);
};

const spendOf = async (workspaceId: string) => {
  const reservations = await db().pool.query(
    "SELECT count(*)::integer AS open FROM spend_reservation WHERE workspace_id = $1",
    [workspaceId],
  );
  const calls = await db().pool.query(
    "SELECT outcome, tokens_in, tokens_out, cost_gbp FROM llm_call WHERE workspace_id = $1",
    [workspaceId],
  );
  return { open: reservations.rows[0]?.open, calls: calls.rows };
};

const titlesOf = (concepts: readonly { readonly title: string }[]) =>
  concepts.map(({ title }) => title).toSorted();

describe("the decision judge's call", () => {
  const candidate: ReturnedConcept = {
    iri: conceptIriOf("01J6AAAAAAAAAAAAAAAAAAAAAA"),
    url: "/knowledge/search/01J6AAAAAAAAAAAAAAAAAAAAAA",
    kind: "Answer",
    title: "How long are audit logs kept?",
    collection: "audits",
    body: "Audit logs are kept for thirteen months.\n",
    trust: {
      tier: "unverified",
      status: "current",
      verifiedBy: null,
      verifiedAt: null,
      rider: null,
    },
    trustWords: "Unverified",
    evidence: [],
  };
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

    // 778 bytes of state and questions as JSON (the pound sign is two), 2,000 of framing.
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
    expect(JSON.parse(wire.sent[0]?.body ?? "")).toEqual({
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

  it("fails judging, sending nothing, with no stored threshold", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    await seededIn(workspaceId, [USERS]);
    const wire = decidingWire(new Map([[USERS.title, 1]]));
    const elsewhere: DecisionThresholds = new Map([["cloudflare", new Map([["clef", 0.7]])]]);

    const answer = await askedWith(asker, wire, { ...ASK_CAPS, decisionThresholds: elsewhere });

    expect([answer.verdict, answer.judgeState]).toEqual(["related", "judging-failed"]);
    expect(wire.sent).toEqual([]);
    expect(await spendOf(workspaceId)).toEqual({ open: 0, calls: [] });
  });

  it("fails judging, sending nothing, over the model's window", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    const long = (title: string) => anAnswer(title, `${"Audit information. ".repeat(1_400)}\n`);
    await seededIn(workspaceId, [long(USERS.title), long(SUPPLIER.title), long(QUESTION)]);
    const wire = decidingWire(new Map());

    const answer = await askedWith(asker, wire);

    expect([answer.verdict, answer.judgeState]).toEqual(["related", "judging-failed"]);
    expect(wire.sent).toEqual([]);
    expect(await spendOf(workspaceId)).toEqual({ open: 0, calls: [] });
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
    expect(wire.sent).toHaveLength(1);
    expect(decisionCandidatesIn(wire.sent[0]?.body ?? "").size).toBe(20);
  });

  it("reserves the decision call's size, not the Messages call's", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    await seededIn(workspaceId, [USERS, SUPPLIER]);
    const reserved: unknown[] = [];
    const readReservation = async () => {
      const open = await db().pool.query(
        "SELECT tokens_out FROM spend_reservation WHERE workspace_id = $1",
        [workspaceId],
      );
      reserved.push(...open.rows.map((row) => row.tokens_out));
    };

    await askedWith(asker, decidingWire(new Map(), readReservation));

    expect(reserved).toEqual([32]);
  });

  it("settles a zero out-price at the input's cost alone", async () => {
    const { workspaceId, asker } = await aDecidingWorkspace();
    await seededIn(workspaceId, [USERS]);

    await askedWith(asker, decidingWire(new Map([[USERS.title, 0.9]])));

    // 2,400 tokens in at £0.03 a million; the 3 out are priced at nothing.
    expect(await spendOf(workspaceId)).toEqual({
      open: 0,
      calls: [{ outcome: "succeeded", tokens_in: 2_400, tokens_out: 3, cost_gbp: "0.000072" }],
    });
  });
});
