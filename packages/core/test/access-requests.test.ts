import { readFileSync } from "node:fs";

import { testData } from "@better-answers/schema/testing";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { INVITATION_EXPIRY_SECONDS, ulid } from "@better-answers/schema";

import { attempt, type Result, type Role, type UserPrincipal } from "../src/kernel/index.ts";
import {
  approveRequest,
  declineRequest,
  listWaitingRequests,
  REQUEST_ROLE_DEFAULT,
  requestAccess,
} from "../src/members/index.ts";
import { openPostgres, type Tx, withPrincipal } from "../src/store/postgres/index.ts";
import { provisionWorkspace } from "../src/workspaces/index.ts";
import { bootstrap, seedPerson } from "./platform.ts";
import { asSliceRelative, coreSourceFiles } from "./source-tree.ts";
import { postgresForSuite } from "./suite-postgres.ts";

/**
 * The *access request* through the members slice's entry point (`[TEST1]`), against real
 * Postgres: the ask a non-member makes at the auth boundary, the two decisions an Admin
 * takes and the queue they read — each with what it refuses beside what it serves.
 *
 * The claim this suite exists for is the one ADR 0038 makes: **the surface can never be
 * used to enumerate workspaces**. That is only a claim until a real workspace, an unknown
 * slug, a membership and a waiting request are all here to answer identically, which is why
 * the seam is the slice's entry point over a real database and not a unit of anything.
 */

const db = postgresForSuite();

/** A provisioned workspace, its first Admin, and the slug a colleague would pass on. */
type Workspace = { readonly id: string; readonly slug: string; readonly adminUserId: string };

const provision = async (name: string): Promise<Workspace> => {
  const adminUserId = await seedPerson(db().pool);
  const id = ulid();
  const slug = `${name.toLowerCase()}-${id.toLowerCase()}`;
  const provisioned = await provisionWorkspace(bootstrap, openPostgres(db().runtimePool), {
    id,
    name,
    slug,
    adminUserId,
  });
  expect(provisioned.ok).toBe(true);
  return { id, slug, adminUserId };
};

const door = () => openPostgres(db().runtimePool);

/** A person on the identity set who belongs to no workspace — every requester here. */
const outsider = (): Promise<string> => seedPerson(db().pool);

/** Add a person to a workspace at a role, and hand back their person id. */
const memberAt = async (workspaceId: string, role: Role): Promise<string> => {
  const client = await db().pool.connect();
  try {
    const person = await testData(client).user();
    await testData(client).member({ workspaceId, userId: person.id, role });
    return person.id;
  } finally {
    client.release();
  }
};

