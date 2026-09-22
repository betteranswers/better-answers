import { readFileSync } from "node:fs";

import { testData } from "@better-answers/schema/testing";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import { attempt, type Result, type Role, type UserPrincipal } from "../src/kernel/index.ts";
import {
  approveRequest,
  declineRequest,
  listWaitingRequests,
  REQUEST_ROLE_DEFAULT,
  requestAccess,
} from "../src/members/index.ts";
import { openPostgres, type Opened, type Tx, withPrincipal } from "../src/store/postgres/index.ts";
import { provisionWorkspace } from "../src/workspaces/index.ts";
import { bootstrap, seedPerson } from "./platform.ts";
import { asSliceRelative, coreSourceFiles, sourceTreeIsInstrumented } from "./source-tree.ts";
import { abortTheTransaction, postgresForSuite, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForSuite();

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

const outsider = (): Promise<string> => seedPerson(db().pool);

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

const as = <T>(
  workspaceId: string,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => withPrincipal(door(), { workspaceId, userId, issuedAt: new Date() }, work);

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

    const rows = await requestRows(workspace.id);
    expect(rows.map((row) => row.requester_id)).toEqual([requester]);

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

  it("hands a caller the store's own failure from the insert, rather than the acknowledgement", async () => {
    const workspace = await provision("Unsaved");
    const requester = await outsider();

    const asked = await whileWritesAreRefused(db().pool, "access_request", () =>
      requestAccess(bootstrap, door(), {
        slug: workspace.slug,
        requesterId: requester,
        reason: "I have joined the bids team and need the answer library.",
      }),
    );

    expect(asked).toEqual({ ok: false, error: expect.any(Error) });
    expect(await requestRows(workspace.id)).toEqual([]);

    const events = await db().pool.query("SELECT 1 FROM audit_event WHERE actor = $1", [
      `human:${requester}`,
    ]);
    expect(events.rowCount).toBe(0);
  });
});

describe("approving a request", () => {
  it("mints the invitation to the requester's address at the role the Admin chose, and records it", async () => {
    const { workspace, requester, requestId } = await withOneWaitingRequest("Approve");

    const decidedAt = new Date("2031-06-15T09:30:00.000Z");

    const approved = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      approveRequest(principal, tx, { requestId, role: "Editor" }, decidedAt),
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

    expect(invitation.rows[0]?.expires_at).toEqual(new Date("2031-06-17T09:30:00.000Z"));

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
      approveRequest(principal, tx, { requestId }, new Date()),
    );

    expect(approved).toMatchObject({ ok: true, value: { role: REQUEST_ROLE_DEFAULT } });
    expect(REQUEST_ROLE_DEFAULT).toBe("Viewer");
  });

  it("refuses a role outside the three, leaving the request waiting and no invitation minted", async () => {
    const { workspace, requestId } = await withOneWaitingRequest("Foreign");

    const approved = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      approveRequest(principal, tx, { requestId, role: "owner" }, new Date()),
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
        approveRequest(principal, tx, { requestId }, new Date()),
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
      approveRequest(principal, tx, { requestId: ulid() }, new Date()),
    );

    expect(approved).toEqual({ ok: false, error: "no-such-request" });
  });

  it("hands the Admin the store's own failure when the invitation cannot be minted", async () => {
    const { workspace, requestId } = await withOneWaitingRequest("Unminted");
    let approved: unknown;

    await expect(
      whileWritesAreRefused(db().pool, "invitation", () =>
        as(workspace.id, workspace.adminUserId, async (principal, tx) => {
          approved = await approveRequest(principal, tx, { requestId }, new Date());
        }),
      ),
    ).rejects.toThrow(/did not commit/);

    expect(approved).toEqual({ ok: false, error: expect.any(Error) });
    expect(await requestRows(workspace.id)).toMatchObject([{ status: "waiting" }]);
  });
});

