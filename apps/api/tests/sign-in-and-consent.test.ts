import { describe, expect, it } from "vitest";
import { z } from "zod";

import { whileWritesAreRefused } from "@better-answers/core/testing/postgres";

import { authorizeUrl, connectAsHost, driveToPage, pkce, signIn } from "./flow.ts";
import { CLAUDE_CLIENT_ID, PUBLIC_URL, type TestApp } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const USER_AGENT = "Distinctive-Browser/7.3 (sign-in audit probe)";

const REFUSED_AUDIT_LOG = "the store refused a write to identity_audit_event";
const REFUSED_WORKSPACE_AUDIT_LOG = "the store refused a write to audit_event";

const sessionHolder = z.object({ user: z.object({ id: z.string() }) });

const signInRowsOf = (personId: string) =>
  app().database.superuser.query(
    `SELECT act, actor, subject_id, detail, row_to_json(identity_audit_event)::text AS whole
       FROM identity_audit_event
      WHERE act = 'people.person.signed_in' AND subject_id = $1`,
    [personId],
  );

const consentRowsBy = (personId: string) =>
  app().database.superuser.query(
    `SELECT workspace_id, act, actor, subject_id, detail FROM audit_event
      WHERE act = 'people.client.consented' AND actor = $1`,
    [`human:${personId}`],
  );

const unrecorded = () => app().logs.filter((line) => line["recorded"] === false);

const linesSince = (before: number, event: string) =>
  app()
    .logs.slice(before)
    .filter((line) => line["event"] === event);

/** A client of its own, and the code just sent to `email` for it. */
const codeAskedFor = async (email: string) => {
  const client = app().client();
  await client.json("/email-otp/send-verification-otp", { email, type: "sign-in" });
  return { client, code: app().codeSentTo(email) };
};

/** A member of two workspaces, so a consent's workspace is the one they picked. */
const memberOfTwo = async (testApp: TestApp) => {
  const first = await testApp.provision();
  const second = await testApp.provision();
  await testApp.addMember(second.workspaceId, first.admin.id, "Viewer");
  return { person: first.admin, second: second.workspaceId };
};

describe("a sign-in, recorded on the identity-set audit log", () => {
  it("records the person as actor and subject, with empty detail", async () => {
    const person = await app().person();

    await signIn(app(), app().client(), person.email);

    const recorded = await signInRowsOf(person.id);
    expect(recorded.rows).toMatchObject([
      {
        act: "people.person.signed_in",
        actor: `human:${person.id}`,
        subject_id: person.id,
        detail: {},
      },
    ]);
  });

  it("carries no address, IP or user agent in its row", async () => {
    const person = await app().person();
    const { client, code } = await codeAskedFor(person.email);

    const signedIn = await client.fetch("/sign-in/email-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({ email: person.email, otp: code }),
    });

    expect(signedIn.status).toBe(200);
    const session = await app().database.superuser.query(
      "SELECT ip_address, user_agent FROM session WHERE user_id = $1",
      [person.id],
    );
    expect(session.rows).toEqual([{ ip_address: client.ip, user_agent: USER_AGENT }]);
    const [row] = (await signInRowsOf(person.id)).rows;
    expect(row?.whole).toEqual(expect.any(String));
    expect(row?.whole).not.toContain(person.email);
    expect(row?.whole).not.toContain(client.ip);
    expect(row?.whole).not.toContain(USER_AGENT);
  });

  it("keeps a refused code a log line, recording nothing", async () => {
    const person = await app().person();
    const { client, code } = await codeAskedFor(person.email);
    const wrong = code === "000000" ? "111111" : "000000";
    const before = app().logs.length;

    const refused = await client.json("/sign-in/email-otp", { email: person.email, otp: wrong });

    expect(refused.status).toBe(400);
    expect((await signInRowsOf(person.id)).rows).toEqual([]);
    expect(linesSince(before, "auth.sign_in")).toMatchObject([{ level: 30, outcome: "refused" }]);
  });

  it("signs the person in though its record fails, logging it", async () => {
    const person = await app().person();
    const client = app().client();
    const before = unrecorded().length;

    await whileWritesAreRefused(app().database.superuser, "identity_audit_event", () =>
      signIn(app(), client, person.email),
    );

    expect((await signInRowsOf(person.id)).rows).toEqual([]);
    const session = sessionHolder.parse(await (await client.fetch("/get-session")).json());
    expect(session.user.id).toBe(person.id);
    expect(unrecorded().slice(before)).toMatchObject([
      {
        level: 50,
        event: "auth.sign_in",
        outcome: "ok",
        principal: person.id,
        reason: REFUSED_AUDIT_LOG,
      },
    ]);
  });
});

