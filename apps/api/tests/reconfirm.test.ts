import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { ulid } from "@better-answers/schema";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { authenticatorKeyOf, holdAnAuthenticator } from "./factor-harness.ts";
import { confirmWithTheAuthenticator, connectAsHost } from "./flow.ts";
import { startApp, type TestApp } from "./harness.ts";
import {
  confirmationsAgedOverAnHourAgo,
  failureOf,
  passkeyAddedOn,
  signedInClient,
  signedInByEmailOnly,
} from "./provoke.ts";
import { refusalOfCall, webClientOf, webSignedIn } from "./web-client.ts";

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;

const STALE = { word: "confirmation-too-old", class: "precondition", httpStatus: 412 } as const;

const aRefusal = z.object({ word: z.string(), class: z.string() });

const refusedAsStale = async (call: Promise<unknown>): Promise<boolean> => {
  const refused = failureOf(await refusalOfCall(call));
  const refusal = aRefusal.safeParse(refused.refusal);
  return (
    refused.httpStatus === STALE.httpStatus &&
    refusal.success &&
    refusal.data.word === STALE.word &&
    refusal.data.class === STALE.class
  );
};

const reconfirmed = async (
  personId: string,
  client: Parameters<typeof confirmWithTheAuthenticator>[0],
): Promise<void> => {
  const key = authenticatorKeyOf(app, personId) ?? (await holdAnAuthenticator(app, personId));
  await confirmWithTheAuthenticator(client, key);
};

type SessionRow = { readonly created_at: Date; readonly expires_at: Date };

const theSessionOf = async (personId: string): Promise<SessionRow> => {
  const found = await app.database.superuser.query<SessionRow>(
    "SELECT created_at, expires_at FROM session WHERE user_id = $1",
    [personId],
  );
  const row = found.rows[0];
  if (row === undefined) throw new Error(`no session was held by ${personId}`);
  return row;
};

const signedInYesterday = async (personId: string): Promise<void> => {
  await app.database.superuser.query(
    `UPDATE session
        SET created_at = created_at - interval '26 hours',
            expires_at = expires_at - interval '26 hours'
      WHERE user_id = $1`,
    [personId],
  );
};

