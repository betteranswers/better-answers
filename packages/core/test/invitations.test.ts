import { describe, expect, it } from "vitest";

import type { Result, Role, UserPrincipal } from "../src/kernel/index.ts";
import {
  approveRequest,
  cancelInvitation,
  inviteMember,
  listInvitations,
  requestAccess,
  resendInvitation,
} from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { bootstrap, provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import {
  addressOf,
  countWaitingOnLocks,
  postgresForSuite,
  readingAs,
  seedingWith,
  until,
  whileActsWaitAt,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const db = postgresForSuite();

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const INVITED_AT = new Date("2031-06-15T09:30:00.000Z");

const A_WEEK_LATER = "2031-06-22T09:30:00.000Z";

const as = <T>(
  workspace: ProvisionedWorkspace,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Result<T, unknown>>,
) => readingAs(db().runtimePool, { workspaceId: workspace.workspaceId, userId }, work);

const invite = (
  workspace: ProvisionedWorkspace,
  address: string,
  role: string,
  now: Date = INVITED_AT,
) =>
  as(workspace, workspace.adminUserId, (principal, tx) =>
    inviteMember(principal, tx, { address, role, now }),
  );

const memberAt = async (workspace: ProvisionedWorkspace, role: Role) =>
  seedingWith(db().pool, async (seed) => {
    const person = await seed.user();
    await seed.member({ workspaceId: workspace.workspaceId, userId: person.id, role });
    return person;
  });

type InvitationRow = {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly inviter_id: string;
  readonly created_at: Date;
  readonly expires_at: Date;
};

const invitationsOf = async (workspace: ProvisionedWorkspace): Promise<InvitationRow[]> =>
  (
    await db().pool.query<InvitationRow>(
      `SELECT id, email, role, status, inviter_id, created_at, expires_at
         FROM invitation WHERE workspace_id = $1 ORDER BY created_at, id`,
      [workspace.workspaceId],
    )
  ).rows;

const invitationEvents = async (workspace: ProvisionedWorkspace) =>
  (
    await db().pool.query<{
      act: string;
      actor: string;
      subject_id: string;
      detail: Record<string, string>;
      batch_id: string | null;
    }>(
      `SELECT act, actor, subject_id, detail, batch_id FROM audit_event
        WHERE workspace_id = $1 AND act LIKE 'people.invitation.%' ORDER BY id`,
      [workspace.workspaceId],
    )
  ).rows;

const answeredValue = <T>(answer: Result<T, unknown>): T => {
  if (!answer.ok) throw new Error(`the act answered ${String(answer.error)}`);
  return answer.value;
};

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

    expect(refused).toEqual({ ok: false, error: "already-a-member" });
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
      error: "malformed",
    });
    expect(await invitationsOf(workspace)).toEqual([]);
  });

  it("replaces a waiting invitation to the address, cancelling it", async () => {
    const workspace = await provisionedWorkspace(db(), "Replacing");
    const address = addressOf("priya");

    const first = answeredValue(await invite(workspace, address, "Viewer"));
    const later = new Date("2031-06-16T10:00:00.000Z");
    const second = answeredValue(await invite(workspace, address.toUpperCase(), "Editor", later));

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

    await expect(
      whileWritesAreRefused(db().pool, "audit_event", () => invite(workspace, address, "Editor")),
    ).rejects.toThrow(/the store refused a write to audit_event/);

    expect(await invitationsOf(workspace)).toMatchObject([
      { id: standing.invitationId, status: "pending", role: "Viewer" },
    ]);
  });
});

describe("an approved access request's invitation", () => {
  it("is minted by the same step, replacing a waiting one", async () => {
    const workspace = await provisionedWorkspace(db(), "Approving");
    const requester = await seedingWith(db().pool, (seed) => seed.user());
    const direct = answeredValue(await invite(workspace, requester.email, "Viewer"));
    expect(
      await requestAccess(bootstrap, workspace.door, {
        slug: workspace.slug,
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
    expect(await invitationEvents(workspace)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          act: "people.invitation.created",
          subject_id: approved.invitationId,
          detail: { role: "Editor" },
        }),
        expect.objectContaining({
          act: "people.invitation.cancelled",
          subject_id: direct.invitationId,
          detail: { replacedByInvitationId: approved.invitationId },
        }),
      ]),
    );
  });
});

