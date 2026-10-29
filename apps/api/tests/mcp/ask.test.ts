import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { asksTablesLockedAtOnce } from "@better-answers/core/testing/postgres";

import { entriesAt } from "../../src/mcp/entries/index.ts";
import {
  aModelWire,
  type Answering,
  anAdminAsking as anAdminAskingIn,
  AUDIT_ANSWERS,
  AUDIT_QUESTION as QUESTION,
  judgeSaying,
  judgingSetUp,
} from "../support/harness/harness-model.ts";
import { recordsIn as recordsOf } from "../support/harness/harness-questions.ts";
import { PUBLIC_URL } from "../support/harness/harness.ts";
import { rendered, structured } from "../support/mcp-call.ts";
import { appForSuite } from "../support/suite-app.ts";

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
  answers: z.array(
    z.object({ title: z.string(), body: z.string(), collection: z.string(), url: z.string() }),
  ),
  related: z.array(
    z.object({
      iri: z.string(),
      title: z.string(),
      body: z.string().optional(),
      evidence: z.array(z.unknown()).optional(),
    }),
  ),
  recordId: z.string(),
});

const recordsIn = (workspaceId: string) => recordsOf(app(), workspaceId);

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
    expect(answer.related.map(({ body, evidence }) => [body, evidence])).toEqual([
      [undefined, undefined],
    ]);
    const text = rendered(result);
    expect(text.split("\n")[0]).toBe("**Answered from the company's knowledge.**");
    expect(text).toContain(USERS.body);
    expect(text).toContain(SUPPLIER.body);
    expect(text).not.toContain(LMS.body);
    expect(text).not.toContain(RETENTION.body);
    expect(text).toContain(`- Answer · ${RETENTION.title} · audits · `);
    expect(text).toContain(` · ${answer.related[0]?.iri}`);
    expect(text).toContain(`Record of this question: ${answer.recordId}`);
    expect(Object.keys(structured(result)).slice(0, 3)).toEqual(["verdict", "recordId", "answers"]);
    for (const { url } of answer.answers) {
      expect(url).toMatch(/^https?:\/\/.+\/knowledge\//);
      expect(text).not.toContain(url);
    }
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

  it("answers related, judging failed, when the provider's credit runs out", async () => {
    const { workspaceId, asking } = await anAdminAsking();
    wire.answerWith(creditUsedUp);

    const result = await asking({ question: QUESTION });

    const answer = judged.parse(structured(result));
    expect([answer.verdict, answer.judgeState, answer.answers]).toEqual([
      "related",
      "judging-failed",
      [],
    ]);
    const inFull = [USERS, SUPPLIER, RETENTION, LMS].map(({ body }) => body);
    expect(answer.related.map(({ body }) => body?.trimEnd()).toSorted()).toEqual(inFull.toSorted());
    for (const body of inFull) expect(rendered(result)).toContain(body);
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

const A_RECORD = "01J6ZZZZZZZZZZZZZZZZZZZZZZ";

const THE_FIT = {
  iri: "https://better-answers.com/c/01FIT",
  url: `${PUBLIC_URL}/knowledge/search/01FIT`,
  kind: "Answer",
  title: "Who reads the audit log?",
  collection: "audits",
  trust: {
    tier: "human-reviewed",
    status: "current",
    checkedBy: "Priya Anand",
    checkedAt: "2026-05-02T09:00:00.000Z",
    rider: null,
  },
  trustWords: "Verified by Priya Anand · 2 May 2026",
  body: "Admins read it.\n",
  evidence: [],
};

const THE_PREVIEW = {
  iri: "https://better-answers.com/c/01PRE",
  url: `${PUBLIC_URL}/knowledge/search/01PRE`,
  kind: "Answer",
  title: "Which audit information do buyers see on the dashboard?",
  collection: "audits",
  trust: { tier: "unverified", status: "current", checkedBy: null, checkedAt: null, rider: null },
  trustWords: "Unverified",
};

const A_JUDGED_ANSWER = {
  verdict: "ok",
  recordId: A_RECORD,
  answers: [THE_FIT],
  judgeState: "judged",
  related: [THE_PREVIEW],
  conflicts: [],
  unmappedPassages: [],
  map: { state: "live" },
  collections: ["audits"],
  readableCollections: ["audits"],
};

describe("the ask entry's answer, from the wire to the text", () => {
  it("renders a fit in full, a preview as one line", () => {
    const entry = entriesAt(PUBLIC_URL).find(({ name }) => name === "ask");
    assert(entry !== undefined, "ask is composed");

    const wired = entry.output.parse(A_JUDGED_ANSWER);
    const lines = entry.render(wired).split("\n");

    expect(wired).toEqual(A_JUDGED_ANSWER);
    expect(lines.slice(0, 4)).toEqual([
      "**Answered from the company's knowledge.**",
      `Record of this question: ${A_RECORD}`,
      "Answers that fit, each word for word below:",
      `- audits · ${THE_FIT.title} · ${THE_FIT.iri}`,
    ]);
    const block = [`Question: ${THE_FIT.title}`, `_${THE_FIT.trustWords}_`, "", "Admins read it."];
    expect(lines.join("\n")).toContain(block.join("\n"));
    expect(lines.filter((line) => line.includes(THE_PREVIEW.title))).toEqual([
      `- Answer · ${THE_PREVIEW.title} · audits · Unverified · ${THE_PREVIEW.iri}`,
    ]);
    expect(lines.filter((line) => line.includes("/knowledge/"))).toEqual([]);
  });
});
