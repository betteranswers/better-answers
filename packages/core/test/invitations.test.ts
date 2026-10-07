import { describe, expect, it } from "vitest";

import type { Result, UserPrincipal } from "../src/kernel/index.ts";
import {
  approveRequest,
  cancelInvitation,
  countInvitations,
  listInvitations,
  listInvitationsInput,
  requestAccess,
  resendInvitation,
} from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import {
  A_WEEK_LATER,
  answeredValue,
  ceilingOf,
  INVITED_AT,
  invitationsSuite,
  ULID,
} from "./invitations-suite.ts";
import { bootstrap, provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import {
  abortTheTransaction,
  addressOf,
  countWaitingOnLocks,
  postgresForSuite,
  seedingWith,
  until,
  whileActsWaitAt,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const db = postgresForSuite();

const {
  as,
  invite,
  resending,
  atTheCeiling,
  invitedMany,
  cancelledInvitation,
  memberAt,
  invitationLeft,
  invitationsOf,
  invitationEvents,
  emailsCountedTo,
  emailsCountedFrom,
  marked,
} = invitationsSuite(db);

const listed = (workspace: ProvisionedWorkspace, status: string | undefined, at: Date) =>
  as(workspace, workspace.adminUserId, (principal, tx) =>
    listInvitations(principal, tx, {
      ...inputOf(listInvitationsInput, status === undefined ? undefined : { status }),
      at,
    }),
  );

const counted = (workspace: ProvisionedWorkspace, at: Date) =>
  as(workspace, workspace.adminUserId, (principal, tx) => countInvitations(principal, tx, { at }));

describe("inviting a person by address", () => {
  it("keeps the address lower-case, waiting seven days, with its event", async () => {
    const workspace = await provisionedWorkspace(db(), "Calder");
    const address = addressOf("priya");

    const invited = await invite(workspace, address.toUpperCase(), "Editor");

    expect(invited).toEqual({
      ok: true,
      value: {
        invitationId: expect.stringMatching(ULID),
        address,
        role: "Editor",
        invitedAt: "2031-06-15T09:30:00.000Z",
        expiresAt: A_WEEK_LATER,
        workspaceName: "Calder",
        replaced: false,
      },
    });
    const { invitationId } = answeredValue(invited);
    expect(await invitationsOf(workspace)).toEqual([
      {
        id: invitationId,
        email: address,
        role: "Editor",
        status: "pending",
        inviter_id: workspace.adminUserId,
        created_at: INVITED_AT,
        expires_at: new Date(A_WEEK_LATER),
      },
    ]);
    expect(await invitationEvents(workspace)).toEqual([
      {
        act: "people.invitation.created",
        actor: `human:${workspace.adminUserId}`,
        subject_id: invitationId,
        detail: { role: "Editor" },
        batch_id: null,
      },
    ]);
  });

  it("answers alike whether or not the platform knows the address", async () => {
    const workspace = await provisionedWorkspace(db(), "Neutral");
    const elsewhere = await provisionedWorkspace(db(), "Elsewhere");
    const known = await memberAt(elsewhere, "Editor");
    const unknown = addressOf("nobody");

    const toKnown = answeredValue(await invite(workspace, known.email, "Viewer"));
    const toUnknown = answeredValue(await invite(workspace, unknown, "Viewer"));

    expect(toKnown).toEqual({
      invitationId: expect.stringMatching(ULID),
      address: known.email,
      role: "Viewer",
      invitedAt: "2031-06-15T09:30:00.000Z",
      expiresAt: A_WEEK_LATER,
      workspaceName: "Neutral",
      replaced: false,
    });
    expect({ ...toKnown, invitationId: "", address: "" }).toEqual({
      ...toUnknown,
      invitationId: "",
      address: "",
    });
    expect((await invitationsOf(workspace)).map((row) => row.email).toSorted()).toEqual(
      [known.email, unknown].toSorted(),
    );
  });

  it("refuses a current member already-a-member, however the address is cased", async () => {
    const workspace = await provisionedWorkspace(db(), "Members");
    const editor = await memberAt(workspace, "Editor");

    const refused = await invite(workspace, editor.email.toUpperCase(), "Admin");

    expect(refused).toEqual({
      ok: false,
      error: { word: "already-a-member", items: { "0": "already-a-member" } },
    });
    expect(await invitationsOf(workspace)).toEqual([]);
    expect(await invitationEvents(workspace)).toEqual([]);
  });

  it("refuses a role outside the three, and a non-address", async () => {
    const workspace = await provisionedWorkspace(db(), "Refusing");

    expect(await invite(workspace, addressOf("sam"), "Owner")).toEqual({
      ok: false,
      error: "no-such-role",
    });
    expect(await invite(workspace, "not an address", "Viewer")).toEqual({
      ok: false,
      error: { word: "malformed", items: { "0": "malformed" } },
    });
    expect(await invitationsOf(workspace)).toEqual([]);
  });

  it("replaces a waiting invitation to the address, cancelling it", async () => {
    const workspace = await provisionedWorkspace(db(), "Replacing");
    const address = addressOf("priya");

    const first = answeredValue(await invite(workspace, address, "Viewer"));
    const later = new Date("2031-06-16T10:00:00.000Z");
    const second = answeredValue(await invite(workspace, address.toUpperCase(), "Editor", later));

    expect({ first: first.replaced, second: second.replaced }).toEqual({
      first: false,
      second: true,
    });
    expect(await invitationsOf(workspace)).toMatchObject([
      { id: first.invitationId, status: "canceled", role: "Viewer" },
      { id: second.invitationId, status: "pending", role: "Editor" },
    ]);
    const events = await invitationEvents(workspace);
    const batch = events.find((event) => event.batch_id !== null)?.batch_id;
    expect(batch).toEqual(expect.stringMatching(ULID));
    expect(
      events.map(({ act, subject_id, detail, batch_id }) => ({
        act,
        subject_id,
        detail,
        batch_id,
      })),
    ).toEqual([
      {
        act: "people.invitation.created",
        subject_id: first.invitationId,
        detail: { role: "Viewer" },
        batch_id: null,
      },
      {
        act: "people.invitation.created",
        subject_id: second.invitationId,
        detail: { role: "Editor" },
        batch_id: batch,
      },
      {
        act: "people.invitation.cancelled",
        subject_id: first.invitationId,
        detail: { replacedByInvitationId: second.invitationId },
        batch_id: batch,
      },
    ]);
  });

  it("leaves one waiting of two concurrent invitations to one address", async () => {
    const workspace = await provisionedWorkspace(db(), "Concurrent");
    const address = addressOf("priya");

    const [first, second] = await whileActsWaitAt(
      db().pool,
      "invitation",
      "INSERT",
      async (release) => {
        const racing = [invite(workspace, address, "Viewer"), invite(workspace, address, "Editor")];
        await until(async () => (await countWaitingOnLocks(db().pool)) === 2);
        await release();
        return Promise.all(racing);
      },
    );

    expect({ first: first?.ok, second: second?.ok }).toEqual({ first: true, second: true });
    const waiting = (await invitationsOf(workspace)).filter((row) => row.status === "pending");
    expect(waiting).toHaveLength(1);
    expect(await invitationsOf(workspace)).toHaveLength(2);
  });

  it("cancels nothing when the act's event cannot be written", async () => {
    const workspace = await provisionedWorkspace(db(), "Unwritten");
    const address = addressOf("priya");
    const standing = answeredValue(await invite(workspace, address, "Viewer"));

    const failed = await whileWritesAreRefused(db().pool, "audit_event", () =>
      invite(workspace, address, "Editor"),
    );

    expect(failed).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringMatching(/the store refused a write to audit_event/),
      }),
    });

    expect(await invitationsOf(workspace)).toMatchObject([
      { id: standing.invitationId, status: "pending", role: "Viewer" },
    ]);
  });
});

