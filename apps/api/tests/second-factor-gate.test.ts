import { describe, expect, it } from "vitest";
import { z } from "zod";

import { confirmedByTheHarness, holdAnAuthenticator } from "./factor-harness.ts";
import {
  authorizeUrl,
  confirmWithTheAuthenticator,
  connectAsHost,
  continueAfterPostLogin,
  pkce,
  setActiveWorkspace,
  signInByEmailOnly,
} from "./flow.ts";
import { PUBLIC_URL, type TestClient } from "./harness.ts";
import type { PasskeyDevice } from "./passkey-device.ts";
import { passkeyAddedOn, setUpOn, signedInByEmailOnly } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { refusalOfCall, webClientOf } from "./web-client.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Moved forward to stand an hour past a pending read without waiting it out. */
const shift = { ms: 0 };

const app = appForSuite({ clock: { now: () => new Date(Date.now() + shift.ms) } });

const PENDING = { data: { httpStatus: 412, refusal: { word: "second-factor-pending" } } };

const NO_SESSION = { data: { httpStatus: 401, refusal: { word: "no-session" } } };

const apiOf = (client: TestClient) => webClientOf(client).api;

const memberOf = (client: TestClient) =>
  apiOf(client)
    .session.member.query()
    .catch((refused: unknown) => refused);

const standingOf = async (client: TestClient) =>
  (await apiOf(client).person.secondFactor.query()).thisSession?.standing;

const signedInByPasskey = async (device: PasskeyDevice): Promise<TestClient> => {
  const client = app().client();
  const asked = await client.json("/passkeys/sign-in-options", {});
  expect(asked.status, "the sign-in was not asked").toBe(200);
  const signedIn = await client.json("/passkeys/sign-in", {
    response: device.get(await asked.json()),
  });
  expect(signedIn.status, "the passkey did not sign in").toBe(200);
  return client;
};

/** A new workspace's Admin holding an authenticator, and the key its codes come from. */
const anAdminHolding = async () => {
  const workspace = await app().provision();
  const key = await holdAnAuthenticator(app(), workspace.admin.id);
  return { workspace, admin: workspace.admin, key };
};

const sessionRowsOf = async (personId: string) =>
  (
    await app().database.superuser.query<{ id: string; pending: Date | null }>(
      "SELECT id, pending_since AS pending FROM session WHERE user_id = $1 ORDER BY created_at",
      [personId],
    )
  ).rows;

/** Through the Members page's own action, by the workspace's confirmed Admin. */
const madeAnAdminBy = async (adminEmail: string, personId: string): Promise<void> => {
  const adminClient = await signedInByEmailOnly(app(), adminEmail);
  await confirmedByTheHarness(app(), adminClient);
  await apiOf(adminClient).members.changeRole.mutate({ personId, role: "Admin" });
};

