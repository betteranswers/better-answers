import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ulid } from "@better-answers/schema/ulid";

import { confirmWithTheAuthenticator } from "./flow.ts";
import { askedOfTheHarness } from "./harness-asked.ts";
import { harnessControl } from "./harness-control.ts";
import { aPersonSignedIn, signedInByEmailOnly, signedInClient } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { webClientOf } from "./web-client.ts";

/** Served as the browser suite serves it, on an origin of its own, so no cookie is the suites'. */
const app = appForSuite({
  publicUrl: "http://localhost:4173",
  hostnames: { app: "localhost", agent: "agent.localhost", apex: "apex.localhost" },
});

const harnessAnswer = async (
  path: string,
  email: string,
  body: Readonly<Record<string, string>> = { email },
): Promise<unknown> => {
  const answered = await harnessControl(app()).request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(answered.status, `the harness's ${path} failed`).toBe(200);
  return answered.json();
};

describe("the browser suite's second-factor harness", () => {
  it("enrols an authenticator whose key confirms a session", async () => {
    const person = await app().person();
    const { key } = z
      .object({ key: z.string() })
      .parse(await harnessAnswer("/__harness/authenticators", person.email));
    const client = await signedInClient(app(), person.email);

    await confirmWithTheAuthenticator(client, key);
    expect((await webClientOf(client).api.person.secondFactor.query()).thisSession).toEqual({
      confirmed: true,
      setupGranted: false,
      adminOf: null,
      standing: "not-required",
    });
  });

  it("gives saved recovery codes beside the authenticator, unless told not", async () => {
    const [saved, none] = [await app().person(), await app().person()];
    const enrolled = z.object({ key: z.string(), recoveryCodes: z.array(z.string()) });

    const withCodes = enrolled.parse(await harnessAnswer("/__harness/authenticators", saved.email));
    const without = enrolled.parse(
      await harnessAnswer("/__harness/authenticators", none.email, {
        email: none.email,
        codes: "none",
      }),
    );

    const heldBy = async (email: string) =>
      webClientOf(await signedInClient(app(), email)).api.person.secondFactor.query();
    expect(withCodes.recoveryCodes).toHaveLength(10);
    expect(await heldBy(saved.email)).toMatchObject({
      authenticator: "set-up",
      recoveryCodes: { unused: 10 },
      codesAcknowledged: true,
    });
    expect([without.recoveryCodes, (await heldBy(none.email)).recoveryCodes]).toEqual([
      [],
      undefined,
    ]);
  });

  it("restores a person with a code the restore route accepts", async () => {
    const { person, client: before } = await aPersonSignedIn(app());
    const { code } = z
      .object({ code: z.string() })
      .parse(await harnessAnswer("/__harness/restores", person.email));
    const client = await signedInClient(app(), person.email);

    expect(await (await before.fetch("/get-session")).json()).toBeNull();
    expect((await webClientOf(client).api.person.secondFactor.query()).restoreRequired).toBe(true);
    expect((await client.json("/second-factor/restore", { code })).status).toBe(200);
  });

  it("ends a pending session once its hour is moved past", async () => {
    const { admin } = await app().provision();
    const pending = await signedInByEmailOnly(app(), admin.email);
    expect((await webClientOf(pending).api.person.secondFactor.query()).thisSession?.standing).toBe(
      "setup",
    );

    await harnessAnswer("/__harness/pending-sessions/aged", admin.email, { userId: admin.id });

    expect(await (await pending.fetch("/get-session")).json()).toBeNull();
  });
});

const asked = (path: string, body: unknown) => askedOfTheHarness(app(), path, body);

const aSeedOf = (workspaceId: string, document: Readonly<Record<string, unknown>>) => ({
  workspaceId,
  connectedSources: [{ name: "Scans", documents: [{ title: "Floor plan", ...document }] }],
});

const heldIn = async (
  table: "connected_source" | "model_choice",
  workspaceId: string,
): Promise<number> => {
  const counted = await app().database.superuser.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM ${table} WHERE workspace_id = $1`,
    [workspaceId],
  );
  return counted.rows[0]?.held ?? 0;
};

describe("a seed the browser suite's harness cannot write", () => {
  it("answers 400 naming the flag a default-on finding cannot carry", async () => {
    const { workspaceId } = await app().provision();
    const finding = { category: "home-address", ruleId: "UK_HOME_ADDRESS", spans: 1 };

    const answered = await asked(
      "/__harness/connected-sources",
      aSeedOf(workspaceId, { findings: [{ ...finding, tier: "default-on", kept: true }] }),
    );

    expect(answered).toEqual({
      status: 400,
      said: {
        fields: [
          {
            field: "connectedSources.0.documents.0.findings.0.kept",
            rule: expect.stringContaining("finding_restore_check"),
          },
        ],
      },
    });
    expect(await heldIn("connected_source", workspaceId)).toBe(0);
  });

  it("leaves no model choice when a seed's second is refused", async () => {
    const { workspaceId } = await app().provision();
    const answering = { purpose: "answering", provider: "anthropic" };

    const answered = await asked("/__harness/model-choices", {
      workspaceId,
      modelChoices: [
        { ...answering, model: "claude-sonnet-5" },
        { ...answering, model: "claude-haiku-5" },
      ],
    });

    expect(answered).toMatchObject({
      status: 400,
      said: { constraint: "model_choice_workspace_purpose_unique" },
    });
    expect(await heldIn("model_choice", workspaceId)).toBe(0);
  });

  it("answers 400 naming an unreadable reason that holds a space", async () => {
    const { workspaceId } = await app().provision();

    const answered = await asked(
      "/__harness/connected-sources",
      aSeedOf(workspaceId, { unreadableReason: "No text layer" }),
    );

    expect(answered).toEqual({
      status: 400,
      said: {
        fields: [
          {
            field: "connectedSources.0.documents.0.unreadableReason",
            rule: expect.stringContaining("no space"),
          },
        ],
      },
    });
  });

  it("answers 400 naming the field the store's own schema refuses", async () => {
    const answered = await asked("/__harness/connected-sources", aSeedOf("no-such-workspace", {}));

    expect(answered.status).toBe(400);
    expect(answered.said).toMatchObject({ fields: [{ field: "workspaceId" }] });
  });

  it("answers 400 naming the constraint a write trips", async () => {
    const answered = await asked("/__harness/connected-sources", aSeedOf(ulid(), {}));

    expect(answered.status).toBe(400);
    expect(answered.said).toMatchObject({ constraint: expect.stringMatching(/_fk$/) });
  });

  it("leaves a fault of the harness's own a 500", async () => {
    const { workspaceId } = await app().provision();

    const answered = await new Hono()
      .route("/", harnessControl(app()))
      .request("/__harness/syncs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, to: "done" }),
      });

    expect(answered.status).toBe(500);
  });

  it("answers 400 naming the field another route's schema refuses", async () => {
    const { workspaceId, admin } = await app().provision();

    const answered = await asked("/__harness/members", {
      workspaceId,
      userId: admin.id,
      role: "Owner",
    });

    expect(answered.status).toBe(400);
    expect(answered.said).toMatchObject({ fields: [{ field: "role" }] });
  });
});
