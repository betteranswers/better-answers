import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authenticatorCodeAt, keyIn } from "@better-answers/schema/testing/authenticator-code";

import { setActiveWorkspace } from "./flow.ts";
import type { TestClient } from "./harness.ts";
import { signedInClient } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { webClientOf } from "./web-client.ts";

const app = appForSuite();

const START = "/authenticator/start";
const FINISH = "/authenticator/finish";

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const ADDED = "An authenticator now confirms your better-answers sign-in";

const started = z.object({ setupAddress: z.string().startsWith("otpauth://totp/") });
const finished = z.object({ recoveryCodes: z.array(z.string()).nullable() });
const sessionRead = z.object({ session: z.object({ id: z.string() }) }).nullable();

const codeNow = (setupAddress: string): string =>
  authenticatorCodeAt(keyIn(setupAddress), new Date());

const aWrongCode = (right: string): string => (right === "000000" ? "111111" : "000000");

const aSignedInPerson = async () => {
  const person = await app().person();
  return { person, client: await signedInClient(app(), person.email) };
};

const anAdminSignedIn = async () => {
  const { admin } = await app().provision();
  return { admin, client: await signedInClient(app(), admin.email) };
};

const startOn = async (client: TestClient): Promise<string> => {
  const answered = await client.json(START, {});
  expect(answered.status, "the setup did not start").toBe(200);
  return started.parse(await answered.json()).setupAddress;
};

/** A setup started and finished with the code its key shows now. */
const setUpOn = async (client: TestClient) => {
  const setupAddress = await startOn(client);
  return { setupAddress, answered: await client.json(FINISH, { code: codeNow(setupAddress) }) };
};

const refusalOf = (call: Promise<unknown>): Promise<unknown> =>
  call.then(
    () => undefined,
    (error: unknown) => error,
  );

const sessionIdOf = async (cookie: string): Promise<string | undefined> => {
  const read = await app().client().fetch("/get-session", { headers: { cookie } });
  return sessionRead.parse(await read.json())?.session.id;
};

const factorOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ enabled: boolean; verified: boolean | null }>(
      `SELECT u.authenticator_enabled AS enabled, a.verified
         FROM "user" u LEFT JOIN authenticator a ON a.user_id = u.id WHERE u.id = $1`,
      [personId],
    )
  ).rows[0];

const sessionsOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ id: string; confirmed: Date | null }>(
      "SELECT id, second_factor_confirmed_at AS confirmed FROM session WHERE user_id = $1",
      [personId],
    )
  ).rows;

const noticesTo = (email: string) =>
  app().emails.filter((message) => message.to === email && !/^\d{6}$/m.test(message.text));

const subjectsTo = (email: string): readonly string[] =>
  noticesTo(email).map((notice) => notice.subject);

