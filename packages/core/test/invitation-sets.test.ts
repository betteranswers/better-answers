import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { parse, type Result, type UserPrincipal } from "../src/kernel/index.ts";
import {
  bulkCancelInvitations,
  bulkInvitationsInput,
  bulkResendInvitations,
  inviteMembers,
  inviteMembersInput,
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
import { heldAs } from "./members-suite.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import {
  abortTheTransaction,
  addressOf,
  countWaitingOnLocks,
  postgresForSuite,
  racedAt,
  until,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const db = postgresForSuite();

const {
  as,
  sending,
  invite,
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

const RESENT_AT = new Date("2031-06-25T12:00:00.000Z");

const sorted = (ids: readonly string[]): readonly string[] => ids.toSorted(byCodeUnit);

const resendingSet = (
  workspace: ProvisionedWorkspace,
  invitationIds: readonly string[],
  now: Date = RESENT_AT,
) =>
  heldAs(workspace, workspace.adminUserId, (principal, tx) =>
    bulkResendInvitations(principal, tx, {
      ...inputOf(bulkInvitationsInput, { invitationIds }),
      now,
    }),
  );

const cancellingSet = (workspace: ProvisionedWorkspace, invitationIds: readonly string[]) =>
  heldAs(workspace, workspace.adminUserId, (principal, tx) =>
    bulkCancelInvitations(principal, tx, inputOf(bulkInvitationsInput, { invitationIds })),
  );

const statusesOf = async (workspace: ProvisionedWorkspace) =>
  (await invitationsOf(workspace)).map((row) => [row.email, row.status]);

describe("inviting several addresses at once", () => {
  it("mints one invitation per address, in the order sent", async () => {
    const workspace = await provisionedWorkspace(db(), "Several");
    const [ben, ana, cai] = [addressOf("ben"), addressOf("ana"), addressOf("cai")];

    const sent = answeredValue(await sending(workspace, [ben, ana, cai], "Editor"));

    expect(sent.map(({ address, role, replaced }) => ({ address, role, replaced }))).toEqual([
      { address: ben, role: "Editor", replaced: false },
      { address: ana, role: "Editor", replaced: false },
      { address: cai, role: "Editor", replaced: false },
    ]);
    expect(sent.map((one) => one.expiresAt)).toEqual([A_WEEK_LATER, A_WEEK_LATER, A_WEEK_LATER]);
    const events = await invitationEvents(workspace);
    expect(events.map((event) => [event.action, event.subject_id])).toEqual(
      sent.map((one) => ["people.invitation.created", one.invitationId]),
    );
    const [batch] = events.map((event) => event.batch_id);
    expect(batch).toMatch(ULID);
    expect(events.map((event) => event.batch_id)).toEqual([batch, batch, batch]);
  });

  it("folds addresses in any case into one invitation", async () => {
    const workspace = await provisionedWorkspace(db(), "Folding");
    const ana = addressOf("ana");

    const sent = answeredValue(await sending(workspace, [ana.toUpperCase(), ana], "Viewer"));

    expect(sent).toEqual([expect.objectContaining({ address: ana, replaced: false })]);
    expect(await statusesOf(workspace)).toEqual([[ana, "pending"]]);
    expect(await emailsCountedTo(workspace, ana)).toBe(1);
  });

  it("cancels no invitation it minted itself", async () => {
    const workspace = await provisionedWorkspace(db(), "SelfMinted");
    const ana = addressOf("ana");
    const ben = addressOf("ben");

    answeredValue(await sending(workspace, [ana, ben, ana.toUpperCase(), ana], "Viewer"));

    expect(await statusesOf(workspace)).toEqual([
      [ana, "pending"],
      [ben, "pending"],
    ]);
    expect((await invitationEvents(workspace)).map((event) => event.action)).toEqual([
      "people.invitation.created",
      "people.invitation.created",
    ]);
  });

  it("replaces a waiting invitation, saying so, in the send's batch", async () => {
    const workspace = await provisionedWorkspace(db(), "Resending");
    const ana = addressOf("ana");
    const ben = addressOf("ben");
    const first = answeredValue(await invite(workspace, ana, "Viewer"));

    const sent = answeredValue(
      await sending(workspace, [ben, ana], "Editor", new Date("2031-06-16T10:00:00Z")),
    );

    expect(sent.map(({ address, replaced }) => [address, replaced])).toEqual([
      [ben, false],
      [ana, true],
    ]);
    const [toBen, toAna] = sent.map((one) => one.invitationId);
    expect((await invitationsOf(workspace)).map((row) => [row.id, row.status])).toEqual([
      [first.invitationId, "canceled"],
      ...sorted([toBen ?? "", toAna ?? ""]).map((id) => [id, "pending"]),
    ]);
    const events = (await invitationEvents(workspace)).slice(1);
    const batch = events[0]?.batch_id;
    expect(batch).toMatch(ULID);
    expect(events).toEqual([
      expect.objectContaining({
        action: "people.invitation.created",
        subject_id: toBen,
        detail: { role: "Editor" },
        batch_id: batch,
      }),
      expect.objectContaining({
        action: "people.invitation.created",
        subject_id: toAna,
        detail: { role: "Editor" },
        batch_id: batch,
      }),
      expect.objectContaining({
        action: "people.invitation.cancelled",
        subject_id: first.invitationId,
        detail: { replacedByInvitationId: toAna },
        batch_id: batch,
      }),
    ]);
  });

  it("refuses members' addresses by position, minting nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "MemberNamed");
    const editor = await memberAt(workspace, "Editor");
    const ana = addressOf("ana");

    const refused = await sending(
      workspace,
      [ana, editor.email.toUpperCase(), addressOf("ben"), editor.email],
      "Viewer",
    );

    expect(refused).toEqual({
      ok: false,
      error: {
        word: "already-a-member",
        items: { "1": "already-a-member", "3": "already-a-member" },
      },
    });
    expect(await invitationsOf(workspace)).toEqual([]);
    expect(await invitationEvents(workspace)).toEqual([]);
    expect(await emailsCountedTo(workspace, ana)).toBe(0);
  });

  it("refuses an address off a marked workspace's domain, minting nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "MarkedSend");
    const onDomain = await marked(workspace);
    const ana = onDomain("ana");

    const refused = await sending(workspace, [ana, addressOf("ben"), onDomain("cai")], "Viewer");

    expect(refused).toEqual({
      ok: false,
      error: { word: "off-testing-domain", items: { "1": "off-testing-domain" } },
    });
    expect([
      await invitationsOf(workspace),
      await invitationEvents(workspace),
      await emailsCountedTo(workspace, ana),
      await emailsCountedFrom(workspace),
    ]).toEqual([[], [], 0, 0]);
  });

  it("invites a marked workspace's own testing domain, however cased", async () => {
    const workspace = await provisionedWorkspace(db(), "MarkedSendOnDomain");
    const onDomain = await marked(workspace);

    const sent = await sending(
      workspace,
      [onDomain("ana"), onDomain("ben").toUpperCase()],
      "Viewer",
    );

    expect(answeredValue(sent).map((one) => one.address)).toEqual([
      onDomain("ana"),
      onDomain("ben"),
    ]);
  });

  it("names each malformed address by position, minting nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "MalformedNamed");

    const refused = await sending(
      workspace,
      [addressOf("ana"), "not-an-address", addressOf("ben"), ""],
      "Viewer",
    );

    expect(refused).toEqual({
      ok: false,
      error: { word: "malformed", items: { "1": "malformed", "3": "malformed" } },
    });
    expect(await invitationsOf(workspace)).toEqual([]);
  });

  it("mints for a platform person outside it as for anyone", async () => {
    const workspace = await provisionedWorkspace(db(), "Strangers");
    const elsewhere = await provisionedWorkspace(db(), "StrangersHome");
    const known = await memberAt(elsewhere, "Admin");
    const unknown = addressOf("unknown");

    const sent = answeredValue(await sending(workspace, [known.email, unknown], "Viewer"));

    const shapeOf = (one: (typeof sent)[number] | undefined) => ({
      ...one,
      invitationId: "the id",
      address: "the address",
    });
    expect(shapeOf(sent[0])).toEqual(shapeOf(sent[1]));
    expect(await statusesOf(workspace)).toEqual(
      expect.arrayContaining([
        [known.email, "pending"],
        [unknown, "pending"],
      ]),
    );
  });

  it("leaves another workspace's waiting invitation to the address waiting", async () => {
    const workspace = await provisionedWorkspace(db(), "Ours");
    const elsewhere = await provisionedWorkspace(db(), "Theirs");
    const ana = addressOf("ana");
    const theirs = answeredValue(await invite(elsewhere, ana, "Viewer"));

    const sent = answeredValue(await sending(workspace, [ana], "Editor"));

    expect(sent).toEqual([expect.objectContaining({ replaced: false })]);
    expect((await invitationsOf(elsewhere)).map((row) => [row.id, row.status])).toEqual([
      [theirs.invitationId, "pending"],
    ]);
  });

  it("refuses a send past one address's ceiling whole", async () => {
    const workspace = await provisionedWorkspace(db(), "SendCeiling");
    const ana = addressOf("ana");
    const ben = addressOf("ben");
    const invited = await atTheCeiling(workspace, ana);
    const before = await invitationsOf(workspace);

    const refused = await sending(workspace, [ben, ana], "Editor");

    expect(ceilingOf(refused)).toBe(1800);
    expect(await invitationsOf(workspace)).toEqual(before);
    expect(before.map((row) => row.id)).toEqual([invited.invitationId]);
    expect(await emailsCountedTo(workspace, ben)).toBe(0);
    expect(await emailsCountedTo(workspace, ana)).toBe(5);
  });

  it("counts each workspace's emails to an address apart", async () => {
    const workspace = await provisionedWorkspace(db(), "CeilingHere");
    const elsewhere = await provisionedWorkspace(db(), "CeilingThere");
    const ana = addressOf("ana");
    await atTheCeiling(workspace, ana);

    const sent = await sending(elsewhere, [ana], "Viewer");

    expect(sent).toMatchObject({ ok: true });
    expect(await emailsCountedTo(elsewhere, ana)).toBe(1);
  });

  it("refuses a send past the workspace's 200 an hour whole", async () => {
    const workspace = await provisionedWorkspace(db(), "WorkspaceCeiling");
    await invitedMany(workspace, 160);
    const before = await invitationsOf(workspace);
    const late = addressOf("late");
    const forty = Array.from({ length: 40 }, () => addressOf("late"));

    const refused = await sending(workspace, [late, ...forty], "Viewer");

    expect(ceilingOf(refused)).toBe(1800);
    expect(await invitationsOf(workspace)).toEqual(before);
    expect(before).toHaveLength(160);
    expect(await emailsCountedFrom(workspace)).toBe(160);
    expect(await emailsCountedTo(workspace, late)).toBe(0);

    const landed = await sending(workspace, forty, "Viewer");

    expect(landed).toMatchObject({ ok: true });
    expect(await emailsCountedFrom(workspace)).toBe(200);
    expect(ceilingOf(await sending(workspace, [addressOf("ana")], "Viewer"))).toBe(1800);
  });

  it("counts each workspace's emails against its own ceiling", async () => {
    const workspace = await provisionedWorkspace(db(), "FullHere");
    const elsewhere = await provisionedWorkspace(db(), "FullThere");
    await invitedMany(workspace, 200);

    const sent = await sending(elsewhere, [addressOf("ana")], "Viewer");

    expect(sent).toMatchObject({ ok: true });
    expect(await emailsCountedFrom(elsewhere)).toBe(1);
    expect(await emailsCountedFrom(workspace)).toBe(200);
  });

  it("lands both of two crossing sends whole", async () => {
    const workspace = await provisionedWorkspace(db(), "Crossing");
    const ana = addressOf("ana");
    const ben = addressOf("ben");

    const answers = await racedAt(db().pool, "invitation", [
      () => sending(workspace, [ana, ben], "Viewer"),
      () => sending(workspace, [ben, ana], "Editor"),
    ]);

    expect(answers.map((answer) => answer.ok)).toEqual([true, true]);
    const replaced = answers.flatMap((answer) =>
      answer.ok ? [answer.value.map((one) => one.replaced)] : [],
    );
    expect(replaced.toSorted()).toEqual([
      [false, false],
      [true, true],
    ]);
    const rows = await invitationsOf(workspace);
    expect(
      rows
        .filter((row) => row.status === "pending")
        .map((row) => row.email)
        .toSorted(),
    ).toEqual(sorted([ana, ben]));
    expect(rows.filter((row) => row.status === "canceled")).toHaveLength(2);
  });

  it("takes two crossing sends' counters in one order", async () => {
    const workspace = await provisionedWorkspace(db(), "CrossingCounters");
    const ana = addressOf("ana");
    const ben = addressOf("ben");

    const answers = await racedAt(
      db().pool,
      "invitation_email_counter",
      [
        () => sending(workspace, [ana, ben], "Viewer"),
        () => sending(workspace, [ben, ana], "Editor"),
      ],
      "together",
    );

    expect(answers.map((answer) => answer.ok)).toEqual([true, true]);
    expect(await emailsCountedFrom(workspace)).toBe(4);
  });

  it("answers a send caught in a deadlock changed-meanwhile", async () => {
    const workspace = await provisionedWorkspace(db(), "SendDeadlocked");
    const ana = addressOf("ana");
    const waiting = answeredValue(await invite(workspace, ana, "Viewer"));
    const holder = await db().pool.connect();
    const lockOfAna =
      "SELECT pg_advisory_xact_lock(hashtext('invitation'), hashtext($1 || ' ' || $2))";
    try {
      await holder.query("BEGIN");
      // The holder waits first and checks for a deadlock last, so the send finds the cycle.
      await holder.query("SET LOCAL deadlock_timeout = '30s'");
      await holder.query("SELECT 1 FROM invitation WHERE id = $1 FOR UPDATE", [
        waiting.invitationId,
      ]);
      const send = sending(workspace, [ana], "Editor");
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      const waitingOnTheSend = holder.query(lockOfAna, [workspace.workspaceId, ana]);

      expect(await send).toEqual({ ok: false, error: "changed-meanwhile" });
      await waitingOnTheSend;
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    expect((await invitationsOf(workspace)).map((row) => row.status)).toEqual(["pending"]);
  });
});

