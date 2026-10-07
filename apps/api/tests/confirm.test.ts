import { describe, expect, it } from "vitest";
import { z } from "zod";

import { restoredWithACode } from "@better-answers/core/testing/restore-code";
import { authenticatorCodeAt, keyIn } from "@better-answers/schema/testing/authenticator-code";

import { confirmWithTheAuthenticator } from "./flow.ts";
import type { TestClient } from "./harness.ts";
import { aPasskeyDevice, type PasskeyDevice } from "./passkey-device.ts";
import {
  aPersonHoldingEverything,
  aPersonSignedIn,
  aPersonWithAnAuthenticator,
  aWrongCode,
  anAdminWithAnAuthenticator,
  codeNow,
  passkeyAddedOn,
  restoredByTheOperator,
  setUpOn,
  signedInClient,
} from "./provoke.ts";
import { appForSuite, aStoppableClock } from "./suite-app.ts";
import { refusalOfCall, webClientOf } from "./web-client.ts";

const { clock, stopTheClock } = aStoppableClock();

const app = appForSuite({ clock });

const PASSKEY_OPTIONS = "/second-factor/confirm/passkey-options";
const PASSKEY = "/second-factor/confirm/passkey";
const AUTHENTICATOR = "/second-factor/confirm/authenticator";
const RECOVERY = "/second-factor/recovery";
const RESTORE = "/second-factor/restore";
const REPLACE_START = "/second-factor/replace/authenticator-start";
const REPLACE_FINISH = "/second-factor/replace/authenticator-finish";

const ROUTES = [
  PASSKEY_OPTIONS,
  PASSKEY,
  AUTHENTICATOR,
  RECOVERY,
  RESTORE,
  REPLACE_START,
  REPLACE_FINISH,
] as const;

const FAILURES_NOTICE = "Wrong codes were entered for your better-answers account";
const CODE_USED_NOTICE = "A recovery code was used on your better-answers account";
const REPLACED_NOTICE = "Your better-answers second factor was replaced";

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const sessionRead = z.object({ session: z.object({ id: z.string() }) });
const issued = z.object({ recoveryCodes: z.array(z.string()), madeAt: z.iso.datetime() });
const startedAnswer = z.object({ setupAddress: z.string().startsWith("otpauth://totp/") });
const optionsAnswer = z.object({
  challenge: z.string(),
  userVerification: z.string(),
  allowCredentials: z.array(z.object({ id: z.string() })),
});

const codeOf = (key: string): string => authenticatorCodeAt(key, new Date());

const sessionIdOf = async (client: TestClient): Promise<string> =>
  sessionRead.parse(await (await client.fetch("/get-session")).json()).session.id;

const sessionsOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ id: string; confirmed: Date | null }>(
      "SELECT id, second_factor_confirmed_at AS confirmed FROM session WHERE user_id = $1 ORDER BY id",
      [personId],
    )
  ).rows;

const confirmedOf = async (client: TestClient): Promise<Date | null | undefined> => {
  const sessionId = await sessionIdOf(client);
  return (
    await app().database.superuser.query<{ confirmed: Date | null }>(
      "SELECT second_factor_confirmed_at AS confirmed FROM session WHERE id = $1",
      [sessionId],
    )
  ).rows[0]?.confirmed;
};

const heldOn = (client: TestClient) => webClientOf(client).api.person.secondFactor.query();

const noticesTo = (email: string, subject: string): number =>
  app().emails.filter((message) => message.to === email && message.subject === subject).length;

const askToConfirm = async (client: TestClient): Promise<unknown> => {
  const asked = await client.json(PASSKEY_OPTIONS, {});
  expect(asked.status, "the confirm was not asked").toBe(200);
  return asked.json();
};

const confirmOn = async (client: TestClient, device: PasskeyDevice, verified = true) =>
  client.json(PASSKEY, { response: device.get(await askToConfirm(client), { verified }) });