describe("resending an invitation", () => {
  it("renews a waiting invitation for seven days, with its event", async () => {
    const workspace = await provisionedWorkspace(db(), "Resending");
    const address = addressOf("priya");
    const invited = answeredValue(await invite(workspace, address, "Editor"));
    const now = new Date("2031-06-25T12:00:00.000Z");

    const resent = await as(workspace, workspace.adminUserId, (principal, tx) =>
      resendInvitation(principal, tx, { invitationId: invited.invitationId, now }),
    );

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
    expect((await invitationEvents(workspace)).map((event) => [event.act, event.detail])).toEqual([
      ["people.invitation.created", { role: "Editor" }],
      ["people.invitation.resent", {}],
    ]);
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
    const invited = answeredValue(await invite(workspace, addressOf("priya"), "Viewer"));
    answeredValue(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        cancelInvitation(principal, tx, { invitationId: invited.invitationId }),
      ),
    );
    const eventsBefore = await invitationEvents(workspace);

    const refused = await as(workspace, workspace.adminUserId, (principal, tx) =>
      act(principal, tx, invited.invitationId),
    );

    expect(refused).toEqual({ ok: false, error: "no-such-invitation" });
    expect(await invitationEvents(workspace)).toEqual(eventsBefore);
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

describe("the waiting invitations", () => {
  it("lists waiting and expired invitations newest first, none decided", async () => {
    const workspace = await provisionedWorkspace(db(), "Listing", { name: "Priya Shah" });
    const elsewhere = await provisionedWorkspace(db(), "Unlisted");
    const expiredAddress = addressOf("expired");
    const waitingAddress = addressOf("waiting");
    const expired = answeredValue(
      await invite(workspace, expiredAddress, "Viewer", new Date("2031-05-01T08:00:00Z")),
    );
    const waiting = answeredValue(await invite(workspace, waitingAddress, "Editor"));
    const gone = answeredValue(await invite(workspace, addressOf("gone"), "Admin"));
    answeredValue(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        cancelInvitation(principal, tx, { invitationId: gone.invitationId }),
      ),
    );
    await invite(elsewhere, addressOf("theirs"), "Editor");

    const listed = await as(workspace, workspace.adminUserId, listInvitations);

    expect(listed).toEqual({
      ok: true,
      value: [
        {
          invitationId: waiting.invitationId,
          address: waitingAddress,
          role: "Editor",
          invitedAt: "2031-06-15T09:30:00.000Z",
          expiresAt: A_WEEK_LATER,
          invitedBy: "Priya Shah",
        },
        {
          invitationId: expired.invitationId,
          address: expiredAddress,
          role: "Viewer",
          invitedAt: "2031-05-01T08:00:00.000Z",
          expiresAt: "2031-05-08T08:00:00.000Z",
          invitedBy: "Priya Shah",
        },
      ],
    });
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
      "invite",
      (principal, tx) =>
        inviteMember(principal, tx, { address: addressOf("x"), role: "Viewer", now: INVITED_AT }),
    ],
    [
      "resend",
      (principal, tx, invitationId) =>
        resendInvitation(principal, tx, { invitationId, now: INVITED_AT }),
    ],
    ["cancel", (principal, tx, invitationId) => cancelInvitation(principal, tx, { invitationId })],
    ["list", (principal, tx) => listInvitations(principal, tx)],
  ];

  it.each(verbs)("refuses an Editor and a Viewer the %s verb", async (_verb, verb) => {
    const workspace = await provisionedWorkspace(db(), "Roles");
    const invited = answeredValue(await invite(workspace, addressOf("priya"), "Viewer"));

    for (const role of ["Editor", "Viewer"] as const) {
      const person = await memberAt(workspace, role);
      const refused = await as(workspace, person.id, (principal, tx) =>
        verb(principal, tx, invited.invitationId),
      );
      expect({ role, refused }).toEqual({ role, refused: { ok: false, error: "role-forbids" } });
    }
    expect(await invitationsOf(workspace)).toMatchObject([{ status: "pending" }]);
  });
});