describe("the addresses asked to invite", () => {
  it.each([
    [51, "too-big"],
    [0, "too-small"],
  ])("refuses %i addresses, malformed", (count, issue) => {
    const addresses = Array.from({ length: count }, () => addressOf("x"));

    expect(parse(inviteMembersInput, { addresses, role: "Viewer" })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { addresses: issue } },
    });
  });

  it("takes 50 addresses", () => {
    const addresses = Array.from({ length: 50 }, () => addressOf("x"));

    expect(parse(inviteMembersInput, { addresses, role: "Viewer" })).toMatchObject({ ok: true });
  });
});

describe("resending a set of invitations", () => {
  it("renews two waiting and one expired, in one batch", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkResend");
    const expired = answeredValue(
      await invite(workspace, addressOf("old"), "Admin", new Date("2031-05-01T08:00:00Z")),
    );
    const sent = answeredValue(
      await sending(workspace, [addressOf("ana"), addressOf("ben")], "Viewer"),
    );
    const ids = [expired.invitationId, ...sent.map((one) => one.invitationId)];

    const resent = answeredValue(await resendingSet(workspace, ids));

    expect(resent.map((one) => [one.invitationId, one.expiresAt, one.workspaceName])).toEqual(
      sorted(ids).map((id) => [id, "2031-07-02T12:00:00.000Z", "BulkResend"]),
    );
    expect(
      (await invitationsOf(workspace)).map((row) => [row.status, row.expires_at.toISOString()]),
    ).toEqual([
      ["pending", "2031-07-02T12:00:00.000Z"],
      ["pending", "2031-07-02T12:00:00.000Z"],
      ["pending", "2031-07-02T12:00:00.000Z"],
    ]);
    const events = (await invitationEvents(workspace)).filter(
      (event) => event.action === "people.invitation.resent",
    );
    expect(sorted(events.map((event) => event.subject_id))).toEqual(sorted(ids));
    const [batch] = events.map((event) => event.batch_id);
    expect(batch).toMatch(ULID);
    expect(events.map((event) => [event.batch_id, event.detail])).toEqual([
      [batch, {}],
      [batch, {}],
      [batch, {}],
    ]);
  });

  it("refuses accepted, cancelled and unknown ids, renewing nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkResendRefused");
    const waiting = answeredValue(await invite(workspace, addressOf("ana"), "Viewer"));
    const cancelled = await cancelledInvitation(workspace, addressOf("ben"));
    const accepted = await invitationLeft(workspace, {
      email: addressOf("cai"),
      status: "accepted",
    });
    const unknown = ulid();
    const before = await invitationsOf(workspace);

    const refused = await resendingSet(workspace, [
      waiting.invitationId,
      accepted.id,
      cancelled.invitationId,
      unknown,
    ]);

    expect(refused).toEqual({
      ok: false,
      error: {
        word: "no-such-invitation",
        items: {
          [accepted.id]: "no-such-invitation",
          [cancelled.invitationId]: "no-such-invitation",
          [unknown]: "no-such-invitation",
        },
      },
    });
    expect(await invitationsOf(workspace)).toEqual(before);
    expect(await emailsCountedTo(workspace, waiting.address)).toBe(1);
  });

  it("refuses a set past one address's ceiling whole", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkResendCeiling");
    const ana = addressOf("ana");
    const ben = addressOf("ben");
    const atCeiling = await atTheCeiling(workspace, ana);
    const toBen = answeredValue(await invite(workspace, ben, "Viewer"));
    const before = await invitationsOf(workspace);
    const eventsBefore = await invitationEvents(workspace);

    const refused = await resendingSet(
      workspace,
      [toBen.invitationId, atCeiling.invitationId],
      INVITED_AT,
    );

    expect(ceilingOf(refused)).toBe(1800);
    expect(await invitationsOf(workspace)).toEqual(before);
    expect(await invitationEvents(workspace)).toEqual(eventsBefore);
    expect(await emailsCountedTo(workspace, ben)).toBe(1);
  });

  it("counts each renewal against the workspace's ceiling, refusing past it", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkResendWorkspaceCeiling");
    const sent = (await invitedMany(workspace, 188)).map((one) => one.invitationId);

    const resent = await resendingSet(workspace, sent.slice(0, 12), INVITED_AT);

    expect(resent).toMatchObject({ ok: true });
    expect(await emailsCountedFrom(workspace)).toBe(200);
    const before = await invitationsOf(workspace);
    const eventsBefore = await invitationEvents(workspace);

    const refused = await resendingSet(workspace, sent.slice(12, 13), INVITED_AT);

    expect(ceilingOf(refused)).toBe(1800);
    expect(await invitationsOf(workspace)).toEqual(before);
    expect(await invitationEvents(workspace)).toEqual(eventsBefore);
    expect(await emailsCountedFrom(workspace)).toBe(200);
  });

  it("refuses a marked workspace's off-domain invitations by id, renewing none", async () => {
    const workspace = await provisionedWorkspace(db(), "MarkedBulkResend");
    const offDomain = answeredValue(await invite(workspace, addressOf("ana"), "Viewer"));
    const onDomain = await marked(workspace);
    const ben = onDomain("ben");
    const toBen = answeredValue(await invite(workspace, ben, "Viewer"));
    const standing = async () => [
      await invitationsOf(workspace),
      await invitationEvents(workspace),
      await emailsCountedTo(workspace, ben),
    ];
    const before = await standing();

    const refused = await resendingSet(workspace, [toBen.invitationId, offDomain.invitationId]);

    expect(refused).toEqual({
      ok: false,
      error: {
        word: "off-testing-domain",
        items: { [offDomain.invitationId]: "off-testing-domain" },
      },
    });
    expect(await standing()).toEqual(before);
  });

  it("renews a marked workspace's invitations on its domain", async () => {
    const workspace = await provisionedWorkspace(db(), "MarkedBulkResendOnDomain");
    const onDomain = await marked(workspace);
    const toAna = answeredValue(await invite(workspace, onDomain("ana"), "Viewer"));

    const resent = await resendingSet(workspace, [toAna.invitationId]);

    expect(resent).toMatchObject({ ok: true, value: [{ invitationId: toAna.invitationId }] });
  });

  it("renews an id ticked twice once", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkResendTwice");
    const ana = addressOf("ana");
    const invited = answeredValue(await invite(workspace, ana, "Viewer"));

    const resent = await resendingSet(
      workspace,
      [invited.invitationId, invited.invitationId],
      INVITED_AT,
    );

    expect(resent).toMatchObject({ ok: true, value: [{ invitationId: invited.invitationId }] });
    expect((await invitationEvents(workspace)).at(-1)).toMatchObject({
      action: "people.invitation.resent",
      batch_id: null,
    });
    expect(await emailsCountedTo(workspace, ana)).toBe(2);
  });
});

