import { describe, expect, it } from "vitest";
import { z } from "zod";

import { answerOutputWith, ASK_CAPS } from "@better-answers/core/answering";
import { asksTablesLockedAtOnce } from "@better-answers/core/testing/postgres";

import {
  aModelWire,
  type Answering,
  anAdminAsking as anAdminAskingIn,
  AUDIT_ANSWERS,
  AUDIT_QUESTION as QUESTION,
  judgeSaying,
  judgingSetUp,
} from "./harness-model.ts";
import { recordsIn as recordsOf } from "./harness-questions.ts";
import { rendered, structured, type Rpc } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";

const wire = aModelWire();

const app = appForSuite({ fetchModel: wire.fetch });

const { users: USERS, supplier: SUPPLIER, retention: RETENTION, lms: LMS } = AUDIT_ANSWERS;

const anAdminAsking = async (limitGbp?: string) => {
  const asking = await anAdminAskingIn(app(), [USERS, SUPPLIER, RETENTION, LMS]);
  await judgingSetUp(app(), asking.workspaceId, limitGbp === undefined ? {} : { limitGbp });
  return asking;
};

const judged = z.object({
  verdict: z.string(),
  judgeState: z.string(),
  answers: z.array(z.object({ title: z.string(), body: z.string(), collection: z.string() })),
  related: z.array(z.object({ title: z.string() })),
  recordId: z.string(),
});

const recordsIn = (workspaceId: string) => recordsOf(app(), workspaceId);

const sized = (sentence: string, characters: number): string =>
  sentence
    .repeat(Math.ceil(characters / sentence.length))
    .slice(0, characters)
    .trimEnd();

const anAnswer = (title: string, sentence: string, characters: number) => ({
  title,
  collection: "audits",
  trust: "human-reviewed",
  body: sized(sentence, characters),
});

const A_FIT_UNLINKED = anAnswer(
  SUPPLIER.title,
  "The supplier sends its own audit report on request. ",
  700,
);

const A_FIT_LINKED = anAnswer(
  USERS.title,
  "Buyers download their users' audit log from the console. ",
  700,
);

const FITS = [A_FIT_LINKED, A_FIT_UNLINKED];

const RELATED_ANSWERS = [
  anAnswer(
    "How do buyers export audit information for a tender?",
    "A tender pack holds an export of the audit trail. ",
    7_000,
  ),
  anAnswer(
    "Which audit information do buyers see on the dashboard?",
    "The dashboard shows the last thirty days of activity. ",
    4_000,
  ),
  ...Array.from({ length: ASK_CAPS.candidates - FITS.length - 1 }, (_, nth) =>
    anAnswer(
      `Can buyers access audit information for module ${String(nth)}?`,
      `Module ${String(nth)} keeps its own activity record for buyers. `,
      700,
    ),
  ),
];

const OTHER_CONCEPTS = Array.from({ length: 4 }, (_, nth) => ({
  title: `Audit policy ${String(nth)}`,
  collection: "audits",
  kind: "Policy",
  body: sized("Audit information is handled under the audit policy. ", 2_000),
}));

const A_QUESTION_ANSWERED_TWICE = [
  ...RELATED_ANSWERS,
  ...OTHER_CONCEPTS,
  A_FIT_UNLINKED,
  { ...A_FIT_LINKED, linksTo: [...RELATED_ANSWERS, ...OTHER_CONCEPTS].map(({ title }) => title) },
];

const CLAUDE_CODE_INLINE_RESULT_CHARACTERS = 50_000;

const shaped = answerOutputWith(z.unknown());

const askedOver = async (
  concepts: readonly Rpc[],
  judging: { readonly chosen?: boolean },
  judge: Answering = judgeSaying(FITS.map(({ title }) => title)),
) => {
  const { workspaceId, asking } = await anAdminAskingIn(app(), concepts);
  await judgingSetUp(app(), workspaceId, judging);
  wire.answerWith(judge);
  const result = await asking({ question: QUESTION, collections: ["audits"] });
  return { result, text: rendered(result), answer: shaped.parse(structured(result)) };
};

/** Anthropic's refusal once the account's credit is used up. */
const creditUsedUp: Answering = () =>
  new Response(
    JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
    }),
    { status: 400 },
  );

const judgedOverAE1 = () => askedOver(A_QUESTION_ANSWERED_TWICE, {});

