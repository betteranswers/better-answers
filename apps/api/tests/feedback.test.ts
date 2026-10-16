import { describe, expect, it } from "vitest";
import { z } from "zod";

import { holdingTable, isBlockedOnTable, until } from "@better-answers/core/testing/postgres";
import { ulid } from "@better-answers/schema";

import { connectAsHost } from "./flow.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import { feedbackKeptOn as feedbackOf } from "./harness-questions.ts";
import type { TestClient } from "./harness.ts";
import { calledTool, rendered, structured, toolAnswered, type Rpc } from "./mcp-call.ts";
import { seededIn, waitingOnALock } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const FULL_SCOPE = "knowledge:read feedback:write offline_access";

const RETENTION_QUESTION = "How long are audit logs kept?";

const A_NOTE = "The period changed in May.";

const A_DISPUTED_SENTENCE = "Audit logs are kept for a year.";

const A_CONCEPT_NEVER_RETURNED = "https://better-answers.com/c/01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** What the tool says of a record the caller may not give feedback on, whatever the reason. */
const NO_SUCH_RECORD = {
  content: [{ type: "text", text: "Refused: not-found (absent)." }],
  isError: true,
};

type Connected = { readonly client: TestClient; readonly token: string };

const connected = async () => {
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

const aColleagueIn = async (workspaceId: string) => {
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

const given = ({ client, token }: Connected, feedback: Rpc): Promise<Rpc> =>
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

describe("feedback an assistant sends on a record", () => {
  it("AE8: stores a flag with its sentence, queueing nothing", async () => {
    const host = await connected();
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

    const said = await given(host, feedback);

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

  it("stores helpful with no reason", async () => {
    const host = await connected();
    const { workspace } = host;
    const { recordId } = await asked(host);

    const said = await given(host, { recordId, verdict: "helpful" });

    expect(await feedbackKeptOn(recordId)).toEqual([helpfulFrom(workspace.admin.id)]);
    expect(rendered(said)).toBe(
      `Stored on record ${recordId}: marked helpful. No one is notified of it.`,
    );
  });

  it("stores a second flag beside the first", async () => {
    const host = await connected();
    const { recordId } = await asked(host);

    await given(host, { recordId, verdict: "flag", reason: "incomplete", note: A_NOTE });
    await given(host, { recordId, verdict: "flag", reason: "out-of-date" });

    expect((await feedbackKeptOn(recordId)).map(({ reason, note }) => [reason, note])).toEqual([
      ["incomplete", A_NOTE],
      ["out-of-date", null],
    ]);
  });

  it("refuses another member's record and a missing one alike", async () => {
    const host = await connected();
    const { workspace } = host;
    const { recordId } = await asked(host);
    const colleague = await aColleagueIn(workspace.workspaceId);

    const anothers = await given(colleague, { recordId, verdict: "flag", reason: "wrong" });
    const missing = await given(colleague, { recordId: ulid(), verdict: "flag", reason: "wrong" });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(anothers).toEqual(NO_SUCH_RECORD);
    expect(missing).toEqual(NO_SUCH_RECORD);
  });

  it("says nothing of a colleague's record, whatever concept is disputed", async () => {
    const host = await connected();
    const { recordId } = await asked(host);
    const colleague = await aColleagueIn(host.workspace.workspaceId);

    const refused = await given(colleague, {
      recordId,
      verdict: "flag",
      reason: "wrong",
      disputed: { sentence: A_DISPUTED_SENTENCE, concept: A_CONCEPT_NEVER_RETURNED },
    });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(refused).toEqual(NO_SUCH_RECORD);
  });

  it("refuses an Admin feedback on a Viewer's record", async () => {
    const host = await connected();
    const colleague = await aColleagueIn(host.workspace.workspaceId);
    const { recordId } = await asked(colleague);

    const refused = await given(host, { recordId, verdict: "flag", reason: "wrong" });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(refused).toEqual(NO_SUCH_RECORD);
  });

  it("refuses a note sent with helpful, storing nothing", async () => {
    const host = await connected();
    const { recordId } = await asked(host);

    const refused = await given(host, { recordId, verdict: "helpful", note: A_NOTE });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(rendered(refused)).toBe("Refused: malformed (malformed). Fields: note wrong-type.");
  });

  it("refuses a record with no verdict as one never asked", async () => {
    const host = await connected();
    const { workspace } = host;
    const open = await seededIn(app(), (seed) =>
      seed.questionAsked({
        workspaceId: workspace.workspaceId,
        askedBy: `human:${workspace.admin.id}`,
      }),
    );

    const refused = await given(host, { recordId: open.id, verdict: "helpful" });

    expect(await feedbackKeptOn(open.id)).toEqual([]);
    expect(refused).toEqual(NO_SUCH_RECORD);
  });

  it("refuses a flag with a reason outside the four", async () => {
    const host = await connected();
    const { recordId } = await asked(host);

    const refused = await given(host, { recordId, verdict: "flag", reason: "rude" });

    expect(await feedbackKeptOn(recordId)).toEqual([]);
    expect(refused["isError"]).toBe(true);
    expect(rendered(refused)).toContain("give_feedback: reason: ");
  });

  it("refuses a disputed concept the record never returned", async () => {
    const host = await connected();
    const { recordId } = await asked(host);
    const refused = await given(host, {
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

  it("holds a revocation of the member until its commit", async () => {
    const host = await connected();
    const { workspace } = host;
    const { recordId } = await asked(host);
    const store = app().database.superuser;
    const landed: string[] = [];

    const held = await holdingTable(store, "question_feedback", async () => {
      const giving = given(host, { recordId, verdict: "helpful" }).then((said) => {
        landed.push("the feedback");
        return said;
      });
      await until(() => isBlockedOnTable(store, "question_feedback"));
      const revoking = app()
        .endEverySignInAndToken(workspace.admin.id, new Date(Date.now() + 1_000))
        .then(() => landed.push("the revocation"));
      await until(async () => landed.length > 0 || (await waitingOnALock(app())) === 2);
      return { giving, revoking };
    });
    const said = await held.giving;
    await held.revoking;

    expect(landed).toEqual(["the feedback", "the revocation"]);
    expect(await feedbackKeptOn(recordId)).toEqual([helpfulFrom(workspace.admin.id)]);
    expect(said["isError"]).toBeUndefined();
  });
});