/** Tries a wrong code `times` times, each from the next of `clients` in turn. */
const wrongCodesFrom = async (clients: readonly TestClient[], key: string, times: number) => {
  const statuses: number[] = [];
  for (let tried = 0; tried < times; tried += 1) {
    const client = clients[tried % clients.length];
    if (client === undefined) throw new Error("no session to try from");
    statuses.push((await client.json(AUTHENTICATOR, { code: aWrongCode(codeOf(key)) })).status);
  }
  return statuses;
};

describe("confirming with a passkey", () => {
  it("stamps the session it confirms and makes no other", async () => {
    const { person, client: setUpIn } = await aPersonSignedIn(app());
    const { device } = await passkeyAddedOn(setUpIn);
    const client = await signedInClient(app(), person.email);
    const before = await sessionsOf(person.id);

    const answered = await confirmOn(client, device);

    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ confirmed: true });
    expect((await sessionsOf(person.id)).map((session) => session.id)).toEqual(
      before.map((session) => session.id),
    );
    expect(await confirmedOf(client)).toBeInstanceOf(Date);
  });

  it("asks for the person's own passkeys, with user verification", async () => {
    const { client: setUpIn } = await aPersonSignedIn(app());
    const { device } = await passkeyAddedOn(setUpIn);
    await passkeyAddedOn((await aPersonSignedIn(app())).client);

    const options = optionsAnswer.parse(await askToConfirm(setUpIn));

    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials.map((credential) => credential.id)).toEqual([
      device.credentialId,
    ]);
  });

  it("refuses another person's passkey, stamping nothing", async () => {
    const { device: theirs } = await passkeyAddedOn((await aPersonSignedIn(app())).client);
    const { person, client: setUpIn } = await aPersonSignedIn(app());
    await passkeyAddedOn(setUpIn);
    const client = await signedInClient(app(), person.email);

    const answered = await confirmOn(client, theirs);

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "passkey-not-yours" });
    expect(await confirmedOf(client)).toBeNull();
  });

  it("refuses an answer made without user verification", async () => {
    const { person, client: setUpIn } = await aPersonSignedIn(app());
    const { device } = await passkeyAddedOn(setUpIn);
    const client = await signedInClient(app(), person.email);

    const answered = await confirmOn(client, device, false);

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "not-verified" });
    expect(await confirmedOf(client)).toBeNull();
  });

  it("refuses a challenge already answered", async () => {
    const { person, client: setUpIn } = await aPersonSignedIn(app());
    const { device } = await passkeyAddedOn(setUpIn);
    const client = await signedInClient(app(), person.email);
    const response = device.get(await askToConfirm(client));
    expect((await client.json(PASSKEY, { response })).status).toBe(200);

    const again = await client.json(PASSKEY, { response });

    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "challenge-gone" });
  });

  it("refuses a person who holds no passkey", async () => {
    const { client } = await aPersonSignedIn(app());

    const asked = await client.json(PASSKEY_OPTIONS, {});

    expect(asked.status).toBe(409);
    expect(await asked.json()).toEqual({ error: "no-passkey" });
  });
});

