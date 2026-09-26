import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import {
  answeredBelowAdmin,
  answeredToAnAdminPointedHere,
  appForSuite,
  asksToJoin,
  emailsTo,
  eventsOn,
  ISO_INSTANT,
  SEVEN_DAYS_MS,
  ULID,
  type Api,
} from "./people-suite.ts";
import { whileCommitsAreRefused } from "./provoke.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

const REASON = "I have joined the bids team and need the answer library.";

const unreachable = new Set<string>();

const app = appForSuite(unreachable);

/** The id is read off the Admin's own list, as the Requests tab reads it. */
const anAdminWithOneRequest = async () => {
  const workspace = await app().provision({ name: "Calder Joinery" });
  const requester = await asksToJoin(app(), workspace, "Priya", REASON);
  const { api } = await webSignedIn(app(), workspace.admin.email);
  const [waiting] = await api.members.requests.query();
  return { workspace, requester, api, requestId: waiting?.id ?? "" };
};

describe("the waiting access requests over tRPC", () => {
  it("lists each requester's name, address and reason, oldest first", async () => {
    const workspace = await app().provision();
    const priya = await asksToJoin(app(), workspace, "Priya", "I run the framework renewals.");
    const sam = await asksToJoin(app(), workspace, "Sam", "I am on the bid team.");
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const listed = await api.members.requests.query();

    expect(listed).toEqual([
      {
        id: expect.stringMatching(ULID),
        requester: { id: priya.id, name: "Priya", email: priya.email },
        reason: "I run the framework renewals.",
        askedAt: expect.stringMatching(ISO_INSTANT),
      },
      {
        id: expect.stringMatching(ULID),
        requester: { id: sam.id, name: "Sam", email: sam.email },
        reason: "I am on the bid team.",
        askedAt: expect.stringMatching(ISO_INSTANT),
      },
    ]);
  });

  it("never lists another workspace's requests to its Admin", async () => {
    await anAdminWithOneRequest();
    const elsewhere = await app().provision();
    const { api } = await webSignedIn(app(), elsewhere.admin.email);

    expect(await api.members.requests.query()).toEqual([]);
  });
});