describe("an Admin's sign-in", () => {
  it("reaches confirm by email, and lands directly by passkey", async () => {
    const { admin } = await app().provision();
    const { device } = await passkeyAddedOn(await signedInByEmailOnly(app(), admin.email));

    const byEmail = await signedInByEmailOnly(app(), admin.email);
    const byPasskey = await signedInByPasskey(device);

    expect(await memberOf(byEmail)).toMatchObject(PENDING);
    expect(await standingOf(byEmail)).toBe("confirm");
    expect(await memberOf(byPasskey)).toMatchObject({ role: "Admin" });
  });

  it("confirms first on the way to a workspace they view", async () => {
    const { admin, key } = await anAdminHolding();
    const elsewhere = await app().provision();
    await app().addMember(elsewhere.workspaceId, admin.id, "Viewer");
    const client = await signedInByEmailOnly(app(), admin.email);

    const whilePending = await setActiveWorkspace(client, elsewhere.workspaceId);
    await confirmWithTheAuthenticator(client, key);
    const confirmed = await setActiveWorkspace(client, elsewhere.workspaceId);

    expect([whilePending.status, confirmed.status]).toEqual([403, 200]);
    expect(await memberOf(client)).toMatchObject({ role: "Viewer" });
  });

  it("never passes the factor step on an email link alone", async () => {
    const { admin } = await app().provision();
    const { answered } = await setUpOn(await signedInByEmailOnly(app(), admin.email));
    const [recoveryCode] = z
      .object({ recoveryCodes: z.array(z.string()) })
      .parse(await answered.json()).recoveryCodes;
    const client = app().client();
    await client.json("/email-otp/send-verification-otp", { email: admin.email, type: "sign-in" });
    const linked = await client.json("/sign-in-link/sign-in", {
      token: app().linkSentTo(admin.email),
    });
    expect(linked.status, "the link did not sign in").toBe(200);

    const byTheLink = await standingOf(client);
    const spent = await client.json("/second-factor/recovery", { code: recoveryCode });

    expect([byTheLink, spent.status, await standingOf(client)]).toEqual(["confirm", 200, "setup"]);
    expect(await memberOf(client)).toMatchObject(PENDING);
  });

  it("never holds a non-Admin's email sign-in pending", async () => {
    const workspace = await app().provision();
    const [editor, viewer] = [await app().person(), await app().person()];
    await app().addMember(workspace.workspaceId, editor.id, "Editor");
    await app().addMember(workspace.workspaceId, viewer.id, "Viewer");

    for (const person of [editor, viewer]) {
      const client = await signedInByEmailOnly(app(), person.email);
      expect(await standingOf(client)).toBe("not-required");
      expect(await memberOf(client)).toMatchObject({
        workspace: { id: workspace.workspaceId },
      });
    }
  });
});

describe("what a pending session reaches", () => {
  it("refuses a pending operator the console's people list", async () => {
    const operator = await app().person();
    await app().markOperator(operator.email, "grant");
    await holdAnAuthenticator(app(), operator.id);
    const api = apiOf(await signedInByEmailOnly(app(), operator.email));

    expect(await refusalOfCall(api.console.people.list.query({}))).toMatchObject(PENDING);
    expect(await api.session.operator.query()).toMatchObject({ operator: true });
  });

  it("refuses a pending session at /me and /consent", async () => {
    const { admin } = await anAdminHolding();
    const client = await signedInByEmailOnly(app(), admin.email);

    const me = await client.fetch("/me");
    const consent = await client.fetch("/consent?client_id=x&sig=y", {
      redirect: "manual",
      headers: { "sec-fetch-dest": "document" },
    });

    expect([me.status, await me.json()]).toEqual([403, { error: "second-factor-pending" }]);
    expect([consent.status, consent.headers.get("location")]).toEqual([
      302,
      "/confirm?client_id=x&sig=y",
    ]);
  });

  it("refuses setup to a session holding a factor to confirm", async () => {
    const { admin } = await anAdminHolding();
    const { admin: holdingNone } = await app().provision();
    const pending = await signedInByEmailOnly(app(), admin.email);
    const withNothing = await signedInByEmailOnly(app(), holdingNone.email);

    const refused = [
      await pending.json("/authenticator/start", {}),
      await pending.json("/passkeys/add-options", { name: "Phone" }),
    ];
    const started = await withNothing.json("/authenticator/start", {});

    expect(refused.map((answer) => answer.status)).toEqual([403, 403]);
    expect(await refused[0]?.json()).toEqual({ error: "second-factor-pending" });
    expect(started.status).toBe(200);
  });

  it("answers /get-session for a pending session without renewing it", async () => {
    const { admin } = await anAdminHolding();
    const pending = await signedInByEmailOnly(app(), admin.email);
    const confirmed = await signedInByEmailOnly(app(), admin.email);
    await confirmedByTheHarness(app(), confirmed);
    const dueARenewal = new Date(Date.now() + 5 * 24 * ONE_HOUR_MS);
    await app().database.superuser.query("UPDATE session SET expires_at = $2 WHERE user_id = $1", [
      admin.id,
      dueARenewal,
    ]);

    const reads = [await pending.fetch("/get-session"), await confirmed.fetch("/get-session")];

    expect(reads.map((read) => read.status)).toEqual([200, 200]);
    const expiries = await app().database.superuser.query<{ expires: Date; stamped: boolean }>(
      `SELECT expires_at AS expires, second_factor_confirmed_at IS NOT NULL AS stamped
         FROM session WHERE user_id = $1`,
      [admin.id],
    );
    const pendingRow = expiries.rows.find((row) => !row.stamped);
    const confirmedRow = expiries.rows.find((row) => row.stamped);
    expect(pendingRow?.expires).toEqual(dueARenewal);
    expect(confirmedRow?.expires.getTime()).toBeGreaterThan(dueARenewal.getTime());
  });
});

