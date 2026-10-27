import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { connectAsHost } from "./flow.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import {
  questionsSeeding,
  seedQuestions,
  staleTomorrow,
  wordsTwoDaysApart,
} from "./harness-questions.ts";
import { calledTool, structured, toolAnswered } from "./mcp-call.ts";
import { appForSuite, aStoppableClock } from "./suite-app.ts";
import { statusOf, webSignedIn } from "./web-client.ts";

const { clock, stopTheClock, moveTheClock } = aStoppableClock();

const app = appForSuite({ clock });

const FULL_SCOPE = "knowledge:read feedback:write offline_access";

const RETENTION_QUESTION = "How long are audit logs kept?";

const A_DISPUTED_SENTENCE = "Audit logs are kept for a year.";

const answered = z.object({
  recordId: z.string(),
  related: z.array(z.object({ iri: z.string() })),
});

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
  const read = await app().database.superuser.query<Record<string, unknown>>(
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
    assert(record !== undefined, "the admin reads the flagged record");
    const [feedback] = record.feedback;
    assert(feedback !== undefined, "the flagged record carries its flag");
    const feedbackId = feedback.id;

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
    const [record] = (await admin.questions.asked.query({})).records;
    assert(record !== undefined, "the admin reads the flagged record");
    const [feedback] = record.feedback;
    assert(feedback !== undefined, "the flagged record carries its flag");
    const feedbackId = feedback.id;
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

  it("words a record's trust by the app's clock", async () => {
    const workspace = await app().provision();
    const { concepts } = await seedConcepts(
      app(),
      conceptsSeeding.parse({
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        concepts: [
          {
            title: RETENTION_QUESTION,
            body: "Audit logs are kept for thirteen months.",
            frontmatter: { stale_after: staleTomorrow() },
          },
        ],
      }),
    );
    const [retention] = concepts;
    assert(retention !== undefined, "the retention concept was seeded");
    await seedQuestions(
      app(),
      questionsSeeding.parse({
        workspaceId: workspace.workspaceId,
        records: [
          {
            question: RETENTION_QUESTION,
            verdict: "related",
            concepts: [{ iri: retention.iri }],
          },
        ],
      }),
    );
    const { api } = await webSignedIn(app(), workspace.admin.email);
    const read = async () => (await api.questions.asked.query({})).records;

    expect(await wordsTwoDaysApart({ stopTheClock, moveTheClock }, read)).toEqual([
      "Unverified",
      "Out of date",
    ]);
  });
});
