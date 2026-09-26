import { describe, expect, it } from "vitest";

import {
  anAddress,
  answeredBelowAdmin,
  answeredToAnAdminPointedHere,
  appForSuite,
  emailsTo,
  eventsOn,
  ISO_INSTANT,
  SEVEN_DAYS_MS,
  ULID,
  type Api,
} from "./people-suite.ts";
import { whileCommitsAreRefused } from "./provoke.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

const unreachable = new Set<string>();

const app = appForSuite(unreachable);

/** A resend answers the same invitation, its email gone this time. */
const resentWithItsEmail = async (api: Api, invitationId: string): Promise<void> => {
  const resent = await api.members.resendInvitation.mutate({ invitationId });
  expect(resent).toMatchObject({ invitationId, emailSent: true });
};

const anAdmin = async () => {
  const workspace = await app().provision({ name: "Calder Joinery" });
  return { workspace, ...(await webSignedIn(app(), workspace.admin.email)) };
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
    expect(emailsTo(app(), address)).toEqual([
      {
        to: address,
        subject: "Join Calder Joinery on Better Answers",
        text: expect.stringContaining(
          `https://app.example.test/invitations/${invited.invitationId}`,
        ),
      },
    ]);
    expect(emailsTo(app(), address)[0]?.text).toContain("as an Editor");
    expect(await eventsOn(app(), invited.invitationId)).toEqual(["people.invitation.created"]);
  });

  it("answers alike whether or not the address uses Better Answers", async () => {
    const { api } = await anAdmin();
    const elsewhere = await app().provision();
    const known = await app().person(anAddress("known"));
    await app().addMember(elsewhere.workspaceId, known.id, "Admin");
    const unknown = anAddress("unknown");

    const toKnown = await api.members.invite.mutate({ address: known.email, role: "Viewer" });
    const toUnknown = await api.members.invite.mutate({ address: unknown, role: "Viewer" });

    expect(toKnown).toEqual({
      invitationId: expect.stringMatching(ULID),
      address: known.email,
      role: "Viewer",
      invitedAt: expect.stringMatching(ISO_INSTANT),
      expiresAt: expect.stringMatching(ISO_INSTANT),
      emailSent: true,
    });
    const shapeOf = (answer: typeof toKnown) => ({
      ...answer,
      invitationId: "the id",
      address: "the address",
      invitedAt: "the instant",
      expiresAt: "the instant",
    });
    expect(shapeOf(toKnown)).toEqual(shapeOf(toUnknown));
    expect(Object.keys(toKnown).toSorted()).toEqual(Object.keys(toUnknown).toSorted());
    expect(emailsTo(app(), known.email)).toHaveLength(1);
    expect(emailsTo(app(), unknown)).toHaveLength(1);
  });

  it("refuses a current member already-a-member, emailing nobody", async () => {
    const { api, workspace } = await anAdmin();
    const editor = await app().person(anAddress("editor"));
    await app().addMember(workspace.workspaceId, editor.id, "Editor");

    const refused = await refusalOfCall(
      api.members.invite.mutate({ address: editor.email, role: "Admin" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 409, refusal: { word: "already-a-member", class: "conflict" } },
    });
    expect(emailsTo(app(), editor.email)).toEqual([]);
    expect(await api.members.invitations.query()).toEqual([]);
  });
});

describe("the waiting invitations over tRPC", () => {
  it("lists each waiting invitation with its role, expiry and inviter", async () => {
    const { api } = await anAdmin();
    const sam = anAddress("sam");
    const una = anAddress("una");
    const first = await api.members.invite.mutate({ address: sam, role: "Viewer" });
    const second = await api.members.invite.mutate({ address: una, role: "Admin" });

    const listed = await api.members.invitations.query();

    const aWeekOn = (invitedAt: string) => new Date(Date.parse(invitedAt) + SEVEN_DAYS_MS);
    expect(listed).toEqual([
      {
        invitationId: second.invitationId,
        address: una,
        role: "Admin",
        invitedAt: expect.stringMatching(ISO_INSTANT),
        expiresAt: aWeekOn(second.invitedAt).toISOString(),
        invitedBy: "Test person",
      },
      {
        invitationId: first.invitationId,
        address: sam,
        role: "Viewer",
        invitedAt: expect.stringMatching(ISO_INSTANT),
        expiresAt: aWeekOn(first.invitedAt).toISOString(),
        invitedBy: "Test person",
      },
    ]);
  });

  it("resends a waiting invitation, emailing the same link again", async () => {
    const { api } = await anAdmin();
    const address = anAddress("priya");
    const invited = await api.members.invite.mutate({ address, role: "Editor" });

    await resentWithItsEmail(api, invited.invitationId);

    expect(emailsTo(app(), address).map((message) => message.text)).toEqual([
      expect.stringContaining(`/invitations/${invited.invitationId}`),
      expect.stringContaining(`/invitations/${invited.invitationId}`),
    ]);
    expect(await eventsOn(app(), invited.invitationId)).toEqual([
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
    expect(await eventsOn(app(), invited.invitationId)).toEqual([
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

describe("the invitation email", () => {
  it("is sent after the commit, never for a failed invitation", async () => {
    const { api } = await anAdmin();
    const address = anAddress("uncommitted");

    const failed = await whileCommitsAreRefused(app(), "invitation", () =>
      refusalOfCall(api.members.invite.mutate({ address, role: "Viewer" })),
    );

    expect(failed).toMatchObject({ data: { httpStatus: 500 } });
    expect(emailsTo(app(), address)).toEqual([]);
    expect(await api.members.invitations.query()).toEqual([]);
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

    expect(emailsTo(app(), address).at(-1)?.text).toContain(`/invitations/${invited.invitationId}`);
  });
});

const NOT_A_MEMBER = {
  data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
};

const ROLE_FORBIDS = {
  data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
};

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

    const answered = await answeredBelowAdmin(app(), workspace.workspaceId, (api) =>
      call(api, invitationId),
    );

    expect(answered).toMatchObject({ Editor: ROLE_FORBIDS, Viewer: ROLE_FORBIDS });
  });

  it.each(VERBS)("refuses an Admin elsewhere pointed here the %s verb", async (_verb, call) => {
    const { workspace, invitationId } = await aWaitingInvitation();

    const answered = await answeredToAnAdminPointedHere(app(), workspace.workspaceId, (api) =>
      call(api, invitationId),
    );

    expect(answered).toMatchObject(NOT_A_MEMBER);
  });

  it.each(VERBS.filter(([verb]) => verb === "resend" || verb === "cancel"))(
    "refuses an Admin elsewhere the %s verb on this invitation",
    async (_verb, call) => {
      const { invitationId } = await aWaitingInvitation();
      const elsewhere = await app().provision();
      const { api } = await webSignedIn(app(), elsewhere.admin.email);

      expect(await refusalOfCall(call(api, invitationId))).toMatchObject({
        data: { httpStatus: 404, refusal: { word: "no-such-invitation", class: "absent" } },
      });
    },
  );
});