/** A request waiting in `workspace`, and the approval of it the Admin would send. */
const aRequestIn = async (workspace: ProvisionedWorkspace, requester?: { email: string }) => {
  const person = await seedingWith(db().pool, (seed) => seed.user(requester));
  const requestId = await seedingWith(db().pool, async (seed) => {
    const asked = await seed.accessRequest({
      workspaceId: workspace.workspaceId,
      requesterId: person.id,
    });
    return asked.id;
  });
  const approving = () =>
    as(workspace, workspace.adminUserId, (principal, tx) =>
      approveRequest(principal, tx, { requestId, role: "Viewer", now: INVITED_AT }),
    );
  return { requester: person, approving };
};

describe("an approved access request's invitation", () => {
  it("is minted by the same step, replacing a waiting one", async () => {
    const workspace = await provisionedWorkspace(db(), "Approving");
    const requester = await seedingWith(db().pool, (seed) => seed.user());
    const direct = answeredValue(await invite(workspace, requester.email, "Viewer"));
    expect(
      await requestAccess(bootstrap, workspace.door, {
        shortName: workspace.shortName,
        requesterId: requester.id,
        reason: "I have joined the bids team.",
      }),
    ).toEqual({ ok: true, value: { acknowledged: true } });
    const requestId = (
      await db().pool.query<{ id: string }>(
        "SELECT id FROM access_request WHERE workspace_id = $1",
        [workspace.workspaceId],
      )
    ).rows[0]?.id;

    const approved = answeredValue(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        approveRequest(principal, tx, {
          requestId: requestId ?? "",
          role: "Editor",
          now: INVITED_AT,
        }),
      ),
    );

    expect(await invitationsOf(workspace)).toMatchObject([
      { id: direct.invitationId, status: "canceled" },
      {
        id: approved.invitationId,
        email: requester.email,
        status: "pending",
        expires_at: new Date(A_WEEK_LATER),
      },
    ]);
    const events = await invitationEvents(workspace);
    const batch = events.at(-1)?.batch_id;
    expect(batch).toEqual(expect.stringMatching(ULID));
    expect(events.slice(1)).toEqual([
      expect.objectContaining({
        act: "people.invitation.created",
        subject_id: approved.invitationId,
        detail: { role: "Editor" },
        batch_id: batch,
      }),
      expect.objectContaining({
        act: "people.invitation.cancelled",
        subject_id: direct.invitationId,
        detail: { replacedByInvitationId: approved.invitationId },
        batch_id: batch,
      }),
    ]);
  });

  /** A request waiting in a new workspace, and the approval of it the Admin would send. */
  const aRequestWaiting = async (name: string) => {
    const workspace = await provisionedWorkspace(db(), name);
    return { workspace, ...(await aRequestIn(workspace)) };
  };

  it("counts against no address's ceiling, nor the workspace's", async () => {
    const { workspace, requester, approving } = await aRequestWaiting("ApprovingUncounted");

    answeredValue(await approving());

    expect(await emailsCountedTo(workspace, requester.email)).toBe(0);
    expect(await emailsCountedFrom(workspace)).toBe(0);
  });

  it("fails as its event fails, in that failure's words", async () => {
    const { workspace, approving } = await aRequestWaiting("ApprovingUnrecorded");

    const failed = await whileWritesAreRefused(db().pool, "audit_event", approving);

    expect(failed).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringMatching(/the store refused a write to audit_event/),
      }),
    });
    expect(await invitationsOf(workspace)).toEqual([]);
  });
});