describe("approving an access request over tRPC", () => {
  it("emails the requester a week-long invitation at the role", async () => {
    const { api, requester, requestId } = await anAdminWithOneRequest();

    const approved = await api.members.approveRequest.mutate({ requestId, role: "Editor" });

    expect(approved).toEqual({
      invitationId: expect.stringMatching(ULID),
      address: requester.email,
      role: "Editor",
      invitedAt: expect.stringMatching(ISO_INSTANT),
      expiresAt: expect.stringMatching(ISO_INSTANT),
      emailSent: true,
    });
    expect(Date.parse(approved.expiresAt) - Date.parse(approved.invitedAt)).toBe(SEVEN_DAYS_MS);
    expect(emailsTo(app(), requester.email)).toEqual([
      {
        to: requester.email,
        subject: "Join Calder Joinery on Better Answers",
        text: expect.stringContaining(
          `https://app.example.test/invitations/${approved.invitationId}`,
        ),
      },
    ]);
    expect(emailsTo(app(), requester.email)[0]?.text).toContain("as an Editor");
    expect(await eventsOn(app(), approved.invitationId)).toEqual(["people.invitation.created"]);
    expect(await eventsOn(app(), requestId)).toEqual([
      "people.request.asked",
      "people.request.approved",
    ]);
    expect(await api.members.requests.query()).toEqual([]);
    expect(await api.members.invitations.query()).toMatchObject([
      { invitationId: approved.invitationId, address: requester.email, role: "Editor" },
    ]);
  });

  it("refuses a role outside the three, inviting nobody", async () => {
    const { api, requester, requestId } = await anAdminWithOneRequest();

    const refused = await refusalOfCall(
      api.members.approveRequest.mutate({ requestId, role: "Owner" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-role", class: "absent" } },
    });
    expect(emailsTo(app(), requester.email)).toEqual([]);
    expect(await api.members.invitations.query()).toEqual([]);
    expect(await api.members.requests.query()).toMatchObject([{ id: requestId }]);
  });

  it("refuses a request decided already, already-decided", async () => {
    const { api, requester, requestId } = await anAdminWithOneRequest();
    await api.members.declineRequest.mutate({ requestId });

    const refused = await refusalOfCall(
      api.members.approveRequest.mutate({ requestId, role: "Viewer" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 409, refusal: { word: "already-decided", class: "conflict" } },
    });
    expect(emailsTo(app(), requester.email)).toEqual([]);
  });

  it("refuses an id no request carries, no-such-request", async () => {
    const { api } = await anAdminWithOneRequest();

    const refused = await refusalOfCall(
      api.members.approveRequest.mutate({ requestId: ulid(), role: "Viewer" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-request", class: "absent" } },
    });
  });

  it("refuses an id of no known form, malformed", async () => {
    const { api } = await anAdminWithOneRequest();

    const refused = await refusalOfCall(
      api.members.approveRequest.mutate({ requestId: "' OR true --", role: "Viewer" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 400, refusal: { word: "malformed", class: "malformed" } },
    });
  });
});

describe("declining an access request over tRPC", () => {
  it("records the decline, which leaves the list, emailing nobody", async () => {
    const { api, requester, requestId } = await anAdminWithOneRequest();

    const declined = await api.members.declineRequest.mutate({ requestId });

    expect(declined).toEqual({ requestId });
    expect(await eventsOn(app(), requestId)).toEqual([
      "people.request.asked",
      "people.request.declined",
    ]);
    expect(await api.members.requests.query()).toEqual([]);
    expect(await api.members.invitations.query()).toEqual([]);
    expect(emailsTo(app(), requester.email)).toEqual([]);
  });
});

describe("an approval's invitation email", () => {
  it("is sent after the commit, never for a failed approval", async () => {
    const { api, requester, requestId } = await anAdminWithOneRequest();

    const failed = await whileCommitsAreRefused(app(), "invitation", () =>
      refusalOfCall(api.members.approveRequest.mutate({ requestId, role: "Viewer" })),
    );

    expect(failed).toMatchObject({ data: { httpStatus: 500 } });
    expect(emailsTo(app(), requester.email)).toEqual([]);
    expect(await api.members.invitations.query()).toEqual([]);
    expect(await api.members.requests.query()).toMatchObject([{ id: requestId }]);
    expect(await eventsOn(app(), requestId)).toEqual(["people.request.asked"]);
  });

  it("stands when it did not go, and a resend recovers", async () => {
    const { api, requester, requestId } = await anAdminWithOneRequest();
    unreachable.add(requester.email);

    const approved = await api.members.approveRequest.mutate({ requestId, role: "Viewer" });

    expect(approved).toMatchObject({ address: requester.email, emailSent: false });
    expect(await api.members.invitations.query()).toMatchObject([
      { invitationId: approved.invitationId },
    ]);

    unreachable.delete(requester.email);
    const resent = await api.members.resendInvitation.mutate({
      invitationId: approved.invitationId,
    });

    expect(resent).toMatchObject({ invitationId: approved.invitationId, emailSent: true });
    expect(emailsTo(app(), requester.email).at(-1)?.text).toContain(
      `/invitations/${approved.invitationId}`,
    );
  });
});

type Verb = readonly [string, (api: Api, requestId: string) => Promise<unknown>];

const VERBS: readonly Verb[] = [
  ["list", (api) => api.members.requests.query()],
  ["approve", (api, requestId) => api.members.approveRequest.mutate({ requestId, role: "Admin" })],
  ["decline", (api, requestId) => api.members.declineRequest.mutate({ requestId })],
];

const DECISIONS = VERBS.filter(([verb]) => verb !== "list");

describe("who may read and decide access requests", () => {
  it.each(VERBS)("refuses an Editor and a Viewer the %s verb", async (_verb, call) => {
    const { workspace, requestId } = await anAdminWithOneRequest();

    const answered = await answeredBelowAdmin(app(), workspace.workspaceId, (api) =>
      call(api, requestId),
    );

    const roleForbids = { word: "role-forbids", class: "forbidden" };
    expect(answered).toMatchObject({
      Editor: { data: { httpStatus: 403, refusal: roleForbids } },
      Viewer: { data: { httpStatus: 403, refusal: roleForbids } },
    });
    expect(await eventsOn(app(), requestId)).toEqual(["people.request.asked"]);
  });

  it.each(VERBS)("refuses an Admin elsewhere pointed here the %s verb", async (_verb, call) => {
    const { workspace, requestId } = await anAdminWithOneRequest();

    const answered = await answeredToAnAdminPointedHere(app(), workspace.workspaceId, (api) =>
      call(api, requestId),
    );

    expect(answered).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
    });
    expect(await eventsOn(app(), requestId)).toEqual(["people.request.asked"]);
  });

  it.each(DECISIONS)(
    "refuses an Admin elsewhere the %s verb on this request",
    async (_verb, call) => {
      const { requester, requestId } = await anAdminWithOneRequest();
      const elsewhere = await app().provision();
      const { api } = await webSignedIn(app(), elsewhere.admin.email);

      expect(await refusalOfCall(call(api, requestId))).toMatchObject({
        data: { httpStatus: 404, refusal: { word: "no-such-request", class: "absent" } },
      });
      expect(await eventsOn(app(), requestId)).toEqual(["people.request.asked"]);
      expect(emailsTo(app(), requester.email)).toEqual([]);
    },
  );
});
