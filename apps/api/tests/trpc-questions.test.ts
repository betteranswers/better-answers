import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectAsHost } from "./flow.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import { calledTool, structured, toolAnswered } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";
import { statusOf, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const FULL_SCOPE = "knowledge:read feedback:write offline_access";

const RETENTION_QUESTION = "How long are audit logs kept?";

const A_DISPUTED_SENTENCE = "Audit logs are kept for a year.";

const answered = z.object({
  recordId: z.string(),
  related: z.array(z.object({ iri: z.string() })),
});

/** An Admin who asked the retention question twice over MCP and flagged the first answer. */
const aFlaggedRecordAndANewerOne = async () => {
  const workspace = await app().provision();
  const client = app().client();
  const { accessToken: token } = await connectAsHost(app(), client, workspace.admin, {
    scope: FULL_SCOPE,
  });
  await seedConcepts(
    app(),
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [{ title: RETENTION_QUESTION, body: "Audit logs are kept for thirteen months." }],
    }),
  );
  const ask = async () =>
    answered.parse(
      structured(await calledTool(client, token, "ask", { question: RETENTION_QUESTION })),
    );
  const flagged = await ask();
  const concept = flagged.related[0]?.iri ?? "";
  await toolAnswered(client, token, "give_feedback", {
    recordId: flagged.recordId,
    verdict: "flag",
    reason: "wrong",
    disputed: { sentence: A_DISPUTED_SENTENCE, concept },
  });
  const newer = await ask();
  return { workspace, flagged: flagged.recordId, newer: newer.recordId, concept };
};

const eventsOn = async (feedbackId: string) => {
  const read = await app().database.superuser.query(
    "SELECT action, actor, detail FROM audit_event WHERE subject_id = $1",
    [feedbackId],
  );
  return read.rows;
};

describe("Questions asked over tRPC", () => {
  it("AE8: shows the flagged record first, with its sentence", async () => {
    const { workspace, flagged, newer, concept } = await aFlaggedRecordAndANewerOne();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const { records } = await api.questions.asked.query({});

    expect(records.map(({ id, flagged: isFlagged }) => [id, isFlagged])).toEqual([
      [flagged, true],
      [newer, false],
    ]);
    expect(records[0]?.feedback).toEqual([
      expect.objectContaining({
        verdict: "flag",
        reason: "wrong",
        disputed: { sentence: A_DISPUTED_SENTENCE, concept },
        closedAs: null,
      }),
    ]);
  });

  it("closes a flag, audits it, and unflags its record", async () => {
    const { workspace, flagged } = await aFlaggedRecordAndANewerOne();
    const { api } = await webSignedIn(app(), workspace.admin.email);
    const [record] = (await api.questions.asked.query({})).records;
    const feedbackId = record?.feedback[0]?.id ?? "";

    const closed = await api.questions.closeFlag.mutate({
      feedbackId,
      closedAs: "no-fault-in-the-knowledge",
    });

    expect(closed).toEqual({
      feedbackId,
      recordId: flagged,
      closedAs: "no-fault-in-the-knowledge",
    });
    expect(await eventsOn(feedbackId)).toEqual([
      {
        action: "knowledge.feedback.closed",
        actor: `human:${workspace.admin.id}`,
        detail: { recordId: flagged, closedAs: "no-fault-in-the-knowledge" },
      },
    ]);
    const after = (await api.questions.asked.query({})).records;
    expect(after.map(({ flagged: isFlagged }) => isFlagged)).toEqual([false, false]);
  });

  it.each(["Editor", "Viewer"] as const)("refuses an %s the read and the closing", async (role) => {
    const { workspace } = await aFlaggedRecordAndANewerOne();
    const { api: admin } = await webSignedIn(app(), workspace.admin.email);
    const feedbackId = (await admin.questions.asked.query({})).records[0]?.feedback[0]?.id ?? "";
    const member = await app().person();
    await app().addMember(workspace.workspaceId, member.id, role);
    const { api } = await webSignedIn(app(), member.email);

    const refused = [
      await statusOf(api.questions.asked.query({})),
      await statusOf(
        api.questions.closeFlag.mutate({ feedbackId, closedAs: "fixed-in-the-knowledge" }),
      ),
    ];

    expect(refused).toEqual([403, 403]);
    expect(await eventsOn(feedbackId)).toEqual([]);
  });
});
