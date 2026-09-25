import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startApp, type TestApp } from "./harness.ts";
import { sessionPointedAt } from "./provoke.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

let app: TestApp;

// The transport refuses these addresses, as an SMTP relay that is down would.
const unreachable = new Set<string>();

beforeAll(async () => {
  app = await startApp({
    onEmail: (message) => {
      if (unreachable.has(message.to)) throw new Error("the relay refused the message");
    },
  });
});

afterAll(async () => {
  await app.stop();
});

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const anAddress = (who: string): string =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@client.example`;

const emailsTo = (address: string) => app.emails.filter((message) => message.to === address);

const eventsOn = async (subjectId: string) =>
  (
    await app.database.superuser.query<{ act: string }>(
      "SELECT act FROM audit_event WHERE subject_id = $1 ORDER BY id",
      [subjectId],
    )
  ).rows.map((row) => row.act);

type Api = Awaited<ReturnType<typeof webSignedIn>>["api"];

// A resend answers the same invitation, its email gone this time.
const resentWithItsEmail = async (api: Api, invitationId: string): Promise<void> => {
  const resent = await api.members.resendInvitation.mutate({ invitationId });
  expect(resent).toMatchObject({ invitationId, emailSent: true });
};

const anAdmin = async () => {
  const workspace = await app.provision({ name: "Calder Joinery" });
  return { workspace, ...(await webSignedIn(app, workspace.admin.email)) };
};

describe("inviting a person over tRPC", () => {
  it("invites an address for a week, emailing the accept link", async () => {
    const { api } = await anAdmin();
    const address = anAddress("priya");

    const invited = await api.members.invite.mutate({
      address: address.toUpperCase(),
      role: "Editor",
    });

    expect(invited).toEqual({
      invitationId: expect.stringMatching(ULID),
      address,
      role: "Editor",
      invitedAt: expect.stringMatching(ISO_INSTANT),
      expiresAt: expect.stringMatching(ISO_INSTANT),
      emailSent: true,
    });
    expect(Date.parse(invited.expiresAt) - Date.parse(invited.invitedAt)).toBe(SEVEN_DAYS_MS);
    expect(emailsTo(address)).toEqual([
      {
        to: address,
        subject: "Join Calder Joinery on Better Answers",
        text: expect.stringContaining(
          `https://app.example.test/invitations/${invited.invitationId}`,
        ),
      },
    ]);
    expect(emailsTo(address)[0]?.text).toContain("as an Editor");
    expect(await eventsOn(invited.invitationId)).toEqual(["people.invitation.created"]);
  });

  it("answers alike whether or not the address uses Better Answers", async () => {
    const { api } = await anAdmin();
    const elsewhere = await app.provision();
    const known = await app.person(anAddress("known"));
    await app.addMember(elsewhere.workspaceId, known.id, "Admin");
    const unknown = anAddress("unknown");

    const toKnown = await api.members.invite.mutate({ address: known.email, role: "Viewer" });
    const toUnknown = await api.members.invite.mutate({ address: unknown, role: "Viewer" });

    const shapeOf = (answer: typeof toKnown) => ({
      ...answer,
      invitationId: "the id",
      address: "the address",
      invitedAt: "the instant",
      expiresAt: "the instant",
    });
    expect(shapeOf(toKnown)).toEqual(shapeOf(toUnknown));
    expect(Object.keys(toKnown).toSorted()).toEqual(Object.keys(toUnknown).toSorted());
    expect(emailsTo(known.email)).toHaveLength(1);
    expect(emailsTo(unknown)).toHaveLength(1);
  });

  it("refuses a current member already-a-member, emailing nobody", async () => {
    const { api, workspace } = await anAdmin();
    const editor = await app.person(anAddress("editor"));
    await app.addMember(workspace.workspaceId, editor.id, "Editor");

    const refused = await refusalOfCall(
      api.members.invite.mutate({ address: editor.email, role: "Admin" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 409, refusal: { word: "already-a-member", class: "conflict" } },
    });
    expect(emailsTo(editor.email)).toEqual([]);
    expect(await api.members.invitations.query()).toEqual([]);
  });
});

