import { describe, expect, it } from "vitest";
import { z } from "zod";

import { matching } from "@better-answers/schema/testing/matching";

import type { TestClient } from "../../support/harness/harness.ts";
import { aPasskeyDevice, type PasskeyDevice } from "../../support/passkey-device.ts";
import { aPersonSignedIn, anAdminSignedIn } from "../../support/provoke.ts";
import { appForSuite, aStoppableClock } from "../../support/suite-app.ts";
import { webClientOf } from "../../support/web-client.ts";

const { clock, stopTheClock } = aStoppableClock();

const app = appForSuite({ clock });

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

const aSignedInPerson = () => aPersonSignedIn(app());

const askToAdd = async (client: TestClient): Promise<unknown> => {
  const asked = await client.json(ADD_OPTIONS, { name: "Chrome on macOS" });
  expect(asked.status, "the add-options request failed").toBe(200);
  return asked.json();
};

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
  expect(asked.status, "the sign-in-options request failed").toBe(200);
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
        WHERE subject_id = $1 AND action = 'people.person.signed_in' ORDER BY at, id`,
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
  it("stores the trimmed name, confirms the session, sends one notice", async () => {
    const { person, client } = await aSignedInPerson();

    const answered = await addOn(client, aPasskeyDevice(client.origin), { name: " Work laptop " });

    expect(answered.status).toBe(200);
    const { passkeyId, recoveryCodes } = addedAnswer.parse(await answered.json());
    expect(recoveryCodes).toBeNull();
    expect(await passkeysOf(person.id)).toEqual([{ id: passkeyId, name: "Work laptop" }]);
    expect(await sessionsOf(person.id)).toEqual([
      { id: matching.any(String), confirmed: matching.any(Date) },
    ]);
    expect(subjectsTo(person.email)).toEqual([ADDED]);
  });

  it("returns ten recovery codes to an Admin without any", async () => {
    const { client } = await anAdminSignedIn(app());

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

  it("refuses a blank name at the add-options step", async () => {
    const { client } = await aSignedInPerson();

    const asked = await client.json(ADD_OPTIONS, { name: "   " });

    expect(asked.status).toBe(400);
    expect(await asked.json()).toEqual({ error: "passkey-name-empty" });
  });

  it("refuses a blank name at the add step", async () => {
    const { person, client } = await aSignedInPerson();

    const answered = await addOn(client, aPasskeyDevice(client.origin), { name: "   " });

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "passkey-name-empty" });
    expect(await passkeysOf(person.id)).toEqual([]);
  });

  it("refuses an add whose challenge was never issued", async () => {
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

  it.each([ADD_OPTIONS, ADD])("answers 429 at %s after ten calls in ten minutes", async (path) => {
    const { client } = await aSignedInPerson();
    const answers: number[] = [];
    stopTheClock();

    for (let asked = 0; asked < 11; asked += 1) {
      answers.push((await client.json(path, { name: "Phone" })).status);
    }

    expect(answers.slice(0, -1)).not.toContain(429);
    expect(answers.at(-1)).toBe(429);
  });
});

describe("signing in with a passkey", () => {
  it("signs in in one step and sends no email", async () => {
    const { person, device } = await aPersonWithAPasskey();
    const emailsBefore = emailsTo(person.email);
    const browser = app().client();

    const answered = await signInOn(browser, device);

    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ displayNameGiven: true });
    expect((await sessionOf(browser))?.user.id).toBe(person.id);
    expect(emailsTo(person.email)).toBe(emailsBefore);
  });

  it("confirms the new session and records the sign-in method", async () => {
    const { person, device } = await aPersonWithAPasskey();

    await signInOn(app().client(), device);

    expect((await sessionsOf(person.id)).at(-1)?.confirmed).toBeInstanceOf(Date);
    expect((await signInsOf(person.id)).at(-1)).toEqual({ method: "passkey" });
  });

  it("records when the passkey was last used", async () => {
    const { device, passkeyId } = await aPersonWithAPasskey();

    await signInOn(app().client(), device);

    expect(await lastUseOf(passkeyId)).toBeInstanceOf(Date);
  });

  it("refuses an assertion without user verification and makes no session", async () => {
    const { person, device } = await aPersonWithAPasskey();
    const before = await sessionsOf(person.id);
    const browser = app().client();

    const answered = await signInOn(browser, device, false);

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "not-verified" });
    expect(await sessionOf(browser)).toBeNull();
    expect(await sessionsOf(person.id)).toEqual(before);
  });

  it("refuses a passkey that was never added", async () => {
    const browser = app().client();

    const answered = await signInOn(browser, aPasskeyDevice(browser.origin));

    expect(answered.status).toBe(401);
    expect(await answered.json()).toEqual({ error: "passkey-unknown" });
  });

  it("refuses a passkey after it is removed", async () => {
    const { client, device, passkeyId } = await aPersonWithAPasskey();
    await webClientOf(client).api.person.removePasskey.mutate({ passkeyId });

    const answered = await signInOn(app().client(), device);

    expect(answered.status).toBe(401);
    expect(await answered.json()).toEqual({ error: "passkey-unknown" });
  });

  it("requires user verification and lists no allowed passkeys", async () => {
    const { client } = await aPersonWithAPasskey();

    const asked = await client.json(SIGN_IN_OPTIONS, {});

    const options = z
      .object({ userVerification: z.string(), allowCredentials: z.unknown().optional() })
      .parse(await asked.json());
    expect(options).toEqual({ userVerification: "required" });
  });

  it.each([SIGN_IN_OPTIONS, SIGN_IN])("answers 429 at %s past thirty in a minute", async (path) => {
    const browser = app().client();
    const answers: number[] = [];
    stopTheClock();

    for (let asked = 0; asked < 31; asked += 1) {
      answers.push((await browser.json(path, {})).status);
    }

    expect(answers.slice(0, -1)).not.toContain(429);
    expect(answers.at(-1)).toBe(429);
  });

  it("does not count toward the sign-in link's rate limit", async () => {
    const browser = app().client();
    for (let asked = 0; asked < 11; asked += 1) await browser.json(SIGN_IN_OPTIONS, {});

    const linkTried = await browser.json("/sign-in-link/sign-in", { token: "unknown" });

    expect(linkTried.status).toBe(410);
  });
});

describe("renaming and removing a passkey", () => {
  it("renames it and sends no notice", async () => {
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

  it("keeps an Admin's last second factor and sends no notice", async () => {
    const { admin: person, client } = await anAdminSignedIn(app());
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

  it("records that the person dismissed the passkey offer", async () => {
    const { client } = await aSignedInPerson();
    const { api } = webClientOf(client);

    await api.person.dismissPasskeyOffer.mutate();

    expect(await api.person.secondFactor.query()).toMatchObject({ passkeyOfferDismissed: true });
  });
});
