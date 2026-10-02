import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
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
import { refusalOfCall, statusOf, webSignedIn } from "./web-client.ts";

const unreachable = new Set<string>();

const app = appForSuite(unreachable);

const INVITE = `${TRPC_ENDPOINT}/members.invite`;

/** The same figure the browser suite holds a list to: the send answers inside it. */
const SEND_BUDGET_MS = 1000;

const A_DAY_MS = 24 * 60 * 60 * 1000;

const inviting = (api: Api, addresses: readonly string[], role = "Viewer") =>
  api.members.invite.mutate({ addresses: [...addresses], role });

/** One address's invitation, as the send answered it. */
const invitedOne = async (api: Api, address: string, role = "Viewer") => {
  const [one] = (await inviting(api, [address], role)).invitations;
  if (one === undefined) throw new Error("the send answered no invitation");
  return one;
};

/** A resend answers the same invitation, its email gone this time. */
const resentWithItsEmail = async (api: Api, invitationId: string): Promise<void> => {
  const resent = await api.members.resendInvitation.mutate({ invitationId });
  expect(resent).toMatchObject({ invitationId, emailSent: true });
};

const anAdmin = async () => {
  const workspace = await app().provision({ name: "Calder Joinery" });
  return { workspace, ...(await webSignedIn(app(), workspace.admin.email)) };
};

/** Sends to `address` until refused: the window is the wall clock's hour, so a count can restart. */
const sentToTheCeiling = async (api: Api, address: string): Promise<readonly number[]> => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt <= 11; attempt += 1) {
    const status = await statusOf(inviting(api, [address]));
    statuses.push(status);
    if (status === 429) return statuses;
  }
  return statuses;
};