describe("what a decision refuses and what it passes on", () => {
  type Decision = (
    principal: UserPrincipal,
    tx: Tx,
    requestId: string,
  ) => Promise<Result<unknown, string | Error>>;

  const DECISIONS: readonly (readonly [string, Decision])[] = [
    [
      "approving",
      (principal, tx, requestId) => approveRequest(principal, tx, { requestId }, new Date()),
    ],
    ["declining", (principal, tx, requestId) => declineRequest(principal, tx, { requestId })],
  ];

  it.each(DECISIONS)("refuses %s a request id of no known form", async (verb, decide) => {
    const { workspace } = await withOneWaitingRequest(`Shapeless${verb}`);

    const refused = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      decide(principal, tx, "' OR true --"),
    );

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await requestRows(workspace.id)).toMatchObject([{ status: "waiting" }]);
  });

  it.each(DECISIONS)(
    "hands the Admin the store's own failure when %s cannot be landed",
    async (verb, decide) => {
      const { workspace, requestId } = await withOneWaitingRequest(`Unlandable${verb}`);
      let decided: unknown;

      await expect(
        whileWritesAreRefused(db().pool, "access_request", () =>
          as(workspace.id, workspace.adminUserId, async (principal, tx) => {
            decided = await decide(principal, tx, requestId);
          }),
        ),
      ).rejects.toThrow(/did not commit/);

      expect(decided).toEqual({ ok: false, error: expect.any(Error) });
      expect(await requestRows(workspace.id)).toMatchObject([{ status: "waiting" }]);
      expect((await eventsAbout(requestId)).map((event) => event.act)).toEqual([
        "people.request.asked",
      ]);
    },
  );
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

  it("hands the Admin the store's own failure rather than a queue with nobody in it", async () => {
    const { workspace } = await withOneWaitingRequest("Unqueued");
    let listed: Result<unknown, unknown> | undefined;

    await expect(
      as(workspace.id, workspace.adminUserId, async (principal, tx) => {
        await abortTheTransaction(tx);
        listed = await listWaitingRequests(principal, tx);
      }),
    ).rejects.toThrow(/did not commit/);

    expect(listed).toEqual({ ok: false, error: expect.any(Error) });
    expect(listed?.ok === false ? String(listed.error) : "").toContain(
      "current transaction is aborted",
    );
  });

  it("hands the Admin a row the boundary cannot read rather than a queue that omits it", async () => {
    const { workspace, requestId } = await withOneWaitingRequest("Unreadable");

    await db().pool.query("UPDATE access_request SET id = $2 WHERE id = $1", [
      requestId,
      "not-a-ulid",
    ]);

    const listed = await as(workspace.id, workspace.adminUserId, (principal, tx) =>
      listWaitingRequests(principal, tx),
    );

    expect(listed).toEqual({ ok: false, error: expect.any(Error) });
  });
});

describe("who may decide", () => {
  type Verb = (
    principal: UserPrincipal,
    tx: Tx,
    requestId: string,
  ) => Promise<Result<unknown, unknown>>;

  const verbs: readonly [string, Verb][] = [
    [
      "approve",
      (principal, tx, requestId) => approveRequest(principal, tx, { requestId }, new Date()),
    ],
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

      expect(reached).toEqual(
        name === "list" ? { ok: true, value: [] } : { ok: false, error: "no-such-request" },
      );
      expect(await requestRows(workspace.id)).toMatchObject([{ status: "waiting" }]);
    });
  }
});

describe("the actor-naming door", () => {
  it.skipIf(sourceTreeIsInstrumented())(
    "is called by the request act and by nothing else in the tree",
    async () => {
      const call = /\brecordFor\(/;

      expect(call.test("await recordFor(platform, tx, event);")).toBe(true);
      expect(call.test("export const recordFor = <A extends LedgerAct>(")).toBe(false);
      expect(call.test("import { record } from '../audit/index.ts';")).toBe(false);

      const callers = coreSourceFiles().filter((file) => call.test(readFileSync(file, "utf8")));

      expect(asSliceRelative(callers).toSorted()).toEqual(["members/requests.ts"]);
    },
  );
});