describe("confirming with an authenticator", () => {
  it("confirms this session with a working code", async () => {
    const { client, key } = await anAdminWithAnAuthenticator(app());
    expect((await heldOn(client)).thisSession).toMatchObject({
      confirmed: false,
      setupGranted: false,
      standing: "confirm",
    });

    const answered = await confirmWithTheAuthenticator(client, key);

    expect(await answered.json()).toEqual({ confirmed: true });
    expect((await heldOn(client)).thisSession).toMatchObject({
      confirmed: true,
      setupGranted: false,
      standing: "confirmed",
    });
  });

  it("refuses wrong codes, and the sixth makes the next wait", async () => {
    const { client, key } = await aPersonWithAnAuthenticator(app());

    const statuses = await wrongCodesFrom([client], key, 6);
    const held = await heldOn(client);
    const waiting = await client.json(AUTHENTICATOR, { code: codeOf(key) });

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
    expect(held.waits.authenticator).toBeGreaterThan(0);
    expect(waiting.status).toBe(429);
    expect(Number(waiting.headers.get("retry-after"))).toBeLessThanOrEqual(30);
    expect(await confirmedOf(client)).toBeNull();
  });

  it("checks one of several wrong codes sent at once", async () => {
    const { client, key } = await aPersonWithAnAuthenticator(app());
    await wrongCodesFrom([client], key, 5);

    const statuses = await Promise.all(
      Array.from(
        { length: 4 },
        async () => (await client.json(AUTHENTICATOR, { code: aWrongCode(codeOf(key)) })).status,
      ),
    );

    expect(statuses.toSorted((one, other) => one - other)).toEqual([400, 429, 429, 429]);
    expect((await heldOn(client)).waits.authenticator).toBeLessThanOrEqual(30);
  });

  it("caps one person's tries across five sessions", async () => {
    const person = await app().person();
    const clients: TestClient[] = [];
    for (let signedIn = 0; signedIn < 5; signedIn += 1) {
      clients.push(await signedInClient(app(), person.email));
    }
    // Set up after the five sign-ins: the api's own setup keeps its session signed in.
    const { setupAddress } = await setUpOn(clients.at(-1) ?? app().client());

    const statuses = await wrongCodesFrom(clients, keyIn(setupAddress), 7);

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 429]);
  });

  it("sends one notice for a run of wrong codes", async () => {
    const { person, client, key } = await aPersonWithAnAuthenticator(app());

    await wrongCodesFrom([client], key, 6);

    expect(noticesTo(person.email, FAILURES_NOTICE)).toBe(1);
  });

  it("refuses a person who holds no authenticator", async () => {
    const { client } = await aPersonSignedIn(app());

    const answered = await client.json(AUTHENTICATOR, { code: "123456" });

    expect(answered.status).toBe(409);
    expect(await answered.json()).toEqual({ error: "no-authenticator" });
  });

  it("lets a recovery code and passkey through while it waits", async () => {
    const { client, key, device, recoveryCodes } = await aPersonHoldingEverything(app());
    expect(await wrongCodesFrom([client], key, 7)).toContain(429);

    const spent = await client.json(RECOVERY, { code: recoveryCodes[0] });
    const confirmed = await confirmOn(client, device);

    expect(spent.status).toBe(200);
    expect(await spent.json()).toEqual({ granted: true });
    expect(confirmed.status).toBe(200);
  });
});

/** Ten codes made over tRPC and no factor, in the email session that made them. */
const aPersonHoldingCodesAlone = async () => {
  const { client } = await aPersonSignedIn(app());
  const { recoveryCodes } = await webClientOf(client).api.person.replaceRecoveryCodes.mutate({
    replacing: false,
  });
  return { client, recoveryCodes };
};

/** Everything held, a code spent in the unconfirmed session, and a new key's setup started there. */
const aReplacementStarted = async () => {
  const held = await aPersonHoldingEverything(app());
  expect((await held.client.json(RECOVERY, { code: held.recoveryCodes[0] })).status).toBe(200);
  const started = await held.client.json(REPLACE_START, {});
  return { ...held, ...startedAnswer.parse(await started.json()) };
};