describe("the waiting invitations over tRPC", () => {
  it("lists each waiting invitation with its role and expiry", async () => {
    const { api } = await anAdmin();
    const first = await api.members.invite.mutate({ address: anAddress("sam"), role: "Viewer" });
    const second = await api.members.invite.mutate({ address: anAddress("una"), role: "Admin" });

    const listed = await api.members.invitations.query();

    const { emailSent: _first, ...firstListed } = first;
    const { emailSent: _second, ...secondListed } = second;
    expect(listed).toEqual([secondListed, firstListed]);
  });

  it("resends a waiting invitation, emailing the same link again", async () => {
    const { api } = await anAdmin();
    const address = anAddress("priya");
    const invited = await api.members.invite.mutate({ address, role: "Editor" });

    await resentWithItsEmail(api, invited.invitationId);

    expect(emailsTo(address).map((message) => message.text)).toEqual([
      expect.stringContaining(`/invitations/${invited.invitationId}`),
      expect.stringContaining(`/invitations/${invited.invitationId}`),
    ]);
    expect(await eventsOn(invited.invitationId)).toEqual([
      "people.invitation.created",
      "people.invitation.resent",
    ]);
  });

  it("cancels a waiting invitation, which leaves the list", async () => {
    const { api } = await anAdmin();
    const invited = await api.members.invite.mutate({ address: anAddress("sam"), role: "Viewer" });

    const cancelled = await api.members.cancelInvitation.mutate({
      invitationId: invited.invitationId,
    });

    expect(cancelled).toEqual({ invitationId: invited.invitationId });
    expect(await api.members.invitations.query()).toEqual([]);
    expect(await eventsOn(invited.invitationId)).toEqual([
      "people.invitation.created",
      "people.invitation.cancelled",
    ]);
    expect(
      await refusalOfCall(
        api.members.resendInvitation.mutate({ invitationId: invited.invitationId }),
      ),
    ).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-invitation", class: "absent" } },
    });
  });
});

describe("an invitation whose email did not go", () => {
  it("stands, says its email did not go; a resend recovers", async () => {
    const { api } = await anAdmin();
    const address = anAddress("offline");
    unreachable.add(address);

    const invited = await api.members.invite.mutate({ address, role: "Viewer" });

    expect(invited).toMatchObject({ address, emailSent: false });
    expect(await api.members.invitations.query()).toMatchObject([
      { invitationId: invited.invitationId },
    ]);

    unreachable.delete(address);
    await resentWithItsEmail(api, invited.invitationId);

    expect(emailsTo(address).at(-1)?.text).toContain(`/invitations/${invited.invitationId}`);
  });
});

type Verb = readonly [string, (api: Api, invitationId: string) => Promise<unknown>];

const VERBS: readonly Verb[] = [
  ["invite", (api) => api.members.invite.mutate({ address: anAddress("x"), role: "Viewer" })],
  ["resend", (api, invitationId) => api.members.resendInvitation.mutate({ invitationId })],
  ["cancel", (api, invitationId) => api.members.cancelInvitation.mutate({ invitationId })],
  ["list", (api) => api.members.invitations.query()],
];

const aWaitingInvitation = async () => {
  const { workspace, api } = await anAdmin();
  const invited = await api.members.invite.mutate({
    address: anAddress("waiting"),
    role: "Viewer",
  });
  return { workspace, invitationId: invited.invitationId };
};

describe("who may act on invitations", () => {
  it.each(VERBS)("refuses an Editor and a Viewer the %s verb", async (_verb, call) => {
    const { workspace, invitationId } = await aWaitingInvitation();

    for (const role of ["Editor", "Viewer"] as const) {
      const person = await app.person(anAddress(role.toLowerCase()));
      await app.addMember(workspace.workspaceId, person.id, role);
      const { api } = await webSignedIn(app, person.email);

      expect({ role, refused: await refusalOfCall(call(api, invitationId)) }).toMatchObject({
        role,
        refused: {
          data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
        },
      });
    }
  });

  it.each(VERBS)("refuses an Admin elsewhere pointed here the %s verb", async (_verb, call) => {
    const { workspace, invitationId } = await aWaitingInvitation();
    const elsewhere = await app.provision();
    const { api } = await webSignedIn(app, elsewhere.admin.email);
    await sessionPointedAt(app, elsewhere.admin.id, workspace.workspaceId);

    expect(await refusalOfCall(call(api, invitationId))).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
    });
  });

  it.each(VERBS.filter(([verb]) => verb === "resend" || verb === "cancel"))(
    "refuses an Admin elsewhere the %s verb on this invitation",
    async (_verb, call) => {
      const { invitationId } = await aWaitingInvitation();
      const elsewhere = await app.provision();
      const { api } = await webSignedIn(app, elsewhere.admin.email);

      expect(await refusalOfCall(call(api, invitationId))).toMatchObject({
        data: { httpStatus: 404, refusal: { word: "no-such-invitation", class: "absent" } },
      });
    },
  );
});