/** Run `work` in one transaction as this person's Principal, and unwrap the resolve. */
const as = async <T>(
  workspaceId: string,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => {
  const resolved = await withPrincipal(door(), { workspaceId, userId, issuedAt: new Date() }, work);
  if (!resolved.ok) throw new Error(`the principal did not resolve: ${resolved.error}`);
  return resolved.value;
};

/** Every access-request row of a workspace, oldest first, as the superuser reads them. */
const requestRows = async (workspaceId: string) => {
  const rows = await db().pool.query<{
    id: string;
    requester_id: string;
    reason: string;
    status: string;
    decided_by: string | null;
    decided_at: Date | null;
    invitation_id: string | null;
  }>(
    `SELECT id, requester_id, reason, status, decided_by, decided_at, invitation_id
       FROM access_request WHERE workspace_id = $1 ORDER BY created_at, id`,
    [workspaceId],
  );
  return rows.rows;
};

/** Every ledger row about one subject, as the superuser reads them. */
const eventsAbout = async (subjectId: string) => {
  const rows = await db().pool.query<{
    act: string;
    actor: string;
    subject_kind: string;
    detail: Record<string, string | number | boolean>;
  }>("SELECT act, actor, subject_kind, detail FROM audit_event WHERE subject_id = $1 ORDER BY at", [
    subjectId,
  ]);
  return rows.rows;
};

/** A workspace with one waiting request on it, which is the footing both decisions share. */
const withOneWaitingRequest = async (name: string) => {
  const workspace = await provision(name);
  const requester = await outsider();
  const asked = await requestAccess(bootstrap, door(), {
    slug: workspace.slug,
    requesterId: requester,
    reason: "I have joined the bids team and need the answer library.",
  });
  expect(asked.ok).toBe(true);
  const rows = await requestRows(workspace.id);
  const requestId = rows[0]?.id ?? "";
  return { workspace, requester, requestId };
};

describe("asking to join a workspace", () => {
  it("records the ask with its reason, and books its ledger row to the person who asked", async () => {
    const workspace = await provision("Acme");
    const requester = await outsider();

    const asked = await requestAccess(bootstrap, door(), {
      slug: workspace.slug,
      requesterId: requester,
      reason: "I have joined the bids team and need the answer library.",
    });

    expect(asked).toEqual({ ok: true, value: { acknowledged: true } });
    const rows = await requestRows(workspace.id);
    expect(rows).toEqual([
      {
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        requester_id: requester,
        reason: "I have joined the bids team and need the answer library.",
        status: "waiting",
        decided_by: null,
        decided_at: null,
        invitation_id: null,
      },
    ]);
    // The one caller of the actor-naming door (`[AUDIT4]`): the row is the requester's act,
    // made under the platform principal, so the actor is the person and never the platform.
    expect(await eventsAbout(rows[0]?.id ?? "")).toEqual([
      {
        act: "people.request.asked",
        actor: `human:${requester}`,
        subject_kind: "request",
        detail: { requesterId: requester },
      },
    ]);
  });

  it("answers one acknowledgement for a real slug, an unknown one, an already-member and a second ask", async () => {
    // ADR 0038's anti-enumeration rule as a functional test: four different truths, one
    // answer, and a row written in exactly one of them.
    const workspace = await provision("Neutral");
    const requester = await outsider();
    const ask = (slug: string, requesterId: string) =>
      requestAccess(bootstrap, door(), { slug, requesterId, reason: "Please let me in." });

    const real = await ask(workspace.slug, requester);
    const unknown = await ask(`no-such-workspace-${ulid().toLowerCase()}`, await outsider());
    const alreadyMember = await ask(workspace.slug, workspace.adminUserId);
    const secondAsk = await ask(workspace.slug, requester);

    const answers = [real, unknown, alreadyMember, secondAsk];
    expect(answers).toEqual(answers.map(() => ({ ok: true, value: { acknowledged: true } })));
    // One row, from the first ask alone — the member wrote none and the second ask was
    // refused by the partial unique index, whose refusal the acknowledgement covers.
    const rows = await requestRows(workspace.id);
    expect(rows.map((row) => row.requester_id)).toEqual([requester]);
    // And the second ask's event went with its transaction: one act, not two.
    expect(await eventsAbout(rows[0]?.id ?? "")).toHaveLength(1);
  });

  it("refuses a reason nobody wrote and a requester that is not a person id, and writes nothing", async () => {
    const workspace = await provision("Malformed");
    const ask = (requesterId: string, reason: string) =>
      requestAccess(bootstrap, door(), { slug: workspace.slug, requesterId, reason });

    expect(await ask(await outsider(), "   ")).toEqual({ ok: false, error: "malformed" });
    expect(await ask("' OR true --", "Please let me in.")).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(await requestRows(workspace.id)).toEqual([]);
  });

  it("leaves nothing behind when the person asking is on no identity row, and says so to nobody", async () => {
    // `[AUDIT1]`'s fail-together proof for this slice: the ledger row is written before the
    // request row, so the foreign key refusing a person nobody minted comes *after* the
    // event — which proves the event rolled back with the act rather than never having run.
    //
    // And the answer is the acknowledgement, not a refusal: the foreign key can only fail
    // where the slug resolved, so a caller free to name a person who does not exist would
    // otherwise read "this workspace is real" off the difference.
    const workspace = await provision("Ghost");
    const nobody = ulid();
    const ask = (slug: string) =>
      requestAccess(bootstrap, door(), {
        slug,
        requesterId: nobody,
        reason: "I am nobody at all.",
      });

    const asked = await ask(workspace.slug);

    expect(asked).toEqual({ ok: true, value: { acknowledged: true } });
    expect(asked).toEqual(await ask(`no-such-workspace-${ulid().toLowerCase()}`));
    expect(await requestRows(workspace.id)).toEqual([]);
    // Read as the superuser, so a row that survived could not hide behind the policy.
    const events = await db().pool.query("SELECT 1 FROM audit_event WHERE actor = $1", [
      `human:${nobody}`,
    ]);
    expect(events.rowCount).toBe(0);
  });

  it("hands a caller the store's own failure rather than a refusal it could act on", async () => {
    const gone = new pg.Pool(db().runtimePool.options);
    await gone.end();

    const asked = await requestAccess(bootstrap, openPostgres(gone), {
      slug: "acme",
      requesterId: await outsider(),
      reason: "Please let me in.",
    });

    expect(asked.ok).toBe(false);
    if (asked.ok) return;
    expect(asked.error).toBeInstanceOf(Error);
  });
});

describe("approving a request", () => {
  it("mints the invitation to the requester's address at the role the Admin chose, and records it", async () => {
    const { workspace, requester, requestId } = await withOneWaitingRequest("Approve");
    const before = Date.now();

    const approved = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      approveRequest(principal, tx, { requestId, role: "Editor" }),
    );

    expect(approved).toEqual({
      ok: true,
      value: {
        requestId,
        invitationId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        role: "Editor",
      },
    });
    if (!approved.ok) return;
    const rows = await requestRows(workspace.id);
    expect(rows[0]).toMatchObject({
      status: "approved",
      decided_by: workspace.adminUserId,
      invitation_id: approved.value.invitationId,
    });
    expect(rows[0]?.decided_at).toBeInstanceOf(Date);

    // The invitation is a row this act wrote itself, never Better Auth's endpoint: to the
    // requester's own address, at the chosen role, pending, and expiring at the plugin's
    // own default (`[DEPS1]`, pinned by apps/api/tests/invitation-shape.test.ts).
    const invitation = await db().pool.query<{
      email: string;
      role: string;
      status: string;
      expires_at: Date;
      inviter_id: string;
      workspace_id: string;
    }>(
      "SELECT email, role, status, expires_at, inviter_id, workspace_id FROM invitation WHERE id = $1",
      [approved.value.invitationId],
    );
    const person = await db().pool.query<{ email: string }>(
      'SELECT email FROM "user" WHERE id = $1',
      [requester],
    );
    expect(invitation.rows[0]).toMatchObject({
      email: person.rows[0]?.email,
      role: "Editor",
      status: "pending",
      inviter_id: workspace.adminUserId,
      workspace_id: workspace.id,
    });
    const expiresAt = invitation.rows[0]?.expires_at.getTime() ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + INVITATION_EXPIRY_SECONDS * 1000);

    expect(await eventsAbout(requestId)).toEqual([
      {
        act: "people.request.asked",
        actor: `human:${requester}`,
        subject_kind: "request",
        detail: { requesterId: requester },
      },
      {
        act: "people.request.approved",
        actor: `human:${workspace.adminUserId}`,
        subject_kind: "request",
        detail: {
          requesterId: requester,
          role: "Editor",
          invitationId: approved.value.invitationId,
        },
      },
    ]);
  });

  it("lets an Admin who names no role approve at Viewer", async () => {
    const { workspace, requestId } = await withOneWaitingRequest("Default");

    const approved = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      approveRequest(principal, tx, { requestId }),
    );

    expect(approved).toMatchObject({ ok: true, value: { role: REQUEST_ROLE_DEFAULT } });
    expect(REQUEST_ROLE_DEFAULT).toBe("Viewer");
  });

  it("refuses a role outside the three, leaving the request waiting and no invitation minted", async () => {
    const { workspace, requestId } = await withOneWaitingRequest("Foreign");

    const approved = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      approveRequest(principal, tx, { requestId, role: "owner" }),
    );

    expect(approved).toEqual({ ok: false, error: "no-such-role" });
    expect(await requestRows(workspace.id)).toMatchObject([{ status: "waiting" }]);
    const invitations = await db().pool.query("SELECT 1 FROM invitation WHERE workspace_id = $1", [
      workspace.id,
    ]);
    expect(invitations.rowCount).toBe(0);
  });

  it("refuses a request that was already decided, and never mints a second invitation", async () => {
    const { workspace, requestId } = await withOneWaitingRequest("Twice");
    const approve = () =>
      as(workspace.id, workspace.adminUserId, (principal, tx) =>
        approveRequest(principal, tx, { requestId }),
      );

    expect((await approve()).ok).toBe(true);
    expect(await approve()).toEqual({ ok: false, error: "already-decided" });
    const invitations = await db().pool.query("SELECT 1 FROM invitation WHERE workspace_id = $1", [
      workspace.id,
    ]);
    expect(invitations.rowCount).toBe(1);
  });

  it("refuses an id no request of this workspace carries", async () => {
    const workspace = await provision("Missing");

    const approved = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      approveRequest(principal, tx, { requestId: ulid() }),
    );

    expect(approved).toEqual({ ok: false, error: "no-such-request" });
  });
});