describe("setting up an authenticator", () => {
  it("leaves nothing enabled after a wrong code", async () => {
    const { person, client } = await aSignedInPerson();
    const setupAddress = await startOn(client);

    const answered = await client.json(FINISH, { code: aWrongCode(codeNow(setupAddress)) });

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "code-wrong" });
    expect(await factorOf(person.id)).toEqual({ enabled: false, verified: false });
    expect(noticesTo(person.email)).toEqual([]);
  });

  it("enables it on a working code and answers ten codes", async () => {
    const { person, client } = await aSignedInPerson();

    const { answered } = await setUpOn(client);

    expect(answered.status).toBe(200);
    const { recoveryCodes } = finished.parse(await answered.json());
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes ?? []) expect(code).toMatch(RECOVERY_CODE);
    expect(await factorOf(person.id)).toEqual({ enabled: true, verified: true });
  });

  it("leaves one stamped session and refuses the old token", async () => {
    const { person, client } = await aSignedInPerson();
    const before = client.cookies();

    await setUpOn(client);

    const held = await sessionsOf(person.id);
    expect(held).toEqual([{ id: expect.any(String), confirmed: expect.any(Date) }]);
    expect(await sessionIdOf(client.cookies())).toBe(held[0]?.id);
    expect(await sessionIdOf(before)).toBeUndefined();
  });

  it("keeps the chosen workspace across the session swap", async () => {
    const { admin, client } = await anAdminSignedIn();
    const other = await app().provision();
    await app().addMember(other.workspaceId, admin.id, "Viewer");
    const picked = await setActiveWorkspace(client, other.workspaceId);
    expect(picked.status, "the workspace was not picked").toBe(200);

    await setUpOn(client);

    const held = await app().database.superuser.query<{ workspace: string | null }>(
      "SELECT active_workspace_id AS workspace FROM session WHERE user_id = $1",
      [admin.id],
    );
    expect(held.rows).toEqual([{ workspace: other.workspaceId }]);
  });

  it("sends one notice holding neither the key nor a code", async () => {
    const { person, client } = await aSignedInPerson();

    const { setupAddress, answered } = await setUpOn(client);

    const { recoveryCodes } = finished.parse(await answered.json());
    expect(subjectsTo(person.email)).toEqual([ADDED]);
    const sent = JSON.stringify(noticesTo(person.email));
    expect(sent).not.toContain(keyIn(setupAddress));
    for (const code of recoveryCodes ?? []) expect(sent).not.toContain(code);
  });

  it("answers the key only to the call starting the setup", async () => {
    const { client } = await aSignedInPerson();

    const { setupAddress, answered } = await setUpOn(client);
    const read = await webClientOf(client).api.person.secondFactor.query();

    expect(await answered.text()).not.toContain(keyIn(setupAddress));
    expect(JSON.stringify(read)).not.toContain(keyIn(setupAddress));
  });

  it("refuses to check a code once the setup is done", async () => {
    const { client } = await aSignedInPerson();
    const { setupAddress } = await setUpOn(client);

    const right = await client.json(FINISH, { code: codeNow(setupAddress) });
    const wrong = await client.json(FINISH, { code: aWrongCode(codeNow(setupAddress)) });

    expect([right.status, wrong.status]).toEqual([409, 409]);
    expect(await right.json()).toEqual({ error: "no-setup-waiting" });
  });

  it("refuses a second setup while one is held", async () => {
    const { client } = await aSignedInPerson();
    await setUpOn(client);

    const again = await client.json(START, {});

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "authenticator-held" });
  });

  it("keeps held recovery codes through an abandoned setup", async () => {
    const { client } = await aSignedInPerson();
    const { api } = webClientOf(client);
    const { recoveryCodes } = await api.person.replaceRecoveryCodes.mutate();

    await startOn(client);

    expect(await api.person.secondFactor.query()).toMatchObject({
      authenticator: "awaiting-code",
      recoveryCodes: { unused: 10 },
    });
    expect(recoveryCodes).toHaveLength(10);
  });

  it("refuses a caller with no session", async () => {
    const client = app().client();

    const answers = [await client.json(START, {}), await client.json(FINISH, { code: "123456" })];

    expect(answers.map((answer) => answer.status)).toEqual([401, 401]);
  });

  it("refuses a cross-site post", async () => {
    const { person, client } = await aSignedInPerson();

    const refused = await client.fetch(START, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://elsewhere.example" },
      body: "{}",
    });

    expect(refused.status).toBe(403);
    expect(await factorOf(person.id)).toEqual({ enabled: false, verified: null });
  });

  it("answers 429 past ten codes in ten minutes", async () => {
    const { client } = await aSignedInPerson();
    const wrong = aWrongCode(codeNow(await startOn(client)));
    const answers: number[] = [];

    for (let tried = 0; tried < 11; tried += 1) {
      answers.push((await client.json(FINISH, { code: wrong })).status);
    }

    expect(answers).toEqual([...Array.from({ length: 10 }, () => 400), 429]);
  });
});

describe("removing an authenticator", () => {
  it("removes it and sends one notice", async () => {
    const { person, client } = await aSignedInPerson();
    await setUpOn(client);

    await webClientOf(client).api.person.removeAuthenticator.mutate();

    expect(await factorOf(person.id)).toEqual({ enabled: false, verified: null });
    expect(subjectsTo(person.email)).toEqual([
      ADDED,
      "Your better-answers authenticator was removed",
    ]);
  });

  it("refuses an Admin's last second factor", async () => {
    const { admin, client } = await anAdminSignedIn();
    await setUpOn(client);

    const refused = await refusalOf(webClientOf(client).api.person.removeAuthenticator.mutate());

    expect(refused).toMatchObject({
      data: { refusal: { word: "last-second-factor", class: "precondition" } },
    });
    expect(await factorOf(admin.id)).toEqual({ enabled: true, verified: true });
    expect(subjectsTo(admin.email)).toEqual([ADDED]);
  });
});

describe("replacing recovery codes", () => {
  it("answers ten new codes and sends one notice", async () => {
    const { person, client } = await aSignedInPerson();
    await setUpOn(client);

    const { recoveryCodes } = await webClientOf(client).api.person.replaceRecoveryCodes.mutate();

    expect(recoveryCodes).toHaveLength(10);
    expect(subjectsTo(person.email)).toEqual([
      ADDED,
      "Your better-answers recovery codes were replaced",
    ]);
  });

  it("marks the set saved once acknowledged", async () => {
    const { person, client } = await aSignedInPerson();
    const { api } = webClientOf(client);
    await api.person.replaceRecoveryCodes.mutate();

    await api.person.acknowledgeRecoveryCodes.mutate();

    const saved = await app().database.superuser.query<{ acknowledged: boolean }>(
      'SELECT recovery_codes_acknowledged AS acknowledged FROM "user" WHERE id = $1',
      [person.id],
    );
    expect(saved.rows).toEqual([{ acknowledged: true }]);
  });
});
