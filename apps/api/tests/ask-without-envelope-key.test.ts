import { describe, expect, it } from "vitest";
import { z } from "zod";

import { aModelWire, anAdminAsking, judgeSaying, judgingSetUp } from "./harness-model.ts";
import { structured } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";

const wire = aModelWire();

const app = appForSuite({ fetchModel: wire.fetch, envelopeKey: null });

const RETENTION = {
  title: "How long are audit logs kept?",
  collection: "audits",
  body: "Audit logs are kept for thirteen months.",
};

const judgeState = z.object({ verdict: z.string(), judgeState: z.string() });

describe("ask over MCP, on an api with no envelope key", () => {
  it("answers unjudged related knowledge and calls no model", async () => {
    const { workspaceId, asking } = await anAdminAsking(app(), [RETENTION]);
    await judgingSetUp(app(), workspaceId);
    wire.answerWith(judgeSaying([RETENTION.title]));

    const answer = await asking({ question: RETENTION.title });

    expect(judgeState.parse(structured(answer))).toEqual({
      verdict: "related",
      judgeState: "not-judged",
    });
    expect(wire.sent).toEqual([]);
    const kept = await app().database.superuser.query(
      "SELECT judge_state, completed_at IS NOT NULL AS completed FROM question_asked WHERE workspace_id = $1",
      [workspaceId],
    );
    expect(kept.rows).toEqual([{ judge_state: "not-judged", completed: true }]);
  });
});
