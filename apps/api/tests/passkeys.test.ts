import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { TestClient } from "./harness.ts";
import { aPasskeyDevice, type PasskeyDevice } from "./passkey-device.ts";
import { signedInClient } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { webClientOf } from "./web-client.ts";

const app = appForSuite();

const ADD_OPTIONS = "/passkeys/add-options";
const ADD = "/passkeys/add";
const SIGN_IN_OPTIONS = "/passkeys/sign-in-options";
const SIGN_IN = "/passkeys/sign-in";

const ADDED = "A passkey was added to your better-answers account";
const REMOVED = "A passkey was removed from your better-answers account";

const addedAnswer = z.object({
  passkeyId: z.string(),
  recoveryCodes: z.array(z.string()).nullable(),
});

const sessionRead = z
  .object({ session: z.object({ id: z.string() }), user: z.object({ id: z.string() }) })
  .nullable();

const aSignedInPerson = async () => {
  const person = await app().person();
  return { person, client: await signedInClient(app(), person.email) };
};

const anAdminSignedIn = async () => {
  const { admin } = await app().provision();
  return { person: admin, client: await signedInClient(app(), admin.email) };
};

const askToAdd = async (client: TestClient): Promise<unknown> => {
  const asked = await client.json(ADD_OPTIONS, {});
  expect(asked.status, "the add was not asked").toBe(200);
  return asked.json();
};

/** A passkey added from `device` through the api's two steps, as the Account page adds one. */
const addOn = async (
  client: TestClient,
  device: PasskeyDevice,
  input: { readonly name?: string; readonly verified?: boolean } = {},
) =>
  client.json(ADD, {
    name: input.name ?? "Chrome on macOS",
    response: device.create(await askToAdd(client), { verified: input.verified ?? true }),
  });

const aPersonWithAPasskey = async () => {
  const { person, client } = await aSignedInPerson();
  const device = aPasskeyDevice(client.origin);
  const answered = await addOn(client, device);
  expect(answered.status, "the passkey was not added").toBe(200);
  return { person, client, device, passkeyId: addedAnswer.parse(await answered.json()).passkeyId };
};

const signInOn = async (client: TestClient, device: PasskeyDevice, verified = true) => {
  const asked = await client.json(SIGN_IN_OPTIONS, {});
  expect(asked.status, "the sign-in was not asked").toBe(200);
  return client.json(SIGN_IN, { response: device.get(await asked.json(), { verified }) });
};

const sessionOf = async (client: TestClient) =>
  sessionRead.parse(await (await client.fetch("/get-session")).json());

const passkeysOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ id: string; name: string | null }>(
      "SELECT id, name FROM passkey WHERE user_id = $1",
      [personId],
    )
  ).rows;

const sessionsOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ id: string; confirmed: Date | null }>(
      "SELECT id, second_factor_confirmed_at AS confirmed FROM session WHERE user_id = $1 ORDER BY created_at",
      [personId],
    )
  ).rows;

const signInsOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ detail: unknown }>(
      `SELECT detail FROM identity_audit_event
        WHERE subject_id = $1 AND act = 'people.person.signed_in' ORDER BY at, id`,
      [personId],
    )
  ).rows.map((row) => row.detail);

const lastUseOf = async (passkeyId: string) =>
  (
    await app().database.superuser.query<{ at: Date }>(
      "SELECT at FROM passkey_last_use WHERE passkey_id = $1",
      [passkeyId],
    )
  ).rows[0]?.at;

const subjectsTo = (email: string): readonly string[] =>
  app()
    .emails.filter((message) => message.to === email && !/^\d{6}$/m.test(message.text))
    .map((notice) => notice.subject);

const emailsTo = (email: string): number =>
  app().emails.filter((message) => message.to === email).length;

describe("adding a passkey", () => {
  it("keeps it by name, confirming the session, with one notice", async () => {
    const { person, client } = await aSignedInPerson();

    const answered = await addOn(client, aPasskeyDevice(client.origin), { name: " Work laptop " });

    expect(answered.status).toBe(200);
    const { passkeyId, recoveryCodes } = addedAnswer.parse(await answered.json());
    expect(recoveryCodes).toBeNull();
    expect(await passkeysOf(person.id)).toEqual([{ id: passkeyId, name: "Work laptop" }]);
    expect(await sessionsOf(person.id)).toEqual([
      { id: expect.any(String), confirmed: expect.any(Date) },
    ]);
    expect(subjectsTo(person.email)).toEqual([ADDED]);
  });

  it("answers ten recovery codes to an Admin holding none", async () => {
    const { client } = await anAdminSignedIn();

    const answered = await addOn(client, aPasskeyDevice(client.origin));

    expect(addedAnswer.parse(await answered.json()).recoveryCodes).toHaveLength(10);
  });

  it("refuses a passkey made without user verification", async () => {
    const { person, client } = await aSignedInPerson();

    const answered = await addOn(client, aPasskeyDevice(client.origin), { verified: false });

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "not-verified" });
    expect(await passkeysOf(person.id)).toEqual([]);
    expect(subjectsTo(person.email)).toEqual([]);
  });

  it("refuses a blank name before the device is asked", async () => {
    const { person, client } = await aSignedInPerson();

    const answered = await addOn(client, aPasskeyDevice(client.origin), { name: "   " });

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "passkey-name-empty" });
    expect(await passkeysOf(person.id)).toEqual([]);
  });

  it("refuses an add nobody asked for", async () => {
    const { person, client } = await aSignedInPerson();
    const device = aPasskeyDevice(client.origin);

    const answered = await client.json(ADD, {
      name: "Phone",
      response: device.create({ challenge: "bm90LWFza2Vk" }),
    });

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "challenge-gone" });
    expect(await passkeysOf(person.id)).toEqual([]);
  });

  it("adds one on a session more than a day old", async () => {
    const { person, client } = await aSignedInPerson();
    await app().database.superuser.query(
      "UPDATE session SET created_at = now() - interval '2 days' WHERE user_id = $1",
      [person.id],
    );

    const answered = await addOn(client, aPasskeyDevice(client.origin));

    expect(answered.status).toBe(200);
  });

  it("refuses a caller with no session", async () => {
    const client = app().client();

    const answers = [await client.json(ADD_OPTIONS, {}), await client.json(ADD, {})];

    expect(answers.map((answer) => answer.status)).toEqual([401, 401]);
  });

  it("refuses a cross-site post", async () => {
    const { client } = await aSignedInPerson();

    const refused = await client.fetch(ADD_OPTIONS, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://elsewhere.example" },
      body: "{}",
    });

    expect(refused.status).toBe(403);
  });
});

