import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { until } from "@better-answers/core/testing/postgres";

import { askedFrom } from "../../../../web/src/shared/api/ask-stream.ts";
import { appForSuite } from "../suite-app.ts";
import { anAdminOnTheWeb } from "../web-client.ts";
import { scriptedModels } from "./harness-asking.ts";
import { harnessControl } from "./harness-control.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import { AUDIT_ANSWERS, AUDIT_QUESTION as QUESTION } from "./harness-model.ts";

const models = scriptedModels();

const app = appForSuite({ fetchModel: models.fetch });

const { users: USERS, supplier: SUPPLIER } = AUDIT_ANSWERS;

const POLICY = {
  title: "Audit information access for buyers",
  collection: "audits",
  kind: "Policy",
  body: "Buyers access audit information through the console's audit page.",
};

const harness = (path: string, init?: RequestInit) =>
  new Hono().route("/", harnessControl(app(), models)).request(path, init);

const posted = (path: string, body: Readonly<Record<string, unknown>>) =>
  harness(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const scripted = async (script: Readonly<Record<string, unknown>>) => {
  expect((await posted("/__harness/asking", script)).status).toBe(200);
};

const released = (workspaceId: string) => posted("/__harness/asking/releases", { workspaceId });

const SENTENCE = "Buyers use the console's audit page.";

const DRAFTING = { writes: [{ citing: POLICY.title, sentence: SENTENCE }] };

const calls = z.object({ judge: z.number(), draft: z.number() });

const callsTo = async (workspaceId: string) =>
  calls.parse(await (await harness(`/__harness/asking/calls?workspaceId=${workspaceId}`)).json());

const anAdminAsking = async () => {
  const { workspace, api } = await anAdminOnTheWeb(app());
  await seedConcepts(
    app(),
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [USERS, SUPPLIER, POLICY],
    }),
  );
  return { workspaceId: workspace.workspaceId, api };
};

type Web = Awaited<ReturnType<typeof anAdminAsking>>["api"];

const kept = z.object({ drafted: z.array(z.unknown()).nullable() });

const draftedOn = async (recordId: string): Promise<readonly unknown[]> => {
  const found = await app().database.superuser.query(
    "SELECT drafted FROM question_content WHERE record_id = $1",
    [recordId],
  );
  return kept.parse(found.rows[0] ?? { drafted: null }).drafted ?? [];
};

const keptAtEachHeldSentence = async (api: Web, workspaceId: string) => {
  let recordId = "";
  const keptWhileHeld: number[] = [];
  for await (const event of await api.ask.question.mutate({ question: QUESTION })) {
    if (event.kind === "result") recordId = event.result.recordId;
    if (event.kind !== "sentence") continue;
    keptWhileHeld.push((await draftedOn(recordId)).length);
    await released(workspaceId);
  }
  return { recordId, keptWhileHeld };
};

const streamed = async (api: Web) => {
  const events = [];
  for await (const event of await api.ask.question.mutate({ question: QUESTION })) {
    events.push(event);
  }
  return askedFrom(events);
};

describe("the browser suite's scripted model", () => {
  it("answers each workspace's judge by its own script", async () => {
    const fitting = await anAdminAsking();
    const fittingNone = await anAdminAsking();
    await scripted({ workspaceId: fitting.workspaceId, judging: { fits: [USERS.title] } });
    await scripted({ workspaceId: fittingNone.workspaceId, judging: { fits: [] } });

    const [one, other] = await Promise.all([streamed(fitting.api), streamed(fittingNone.api)]);

    expect(one).toMatchObject({ verdict: "ok", judgeState: "judged" });
    expect(one?.answers.map(({ title }) => title)).toEqual([USERS.title]);
    expect(other).toMatchObject({ verdict: "related", judgeState: "judged", answers: [] });
  });

  it("drafts the scripted sentence, cited by its concept's number", async () => {
    const { workspaceId, api } = await anAdminAsking();
    await scripted({ workspaceId, judging: { fits: [] }, drafting: DRAFTING });

    const asked = await streamed(api);

    const policy = asked?.related.find(({ title }) => title === POLICY.title)?.iri;
    expect(asked?.prose).toEqual([
      {
        collection: "audits",
        sentences: [{ sentence: SENTENCE, concepts: [policy] }],
        outcome: "drafted",
      },
    ]);
    expect(await callsTo(workspaceId)).toEqual({ judge: 1, draft: 1 });
  });

  it("holds the judge's answer until the spec releases it", async () => {
    const { workspaceId, api } = await anAdminAsking();
    await scripted({ workspaceId, judging: { fits: [USERS.title] }, holds: "judge" });
    let answered = false;

    const asking = streamed(api).then((asked) => {
      answered = true;
      return asked;
    });
    await until(async () => (await callsTo(workspaceId)).judge === 1);
    expect(answered).toBe(false);
    const release = await released(workspaceId);

    expect(await release.json()).toEqual({ released: true });
    expect(await asking).toMatchObject({ verdict: "ok" });
  });

  it("holds the draft after its first sentence until released", async () => {
    const { workspaceId, api } = await anAdminAsking();
    await scripted({ workspaceId, judging: { fits: [] }, drafting: DRAFTING, holds: "draft" });

    const { recordId, keptWhileHeld } = await keptAtEachHeldSentence(api, workspaceId);

    expect(keptWhileHeld).toEqual([0]);
    expect(await draftedOn(recordId)).toHaveLength(1);
  });

  it("ends a held judge's call when its caller leaves", async () => {
    const workspaceId = "a-workspace-no-api-asks-in";
    models.script({ workspaceId, judging: { fits: [] }, holds: "judge" });
    const leaving = new AbortController();

    const call = models.fetch("https://model.example/v1/messages", {
      headers: { "x-api-key": `sk-test-browser-${workspaceId}` },
      body: "{}",
      signal: leaving.signal,
    });
    leaving.abort();

    await expect(call).rejects.toThrow("aborted");
  });

  it("fails a call the script says fails, at once", async () => {
    const { workspaceId, api } = await anAdminAsking();
    await scripted({ workspaceId, judging: "fails" });

    expect(await streamed(api)).toMatchObject({ verdict: "related", judgeState: "judging-failed" });
  });
});