describe("cancelling a set of invitations", () => {
  it("cancels each waiting and expired invitation, in one batch", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkCancel");
    const expired = answeredValue(
      await invite(workspace, addressOf("old"), "Viewer", new Date("2031-05-01T08:00:00Z")),
    );
    const waiting = answeredValue(await invite(workspace, addressOf("ana"), "Viewer"));
    const ids = [waiting.invitationId, expired.invitationId];

    const cancelled = await cancellingSet(workspace, ids);

    expect(cancelled).toEqual({ ok: true, value: { changed: sorted(ids), skipped: 0 } });
    expect((await invitationsOf(workspace)).map((row) => row.status)).toEqual([
      "canceled",
      "canceled",
    ]);
    const events = (await invitationEvents(workspace)).filter(
      (event) => event.action === "people.invitation.cancelled",
    );
    const [batch] = events.map((event) => event.batch_id);
    expect(batch).toMatch(ULID);
    expect(events.map((event) => [event.subject_id, event.detail, event.batch_id])).toEqual(
      sorted(ids).map((id) => [id, {}, batch]),
    );
  });

  it("refuses a set holding an accepted invitation, naming it", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkCancelAccepted");
    const waiting = answeredValue(await invite(workspace, addressOf("ana"), "Viewer"));
    const accepted = await invitationLeft(workspace, {
      email: addressOf("ben"),
      status: "accepted",
    });

    const refused = await cancellingSet(workspace, [waiting.invitationId, accepted.id]);

    expect(refused).toEqual({
      ok: false,
      error: { word: "no-such-invitation", items: { [accepted.id]: "no-such-invitation" } },
    });
    expect((await invitationsOf(workspace)).map((row) => [row.id, row.status])).toEqual([
      [waiting.invitationId, "pending"],
      [accepted.id, "accepted"],
    ]);
  });

  it("skips and counts one another Admin already cancelled", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkCancelSkips");
    const gone = await cancelledInvitation(workspace, addressOf("ana"));
    const waiting = answeredValue(await invite(workspace, addressOf("ben"), "Viewer"));

    const cancelled = await cancellingSet(workspace, [gone.invitationId, waiting.invitationId]);

    expect(cancelled).toEqual({
      ok: true,
      value: { changed: [waiting.invitationId], skipped: 1 },
    });
    expect(
      (await invitationEvents(workspace))
        .filter((event) => event.action === "people.invitation.cancelled")
        .map((event) => [event.subject_id, event.batch_id]),
    ).toEqual([
      [gone.invitationId, null],
      [waiting.invitationId, null],
    ]);
  });

  it("answers a cancel caught in a deadlock changed-meanwhile", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkCancelDeadlocked");
    const sent = answeredValue(
      await sending(workspace, [addressOf("ana"), addressOf("ben")], "Viewer"),
    );
    const [first, second] = sorted(sent.map((one) => one.invitationId));
    const holder = await db().pool.connect();
    const HOLD = "SELECT 1 FROM invitation WHERE id = $1 FOR UPDATE";
    try {
      await holder.query("BEGIN");
      // The holder waits first and checks for a deadlock last, so the cancel finds the cycle.
      await holder.query("SET LOCAL deadlock_timeout = '30s'");
      await holder.query(HOLD, [second]);
      const cancel = cancellingSet(workspace, [first ?? "", second ?? ""]);
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      const waitingOnTheCancel = holder.query(HOLD, [first]);

      expect(await cancel).toEqual({ ok: false, error: "changed-meanwhile" });
      await waitingOnTheCancel;
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    expect((await invitationsOf(workspace)).map((row) => row.status)).toEqual([
      "pending",
      "pending",
    ]);
  });
});