describe("spending a recovery code", () => {
  it("grants setup to the spending session alone", async () => {
    const { person, client, recoveryCodes } = await aPersonHoldingEverything(app());
    const elsewhere = await signedInClient(app(), person.email);

    const spent = await client.json(RECOVERY, { code: recoveryCodes[0] });
    const refused = await elsewhere.json(REPLACE_START, {});
    const started = await client.json(REPLACE_START, {});

    expect(spent.status).toBe(200);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "setup-not-granted" });
    expect(started.status).toBe(200);
    expect((await heldOn(client)).thisSession).toMatchObject({
      confirmed: false,
      setupGranted: true,
    });
    expect(noticesTo(person.email, CODE_USED_NOTICE)).toBe(1);
  });

  it("refuses a code that is not one of the person's", async () => {
    const { client } = await aPersonHoldingEverything(app());

    const spent = await client.json(RECOVERY, { code: "0000-0000-0000-0000" });

    expect(spent.status).toBe(400);
    expect(await spent.json()).toEqual({ error: "recovery-code-wrong" });
    expect((await heldOn(client)).thisSession?.setupGranted).toBe(false);
  });

  it("leaves the old factors and codes when setup is abandoned", async () => {
    const { person, key, device } = await aReplacementStarted();

    const later = await signedInClient(app(), person.email);

    await confirmWithTheAuthenticator(later, key);
    expect((await confirmOn(later, device)).status).toBe(200);
    expect((await heldOn(later)).recoveryCodes?.unused).toBe(9);
  });
});

describe("replacing the factors after a spent code", () => {
  it("swaps in a new authenticator, answering ten fresh codes", async () => {
    const { person, client, recoveryCodes, setupAddress } = await aReplacementStarted();

    const finished = await client.json(REPLACE_FINISH, { code: codeNow(setupAddress) });

    expect(finished.status).toBe(200);
    const fresh = issued.parse(await finished.json());
    expect(fresh.recoveryCodes).toHaveLength(10);
    for (const code of fresh.recoveryCodes) expect(code).toMatch(RECOVERY_CODE);
    const held = await heldOn(client);
    expect(held.passkeys).toEqual([]);
    expect(held.authenticator).toBe("set-up");
    expect(held.thisSession).toMatchObject({ confirmed: true, setupGranted: false });
    expect(noticesTo(person.email, REPLACED_NOTICE)).toBe(1);
    const oldCode = await client.json(RECOVERY, { code: recoveryCodes[1] });
    expect(await oldCode.json()).toEqual({ error: "recovery-code-wrong" });
  });

  it("confirms with the new key's code, never the old key's", async () => {
    const { person, client, key, setupAddress } = await aReplacementStarted();
    expect((await client.json(REPLACE_FINISH, { code: codeNow(setupAddress) })).status).toBe(200);
    const later = await signedInClient(app(), person.email);

    const withTheOld = await later.json(AUTHENTICATOR, { code: codeOf(key) });
    const withTheNew = await later.json(AUTHENTICATOR, { code: codeNow(setupAddress) });

    expect(withTheOld.status).toBe(400);
    expect(await withTheOld.json()).toEqual({ error: "code-wrong" });
    expect(withTheNew.status).toBe(200);
  });

  it("swaps in a new passkey, answering ten fresh codes", async () => {
    const { person, client, recoveryCodes } = await aPersonHoldingEverything(app());
    await client.json(RECOVERY, { code: recoveryCodes[0] });

    const { answered } = await passkeyAddedOn(client);

    expect(answered.status).toBe(200);
    const added = issued.extend({ passkeyId: z.string() }).parse(await answered.json());
    expect(added.recoveryCodes).toHaveLength(10);
    const held = await heldOn(client);
    expect(held.passkeys.map((passkey) => passkey.id)).toEqual([added.passkeyId]);
    expect(held.authenticator).toBe("none");
    expect(held.thisSession).toMatchObject({ confirmed: true, setupGranted: false });
    expect(noticesTo(person.email, REPLACED_NOTICE)).toBe(1);
  });

  it("refuses a wrong code for the new key, changing nothing", async () => {
    const { client, setupAddress } = await aReplacementStarted();

    const finished = await client.json(REPLACE_FINISH, {
      code: aWrongCode(codeNow(setupAddress)),
    });

    expect(finished.status).toBe(400);
    expect(await finished.json()).toEqual({ error: "code-wrong" });
    expect((await heldOn(client)).passkeys).toHaveLength(1);
  });

  it("refuses a finish from a session without the grant", async () => {
    const { client } = await aPersonHoldingEverything(app());

    const finished = await client.json(REPLACE_FINISH, { code: "123456" });

    expect(finished.status).toBe(409);
    expect(await finished.json()).toEqual({ error: "setup-not-granted" });
  });

  it("refuses a first setup's start to a granted session", async () => {
    const { client, recoveryCodes } = await aPersonHoldingCodesAlone();
    await client.json(RECOVERY, { code: recoveryCodes[0] });

    const started = await client.json("/authenticator/start", {});

    expect(started.status).toBe(409);
    expect(await started.json()).toEqual({ error: "replacement-setup-needed" });
  });

  it("refuses a first setup's finish to a granted session", async () => {
    const { client, recoveryCodes } = await aPersonHoldingCodesAlone();
    const { setupAddress } = startedAnswer.parse(
      await (await client.json("/authenticator/start", {})).json(),
    );
    await client.json(RECOVERY, { code: recoveryCodes[0] });

    const finished = await client.json("/authenticator/finish", { code: codeNow(setupAddress) });

    expect(finished.status).toBe(409);
    expect(await finished.json()).toEqual({ error: "replacement-setup-needed" });
    expect((await heldOn(client)).authenticator).toBe("awaiting-code");
  });

  it("refuses a finish no setup was started for", async () => {
    const { client, recoveryCodes } = await aPersonHoldingEverything(app());
    await client.json(RECOVERY, { code: recoveryCodes[0] });

    const finished = await client.json(REPLACE_FINISH, { code: "123456" });

    expect(finished.status).toBe(409);
    expect(await finished.json()).toEqual({ error: "changed-meanwhile" });
  });
});