describe("a consent, recorded on the consented workspace's audit log", () => {
  it("records the client under the person in the picked workspace", async () => {
    const { person, second } = await memberOfTwo(app());

    await connectAsHost(app(), app().client(), person, { pick: second });

    expect((await consentRowsBy(person.id)).rows).toEqual([
      {
        workspace_id: second,
        act: "people.client.consented",
        actor: `human:${person.id}`,
        subject_id: CLAUDE_CLIENT_ID,
        detail: {},
      },
    ]);
  });

  it("keeps a declined consent a log line, recording nothing", async () => {
    const { admin } = await app().provision();
    const client = app().client();
    const consent = await driveToPage(app(), client, admin);
    expect(consent.pathname).toBe("/consent");
    const before = app().logs.length;

    const declined = await client.form(`${PUBLIC_URL}/consent${consent.search}`, {
      accept: "false",
    });

    expect(declined.status).toBe(302);
    expect(declined.headers.get("location")).toContain("error=access_denied");
    expect((await consentRowsBy(admin.id)).rows).toEqual([]);
    expect(linesSince(before, "auth.consent")).toMatchObject([
      { level: 30, principal: admin.id, outcome: "declined" },
    ]);
  });

  it("records nothing when sent to sign in again first", async () => {
    const { admin } = await app().provision();
    const client = app().client();
    await signIn(app(), client, admin.email);
    const asked = authorizeUrl({
      challenge: pkce().challenge,
      scope: "knowledge:read",
      prompt: "login consent",
    });
    const start = await client.fetch(`${PUBLIC_URL}${asked}`, { redirect: "manual" });
    const toSignIn = new URL(start.headers.get("location") ?? "", PUBLIC_URL);
    expect(toSignIn.pathname).toBe("/sign-in");
    const before = app().logs.length;

    const answered = await client.form(`${PUBLIC_URL}/consent${toSignIn.search}`, {
      accept: "true",
    });

    expect((await consentRowsBy(admin.id)).rows).toEqual([]);
    expect(new URL(answered.headers.get("location") ?? "", PUBLIC_URL).pathname).toBe("/sign-in");
    expect(linesSince(before, "auth.consent")).toMatchObject([
      { level: 30, principal: admin.id, outcome: "deferred" },
    ]);
  });

  it("connects the client though its record fails, logging it", async () => {
    const { person, second } = await memberOfTwo(app());
    const before = unrecorded().length;

    const connected = await whileWritesAreRefused(app().database.superuser, "audit_event", () =>
      connectAsHost(app(), app().client(), person, { pick: second }),
    );

    expect((await consentRowsBy(person.id)).rows).toEqual([]);
    expect(connected.claims).toMatchObject({ workspace: second, user: person.id });
    expect(unrecorded().slice(before)).toMatchObject([
      {
        level: 50,
        event: "auth.consent",
        outcome: "ok",
        principal: person.id,
        client_id: CLAUDE_CLIENT_ID,
        reason: REFUSED_WORKSPACE_AUDIT_LOG,
      },
    ]);
  });
});
