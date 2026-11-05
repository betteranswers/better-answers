import { describe, expect, it } from "vitest";
import { z } from "zod";

import { holdingTable, isBlockedOnTable, until } from "@better-answers/core/testing/postgres";
import { ulid } from "@better-answers/schema";

import { connectAsHost } from "../support/flow.ts";
import { conceptsSeeding, seedConcepts } from "../support/harness/harness-knowledge.ts";
import { feedbackKeptOn as feedbackOf } from "../support/harness/harness-questions.ts";
import type { TestClient } from "../support/harness/harness.ts";
import { calledTool, rendered, structured, toolAnswered, type Rpc } from "../support/mcp-call.ts";
import { landedOrTwoWaitOnALock, seededIn } from "../support/provoke.ts";
import { appForSuite } from "../support/suite-app.ts";

const app = appForSuite();

const FULL_SCOPE = "knowledge:read feedback:write offline_access";

const RETENTION_QUESTION = "How long are audit logs kept?";

const A_NOTE = "The period changed in May.";

const A_DISPUTED_SENTENCE = "Audit logs are kept for a year.";

const A_CONCEPT_NEVER_RETURNED = "https://better-answers.com/c/01ARZ3NDEKTSV4RRFFQ69G5FAV";

const NO_SUCH_RECORD = {
  content: [{ type: "text", text: "Refused: not-found (absent)." }],
  isError: true,
};

type Connected = { readonly client: TestClient; readonly token: string };

const connectAdmin = async () => {
  const workspace = await app().provision();
  const client = app().client();
  const tokens = await connectAsHost(app(), client, workspace.admin, { scope: FULL_SCOPE });
  await seedConcepts(
    app(),
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [{ title: RETENTION_QUESTION, body: "Audit logs are kept for thirteen months." }],
    }),
  );
  return { workspace, client, token: tokens.accessToken };
};

const connectViewer = async (workspaceId: string) => {
  const viewer = await app().person();
  await app().addMember(workspaceId, viewer.id, "Viewer");
  const client = app().client();
  const tokens = await connectAsHost(app(), client, viewer, { scope: FULL_SCOPE });
  return { viewer, client, token: tokens.accessToken };
};

const answered = z.object({
  recordId: z.string(),
  related: z.array(z.object({ iri: z.string() })),
});

const asked = async ({ client, token }: Connected) => {
  const said = await calledTool(client, token, "ask", { question: RETENTION_QUESTION });
  return answered.parse(structured(said));
};

const sendFeedback = ({ client, token }: Connected, feedback: Rpc): Promise<Rpc> =>
  toolAnswered(client, token, "give_feedback", feedback);

const feedbackKeptOn = (recordId: string) => feedbackOf(app(), recordId);

const queuedIn = async (workspaceId: string) => {
  const counted = await app().database.superuser.query<{ suggestions: number; jobs: number }>(
    `SELECT (SELECT count(*)::int FROM suggestion WHERE workspace_id = $1) AS suggestions,
            (SELECT count(*)::int FROM job WHERE workspace_id = $1) AS jobs`,
    [workspaceId],
  );
  return counted.rows[0];
};

const helpfulFrom = (userId: string) => ({
  given_by: `human:${userId}`,
  verdict: "helpful",
  reason: null,
  note: null,
  disputed_sentence: null,
  disputed_concept: null,
});