describe("signing in with a passkey", () => {
  it("signs in in one step, sending no email", async () => {
    const { person, device } = await aPersonWithAPasskey();
    const emailsBefore = emailsTo(person.email);
    const browser = app().client();

    const answered = await signInOn(browser, device);

    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ displayNameGiven: true });
    expect((await sessionOf(browser))?.user.id).toBe(person.id);
    expect(emailsTo(person.email)).toBe(emailsBefore);
  });

  it("confirms the session it makes and records the method", async () => {
    const { person, device } = await aPersonWithAPasskey();

    await signInOn(app().client(), device);

    expect((await sessionsOf(person.id)).at(-1)?.confirmed).toBeInstanceOf(Date);
    expect((await signInsOf(person.id)).at(-1)).toEqual({ method: "passkey" });
  });

  it("keeps when the passkey was last used", async () => {
    const { device, passkeyId } = await aPersonWithAPasskey();

    await signInOn(app().client(), device);

    expect(await lastUseOf(passkeyId)).toBeInstanceOf(Date);
  });

  it("refuses an assertion without user verification, making no session", async () => {
    const { person, device } = await aPersonWithAPasskey();
    const before = await sessionsOf(person.id);
    const browser = app().client();

    const answered = await signInOn(browser, device, false);

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "not-verified" });
    expect(await sessionOf(browser)).toBeNull();
    expect(await sessionsOf(person.id)).toEqual(before);
  });

  it("refuses a passkey the platform does not hold", async () => {
    const browser = app().client();

    const answered = await signInOn(browser, aPasskeyDevice(browser.origin));

    expect(answered.status).toBe(401);
    expect(await answered.json()).toEqual({ error: "passkey-unknown" });
  });

  it("refuses a passkey once removed", async () => {
    const { client, device, passkeyId } = await aPersonWithAPasskey();
    await webClientOf(client).api.person.removePasskey.mutate({ passkeyId });

    const answered = await signInOn(app().client(), device);

    expect(answered.status).toBe(401);
    expect(await answered.json()).toEqual({ error: "passkey-unknown" });
  });

  it("asks for user verification and names no passkey", async () => {
    const { client } = await aPersonWithAPasskey();

    const asked = await client.json(SIGN_IN_OPTIONS, {});

    const options = z
      .object({ userVerification: z.string(), allowCredentials: z.unknown().optional() })
      .parse(await asked.json());
    expect(options).toEqual({ userVerification: "required" });
  });

  it("answers 429 past thirty asks a minute from one address", async () => {
    const browser = app().client();
    const answers: number[] = [];

    for (let asked = 0; asked < 31; asked += 1) {
      answers.push((await browser.json(SIGN_IN_OPTIONS, {})).status);
    }

    expect(answers.at(-2)).toBe(200);
    expect(answers.at(-1)).toBe(429);
  });
});

describe("renaming and removing a passkey", () => {
  it("renames it, sending no notice", async () => {
    const { person, client, passkeyId } = await aPersonWithAPasskey();

    const renamed = await webClientOf(client).api.person.renamePasskey.mutate({
      passkeyId,
      name: "Phone",
    });

    expect(renamed).toEqual({ passkeyId, name: "Phone" });
    expect(subjectsTo(person.email)).toEqual([ADDED]);
  });

  it("removes it and sends one notice", async () => {
    const { person, client, passkeyId } = await aPersonWithAPasskey();

    await webClientOf(client).api.person.removePasskey.mutate({ passkeyId });

    expect(await passkeysOf(person.id)).toEqual([]);
    expect(subjectsTo(person.email)).toEqual([ADDED, REMOVED]);
  });

  it("refuses an Admin's last second factor, sending no notice", async () => {
    const { person, client } = await anAdminSignedIn();
    const answered = await addOn(client, aPasskeyDevice(client.origin));
    const { passkeyId } = addedAnswer.parse(await answered.json());

    const refused = await webClientOf(client)
      .api.person.removePasskey.mutate({ passkeyId })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(refused).toMatchObject({
      data: { refusal: { word: "last-second-factor", class: "precondition" } },
    });
    expect(subjectsTo(person.email)).toEqual([ADDED]);
  });

  it("keeps the dismissed offer for the person", async () => {
    const { client } = await aSignedInPerson();
    const { api } = webClientOf(client);

    await api.person.dismissPasskeyOffer.mutate();

    expect(await api.person.secondFactor.query()).toMatchObject({ passkeyOfferDismissed: true });
  });
});
