import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { until } from "@better-answers/core/testing/postgres";

import { askedFrom } from "../../web/src/shared/api/ask-stream.ts";
import { scriptedModels } from "./harness-asking.ts";
import { harnessControl } from "./harness-control.ts";
import { conceptsSeeding, seedConcepts } from "./harness-knowledge.ts";
import { AUDIT_ANSWERS, AUDIT_QUESTION as QUESTION } from "./harness-model.ts";
import { appForSuite } from "./suite-app.ts";
import { anAdminOnTheWeb } from "./web-client.ts";

const models = scriptedModels();

const app = appForSuite({ fetchModel: models.fetch });

const { users: USERS, supplier: SUPPLIER } = AUDIT_ANSWERS;

const POLICY = {
  title: "Audit information access for buyers",
  collection: "audits",
  kind: "Policy",
  body: "Buyers access audit information through the console's audit page.",
};

/** Mounted as `serve.ts` mounts it, with the wire the TestApp's model calls reach. */
const harness = (path: string, init?: RequestInit) =>
  new Hono().route("/", harnessControl(app(), models)).request(path, init);

const scripted = async (script: Readonly<Record<string, unknown>>) => {
  const answered = await harness("/__harness/asking", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(script),
  });
  expect(answered.status).toBe(200);
};

const calls = z.object({ judge: z.number(), draft: z.number() });

const callsTo = async (workspaceId: string) =>
  calls.parse(await (await harness(`/__harness/asking/calls?workspaceId=${workspaceId}`)).json());

/** A workspace holding the two audit `Answer`s and the policy, and its Admin on the web. */
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
    const sentence = "Buyers use the console's audit page.";
    await scripted({
      workspaceId,
      judging: { fits: [] },
      drafting: { writes: [{ citing: POLICY.title, sentence }] },
    });

    const asked = await streamed(api);

    const policy = asked?.related.find(({ title }) => title === POLICY.title)?.iri;
    expect(asked?.prose).toEqual([
      { collection: "audits", sentences: [{ sentence, concepts: [policy] }], outcome: "drafted" },
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
    const released = await harness("/__harness/asking/releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });

    expect(await released.json()).toEqual({ released: true });
    expect(await asking).toMatchObject({ verdict: "ok" });
  });

  it("fails a call the script says fails, at once", async () => {
    const { workspaceId, api } = await anAdminAsking();
    await scripted({ workspaceId, judging: "fails" });

    expect(await streamed(api)).toMatchObject({ verdict: "related", judgeState: "judging-failed" });
  });
});