describe("declining a request", () => {
  it("records who said no and leaves the person free to ask again", async () => {
    const { workspace, requester, requestId } = await withOneWaitingRequest("Decline");

    const declined = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      declineRequest(principal, tx, { requestId }),
    );

    expect(declined).toEqual({ ok: true, value: { requestId } });
    expect(await requestRows(workspace.id)).toMatchObject([
      { status: "declined", decided_by: workspace.adminUserId, invitation_id: null },
    ]);
    expect(await eventsAbout(requestId)).toMatchObject([
      { act: "people.request.asked" },
      {
        act: "people.request.declined",
        actor: `human:${workspace.adminUserId}`,
        detail: { requesterId: requester },
      },
    ]);

    // The partial unique index holds only the waiting rows, so a declined person may ask
    // again — and the second ask is a row of its own.
    const again = await requestAccess(bootstrap, door(), {
      slug: workspace.slug,
      requesterId: requester,
      reason: "Asking again now that I am on the account.",
    });
    expect(again).toEqual({ ok: true, value: { acknowledged: true } });
    expect((await requestRows(workspace.id)).map((row) => row.status)).toEqual([
      "declined",
      "waiting",
    ]);
  });

  it("refuses a decision on a request that was already decided", async () => {
    const { workspace, requestId } = await withOneWaitingRequest("Settled");
    const decline = () =>
      as(workspace.id, workspace.adminUserId, (principal, tx) =>
        declineRequest(principal, tx, { requestId }),
      );

    expect((await decline()).ok).toBe(true);
    expect(await decline()).toEqual({ ok: false, error: "already-decided" });
  });

  it("never commits a decision whose transaction met a failed statement", async () => {
    // `[TEST8]`: the abort is provoked inside the work, so the assertion is on the
    // transaction's outcome first — the opener refuses to report a COMMIT Postgres
    // answered with ROLLBACK — and on the act's value second.
    const { workspace, requestId } = await withOneWaitingRequest("Aborted");
    let declined: Awaited<ReturnType<typeof declineRequest>> | undefined;

    await expect(
      withPrincipal(
        door(),
        { workspaceId: workspace.id, userId: workspace.adminUserId, issuedAt: new Date() },
        async (principal, tx) => {
          await attempt(() => tx.query("SELECT no_such_function()"));
          declined = await declineRequest(principal, tx, { requestId });
        },
      ),
    ).rejects.toThrow(/did not commit/);

    expect(declined).toMatchObject({ ok: false, error: expect.any(Error) });
    expect(await requestRows(workspace.id)).toMatchObject([{ status: "waiting" }]);
  });
});