describe("a stale confirmation before a high-impact act", () => {
  it("refuses the members' acts until the Admin re-confirms", async () => {
    const workspace = await app.provision();
    const editor = await app.person(undefined, "Priya Shah");
    await app.addMember(workspace.workspaceId, editor.id, "Editor");
    const viewer = await app.person();
    const { client, api } = await webSignedIn(app, workspace.admin.email);
    await confirmationsAgedOverAnHourAgo(app, workspace.admin.id);

    const refused = [
      api.members.remove.mutate({ personId: editor.id }),
      api.members.changeRole.mutate({ personId: editor.id, role: "Viewer" }),
      api.members.endEverySignInAndToken.mutate({ personId: editor.id }),
      api.members.exportAuditLog.mutate({ family: "people", search: "" }),
      api.members.invite.mutate({ addresses: [viewer.email], role: "Admin" }),
      api.members.bulkChangeRole.mutate({ personIds: [editor.id], role: "Viewer" }),
    ];
    for (const call of refused) expect(await refusedAsStale(call)).toBe(true);

    await reconfirmed(workspace.admin.id, client);
    const moved = await api.members.changeRole.mutate({ personId: editor.id, role: "Viewer" });

    expect(moved).toMatchObject({ personId: editor.id, role: "Viewer" });
  });

  it("invites a Viewer without a fresh confirmation", async () => {
    const workspace = await app.provision();
    const viewer = await app.person();
    const { api } = await webSignedIn(app, workspace.admin.email);
    await confirmationsAgedOverAnHourAgo(app, workspace.admin.id);

    const invited = await api.members.invite.mutate({
      addresses: [viewer.email],
      role: "Viewer",
    });

    expect(invited.invitations[0]).toMatchObject({ address: viewer.email, role: "Viewer" });
  });

  it("refuses the person's own factor changes until re-confirmed", async () => {
    const person = await app.person();
    const setUpIn = await signedInClient(app, person.email);
    const kept = z.object({ passkeyId: z.string() });
    const { passkeyId } = kept.parse(await (await passkeyAddedOn(setUpIn)).answered.json());
    const client = await signedInByEmailOnly(app, person.email);
    const { api } = webClientOf(client);
    await confirmationsAgedOverAnHourAgo(app, person.id);

    const asked = await client.json("/passkeys/add-options", { name: "Phone" });
    expect(asked.status).toBe(STALE.httpStatus);
    expect([
      await refusedAsStale(api.person.removePasskey.mutate({ passkeyId })),
      await refusedAsStale(api.person.replaceRecoveryCodes.mutate({ replacing: true })),
    ]).toEqual([true, true]);

    await reconfirmed(person.id, client);
    const replaced = await api.person.replaceRecoveryCodes.mutate({ replacing: true });

    expect(replaced.replaced).toBe(false);
  });

  it("adds a first passkey with no confirmation to re-confirm", async () => {
    const person = await app.person();
    const client = await signedInClient(app, person.email);

    const { answered } = await passkeyAddedOn(client);

    expect(answered.status).toBe(200);
  });

  it("reaches no high-impact act from a bearer", async () => {
    const workspace = await app.provision();
    const { accessToken } = await connectAsHost(app, app.client(), {
      email: workspace.admin.email,
    });
    const asks: readonly (readonly [string, RequestInit])[] = [
      ["members.remove", { method: "POST", body: JSON.stringify({ personId: ulid() }) }],
      [
        "members.changeRole",
        { method: "POST", body: JSON.stringify({ personId: ulid(), role: "Viewer" }) },
      ],
      [
        "members.endEverySignInAndToken",
        { method: "POST", body: JSON.stringify({ personId: ulid() }) },
      ],
      ["members.exportAuditLog", { method: "POST", body: JSON.stringify({}) }],
      [
        "members.invite",
        { method: "POST", body: JSON.stringify({ addresses: ["x@example.test"], role: "Admin" }) },
      ],
      [
        "members.bulkChangeRole",
        { method: "POST", body: JSON.stringify({ personIds: [ulid()], role: "Viewer" }) },
      ],
      ["members.bulkRemove", { method: "POST", body: JSON.stringify({ personIds: [ulid()] }) }],
      [
        "members.bulkAddToGroup",
        { method: "POST", body: JSON.stringify({ groupId: ulid(), personIds: [ulid()] }) },
      ],
      [
        "console.people.endEverySignInAndToken",
        { method: "POST", body: JSON.stringify({ personId: ulid() }) },
      ],
      [
        "console.people.correctDisplayName",
        { method: "POST", body: JSON.stringify({ personId: ulid(), displayName: "Sam" }) },
      ],
    ];

    for (const [path, init] of asks) {
      const response = await app.client().fetch(`${TRPC_ENDPOINT}/${path}`, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      });
      const answer = await response.json();
      expect({ path, status: response.status, answer }).toMatchObject({
        status: 401,
        answer: { error: { data: { refusal: { word: "no-session" } } } },
      });
    }
  });
});

describe("the operator's console writes", () => {
  it("follow the confirmation, not the sign-in's age", async () => {
    const workspace = await app.provision();
    await app.markOperator(workspace.admin.email, "grant");
    const person = await app.person();
    const { client, api } = await webSignedIn(app, workspace.admin.email);
    await signedInYesterday(workspace.admin.id);

    const written = await api.console.people.endEverySignInAndToken.mutate({
      personId: person.id,
    });
    await confirmationsAgedOverAnHourAgo(app, workspace.admin.id);
    const refused = await refusedAsStale(
      api.console.people.correctDisplayName.mutate({ personId: person.id, displayName: "Sam" }),
    );

    await reconfirmed(workspace.admin.id, client);
    const corrected = await api.console.people.correctDisplayName.mutate({
      personId: person.id,
      displayName: "Sam Okoro",
    });

    expect(written).toMatchObject({ personId: person.id });
    expect(refused).toBe(true);
    expect(corrected).toMatchObject({ displayName: "Sam Okoro" });
  });
});

describe("a session's lifetime", () => {
  it("lives thirty days and renews after a day of use", async () => {
    const person = await app.person();
    const client = await signedInClient(app, person.email);
    const first = await theSessionOf(person.id);
    expect(first.expires_at.getTime() - first.created_at.getTime()).toBeGreaterThan(
      THIRTY_DAYS_MS - 5_000,
    );

    await signedInYesterday(person.id);
    const beforeRenewal = (await theSessionOf(person.id)).expires_at.getTime() - Date.now();
    await client.fetch("/get-session");

    const renewed = await theSessionOf(person.id);
    expect(beforeRenewal).toBeLessThan(THIRTY_DAYS_MS);
    expect(renewed.expires_at.getTime() - Date.now()).toBeGreaterThan(THIRTY_DAYS_MS - 5_000);
  });
});
