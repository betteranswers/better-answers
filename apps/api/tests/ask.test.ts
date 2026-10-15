import { describe, expect, it } from "vitest";
import { z } from "zod";

import { asksTablesLockedAtOnce } from "@better-answers/core/testing/postgres";

import {
  aModelWire,
  anAdminAsking as anAdminAskingIn,
  judgeSaying,
  judgingSetUp,
} from "./harness-model.ts";
import { rendered, structured } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";

const wire = aModelWire();

const app = appForSuite({ fetchModel: wire.fetch });

const USERS = {
  title: "How do buyers access audit information about their users' actions?",
  collection: "audits",
  body: "Buyers download their users' audit log from the console.",
};
const SUPPLIER = {
  title: "How do buyers access audit information about the supplier's actions?",
  collection: "audits",
  body: "The supplier sends its own audit report on request.",
};
const RETENTION = {
  title: "How long is audit information kept for buyers?",
  collection: "audits",
  body: "Audit information is kept for thirteen months.",
};
const LMS = {
  title: "How do buyers access audit information in the LMS?",
  collection: "lms",
  body: "The LMS exports its audit trail to buyers.",
};

const QUESTION = "How do buyers access audit information?";

/** A workspace holding the four `Answer`s, set to judge, and an assistant connected as its Admin. */
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

const recordsIn = async (workspaceId: string) => {
  const kept = await app().database.superuser.query(
    `SELECT r.verdict, r.judge_state, r.completed_at IS NOT NULL AS completed, c.question
       FROM question_asked r JOIN question_content c ON c.record_id = r.id
      WHERE r.workspace_id = $1`,
    [workspaceId],
  );
  return kept.rows;
};

describe("ask, judged over MCP", () => {
  it("AE1: returns both fits word for word, none from lms", async () => {
    const { asking } = await anAdminAsking();
    wire.answerWith(judgeSaying([USERS.title, SUPPLIER.title]));

    const result = await asking({ question: QUESTION, collections: ["audits"] });

    const answer = judged.parse(structured(result));
    expect([answer.verdict, answer.judgeState]).toEqual(["ok", "judged"]);
    expect(answer.answers.map(({ title, body }) => ({ title, body })).toSorted()).toEqual(
      // The seed ends a body with a newline, as a concept file does.
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
      { verdict: null, judge_state: null, completed: false, question: QUESTION },
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
      { verdict: "related", judge_state: "judging-failed", completed: true, question: QUESTION },
    ]);
  });
});