describe("connecting Claude from a pending session", () => {
  it("issues no code until the session confirms, then resumes", async () => {
    const { admin, key } = await anAdminHolding();
    await connectAsHost(app(), app().client(), admin);
    const client = app().client();
    const { challenge } = pkce();
    const asked = new URL(authorizeUrl({ challenge, scope: "knowledge:read" }), PUBLIC_URL);
    // No prompt: with consent already given, a confirmed session would be handed a code at once.
    asked.searchParams.delete("prompt");
    const start = await client.fetch(asked.href, { redirect: "manual" });
    const query = new URL(start.headers.get("location") ?? "", PUBLIC_URL).search;
    await signInByEmailOnly(app(), client, admin.email);

    const resumed = await client.fetch(`${PUBLIC_URL}/oauth2/authorize${query}`, {
      redirect: "manual",
    });
    const continued = await client.json("/oauth2/continue", {
      postLogin: true,
      oauth_query: query.slice(1),
    });
    await confirmWithTheAuthenticator(client, key);
    const after = await continueAfterPostLogin(client, query);

    const resumedTo = new URL(resumed.headers.get("location") ?? "", PUBLIC_URL);
    expect([resumedTo.pathname, resumedTo.searchParams.has("code")]).toEqual([
      "/choose-workspace",
      false,
    ]);
    expect(continued.status).toBe(403);
    expect(after.searchParams.has("code")).toBe(true);
  });
});

describe("becoming an Admin mid-session", () => {
  it("makes the next page setup after accepting an Admin invitation", async () => {
    const elsewhere = await app().provision();
    const person = await app().person();
    await app().addMember(elsewhere.workspaceId, person.id, "Viewer");
    const client = await signedInByEmailOnly(app(), person.email);
    const inviting = await app().provision();
    const invitation = await app().invite({
      workspaceId: inviting.workspaceId,
      email: person.email,
      inviterId: inviting.admin.id,
      role: "Admin",
    });
    const before = await standingOf(client);

    await apiOf(client).person.acceptInvitation.mutate({ invitationId: invitation.id });

    expect([before, await standingOf(client)]).toEqual(["not-required", "setup"]);
    expect(await memberOf(client)).toMatchObject(PENDING);
  });

  it("makes the next request pending and sends the credential list", async () => {
    const workspace = await app().provision();
    const editor = await app().person();
    await app().addMember(workspace.workspaceId, editor.id, "Editor");
    const { device } = await passkeyAddedOn(await signedInByEmailOnly(app(), editor.email));
    const promoted = await signedInByPasskey(device);
    expect(await memberOf(promoted)).toMatchObject({ role: "Editor" });
    await madeAnAdminBy(workspace.admin.email, editor.id);

    expect(await memberOf(promoted)).toMatchObject(PENDING);
    expect(await standingOf(promoted)).toBe("confirm");
    await expect
      .poll(
        () =>
          app()
            .emails.filter((sent) => sent.to === editor.email)
            .at(-1)?.subject,
      )
      .toBe("You're now an Admin on better-answers");
    const notice = app()
      .emails.filter((sent) => sent.to === editor.email)
      .at(-1);
    expect(notice?.text).toMatch(/^Passkey · Phone · added \d{1,2} \w+ \d{4}$/m);
  });
});