describe("give_feedback on a question record over MCP", () => {
  it("AE8: stores a flag with its disputed sentence, queues nothing", async () => {
    const host = await connectAdmin();
    const { workspace } = host;
    const { recordId, related } = await asked(host);
    const concept = related[0]?.iri;
    const before = await queuedIn(workspace.workspaceId);
    const feedback = {
      recordId,
      verdict: "flag",
      reason: "wrong",
      note: A_NOTE,
      disputed: { sentence: A_DISPUTED_SENTENCE, concept },
    };

    const said = await sendFeedback(host, feedback);

    expect(await feedbackKeptOn(recordId)).toEqual([
      {
        given_by: `human:${workspace.admin.id}`,
        verdict: "flag",
        reason: "wrong",
        note: A_NOTE,
        disputed_sentence: A_DISPUTED_SENTENCE,
        disputed_concept: concept,
      },
    ]);
    expect(await queuedIn(workspace.workspaceId)).toEqual(before);
    expect(structured(said)).toEqual({ outcome: "stored", feedback });
    expect(rendered(said)).toBe(
      `Stored on record ${recordId}: flagged as wrong — "${A_NOTE}", with the sentence disputed and the concept it rested on. No one is notified of it.`,
    );
  });

  it("stores a helpful verdict with no reason", async () => {
    const host = await connectAdmin();
    const { workspace } = host;
    const { recordId } = await asked(host);

    const said = await sendFeedback(host, { recordId, verdict: "helpful" });

    expect(await feedbackKeptOn(recordId)).toEqual([helpfulFrom(workspace.admin.id)]);
    expect(rendered(said)).toBe(
      `Stored on record ${recordId}: marked helpful. No one is notified of it.`,
    );
  });

  it("stores a second flag alongside the first", async () => {
    const host = await connectAdmin();
    const { recordId } = await asked(host);

    await sendFeedback(host, { recordId, verdict: "flag", reason: "incomplete", note: A_NOTE });
    await sendFeedback(host, { recordId, verdict: "flag", reason: "out-of-date" });

    expect((await feedbackKeptOn(recordId)).map(({ reason, note }) => [reason, note])).toEqual([
      ["incomplete", A_NOTE],
      ["out-of-date", null],
    ]);
  });

  it("refuses another member's record and a missing record identically", async () => {
    const host = await connectAdmin();
    const { workspace } = host;
    const { recordId } = await asked(host);
    const colleague = await connectViewer(workspace.workspaceId);

    const anothers = await sendFeedback(colleague, { recordId, verdict: "flag", reason: "wrong" });
    const missing = await sendFeedback(colleague, {
      recordId: ulid(),
      verdict: "flag",
      reason: "wrong",
    });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(anothers).toEqual(NO_SUCH_RECORD);
    expect(missing).toEqual(NO_SUCH_RECORD);
  });

  it("refuses a colleague's record as missing, whatever concept is disputed", async () => {
    const host = await connectAdmin();
    const { recordId } = await asked(host);
    const colleague = await connectViewer(host.workspace.workspaceId);

    const refused = await sendFeedback(colleague, {
      recordId,
      verdict: "flag",
      reason: "wrong",
      disputed: { sentence: A_DISPUTED_SENTENCE, concept: A_CONCEPT_NEVER_RETURNED },
    });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(refused).toEqual(NO_SUCH_RECORD);
  });

  it("refuses an Admin's feedback on a Viewer's record", async () => {
    const host = await connectAdmin();
    const colleague = await connectViewer(host.workspace.workspaceId);
    const { recordId } = await asked(colleague);

    const refused = await sendFeedback(host, { recordId, verdict: "flag", reason: "wrong" });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(refused).toEqual(NO_SUCH_RECORD);
  });

  it("refuses a note with a helpful verdict and stores nothing", async () => {
    const host = await connectAdmin();
    const { recordId } = await asked(host);

    const refused = await sendFeedback(host, { recordId, verdict: "helpful", note: A_NOTE });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(rendered(refused)).toBe("Refused: malformed (malformed). Fields: note wrong-type.");
  });

  it("refuses a record without a verdict as no such record", async () => {
    const host = await connectAdmin();
    const { workspace } = host;
    const open = await seededIn(app(), (seed) =>
      seed.questionAsked({
        workspaceId: workspace.workspaceId,
        askedBy: `human:${workspace.admin.id}`,
      }),
    );

    const refused = await sendFeedback(host, { recordId: open.id, verdict: "helpful" });

    expect(await feedbackKeptOn(open.id)).toEqual([]);
    expect(refused).toEqual(NO_SUCH_RECORD);
  });

  it("refuses a flag with a reason outside the four allowed", async () => {
    const host = await connectAdmin();
    const { recordId } = await asked(host);

    const refused = await sendFeedback(host, { recordId, verdict: "flag", reason: "rude" });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(refused["isError"]).toBe(true);
    expect(rendered(refused)).toContain("give_feedback: reason: ");
  });

  it("refuses a disputed concept the record never returned", async () => {
    const host = await connectAdmin();
    const { recordId } = await asked(host);
    const refused = await sendFeedback(host, {
      recordId,
      verdict: "flag",
      reason: "wrong",
      disputed: { sentence: A_DISPUTED_SENTENCE, concept: A_CONCEPT_NEVER_RETURNED },
    });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(rendered(refused)).toBe(
      "Refused: malformed (malformed). Fields: disputed.concept not-in-set.",
    );
  });

  it("makes a concurrent revocation wait until the feedback commits", async () => {
    const host = await connectAdmin();
    const { workspace } = host;
    const { recordId } = await asked(host);
    const store = app().database.superuser;
    const landed: string[] = [];

    const held = await holdingTable(store, "question_feedback", async () => {
      const giving = sendFeedback(host, { recordId, verdict: "helpful" }).then((said) => {
        landed.push("the feedback");
        return said;
      });
      await until(() => isBlockedOnTable(store, "question_feedback"));
      const revoking = app()
        .endEverySignInAndToken(workspace.admin.id, new Date(Date.now() + 1_000))
        .then(() => landed.push("the revocation"));
      await until(async () => landedOrTwoWaitOnALock(app(), landed));
      return { giving, revoking };
    });
    const said = await held.giving;
    await held.revoking;

    expect(landed).toEqual(["the feedback", "the revocation"]);
    expect(await feedbackKeptOn(recordId)).toEqual([helpfulFrom(workspace.admin.id)]);
    expect(said["isError"]).toBeUndefined();
  });
});