describe("the Admin's queue", () => {
  it("lists the waiting requests with who asked, when and why — oldest first, decided ones gone", async () => {
    const workspace = await provision("Queue");
    const first = await outsider();
    const second = await outsider();
    for (const [requesterId, reason] of [
      [first, "I am on the bid team."],
      [second, "I run the framework renewals."],
    ] as const) {
      expect(
        (await requestAccess(bootstrap, door(), { slug: workspace.slug, requesterId, reason })).ok,
      ).toBe(true);
    }
    const rows = await requestRows(workspace.id);
    expect(
      (
        await as(workspace.id, workspace.adminUserId, (principal, tx) =>
          declineRequest(principal, tx, { requestId: rows[0]?.id ?? "" }),
        )
      ).ok,
    ).toBe(true);

    const waiting = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      listWaitingRequests(principal, tx),
    );

    const person = await db().pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM "user" WHERE id = $1',
      [second],
    );
    expect(waiting).toEqual({
      ok: true,
      value: [
        {
          id: rows[1]?.id,
          requester: { id: second, name: person.rows[0]?.name, email: person.rows[0]?.email },
          reason: "I run the framework renewals.",
          askedAt: expect.any(Date),
        },
      ],
    });
  });
});

/**
 * The tenant boundary and the role, held per verb — the T-027 house pattern. An Editor and a
 * Viewer are refused with the kernel's one word; an Admin of another workspace is refused as
 * an Admin whose scope simply does not hold the row, which is the policy answering rather
 * than a check anybody wrote.
 */