describe("a pending session's hour", () => {
  it("ends a pending session an hour after its first read", async () => {
    const { admin } = await anAdminHolding();
    const client = await signedInByEmailOnly(app(), admin.email);
    expect(await memberOf(client)).toMatchObject(PENDING);

    shift.ms = ONE_HOUR_MS + 60_000;
    try {
      expect(await memberOf(client)).toMatchObject(NO_SESSION);
    } finally {
      shift.ms = 0;
    }
    expect(await sessionRowsOf(admin.id)).toEqual([]);
  });

  it("refuses a held session past its hour at the library", async () => {
    const { admin } = await anAdminHolding();
    const client = await signedInByEmailOnly(app(), admin.email);
    expect(await memberOf(client)).toMatchObject(PENDING);
    const holder = await app().database.superuser.connect();

    shift.ms = ONE_HOUR_MS + 60_000;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM session WHERE user_id = $1 FOR UPDATE", [admin.id]);

      const listed = await client.fetch("/organization/list");

      expect(listed.status).toBe(401);
      expect(await sessionRowsOf(admin.id)).toHaveLength(1);
    } finally {
      shift.ms = 0;
      await holder.query("ROLLBACK");
      holder.release();
    }
  });

  it("keeps an older session an hour from its next request", async () => {
    const { admin } = await anAdminHolding();
    const client = await signedInByEmailOnly(app(), admin.email);
    await app().database.superuser.query(
      "UPDATE session SET created_at = now() - interval '3 days', pending_since = NULL WHERE user_id = $1",
      [admin.id],
    );

    shift.ms = ONE_HOUR_MS * 5;
    try {
      const first = await memberOf(client);
      shift.ms = ONE_HOUR_MS * 6 - 60_000;
      const withinTheHour = await memberOf(client);
      shift.ms = ONE_HOUR_MS * 6 + 60_000;
      const pastIt = await memberOf(client);

      expect([first, withinTheHour, pastIt]).toMatchObject([PENDING, PENDING, NO_SESSION]);
    } finally {
      shift.ms = 0;
    }
  });

  it("sends a new Admin's old session to setup, not away", async () => {
    const workspace = await app().provision();
    const editor = await app().person();
    await app().addMember(workspace.workspaceId, editor.id, "Editor");
    const client = await signedInByEmailOnly(app(), editor.email);
    await app().database.superuser.query(
      `UPDATE session SET created_at = now() - interval '3 hours',
                          pending_since = now() - interval '2 hours'
        WHERE user_id = $1`,
      [editor.id],
    );
    await madeAnAdminBy(workspace.admin.email, editor.id);

    expect(await memberOf(client)).toMatchObject(PENDING);
    expect(await standingOf(client)).toBe("setup");
    expect(await sessionRowsOf(editor.id)).toHaveLength(1);
  });
});

describe("a confirmation and the factor behind it", () => {
  it("ends on other sessions when a factor is removed", async () => {
    const { admin } = await app().provision();
    const setUpIn = await signedInByEmailOnly(app(), admin.email);
    await passkeyAddedOn(setUpIn);
    await holdAnAuthenticator(app(), admin.id);
    const removing = await signedInByEmailOnly(app(), admin.email);
    const other = await signedInByEmailOnly(app(), admin.email);
    await confirmedByTheHarness(app(), removing);
    await confirmedByTheHarness(app(), other);

    await apiOf(removing).person.removeAuthenticator.mutate();

    expect([await standingOf(removing), await standingOf(other)]).toEqual(["confirmed", "confirm"]);
  });
});