describe("a marked workspace's invitations", () => {
  const approvingFrom = async (workspace: ProvisionedWorkspace, email: string) =>
    (await aRequestIn(workspace, { email })).approving();

  const requestsOf = async (workspace: ProvisionedWorkspace) =>
    (
      await db().pool.query<{ status: string }>(
        "SELECT status FROM access_request WHERE workspace_id = $1",
        [workspace.workspaceId],
      )
    ).rows;

  it("refuses resending to an address off its domain, renewing nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "MarkedResend");
    const ana = addressOf("ana");
    const invited = answeredValue(await invite(workspace, ana, "Viewer"));
    await marked(workspace);
    const before = await invitationsOf(workspace);

    const refused = await resending(workspace, invited.invitationId, INVITED_AT);

    expect(refused).toEqual({ ok: false, error: "off-testing-domain" });
    expect(await invitationsOf(workspace)).toEqual(before);
    expect(await emailsCountedTo(workspace, ana)).toBe(1);
  });

  it("resends one to an address on its domain", async () => {
    const workspace = await provisionedWorkspace(db(), "MarkedResendOnDomain");
    const onDomain = await marked(workspace);
    const invited = answeredValue(await invite(workspace, onDomain("ana"), "Viewer"));

    const resent = await resending(workspace, invited.invitationId, INVITED_AT);

    expect(resent).toMatchObject({ ok: true, value: { invitationId: invited.invitationId } });
  });

  it("refuses approving a request from an address off its domain", async () => {
    const workspace = await provisionedWorkspace(db(), "MarkedApprove");
    await marked(workspace);

    const refused = await approvingFrom(workspace, addressOf("ana"));

    expect(refused).toEqual({ ok: false, error: "off-testing-domain" });
    expect(await invitationsOf(workspace)).toEqual([]);
    expect(await requestsOf(workspace)).toEqual([{ status: "waiting" }]);
  });

  it("approves a request from an address on its domain", async () => {
    const workspace = await provisionedWorkspace(db(), "MarkedApproveOnDomain");
    const onDomain = await marked(workspace);

    const approved = await approvingFrom(workspace, onDomain("ana"));

    expect(approved).toMatchObject({ ok: true, value: { address: onDomain("ana") } });
  });

  it("lets an unmarked workspace invite, resend and approve any address", async () => {
    const elsewhere = await provisionedWorkspace(db(), "MarkedElsewhere");
    await marked(elsewhere);
    const workspace = await provisionedWorkspace(db(), "Unmarked");
    const ana = addressOf("ana");

    const invited = answeredValue(await invite(workspace, ana, "Viewer"));
    const resent = await resending(workspace, invited.invitationId, INVITED_AT);
    const approved = await approvingFrom(workspace, addressOf("ben"));

    expect([invited.address, resent.ok, approved.ok]).toEqual([ana, true, true]);
  });
});