describe("ask, judged over MCP", () => {
  it("AE1: returns both fits word for word, none from lms", async () => {
    const { asking } = await anAdminAsking();
    wire.answerWith(judgeSaying([USERS.title, SUPPLIER.title]));

    const result = await asking({ question: QUESTION, collections: ["audits"] });

    const answer = judged.parse(structured(result));
    expect([answer.verdict, answer.judgeState]).toEqual(["ok", "judged"]);
    expect(answer.answers.map(({ title, body }) => ({ title, body })).toSorted()).toEqual(
      [USERS, SUPPLIER].map(({ title, body }) => ({ title, body: `${body}\n` })).toSorted(),
    );
    expect(answer.related.map(({ title }) => title)).toEqual([RETENTION.title]);
    const text = rendered(result);
    expect(text.split("\n")[0]).toBe("**Answered from the company's knowledge.**");
    expect(text).toContain(USERS.body);
    expect(text).toContain(SUPPLIER.body);
    expect(text).not.toContain(LMS.body);
    expect(text).toContain(`Record of this question: ${answer.recordId}`);
  });

  it("holds no connection while the judge is called", async () => {
    const { asking } = await anAdminAsking();
    const contended: string[] = [];
    wire.answerWith(async (sent) => {
      contended.push(await asksTablesLockedAtOnce(app().database.superuser));
      return judgeSaying([USERS.title])(sent);
    });

    const answer = judged.parse(structured(await asking({ question: QUESTION })));

    expect(contended).toEqual(["locked"]);
    expect(answer.verdict).toBe("ok");
  });

  it("AE9: refuses at the spending limit and keeps the question", async () => {
    const { workspaceId, asking } = await anAdminAsking("0.001");
    wire.answerWith(judgeSaying([USERS.title]));
    const before = wire.sent.length;

    const result = await asking({ question: QUESTION });

    expect(result["isError"]).toBe(true);
    expect(rendered(result)).toContain("spending-limit-met");
    expect(wire.sent.slice(before)).toEqual([]);
    expect(await recordsIn(workspaceId)).toEqual([
      { transport: "mcp", verdict: null, judge_state: null, completed: false, question: QUESTION },
    ]);
  });

  it("shows a judged-no `Answer` as a preview in both copies", async () => {
    const { result, text, answer } = await judgedOverAE1();

    const relatedAnswers = answer.related.filter(({ kind }) => kind === "Answer");
    expect(relatedAnswers.map(({ title }) => title).toSorted()).toEqual(
      RELATED_ANSWERS.map(({ title }) => title).toSorted(),
    );
    expect(answer.related.filter((concept) => "body" in concept || "evidence" in concept)).toEqual(
      [],
    );
    for (const { body } of RELATED_ANSWERS.slice(0, 2)) expect(text).not.toContain(body);
    for (const { title, iri } of relatedAnswers) {
      expect(text).toContain(`- Answer · ${title} · audits · `);
      expect(text).toContain(` · ${iri}`);
    }
    expect(JSON.stringify(structured(result)).length).toBeLessThan(
      CLAUDE_CODE_INLINE_RESULT_CHARACTERS,
    );
    expect(JSON.stringify(result).length).toBeLessThan(CLAUDE_CODE_INLINE_RESULT_CHARACTERS);
  });

  it.each([
    ["not judged", { chosen: false }, undefined, "not-judged"],
    ["judging failed", {}, creditUsedUp, "judging-failed"],
  ] as const)(
    "keeps `Answer`s in full in both copies when %s",
    async (_, judging, judge, state) => {
      const { text, answer } = await askedOver(A_QUESTION_ANSWERED_TWICE, judging, judge);

      expect([answer.verdict, answer.judgeState, answer.answers]).toEqual(["related", state, []]);
      const inFull = answer.related.filter(({ kind }) => kind === "Answer");
      expect(inFull.map(({ title }) => title).toSorted()).toEqual(
        [...RELATED_ANSWERS, ...FITS].map(({ title }) => title).toSorted(),
      );
      for (const { body } of inFull) {
        expect(body).toBeDefined();
        expect(text).toContain(body?.trimEnd());
      }
    },
  );

  it("keeps a fit word for word with who verified it", async () => {
    const { text, answer } = await judgedOverAE1();

    const fit = shaped.shape.answers.element.parse(
      answer.answers.find(({ title }) => title === A_FIT_UNLINKED.title),
    );
    expect(fit.body).toBe(`${A_FIT_UNLINKED.body}\n`);
    expect(fit.trustWords).toMatch(/^Verified by Test person · /);
    expect(text).toContain(
      [`Question: ${fit.title}`, `_${fit.trustWords}_`, "", A_FIT_UNLINKED.body].join("\n"),
    );
  });

  it("follows the verdict with the record id and the fits", async () => {
    const { result, text, answer } = await judgedOverAE1();

    expect(text.split("\n").slice(0, 5)).toEqual([
      "**Answered from the company's knowledge.**",
      `Record of this question: ${answer.recordId}`,
      "Answers that fit, each word for word below:",
      ...answer.answers.map(({ title, iri }) => `- audits · ${title} · ${iri}`),
    ]);
    expect(Object.keys(structured(result)).slice(0, 3)).toEqual(["verdict", "recordId", "answers"]);
  });

  it("names one link per concept in the text, the iri", async () => {
    const { text, answer } = await judgedOverAE1();

    for (const concept of answer.related) expect(text.split(concept.iri)).toHaveLength(2);
    for (const concept of [...answer.answers, ...answer.related]) {
      expect(concept.url).toMatch(/^https?:\/\/.+\/knowledge\//);
      expect(text).not.toContain(concept.url);
    }
  });

  it("answers related, judging failed, when the provider's credit runs out", async () => {
    const { workspaceId, asking } = await anAdminAsking();
    wire.answerWith(creditUsedUp);

    const answer = judged.parse(structured(await asking({ question: QUESTION })));

    expect([answer.verdict, answer.judgeState, answer.answers]).toEqual([
      "related",
      "judging-failed",
      [],
    ]);
    expect(await recordsIn(workspaceId)).toEqual([
      {
        transport: "mcp",
        verdict: "related",
        judge_state: "judging-failed",
        completed: true,
        question: QUESTION,
      },
    ]);
  });
});