/** A person the operator has restored, signed in again by email, with the code they were handed. */
const aRestoredPerson = async () => {
  const person = await app().person();
  const code = await restoredByTheOperator(app(), person.email);
  return { person, client: await signedInClient(app(), person.email), code };
};

describe("setting up after an operator's restore", () => {
  it("waits on the restore code before any setup", async () => {
    const { client } = await aRestoredPerson();

    const answers = [
      await client.json("/authenticator/start", {}),
      await client.json("/passkeys/add-options", { name: "Phone" }),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([409, 409]);
    for (const answer of answers) {
      expect(await answer.json()).toEqual({ error: "restore-code-needed" });
    }
  });

  it("refuses an add asked for before the restore", async () => {
    const { person, client } = await aPersonSignedIn(app());
    const asked = await client.json("/passkeys/add-options", { name: "Phone" });
    const response = aPasskeyDevice(client.origin).create(await asked.json());
    await restoredWithACode(app().database.superuser, person.email, new Date());

    const answered = await client.json("/passkeys/add", { name: "Phone", response });

    expect(answered.status).toBe(409);
    expect(await answered.json()).toEqual({ error: "restore-code-needed" });
  });

  it("refuses an authenticator started before the restore", async () => {
    const { person, client } = await aPersonSignedIn(app());
    const { setupAddress } = startedAnswer.parse(
      await (await client.json("/authenticator/start", {})).json(),
    );
    await restoredWithACode(app().database.superuser, person.email, new Date());

    const finished = await client.json("/authenticator/finish", { code: codeNow(setupAddress) });

    expect(finished.status).toBe(409);
    expect(await finished.json()).toEqual({ error: "restore-code-needed" });
    expect((await heldOn(client)).authenticator).toBe("awaiting-code");
  });

  it("refuses setup to a grant from before the restore", async () => {
    const { person, client, recoveryCodes } = await aPersonHoldingEverything(app());
    expect((await client.json(RECOVERY, { code: recoveryCodes[0] })).status).toBe(200);
    const restoredLater = new Date(Date.now() + 1000);
    await restoredWithACode(app().database.superuser, person.email, restoredLater);

    const answers = [
      await client.json("/authenticator/start", {}),
      await client.json("/passkeys/add-options", { name: "Phone" }),
      await client.json(REPLACE_START, {}),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([409, 409, 409]);
    expect(await Promise.all(answers.map(async (answer) => answer.json()))).toEqual([
      { error: "restore-code-needed" },
      { error: "restore-code-needed" },
      { error: "setup-not-granted" },
    ]);
    expect((await heldOn(client)).thisSession?.setupGranted).toBe(false);
  });

  it("refuses a recovery code and new codes while restored", async () => {
    const { person, client, recoveryCodes } = await aPersonHoldingEverything(app());
    await restoredWithACode(app().database.superuser, person.email, new Date());

    const spent = await client.json(RECOVERY, { code: recoveryCodes[0] });
    const made = await refusalOfCall(
      webClientOf(client).api.person.replaceRecoveryCodes.mutate({ replacing: true }),
    );

    expect(spent.status).toBe(409);
    expect(await spent.json()).toEqual({ error: "restore-code-needed" });
    expect(made).toMatchObject({
      data: { refusal: { word: "restore-code-needed", class: "precondition" } },
    });
    const held = await heldOn(client);
    expect(held.recoveryCodes?.unused).toBe(10);
    expect(held.thisSession?.setupGranted).toBe(false);
    expect(noticesTo(person.email, CODE_USED_NOTICE)).toBe(0);
  });

  it("refuses a wrong or expired restore code, granting nothing", async () => {
    const { person, client, code } = await aRestoredPerson();
    const wrong = await client.json(RESTORE, { code: "not-the-code" });
    await app().database.superuser.query(
      "UPDATE verification SET expires_at = $2 WHERE identifier = $1",
      [`operator-restore-${person.email.toLowerCase()}`, new Date(Date.now() - 60_000)],
    );

    const expired = await client.json(RESTORE, { code });

    expect([wrong.status, expired.status]).toEqual([400, 400]);
    expect(await expired.json()).toEqual({ error: "restore-code-wrong" });
    expect((await heldOn(client)).thisSession?.setupGranted).toBe(false);
  });

  it("grants setup once for the right restore code", async () => {
    const { client, code } = await aRestoredPerson();

    const accepted = await client.json(RESTORE, { code });
    const again = await client.json(RESTORE, { code });
    const firstSetup = await client.json("/authenticator/start", {});
    const started = await client.json(REPLACE_START, {});

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ granted: true });
    expect(again.status).toBe(400);
    expect(firstSetup.status).toBe(409);
    expect(await firstSetup.json()).toEqual({ error: "replacement-setup-needed" });
    expect(started.status).toBe(200);
  });
});

describe("the confirm and recovery routes", () => {
  it.each(ROUTES)("refuses %s with no session", async (path) => {
    const answered = await app().client().json(path, {});

    expect(answered.status).toBe(401);
    expect(await answered.json()).toEqual({ error: "not_signed_in" });
  });

  it.each(ROUTES)("refuses a cross-site post to %s", async (path) => {
    const { client } = await aPersonSignedIn(app());

    const refused = await client.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://elsewhere.example" },
      body: "{}",
    });

    expect(refused.status).toBe(403);
  });

  it.each(ROUTES)("answers 429 at %s past ten tries", async (path) => {
    const { client } = await aPersonSignedIn(app());
    const statuses: number[] = [];

    stopTheClock();
    for (let asked = 0; asked < 11; asked += 1) {
      statuses.push((await client.json(path, {})).status);
    }

    expect(statuses.slice(0, -1)).not.toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("an email sign-in", () => {
  it("leaves the session unconfirmed, even with a factor held", async () => {
    const { person, client } = await aPersonWithAnAuthenticator(app());

    expect(await confirmedOf(client)).toBeNull();
    expect((await sessionsOf(person.id)).map((session) => session.confirmed)).toEqual([null]);
  });
});
