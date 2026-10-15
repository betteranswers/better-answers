import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectAsHost } from "./flow.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import { aModelWire, judgeSaying, judgingSetUp } from "./harness-model.ts";
import { structured, toolAnswered } from "./mcp-call.ts";
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
    const workspace = await app().provision();
    await seedConcepts(
      app(),
      conceptsSeeding.parse({
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        concepts: [RETENTION],
      }),
    );
    await app().database.superuser.query("ANALYZE map_node, map_edge");
    await judgingSetUp(app(), workspace.workspaceId);
    wire.answerWith(judgeSaying([RETENTION.title]));
    const client = app().client();
    const tokens = await connectAsHost(app(), client, workspace.admin, {
      scope: "knowledge:read offline_access",
    });

    const answer = await toolAnswered(client, tokens.accessToken, "ask", {
      question: RETENTION.title,
    });

    expect(judgeState.parse(structured(answer))).toEqual({
      verdict: "related",
      judgeState: "not-judged",
    });
    expect(wire.sent).toEqual([]);
    const kept = await app().database.superuser.query(
      "SELECT judge_state, completed_at IS NOT NULL AS completed FROM question_asked WHERE workspace_id = $1",
      [workspace.workspaceId],
    );
    expect(kept.rows).toEqual([{ judge_state: "not-judged", completed: true }]);
  });
});