const EACH_SET_ON_IDS = [
  ["resend", resendingSet],
  ["cancel", cancellingSet],
] as const;

describe.each(EACH_SET_ON_IDS)("asked to %s another workspace's invitation", (_verb, actionOn) => {
  it("names it as it names a random id, changing nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "SetOnOurs");
    const elsewhere = await provisionedWorkspace(db(), "SetOnTheirs");
    const theirs = answeredValue(await invite(elsewhere, addressOf("ana"), "Viewer"));
    const random = ulid();

    const answers = [
      await actionOn(workspace, [theirs.invitationId]),
      await actionOn(workspace, [random]),
    ];

    expect(answers).toEqual(
      [theirs.invitationId, random].map((id) => ({
        ok: false,
        error: { word: "no-such-invitation", items: { [id]: "no-such-invitation" } },
      })),
    );
    expect(await invitationsOf(elsewhere)).toMatchObject([
      { status: "pending", expires_at: new Date(A_WEEK_LATER) },
    ]);
  });
});

describe("the invitation ids asked to resend or cancel", () => {
  it.each([
    [51, "too-big"],
    [0, "too-small"],
  ])("refuses %i ids, malformed", (count, issue) => {
    const invitationIds = Array.from({ length: count }, () => ulid());

    expect(parse(bulkInvitationsInput, { invitationIds })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { invitationIds: issue } },
    });
  });

  it("takes 50 ids", () => {
    const invitationIds = Array.from({ length: 50 }, () => ulid());

    expect(parse(bulkInvitationsInput, { invitationIds })).toMatchObject({ ok: true });
  });
});

