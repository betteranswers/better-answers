import { describe, expect, it } from "vitest";
import { z } from "zod";

import { confirmWithTheAuthenticator } from "./flow.ts";
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