describe("inviting a person over tRPC", () => {
  it("invites an address for a week, emailing the accept link", async () => {
    const { api } = await anAdmin();
    const address = anAddress("priya");

    const invited = await invitedOne(api, address.toUpperCase(), "Editor");

    expect(invited).toEqual({
      invitationId: expect.stringMatching(ULID),
      address,
      role: "Editor",
      invitedAt: expect.stringMatching(ISO_INSTANT),
      expiresAt: expect.stringMatching(ISO_INSTANT),
      replaced: false,
      emailSent: true,
    });
    expect(Date.parse(invited.expiresAt) - Date.parse(invited.invitedAt)).toBe(SEVEN_DAYS_MS);
    const [email] = emailsTo(app(), address);
    expect(emailsTo(app(), address)).toEqual([
      {
        to: address,
        subject: "Join Calder Joinery on better-answers",
        text: expect.stringContaining(
          `https://app.example.test/invitations/${invited.invitationId}`,
        ),
      },
    ]);
    expect(email?.text).toContain(
      "You are invited to join Calder Joinery on better-answers as an Editor.",
    );
    expect(email?.text).toMatch(
      /The invitation lasts until \d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\./,
    );
    expect(await eventsOn(app(), invited.invitationId)).toEqual(["people.invitation.created"]);
  });

  it("answers alike whether or not the address uses better-answers", async () => {
    const { api } = await anAdmin();
    const elsewhere = await app().provision();
    const known = await app().person(anAddress("known"));
    await app().addMember(elsewhere.workspaceId, known.id, "Admin");
    const unknown = anAddress("unknown");

    const toKnown = await invitedOne(api, known.email);
    const toUnknown = await invitedOne(api, unknown);

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

  it("names a member's address by position, emailing nobody", async () => {
    const { api, workspace } = await anAdmin();
    const editor = await app().person(anAddress("editor"));
    await app().addMember(workspace.workspaceId, editor.id, "Editor");
    const other = anAddress("other");

    const refused = await refusalOfCall(inviting(api, [other, editor.email], "Admin"));

    expect(refused).toMatchObject({
      data: {
        httpStatus: 409,
        refusal: {
          word: "already-a-member",
          class: "conflict",
          items: { "1": "already-a-member" },
        },
      },
    });
    expect(emailsTo(app(), editor.email)).toEqual([]);
    expect(emailsTo(app(), other)).toEqual([]);
    expect(await api.members.invitations.query()).toEqual([]);
  });

  it("names an address off a marked workspace's domain, emailing nobody", async () => {
    const { api, workspace } = await anAdmin();
    const testingDomain = `${ulid().toLowerCase()}.testing.invalid`;
    const client = await app().database.superuser.connect();
    try {
      await testData(client).testWorkspaceMark({
        workspaceId: workspace.workspaceId,
        testingDomain,
      });
    } finally {
      client.release();
    }
    const onDomain = `ana@${testingDomain}`;
    const offDomain = anAddress("ben");

    const refused = await refusalOfCall(inviting(api, [onDomain, offDomain]));

    expect(refused).toMatchObject({
      data: {
        refusal: {
          word: "off-testing-domain",
          class: "inapplicable",
          items: { "1": "off-testing-domain" },
        },
      },
    });
    expect(emailsTo(app(), onDomain)).toEqual([]);
    expect(emailsTo(app(), offDomain)).toEqual([]);
    expect(await api.members.invitations.query()).toEqual([]);
  });
});

describe("inviting several addresses over tRPC", () => {
  it("sends one email for one address in two cases", async () => {
    const { api } = await anAdmin();
    const ana = anAddress("ana");

    const sent = await inviting(api, [ana.toUpperCase(), ana]);

    expect(sent.invitations).toEqual([expect.objectContaining({ address: ana, emailSent: true })]);
    expect(emailsTo(app(), ana)).toHaveLength(1);
    expect(await api.members.invitations.query()).toHaveLength(1);
  });

  it("replaces a waiting invitation, saying so, emailing its new link", async () => {
    const { api } = await anAdmin();
    const ana = anAddress("ana");
    const ben = anAddress("ben");
    const first = await invitedOne(api, ana);

    const sent = await inviting(api, [ana, ben], "Editor");

    expect(
      sent.invitations.map(({ address, replaced, emailSent }) => [address, replaced, emailSent]),
    ).toEqual([
      [ana, true, true],
      [ben, false, true],
    ]);
    const [toAna] = sent.invitations;
    expect(emailsTo(app(), ana).map((message) => message.text)).toEqual([
      expect.stringContaining(`/invitations/${first.invitationId}`),
      expect.stringContaining(`/invitations/${toAna?.invitationId}`),
    ]);
    expect(await eventsOn(app(), first.invitationId)).toEqual([
      "people.invitation.created",
      "people.invitation.cancelled",
    ]);
  });

  it("names the address whose email failed, committing every invitation", async () => {
    const { api } = await anAdmin();
    const online = anAddress("online");
    const offline = anAddress("offline");
    unreachable.add(offline);

    const sent = await inviting(api, [online, offline]);

    expect(sent.invitations.map(({ address, emailSent }) => [address, emailSent])).toEqual([
      [online, true],
      [offline, false],
    ]);
    expect((await api.members.invitations.query()).map((row) => row.address).toSorted()).toEqual(
      [online, offline].toSorted(),
    );
    expect(emailsTo(app(), online)).toHaveLength(1);
  });

  it("refuses 51 addresses, malformed, emailing nobody", async () => {
    const { api } = await anAdmin();
    const addresses = Array.from({ length: 51 }, (_unused, at) => anAddress(`many${at}`));

    const refused = await refusalOfCall(inviting(api, addresses));

    expect(refused).toMatchObject({
      data: {
        httpStatus: 400,
        refusal: { word: "malformed", fields: { addresses: "too-big" } },
      },
    });
    expect(app().emails.filter((message) => addresses.includes(message.to))).toEqual([]);
  });

  it("answers fifty addresses within the list's budget", async () => {
    const { api } = await anAdmin();
    const addresses = Array.from({ length: 50 }, (_unused, at) => anAddress(`fifty${at}`));

    const started = performance.now();
    const sent = await inviting(api, addresses);
    const elapsed = performance.now() - started;

    expect(sent.invitations.filter((one) => one.emailSent)).toHaveLength(50);
    expect(elapsed, "fifty invitations answered past their budget").toBeLessThan(SEND_BUDGET_MS);
  });
});

describe("the per-address ceiling over tRPC", () => {
  it("refuses a send past it whole, minting and emailing nothing", async () => {
    const { api, client } = await anAdmin();
    const ana = anAddress("ana");
    const ben = anAddress("ben");

    const statuses = await sentToTheCeiling(api, ana);
    const refused = await client.json(INVITE, { addresses: [ben, ana], role: "Viewer" });

    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(5);
    expect(refused.status).toBe(429);
    const retryAfter = Number(refused.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(await refused.json()).toMatchObject({
      error: { data: { code: "TOO_MANY_REQUESTS", retryAfterSeconds: retryAfter } },
    });
    expect(emailsTo(app(), ben)).toEqual([]);
    expect(emailsTo(app(), ana)).toHaveLength(statuses.length - 1);
    expect((await api.members.invitations.query()).map((row) => row.address)).toEqual([ana]);
  });

  it("refuses a bulk resend past it whole, emailing nobody", async () => {
    const { api } = await anAdmin();
    const ana = anAddress("ana");
    const toBen = await invitedOne(api, anAddress("ben"));
    const statuses = await sentToTheCeiling(api, ana);
    const [toAna] = await api.members.invitations.query({ status: "waiting" });
    const before = await api.members.invitations.query();

    const refused = await refusalOfCall(
      api.members.bulkResendInvitations.mutate({
        invitationIds: [toBen.invitationId, toAna?.invitationId ?? ""],
      }),
    );

    expect(statuses.at(-1)).toBe(429);
    expect(refused).toMatchObject({ data: { httpStatus: 429, code: "TOO_MANY_REQUESTS" } });
    expect(emailsTo(app(), toBen.address)).toHaveLength(1);
    expect(await api.members.invitations.query()).toEqual(before);
  });
});

describe("the invitations by status over tRPC", () => {
  it("lists each status's rows, with every status's count", async () => {
    const { api, workspace } = await anAdmin();
    const waiting = await invitedOne(api, anAddress("waiting"));
    const seeded = { workspaceId: workspace.workspaceId, inviterId: workspace.admin.id };
    const accepted = await app().invite({
      ...seeded,
      email: anAddress("accepted"),
      status: "accepted",
    });
    const cancelled = await app().invite({
      ...seeded,
      email: anAddress("cancelled"),
      status: "canceled",
    });
    const expired = await app().invite({
      ...seeded,
      email: anAddress("expired"),
      expiresAt: new Date(Date.now() - A_DAY_MS),
    });

    const idsOf = async (status?: "waiting" | "accepted" | "expired" | "cancelled") =>
      (await api.members.invitations.query(status === undefined ? undefined : { status })).map(
        (row) => [row.invitationId, row.status],
      );

    expect({
      unasked: await idsOf(),
      waiting: await idsOf("waiting"),
      accepted: await idsOf("accepted"),
      expired: await idsOf("expired"),
      cancelled: await idsOf("cancelled"),
    }).toEqual({
      unasked: [[waiting.invitationId, "waiting"]],
      waiting: [[waiting.invitationId, "waiting"]],
      accepted: [[accepted.id, "accepted"]],
      expired: [[expired.id, "expired"]],
      cancelled: [[cancelled.id, "cancelled"]],
    });
    expect(await api.members.invitationCounts.query()).toEqual({
      waiting: 1,
      accepted: 1,
      expired: 1,
      cancelled: 1,
    });
  });

  it("refuses a status outside the four, malformed", async () => {
    const { client } = await anAdmin();

    const answered = await client.fetch(
      `${TRPC_ENDPOINT}/members.invitations?input=${encodeURIComponent(JSON.stringify({ status: "pending" }))}`,
    );

    expect(answered.status).toBe(400);
    expect(await answered.json()).toMatchObject({
      error: { data: { refusal: { word: "malformed", fields: { status: "not-in-set" } } } },
    });
  });
});

describe("the waiting invitations over tRPC", () => {
  it("lists each waiting invitation with its role, expiry and inviter", async () => {
    const { api } = await anAdmin();
    const sam = anAddress("sam");
    const una = anAddress("una");
    const first = await invitedOne(api, sam, "Viewer");
    const second = await invitedOne(api, una, "Admin");

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
        status: "waiting",
      },
      {
        invitationId: first.invitationId,
        address: sam,
        role: "Viewer",
        invitedAt: expect.stringMatching(ISO_INSTANT),
        expiresAt: aWeekOn(first.invitedAt).toISOString(),
        invitedBy: "Test person",
        status: "waiting",
      },
    ]);
  });

  it("resends a waiting invitation, emailing the same link again", async () => {
    const { api } = await anAdmin();
    const address = anAddress("priya");
    const invited = await invitedOne(api, address, "Editor");

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
    const invited = await invitedOne(api, anAddress("sam"));

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

describe("a set of invitations over tRPC", () => {
  it("resends two waiting and one expired, emailing each after commit", async () => {
    const { api, workspace } = await anAdmin();
    const sent = await inviting(api, [anAddress("ana"), anAddress("ben")]);
    const old = anAddress("old");
    const expired = await app().invite({
      workspaceId: workspace.workspaceId,
      inviterId: workspace.admin.id,
      email: old,
      expiresAt: new Date(Date.now() - A_DAY_MS),
    });
    const ids = [...sent.invitations.map((one) => one.invitationId), expired.id];

    const resent = await api.members.bulkResendInvitations.mutate({ invitationIds: ids });

    expect(resent.invitations.map((one) => [one.invitationId, one.emailSent]).toSorted()).toEqual(
      ids.map((id) => [id, true]).toSorted(),
    );
    for (const one of resent.invitations) {
      expect(Date.parse(one.expiresAt)).toBeGreaterThan(Date.now() + SEVEN_DAYS_MS - A_DAY_MS);
    }
    expect(
      [...sent.invitations.map((one) => one.address), old].map(
        (address) => emailsTo(app(), address).length,
      ),
    ).toEqual([2, 2, 1]);
    expect(await api.members.invitationCounts.query()).toMatchObject({ waiting: 3, expired: 0 });
  });

  it("cancels a set, skipping one already cancelled", async () => {
    const { api } = await anAdmin();
    const sent = await inviting(api, [anAddress("ana"), anAddress("ben")]);
    const [gone, waiting] = sent.invitations.map((one) => one.invitationId);
    await api.members.cancelInvitation.mutate({ invitationId: gone ?? "" });

    const cancelled = await api.members.bulkCancelInvitations.mutate({
      invitationIds: [gone ?? "", waiting ?? ""],
    });

    expect(cancelled).toEqual({ changed: [waiting], skipped: 1 });
    expect(await api.members.invitationCounts.query()).toMatchObject({ waiting: 0, cancelled: 2 });
  });

  it("refuses a cancel naming an accepted invitation, by its id", async () => {
    const { api, workspace } = await anAdmin();
    const waiting = await invitedOne(api, anAddress("ana"));
    const accepted = await app().invite({
      workspaceId: workspace.workspaceId,
      inviterId: workspace.admin.id,
      email: anAddress("ben"),
      status: "accepted",
    });

    const refused = await refusalOfCall(
      api.members.bulkCancelInvitations.mutate({
        invitationIds: [waiting.invitationId, accepted.id],
      }),
    );

    expect(refused).toMatchObject({
      data: {
        httpStatus: 404,
        refusal: {
          word: "no-such-invitation",
          class: "absent",
          items: { [accepted.id]: "no-such-invitation" },
        },
      },
    });
    expect(await api.members.invitations.query()).toMatchObject([
      { invitationId: waiting.invitationId },
    ]);
  });
});

describe("the invitation email", () => {
  it("is sent after the commit, never for a failed invitation", async () => {
    const { api } = await anAdmin();
    const address = anAddress("uncommitted");

    const failed = await whileCommitsAreRefused(app(), "invitation", () =>
      refusalOfCall(inviting(api, [address])),
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

    const invited = await invitedOne(api, address);

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
  ["invite", (api) => inviting(api, [anAddress("x")])],
  ["resend", (api, invitationId) => api.members.resendInvitation.mutate({ invitationId })],
  [
    "bulk resend",
    (api, invitationId) =>
      api.members.bulkResendInvitations.mutate({ invitationIds: [invitationId] }),
  ],
  ["cancel", (api, invitationId) => api.members.cancelInvitation.mutate({ invitationId })],
  [
    "bulk cancel",
    (api, invitationId) =>
      api.members.bulkCancelInvitations.mutate({ invitationIds: [invitationId] }),
  ],
  ["list", (api) => api.members.invitations.query()],
  ["count", (api) => api.members.invitationCounts.query()],
];

const aWaitingInvitation = async () => {
  const { workspace, api } = await anAdmin();
  const invited = await invitedOne(api, anAddress("waiting"));
  return { workspace, invitationId: invited.invitationId, address: invited.address };
};

describe("who may act on invitations", () => {
  it.each(VERBS)("refuses an Editor and a Viewer the %s verb", async (_verb, call) => {
    const { workspace, invitationId, address } = await aWaitingInvitation();

    const answered = await answeredBelowAdmin(app(), workspace.workspaceId, (api) =>
      call(api, invitationId),
    );

    expect(answered).toMatchObject({ Editor: ROLE_FORBIDS, Viewer: ROLE_FORBIDS });
    expect(emailsTo(app(), address)).toHaveLength(1);
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

  it("refuses an Editor a send, minting and emailing nothing", async () => {
    const { workspace, api } = await anAdmin();
    const address = anAddress("forbidden");

    const answered = await answeredBelowAdmin(app(), workspace.workspaceId, (editorApi) =>
      inviting(editorApi, [address]),
    );

    expect(answered).toMatchObject({ Editor: ROLE_FORBIDS, Viewer: ROLE_FORBIDS });
    expect(emailsTo(app(), address)).toEqual([]);
    expect(await api.members.invitationCounts.query()).toMatchObject({ waiting: 0 });
  });
});