describe("resending an invitation", () => {
  it("renews a waiting invitation for seven days, with its event", async () => {
    const workspace = await provisionedWorkspace(db(), "Resending");
    const address = addressOf("priya");
    const invited = answeredValue(await invite(workspace, address, "Editor"));
    const now = new Date("2031-06-25T12:00:00.000Z");

    const resent = await resending(workspace, invited.invitationId, now);

    expect(resent).toEqual({
      ok: true,
      value: {
        invitationId: invited.invitationId,
        address,
        role: "Editor",
        invitedAt: "2031-06-15T09:30:00.000Z",
        expiresAt: "2031-07-02T12:00:00.000Z",
        workspaceName: "Resending",
      },
    });
    expect(await invitationEvents(workspace)).toEqual([
      expect.objectContaining({ act: "people.invitation.created", detail: { role: "Editor" } }),
      expect.objectContaining({
        act: "people.invitation.resent",
        subject_id: invited.invitationId,
        detail: {},
        batch_id: null,
      }),
    ]);
  });

  it("refuses an address's sixth email in an hour, renewing nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "ResendCeiling");
    const address = addressOf("priya");
    const invited = await atTheCeiling(workspace, address);
    const lastAllowed = await invitationsOf(workspace);

    const refused = await resending(
      workspace,
      invited.invitationId,
      new Date("2031-06-15T09:59:59.000Z"),
    );

    expect(ceilingOf(refused)).toBe(1);
    expect(await invitationsOf(workspace)).toEqual(lastAllowed);
    expect((await invitationEvents(workspace)).map((event) => event.act)).toEqual([
      "people.invitation.created",
      "people.invitation.resent",
      "people.invitation.resent",
      "people.invitation.resent",
      "people.invitation.resent",
    ]);
    expect(await emailsCountedTo(workspace, address)).toBe(5);
  });

  it("answers when the hour's ceiling lifts, and lifts it then", async () => {
    const workspace = await provisionedWorkspace(db(), "ResendCeilingLifts");
    const invited = await atTheCeiling(workspace, addressOf("priya"));

    const refused = await resending(workspace, invited.invitationId, INVITED_AT);
    const nextHour = await resending(
      workspace,
      invited.invitationId,
      new Date("2031-06-15T10:00:00.000Z"),
    );

    expect(ceilingOf(refused)).toBe(1800);
    expect(nextHour).toMatchObject({ ok: true, value: { expiresAt: "2031-06-22T10:00:00.000Z" } });
  });

  it("refuses a workspace's 201st email until the next hour", async () => {
    const workspace = await provisionedWorkspace(db(), "ResendWorkspaceCeiling");
    const [invited] = await invitedMany(workspace, 200);
    const invitationId = invited?.invitationId ?? "";
    const lastAllowed = await invitationsOf(workspace);
    const eventsBefore = await invitationEvents(workspace);

    const refused = await resending(workspace, invitationId, new Date("2031-06-15T09:59:59.000Z"));

    expect(ceilingOf(refused)).toBe(1);
    expect(await invitationsOf(workspace)).toEqual(lastAllowed);
    expect(await invitationEvents(workspace)).toEqual(eventsBefore);
    expect(await emailsCountedFrom(workspace)).toBe(200);

    const nextHour = await resending(workspace, invitationId, new Date("2031-06-15T10:00:00.000Z"));

    expect(nextHour).toMatchObject({ ok: true, value: { expiresAt: "2031-06-22T10:00:00.000Z" } });
    expect(await emailsCountedFrom(workspace)).toBe(1);
  });

  it("counts nothing for an invitation no longer waiting", async () => {
    const workspace = await provisionedWorkspace(db(), "ResendUncounted");
    const address = addressOf("priya");
    const invited = await cancelledInvitation(workspace, address);

    expect(await resending(workspace, invited.invitationId, INVITED_AT)).toEqual({
      ok: false,
      error: "no-such-invitation",
    });
    expect(await emailsCountedTo(workspace, address)).toBe(1);
  });
});

