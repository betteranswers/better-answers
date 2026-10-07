import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { keyIn } from "@better-answers/schema/testing/authenticator-code";

import { setActiveWorkspace } from "./flow.ts";
import {
  aPersonSignedIn,
  aWrongCode,
  anAdminSignedIn as anAdminSignedInTo,
  codeNow,
  sessionsSignedInOverAnHourAgo,
  setUpOn,
  signedInByEmailOnly,
  startOn,
  whileCommitsAreRefused,
} from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { webClientOf, webSignedIn } from "./web-client.ts";

/** While set, the relay holds every message to the address until the test ends. */
let mailHeld: { readonly to: string; readonly until: Promise<void> } | undefined;

const app = appForSuite({
  onEmail: async (message) => {
    if (message.to === mailHeld?.to) await mailHeld.until;
  },
});

const mailHeldFor = (to: string): void => {
  const held = Promise.withResolvers<void>();
  mailHeld = { to, until: held.promise };
  onTestFinished(() => {
    mailHeld = undefined;
    held.resolve();
  });
};

const START = "/authenticator/start";
const FINISH = "/authenticator/finish";

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const ADDED = "An authenticator was set up on your better-answers account";

const finished = z.union([
  z.object({ recoveryCodes: z.array(z.string()), madeAt: z.iso.datetime() }),
  z.object({ recoveryCodes: z.null() }),
]);
const sessionRead = z.object({ session: z.object({ id: z.string() }) }).nullable();

const aSignedInPerson = () => aPersonSignedIn(app());

const anAdminSignedIn = () => anAdminSignedInTo(app());

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

const agesOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ id: string; createdAt: Date; expiresAt: Date }>(
      'SELECT id, created_at AS "createdAt", expires_at AS "expiresAt" FROM session WHERE user_id = $1',
      [personId],
    )
  ).rows;

const revokedAtOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ revokedAt: Date | null }>(
      'SELECT credentials_revoked_at AS "revokedAt" FROM "user" WHERE id = $1',
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
    const [one, other] = [await app().provision(), await app().provision()];
    const person = await app().person();
    await app().addMember(one.workspaceId, person.id, "Viewer");
    await app().addMember(other.workspaceId, person.id, "Viewer");
    const client = await signedInByEmailOnly(app(), person.email);
    const picked = await setActiveWorkspace(client, other.workspaceId);
    expect(picked.status, "the workspace was not picked").toBe(200);

    await setUpOn(client);

    const held = await app().database.superuser.query<{ workspace: string | null }>(
      "SELECT active_workspace_id AS workspace FROM session WHERE user_id = $1",
      [person.id],
    );
    expect(held.rows).toEqual([{ workspace: other.workspaceId }]);
  });

  it("keeps the old session's age across the session swap", async () => {
    const { person, client } = await aSignedInPerson();
    const [before] = await agesOf(person.id);

    await setUpOn(client);

    const after = await agesOf(person.id);
    expect(after).toEqual([
      { id: expect.any(String), createdAt: before?.createdAt, expiresAt: before?.expiresAt },
    ]);
    expect(after[0]?.id).not.toBe(before?.id);
  });

  it("refuses a revoked member's workspace after the session swap", async () => {
    const workspace = await app().provision();
    const person = await app().person();
    await app().addMember(workspace.workspaceId, person.id, "Editor");
    const { client, api } = await webSignedIn(app(), person.email);
    const { api: admin } = await webSignedIn(app(), workspace.admin.email);
    await admin.members.endEverySignInAndToken.mutate({ personId: person.id });

    const { answered } = await setUpOn(client);

    expect(answered.status).toBe(200);
    expect(await refusalOf(api.session.membership.query())).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "credentials-revoked", class: "unauthenticated" } },
    });
  });

  it("refuses the operator's hour-old sign-in after the session swap", async () => {
    const workspace = await app().provision();
    await app().markOperator(workspace.admin.email, "grant");
    const client = await signedInByEmailOnly(app(), workspace.admin.email);
    const { api } = webClientOf(client);
    const person = await app().person();
    await sessionsSignedInOverAnHourAgo(app(), workspace.admin.id);

    const { answered } = await setUpOn(client);

    expect(answered.status).toBe(200);
    expect(
      await refusalOf(api.console.people.endEverySignInAndToken.mutate({ personId: person.id })),
    ).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "sign-in-too-old", class: "unauthenticated" } },
    });
    expect(await revokedAtOf(person.id)).toEqual([{ revokedAt: null }]);
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

  it("answers the codes while the notice is still sending", async () => {
    const { person, client } = await aSignedInPerson();
    mailHeldFor(person.email);

    const { answered } = await setUpOn(client);

    expect(answered.status).toBe(200);
    expect(finished.parse(await answered.json()).recoveryCodes).toHaveLength(10);
  });

  it("answers unanswered when the setup cannot be recorded", async () => {
    const { person, client } = await aSignedInPerson();
    const setupAddress = await startOn(client);

    const answered = await whileCommitsAreRefused(app(), "identity_audit_event", () =>
      client.json(FINISH, { code: codeNow(setupAddress) }),
    );

    expect(answered.status).toBe(502);
    expect(await answered.json()).toEqual({ error: "unanswered" });
    expect(answered.headers.getSetCookie()).toEqual([]);
    expect(await factorOf(person.id)).toEqual({ enabled: true, verified: true });
    expect(noticesTo(person.email)).toEqual([]);
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
    const { recoveryCodes } = await api.person.replaceRecoveryCodes.mutate({ replacing: false });

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

    const { recoveryCodes } = await webClientOf(client).api.person.replaceRecoveryCodes.mutate({
      replacing: true,
    });

    expect(recoveryCodes).toHaveLength(10);
    expect(subjectsTo(person.email)).toEqual([
      ADDED,
      "Your better-answers recovery codes were replaced",
    ]);
  });

  it("answers the codes while the notice is still sending", async () => {
    const { person, client } = await aSignedInPerson();
    await setUpOn(client);
    mailHeldFor(person.email);

    const { recoveryCodes } = await webClientOf(client).api.person.replaceRecoveryCodes.mutate({
      replacing: true,
    });

    expect(recoveryCodes).toHaveLength(10);
  });

  it("sends one notice for a first set", async () => {
    const { person, client } = await aSignedInPerson();

    await webClientOf(client).api.person.replaceRecoveryCodes.mutate({ replacing: false });

    expect(subjectsTo(person.email)).toEqual([
      "Recovery codes were made for your better-answers account",
    ]);
  });

  it("refuses a first set while one is held", async () => {
    const { person, client } = await aSignedInPerson();
    const { api } = webClientOf(client);
    await api.person.replaceRecoveryCodes.mutate({ replacing: false });

    const refused = await refusalOf(api.person.replaceRecoveryCodes.mutate({ replacing: false }));

    expect(refused).toMatchObject({
      data: { httpStatus: 409, refusal: { word: "recovery-codes-held", class: "conflict" } },
    });
    expect(subjectsTo(person.email)).toEqual([
      "Recovery codes were made for your better-answers account",
    ]);
  });

  it("marks the set saved once acknowledged", async () => {
    const { person, client } = await aSignedInPerson();
    const { api } = webClientOf(client);
    const { madeAt } = await api.person.replaceRecoveryCodes.mutate({ replacing: false });

    await api.person.acknowledgeRecoveryCodes.mutate({ madeAt });

    const saved = await app().database.superuser.query<{ acknowledged: boolean }>(
      'SELECT recovery_codes_acknowledged AS acknowledged FROM "user" WHERE id = $1',
      [person.id],
    );
    expect(saved.rows).toEqual([{ acknowledged: true }]);
  });
});
