import { describe, expect, it } from "vitest";
import { z } from "zod";

import { asksTablesLockedAtOnce } from "@better-answers/core/testing/postgres";

import {
  aModelWire,
  anAdminAsking as anAdminAskingIn,
  AUDIT_ANSWERS,
  AUDIT_QUESTION as QUESTION,
  judgeSaying,
  judgingSetUp,
} from "./harness-model.ts";
import { recordsIn as recordsOf } from "./harness-questions.ts";
import { rendered, structured } from "./mcp-call.ts";
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

  it("answers related, judging failed, when the provider's credit runs out", async () => {
    const { workspaceId, asking } = await anAdminAsking();
    wire.answerWith(
      () =>
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
        ),
    );

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