describe("cancelling an invitation", () => {
  it("cancels a waiting invitation, with its event", async () => {
    const workspace = await provisionedWorkspace(db(), "Cancelling");
    const invited = answeredValue(await invite(workspace, addressOf("priya"), "Viewer"));

    const cancelled = await as(workspace, workspace.adminUserId, (principal, tx) =>
      cancelInvitation(principal, tx, { invitationId: invited.invitationId }),
    );

    expect(cancelled).toEqual({ ok: true, value: { invitationId: invited.invitationId } });
    expect(await invitationsOf(workspace)).toMatchObject([{ status: "canceled" }]);
    expect((await invitationEvents(workspace)).at(-1)).toEqual({
      act: "people.invitation.cancelled",
      actor: `human:${workspace.adminUserId}`,
      subject_id: invited.invitationId,
      detail: {},
      batch_id: null,
    });
  });
});

describe("what resending and cancelling refuse", () => {
  const VERBS = [
    [
      "resending",
      (principal: UserPrincipal, tx: Tx, invitationId: string) =>
        resendInvitation(principal, tx, { invitationId, now: INVITED_AT }),
    ],
    [
      "cancelling",
      (principal: UserPrincipal, tx: Tx, invitationId: string) =>
        cancelInvitation(principal, tx, { invitationId }),
    ],
  ] as const;

  it.each(VERBS)("refuses %s an invitation no longer waiting", async (_verb, act) => {
    const workspace = await provisionedWorkspace(db(), "Decided");
    const invited = await cancelledInvitation(workspace, addressOf("priya"));
    const eventsBefore = await invitationEvents(workspace);

    const refused = await as(workspace, workspace.adminUserId, (principal, tx) =>
      act(principal, tx, invited.invitationId),
    );

    expect(refused).toEqual({ ok: false, error: "no-such-invitation" });
    expect(await invitationEvents(workspace)).toEqual(eventsBefore);
  });

  it.each(VERBS)("refuses %s an accepted invitation", async (_verb, act) => {
    const workspace = await provisionedWorkspace(db(), "Accepted");
    const accepted = await invitationLeft(workspace, {
      email: addressOf("priya"),
      status: "accepted",
    });

    const refused = await as(workspace, workspace.adminUserId, (principal, tx) =>
      act(principal, tx, accepted.id),
    );

    expect(refused).toEqual({ ok: false, error: "no-such-invitation" });
    expect(await invitationsOf(workspace)).toMatchObject([{ status: "accepted" }]);
  });

  it.each(VERBS)("refuses %s an id of no known form", async (_verb, act) => {
    const workspace = await provisionedWorkspace(db(), "Shapeless");

    const refused = await as(workspace, workspace.adminUserId, (principal, tx) =>
      act(principal, tx, "' OR true --"),
    );

    expect(refused).toEqual({ ok: false, error: "malformed" });
  });

  it.each(VERBS)("keeps an Admin elsewhere from %s this one's", async (_verb, act) => {
    const workspace = await provisionedWorkspace(db(), "Held");
    const elsewhere = await provisionedWorkspace(db(), "Reaching");
    const invited = answeredValue(await invite(workspace, addressOf("priya"), "Viewer"));

    const reached = await as(elsewhere, elsewhere.adminUserId, (principal, tx) =>
      act(principal, tx, invited.invitationId),
    );

    expect(reached).toEqual({ ok: false, error: "no-such-invitation" });
    expect(await invitationsOf(workspace)).toMatchObject([
      { status: "pending", expires_at: new Date(A_WEEK_LATER) },
    ]);
  });
});