type SetAction = (
  principal: UserPrincipal,
  tx: Tx,
  invitationId: string,
) => Promise<Result<unknown, unknown>>;

const EACH_SET_ACTION: readonly (readonly [string, SetAction])[] = [
  [
    "invite",
    (principal, tx) =>
      inviteMembers(principal, tx, {
        ...inputOf(inviteMembersInput, { addresses: [addressOf("x")], role: "Viewer" }),
        now: INVITED_AT,
      }),
  ],
  [
    "resend",
    (principal, tx, invitationId) =>
      bulkResendInvitations(principal, tx, {
        ...inputOf(bulkInvitationsInput, { invitationIds: [invitationId] }),
        now: INVITED_AT,
      }),
  ],
  [
    "cancel",
    (principal, tx, invitationId) =>
      bulkCancelInvitations(
        principal,
        tx,
        inputOf(bulkInvitationsInput, { invitationIds: [invitationId] }),
      ),
  ],
];

describe.each(EACH_SET_ACTION)("who may %s a set of invitations", (_verb, action) => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses a member at %s, before any read",
    async (role) => {
      const workspace = await provisionedWorkspace(db(), `SetForbidden${role}`);
      const invited = answeredValue(await invite(workspace, addressOf("ana"), "Viewer"));
      const person = await memberAt(workspace, role);
      const before = await invitationsOf(workspace);

      const refused = await as(workspace, person.id, async (principal, tx) => {
        await abortTheTransaction(tx);
        return action(principal, tx, invited.invitationId);
      });

      expect(refused).toEqual({ ok: false, error: "role-forbids" });
      expect(await invitationsOf(workspace)).toEqual(before);
    },
  );
});

describe.each(EACH_SET_ACTION)("a set action to %s whose event fails", (_verb, action) => {
  it("fails, leaving every invitation and count as it was", async () => {
    const workspace = await provisionedWorkspace(db(), "SetUnrecorded");
    const ana = addressOf("ana");
    const invited = answeredValue(await invite(workspace, ana, "Viewer"));
    const before = await invitationsOf(workspace);

    const failed = await whileWritesAreRefused(db().pool, "audit_event", () =>
      as(workspace, workspace.adminUserId, (principal, tx) =>
        action(principal, tx, invited.invitationId),
      ),
    );

    expect(failed).toEqual({ ok: false, error: expect.any(Error) });
    expect(await invitationsOf(workspace)).toEqual(before);
    expect(await emailsCountedTo(workspace, ana)).toBe(1);
  });
});