describe("who may decide", () => {
  type Verb = (
    principal: UserPrincipal,
    tx: Tx,
    requestId: string,
  ) => Promise<Result<unknown, unknown>>;

  const verbs: readonly [string, Verb][] = [
    ["approve", (principal, tx, requestId) => approveRequest(principal, tx, { requestId })],
    ["decline", (principal, tx, requestId) => declineRequest(principal, tx, { requestId })],
    ["list", (principal, tx) => listWaitingRequests(principal, tx)],
  ];

  for (const [name, verb] of verbs) {
    it(`refuses an Editor and a Viewer the ${name} verb, with the one word`, async () => {
      const { workspace, requestId } = await withOneWaitingRequest(`Role${name}`);

      for (const role of ["Editor", "Viewer"] as const) {
        const person = await memberAt(workspace.id, role);
        const refused = await as(workspace.id, person, (principal, tx) =>
          verb(principal, tx, requestId),
        );
        expect({ role, refused }).toEqual({ role, refused: { ok: false, error: "role-forbids" } });
      }
      expect(await requestRows(workspace.id)).toMatchObject([{ status: "waiting" }]);
    });

    it(`keeps an Admin of another workspace out of the ${name} verb`, async () => {
      const { workspace, requestId } = await withOneWaitingRequest(`Tenant${name}`);
      const elsewhere = await provision(`Other${name}`);

      const reached = await as(elsewhere.id, elsewhere.adminUserId, (principal, tx) =>
        verb(principal, tx, requestId),
      );

      // Their own queue is empty and the other workspace's request is not a row they can
      // name: a list answers nothing, a decision answers that there is no such request.
      expect(reached).toEqual(
        name === "list" ? { ok: true, value: [] } : { ok: false, error: "no-such-request" },
      );
      expect(await requestRows(workspace.id)).toMatchObject([{ status: "waiting" }]);
    });
  }
});

describe("the actor-naming door", () => {
  it("is called by the request act and by nothing else in the tree", async () => {
    // `[AUDIT4]`: the second door takes an explicit actor, and the *access request* is its
    // one caller — the act whose maker holds no Principal. A second caller would be a second
    // place a row could be booked to somebody other than the person making the call, which
    // is the whole thing the door's type exists to stop; the count is held here because the
    // criterion is this ticket's.
    const call = /\brecordFor\(/;
    // Proved to bite before its silence is read as innocence — and proved to leave the
    // door's own declaration alone, which is `export const recordFor = <A…>(` and no call.
    expect(call.test("await recordFor(platform, tx, event);")).toBe(true);
    expect(call.test("export const recordFor = <A extends Act>(")).toBe(false);
    expect(call.test("import { record } from '../audit/index.ts';")).toBe(false);

    const callers = coreSourceFiles().filter((file) => call.test(readFileSync(file, "utf8")));

    expect(asSliceRelative(callers).toSorted()).toEqual(["members/requests.ts"]);
  });
});