/** A workspace holding one invitation in each status, as listed at `INVITED_AT`. */
const oneOfEach = async (name: string) => {
  const workspace = await provisionedWorkspace(db(), name, { name: "Priya Shah" });
  const addresses = {
    waiting: addressOf("waiting"),
    expired: addressOf("expired"),
    cancelled: addressOf("cancelled"),
    accepted: addressOf("accepted"),
  };
  const expired = answeredValue(
    await invite(workspace, addresses.expired, "Viewer", new Date("2031-05-01T08:00:00Z")),
  );
  const waiting = answeredValue(await invite(workspace, addresses.waiting, "Editor"));
  const cancelled = await cancelledInvitation(workspace, addresses.cancelled, "Admin");
  const accepted = await invitationLeft(workspace, {
    email: addresses.accepted,
    status: "accepted",
  });
  return { workspace, addresses, expired, waiting, cancelled, accepted };
};

describe("the invitations by status", () => {
  it("lists each status's own invitations, each row carrying it", async () => {
    const { workspace, addresses, expired, waiting, cancelled, accepted } =
      await oneOfEach("Listing");
    const elsewhere = await provisionedWorkspace(db(), "Unlisted");
    await invite(elsewhere, addressOf("theirs"), "Editor");

    const lists = {
      waiting: await listed(workspace, "waiting", INVITED_AT),
      expired: await listed(workspace, "expired", INVITED_AT),
      cancelled: await listed(workspace, "cancelled", INVITED_AT),
      accepted: await listed(workspace, "accepted", INVITED_AT),
    };

    expect(lists).toEqual({
      waiting: {
        ok: true,
        value: [
          {
            invitationId: waiting.invitationId,
            address: addresses.waiting,
            role: "Editor",
            invitedAt: "2031-06-15T09:30:00.000Z",
            expiresAt: A_WEEK_LATER,
            invitedBy: "Priya Shah",
            status: "waiting",
          },
        ],
      },
      expired: {
        ok: true,
        value: [
          {
            invitationId: expired.invitationId,
            address: addresses.expired,
            role: "Viewer",
            invitedAt: "2031-05-01T08:00:00.000Z",
            expiresAt: "2031-05-08T08:00:00.000Z",
            invitedBy: "Priya Shah",
            status: "expired",
          },
        ],
      },
      cancelled: {
        ok: true,
        value: [
          {
            invitationId: cancelled.invitationId,
            address: addresses.cancelled,
            role: "Admin",
            invitedAt: "2031-06-15T09:30:00.000Z",
            expiresAt: A_WEEK_LATER,
            invitedBy: "Priya Shah",
            status: "cancelled",
          },
        ],
      },
      accepted: {
        ok: true,
        value: [
          {
            invitationId: accepted.id,
            address: addresses.accepted,
            role: "Viewer",
            invitedAt: "2031-06-15T09:30:00.000Z",
            expiresAt: A_WEEK_LATER,
            invitedBy: "Priya Shah",
            status: "accepted",
          },
        ],
      },
    });
  });

  it("counts the rows each status lists", async () => {
    const { workspace } = await oneOfEach("Counting");
    const second = await invite(workspace, addressOf("second"), "Viewer");
    expect(second.ok).toBe(true);

    expect(await counted(workspace, INVITED_AT)).toEqual({
      ok: true,
      value: { waiting: 2, accepted: 1, expired: 1, cancelled: 1 },
    });
    expect(answeredValue(await listed(workspace, "waiting", INVITED_AT))).toHaveLength(2);
  });

  it("lists the newest first", async () => {
    const workspace = await provisionedWorkspace(db(), "Newest");
    const older = answeredValue(await invite(workspace, addressOf("older"), "Viewer"));
    const newer = answeredValue(
      await invite(workspace, addressOf("newer"), "Viewer", new Date("2031-06-15T10:00:00Z")),
    );

    const rows = answeredValue(await listed(workspace, "waiting", INVITED_AT));

    expect(rows.map((row) => row.invitationId)).toEqual([newer.invitationId, older.invitationId]);
  });

  it("lists waiting when asked no status", async () => {
    const { workspace, waiting } = await oneOfEach("Unasked");

    const rows = answeredValue(await listed(workspace, undefined, INVITED_AT));

    expect(rows.map((row) => [row.invitationId, row.status])).toEqual([
      [waiting.invitationId, "waiting"],
    ]);
  });

  it("lists an eight-day-old invitation as Expired, not Waiting", async () => {
    const workspace = await provisionedWorkspace(db(), "EightDays");
    const sent = answeredValue(await invite(workspace, addressOf("late"), "Viewer"));
    const eightDaysOn = new Date("2031-06-23T09:30:00.000Z");

    expect(answeredValue(await listed(workspace, "waiting", eightDaysOn))).toEqual([]);
    expect(
      answeredValue(await listed(workspace, "expired", eightDaysOn)).map((row) => row.invitationId),
    ).toEqual([sent.invitationId]);
    expect(await counted(workspace, eightDaysOn)).toEqual({
      ok: true,
      value: { waiting: 0, accepted: 0, expired: 1, cancelled: 0 },
    });
  });

  it("holds an invitation waiting until the instant it expires", async () => {
    const workspace = await provisionedWorkspace(db(), "Instant");
    answeredValue(await invite(workspace, addressOf("edge"), "Viewer"));
    const justBefore = new Date(Date.parse(A_WEEK_LATER) - 1);

    expect(await counted(workspace, justBefore)).toMatchObject({
      value: { waiting: 1, expired: 0 },
    });
    expect(await counted(workspace, new Date(A_WEEK_LATER))).toMatchObject({
      value: { waiting: 0, expired: 1 },
    });
  });

  it("lists and counts none of another workspace's invitations", async () => {
    const workspace = await provisionedWorkspace(db(), "Empty");
    await oneOfEach("Crowded");

    for (const status of ["waiting", "expired", "cancelled", "accepted"]) {
      expect({ status, listed: await listed(workspace, status, INVITED_AT) }).toEqual({
        status,
        listed: { ok: true, value: [] },
      });
    }
    expect(await counted(workspace, INVITED_AT)).toEqual({
      ok: true,
      value: { waiting: 0, accepted: 0, expired: 0, cancelled: 0 },
    });
  });

  it("reads no input, or one naming no status, as waiting", () => {
    expect([inputOf(listInvitationsInput, undefined), inputOf(listInvitationsInput, {})]).toEqual([
      { status: "waiting" },
      { status: "waiting" },
    ]);
  });

  it("refuses a status outside the four, malformed", () => {
    expect(() => inputOf(listInvitationsInput, { status: "pending" })).toThrow(/status/);
  });
});

describe("who may act on invitations", () => {
  type Verb = (
    principal: UserPrincipal,
    tx: Tx,
    invitationId: string,
  ) => Promise<Result<unknown, unknown>>;

  const verbs: readonly (readonly [string, Verb])[] = [
    [
      "resend",
      (principal, tx, invitationId) =>
        resendInvitation(principal, tx, { invitationId, now: INVITED_AT }),
    ],
    ["cancel", (principal, tx, invitationId) => cancelInvitation(principal, tx, { invitationId })],
    [
      "list",
      (principal, tx) => listInvitations(principal, tx, { status: "waiting", at: INVITED_AT }),
    ],
    ["count", (principal, tx) => countInvitations(principal, tx, { at: INVITED_AT })],
  ];

  it.each(verbs)("refuses an Editor and a Viewer the %s verb", async (_verb, verb) => {
    const workspace = await provisionedWorkspace(db(), "Roles");
    const invited = answeredValue(await invite(workspace, addressOf("priya"), "Viewer"));

    for (const role of ["Editor", "Viewer"] as const) {
      const person = await memberAt(workspace, role);
      const refused = await as(workspace, person.id, async (principal, tx) => {
        await abortTheTransaction(tx);
        return verb(principal, tx, invited.invitationId);
      });
      expect({ role, refused }).toEqual({ role, refused: { ok: false, error: "role-forbids" } });
    }
    expect(await invitationsOf(workspace)).toMatchObject([
      { status: "pending", expires_at: new Date(A_WEEK_LATER) },
    ]);
  });

  it.each(verbs)("answers the %s verb's failed statement as a failure", async (_verb, verb) => {
    const workspace = await provisionedWorkspace(db(), "Failing");
    const invited = answeredValue(await invite(workspace, addressOf("priya"), "Viewer"));

    const failed = await as(workspace, workspace.adminUserId, async (principal, tx) => {
      await abortTheTransaction(tx);
      return verb(principal, tx, invited.invitationId);
    });

    expect(failed).toEqual({ ok: false, error: expect.any(Error) });
  });
});
