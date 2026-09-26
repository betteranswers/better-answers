import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "@better-answers/core/testing/postgres";

import { connectAsHost, setActiveWorkspace } from "./flow.ts";
import { startApp, type TestApp } from "./harness.ts";
import { callMcp } from "./mcp-call.ts";
import {
  anAdminOfElsewherePointedAt,
  NOT_A_MEMBER_ANSWERED,
  refusalToAMemberAt,
  refusalToAnotherWorkspacesAdmin,
  ROLE_FORBIDS_ANSWERED,
} from "./people-refusals.ts";
import {
  failureOf,
  revocationHeldOpen,
  seededIn,
  someoneWaitsOnALock,
  whileAuditRowsVanish,
  type HeldRevocation,
} from "./provoke.ts";
import { refusalOfCall, webClientOf, webSignedIn } from "./web-client.ts";

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const aWorkspaceOfThree = async () => {
  const workspace = await app.provision();
  const { workspaceId } = workspace;
  const editor = await app.person(undefined, "Priya Shah");
  const viewer = await app.person(undefined, "Sam Okoro");
  const seeded = await seededIn(app, async (seed) => {
    const editorRow = await seed.member({ workspaceId, userId: editor.id, role: "Editor" });
    const viewerRow = await seed.member({ workspaceId, userId: viewer.id, role: "Viewer" });
    const hr = await seed.group({ workspaceId, name: "HR team" });
    const bids = await seed.group({ workspaceId, name: "Bid writers" });
    await seed.groupMember({ workspaceId, groupId: hr.id, userId: editor.id });
    await seed.groupMember({ workspaceId, groupId: bids.id, userId: editor.id });
    return { editorRow, viewerRow, hr: hr.id, bids: bids.id };
  });
  return { workspace, editor, viewer, seeded };
};

describe("the members list over tRPC", () => {
  it("lists each member's name, address, role, groups and when joined", async () => {
    const { workspace, editor, viewer, seeded } = await aWorkspaceOfThree();
    const { admin } = workspace;
    const { api } = await webSignedIn(app, admin.email);

    const listed = await api.members.list.query();

    expect(listed).toEqual([
      {
        personId: editor.id,
        displayName: "Priya Shah",
        address: editor.email,
        role: "Editor",
        groups: [
          { groupId: seeded.bids, name: "Bid writers" },
          { groupId: seeded.hr, name: "HR team" },
        ],
        joinedAt: seeded.editorRow.createdAt.toISOString(),
        credentialsRevokedAt: null,
      },
      {
        personId: viewer.id,
        displayName: "Sam Okoro",
        address: viewer.email,
        role: "Viewer",
        groups: [],
        joinedAt: seeded.viewerRow.createdAt.toISOString(),
        credentialsRevokedAt: null,
      },
      {
        personId: admin.id,
        displayName: "Test person",
        address: admin.email,
        role: "Admin",
        groups: [],
        joinedAt: expect.stringMatching(ISO_INSTANT),
        credentialsRevokedAt: null,
      },
    ]);
  });

  it("names no member row's own key anywhere in its answer", async () => {
    const { workspace, seeded } = await aWorkspaceOfThree();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const answered = JSON.stringify(await api.members.list.query());

    expect(answered).not.toContain(seeded.editorRow.id);
    expect(answered).not.toContain(seeded.viewerRow.id);
  });

  it("never lists a member of another workspace", async () => {
    const mine = await app.provision();
    const theirs = await app.provision();
    const stranger = await app.person(undefined, "Una Elsewhere");
    await app.addMember(theirs.workspaceId, stranger.id, "Editor");
    const { api } = await webSignedIn(app, mine.admin.email);

    const listed = await api.members.list.query();

    expect(listed.map((member) => member.personId)).toEqual([mine.admin.id]);
  });
});

describe("what the members list refuses", () => {
  it.each(["Editor", "Viewer"] as const)("refuses a member at %s, role-forbids", async (role) => {
    const refused = await refusalToAMemberAt(app, role, (api) => api.members.list.query());

    expect(refused).toMatchObject(ROLE_FORBIDS_ANSWERED);
  });

  it("refuses an Admin of another workspace pointed at this one", async () => {
    const refused = await refusalToAnotherWorkspacesAdmin(app, (api) => api.members.list.query());

    expect(refused).toMatchObject(NOT_A_MEMBER_ANSWERED);
  });
});

const roleHeldBy = async (workspaceId: string, personId: string): Promise<string | undefined> => {
  const held = await app.database.superuser.query<{ role: string }>(
    "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, personId],
  );
  return held.rows[0]?.role;
};

const eventsIn = async (workspaceId: string, act: string) => {
  const rows = await app.database.superuser.query<{
    actor: string;
    subject_id: string;
    detail: Readonly<Record<string, string>>;
  }>(
    "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY id",
    [workspaceId, act],
  );
  return rows.rows;
};

const ROLE_CHANGED = "people.member.role_changed";

const REMOVED = "people.member.removed";

const roleChangesIn = (workspaceId: string) => eventsIn(workspaceId, ROLE_CHANGED);

const removalsIn = (workspaceId: string) => eventsIn(workspaceId, REMOVED);

type WebApi = Awaited<ReturnType<typeof webSignedIn>>["api"];

/** Each act on one member as the Members view asks it, beside the audit act it writes. */
const ACTS_ON_A_MEMBER = [
  {
    verb: "change a role",
    ask: (api: WebApi, personId: string) =>
      api.members.changeRole.mutate({ personId, role: "Editor" }),
    recorded: ROLE_CHANGED,
  },
  {
    verb: "remove a member",
    ask: (api: WebApi, personId: string) => api.members.remove.mutate({ personId }),
    recorded: REMOVED,
  },
] as const;

/** Its first Admin is the one signed in on the web. */
const aWorkspaceOfTwoAdmins = async () => {
  const workspace = await app.provision();
  const second = await app.person();
  await app.addMember(workspace.workspaceId, second.id, "Admin");
  return { workspace, second, ...(await webSignedIn(app, workspace.admin.email)) };
};

describe("changing a member's role over tRPC", () => {
  it("moves a member to the asked role and records it", async () => {
    const { workspace, viewer } = await aWorkspaceOfThree();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const changed = await api.members.changeRole.mutate({ personId: viewer.id, role: "Editor" });

    expect(changed).toEqual({ personId: viewer.id, previousRole: "Viewer", role: "Editor" });
    expect(await roleHeldBy(workspace.workspaceId, viewer.id)).toBe("Editor");
    expect(await roleChangesIn(workspace.workspaceId)).toEqual([
      {
        actor: `human:${workspace.admin.id}`,
        subject_id: viewer.id,
        detail: { previousRole: "Viewer", role: "Editor" },
      },
    ]);
  });

  it("holds from the member's next request, as their membership says", async () => {
    const { second, api: mine } = await aWorkspaceOfTwoAdmins();
    const { api: theirs } = await webSignedIn(app, second.email);
    expect((await theirs.session.membership.query()).role).toBe("Admin");

    await mine.members.changeRole.mutate({ personId: second.id, role: "Viewer" });

    expect((await theirs.session.membership.query()).role).toBe("Viewer");
    expect(await refusalOfCall(theirs.members.list.query())).toMatchObject({
      data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
    });
  });

  it("refuses a role outside the three, no-such-role, recording nothing", async () => {
    const { workspace, viewer } = await aWorkspaceOfThree();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const refused = await refusalOfCall(
      api.members.changeRole.mutate({ personId: viewer.id, role: "Owner" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-role", class: "absent" } },
    });
    expect(await roleHeldBy(workspace.workspaceId, viewer.id)).toBe("Viewer");
    expect(await roleChangesIn(workspace.workspaceId)).toEqual([]);
  });

  it("lets one of two Admins demote themself", async () => {
    const { workspace, second, api } = await aWorkspaceOfTwoAdmins();

    await api.members.changeRole.mutate({ personId: workspace.admin.id, role: "Editor" });

    expect(await roleHeldBy(workspace.workspaceId, workspace.admin.id)).toBe("Editor");
    expect(await roleHeldBy(workspace.workspaceId, second.id)).toBe("Admin");
  });
});

describe.each(ACTS_ON_A_MEMBER)("who may $verb", ({ ask, recorded }) => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses a member at %s, role-forbids, recording nothing",
    async (role) => {
      const { workspace, viewer } = await aWorkspaceOfThree();
      const actor = await app.person();
      await app.addMember(workspace.workspaceId, actor.id, role);
      const { api } = await webSignedIn(app, actor.email);

      const refused = await refusalOfCall(ask(api, viewer.id));

      expect(refused).toMatchObject(ROLE_FORBIDS_ANSWERED);
      expect(await roleHeldBy(workspace.workspaceId, viewer.id)).toBe("Viewer");
      expect(await eventsIn(workspace.workspaceId, recorded)).toEqual([]);
    },
  );

  it("refuses an Admin of another workspace pointed at this one", async () => {
    const { workspace, viewer } = await aWorkspaceOfThree();
    const api = await anAdminOfElsewherePointedAt(app, workspace.workspaceId);

    const refused = await refusalOfCall(ask(api, viewer.id));

    expect(refused).toMatchObject(NOT_A_MEMBER_ANSWERED);
    expect(await roleHeldBy(workspace.workspaceId, viewer.id)).toBe("Viewer");
    expect(await eventsIn(workspace.workspaceId, recorded)).toEqual([]);
  });

  it("refuses a member of another workspace as no member here", async () => {
    const mine = await app.provision();
    const theirs = await app.provision();
    const stranger = await app.person();
    await app.addMember(theirs.workspaceId, stranger.id, "Viewer");
    const { api } = await webSignedIn(app, mine.admin.email);

    const refused = await refusalOfCall(ask(api, stranger.id));

    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-member", class: "absent" } },
    });
    expect(await roleHeldBy(theirs.workspaceId, stranger.id)).toBe("Viewer");
    expect(await eventsIn(theirs.workspaceId, recorded)).toEqual([]);
  });

  it("refuses the workspace's only Admin, last-admin, recording nothing", async () => {
    const workspace = await app.provision();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const refused = await refusalOfCall(ask(api, workspace.admin.id));

    expect(refused).toMatchObject({
      data: { httpStatus: 412, refusal: { word: "last-admin", class: "precondition" } },
    });
    expect(await roleHeldBy(workspace.workspaceId, workspace.admin.id)).toBe("Admin");
    expect(await eventsIn(workspace.workspaceId, recorded)).toEqual([]);
  });
});

const NOTHING_LANDED = { role: "Viewer", changes: [] };

const whatLanded = async (workspaceId: string, personId: string) => ({
  role: await roleHeldBy(workspaceId, personId),
  changes: await roleChangesIn(workspaceId),
});

/** `meanwhile` runs while the Admin's change waits to read their membership, held under a lock. */
const aChangeWaitingOnARevocation = async (
  meanwhile: (revocation: HeldRevocation) => Promise<unknown>,
) => {
  const { workspace, viewer } = await aWorkspaceOfThree();
  const { api } = await webSignedIn(app, workspace.admin.email);
  const revocation = await revocationHeldOpen(app, workspace.admin.id);
  try {
    const changing = refusalOfCall(
      api.members.changeRole.mutate({ personId: viewer.id, role: "Editor" }),
    );
    await until(() => someoneWaitsOnALock(app));
    await meanwhile(revocation);
    return { answered: await changing, workspaceId: workspace.workspaceId, viewerId: viewer.id };
  } finally {
    await revocation.abandon();
  }
};

describe("a role change that fails partway", () => {
  it("leaves no rows when its audit event lands none", async () => {
    const { workspace, viewer } = await aWorkspaceOfThree();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const failed = await whileAuditRowsVanish(app, () =>
      refusalOfCall(api.members.changeRole.mutate({ personId: viewer.id, role: "Editor" })),
    );

    expect(failureOf(failed)).toEqual({
      message: "changeRole failed",
      httpStatus: 500,
      refusal: undefined,
    });
    expect(await whatLanded(workspace.workspaceId, viewer.id)).toEqual(NOTHING_LANDED);
  });

  it("answers a failed held membership read as failure, not signed-out", async () => {
    const { answered, workspaceId, viewerId } = await aChangeWaitingOnARevocation(async () => {
      await app.database.superuser.query(
        `SELECT pg_cancel_backend(pid) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
    });

    expect(failureOf(answered)).toEqual({
      message: "withPrincipal failed",
      httpStatus: 500,
      refusal: undefined,
    });
    expect(await whatLanded(workspaceId, viewerId)).toEqual(NOTHING_LANDED);
  });

  it("refuses the change when a revocation lands while it waits", async () => {
    const { answered, workspaceId, viewerId } = await aChangeWaitingOnARevocation((revocation) =>
      revocation.land(),
    );

    expect(answered).toMatchObject({
      data: {
        httpStatus: 401,
        refusal: { word: "credentials-revoked", class: "unauthenticated" },
      },
    });
    expect(await whatLanded(workspaceId, viewerId)).toEqual(NOTHING_LANDED);
  });
});

const refreshTokensOf = async (personId: string) => {
  const found = await app.database.superuser.query<{ workspace_id: string; revoked: boolean }>(
    `SELECT reference_id AS workspace_id, revoked IS NOT NULL AS revoked FROM oauth_refresh_token
      WHERE user_id = $1 ORDER BY reference_id`,
    [personId],
  );
  return found.rows;
};

const sessionsHeldBy = async (personId: string): Promise<number | undefined> => {
  const found = await app.database.superuser.query<{ held: number }>(
    "SELECT count(*)::int AS held FROM session WHERE user_id = $1",
    [personId],
  );
  return found.rows[0]?.held;
};

/** Each client signs in on its own, so the person holds a session per client. */
const aMemberOfTwoOnFourClients = async () => {
  const acme = await app.provision({ name: "Acme" });
  const beta = await app.provision({ name: "Beta" });
  const person = await app.person(undefined, "Priya Shah");
  await app.addMember(acme.workspaceId, person.id, "Editor");
  await app.addMember(beta.workspaceId, person.id, "Viewer");
  const laptop = await webSignedIn(app, person.email);
  const phone = await webSignedIn(app, person.email);
  for (const browser of [laptop, phone]) {
    expect((await setActiveWorkspace(browser.client, acme.workspaceId)).status).toBe(200);
    expect((await browser.api.session.membership.query()).role).toBe("Editor");
  }
  const acmeHost = app.client();
  const betaHost = app.client();
  const inAcme = await connectAsHost(app, acmeHost, person, { pick: acme.workspaceId });
  const inBeta = await connectAsHost(app, betaHost, person, { pick: beta.workspaceId });
  return {
    acme,
    beta,
    person,
    sessionsInAcme: [laptop.api, phone.api, webClientOf(acmeHost).api],
    sessionInBeta: webClientOf(betaHost).api,
    laptop,
    inAcme,
    inBeta,
  };
};

describe("removing a member over tRPC", () => {
  it("refuses every session here, and keeps the person's other workspace", async () => {
    const { acme, beta, person, sessionsInAcme, sessionInBeta, laptop, inAcme, inBeta } =
      await aMemberOfTwoOnFourClients();
    const { api } = await webSignedIn(app, acme.admin.email);
    const host = app.client();
    expect(await sessionsHeldBy(person.id)).toBe(4);

    const removed = await api.members.remove.mutate({ personId: person.id });

    expect(removed).toEqual({ personId: person.id, role: "Editor" });
    expect(await roleHeldBy(acme.workspaceId, person.id)).toBeUndefined();
    for (const session of sessionsInAcme) {
      expect(await refusalOfCall(session.session.membership.query())).toMatchObject(
        NOT_A_MEMBER_ANSWERED,
      );
    }
    expect(await sessionInBeta.session.membership.query()).toMatchObject({
      workspace: { id: beta.workspaceId },
      role: "Viewer",
    });
    expect(await refreshTokensOf(person.id)).toEqual(
      [
        { workspace_id: acme.workspaceId, revoked: true },
        { workspace_id: beta.workspaceId, revoked: false },
      ].toSorted((one, other) => one.workspace_id.localeCompare(other.workspace_id)),
    );
    expect([
      (await callMcp(host, inAcme.accessToken, "tools/list")).status,
      (await callMcp(host, inBeta.accessToken, "tools/list")).status,
    ]).toEqual([401, 200]);
    expect(await sessionsHeldBy(person.id)).toBe(4);
    expect(await removalsIn(acme.workspaceId)).toEqual([
      { actor: `human:${acme.admin.id}`, subject_id: person.id, detail: { role: "Editor" } },
    ]);

    expect((await setActiveWorkspace(laptop.client, beta.workspaceId)).status).toBe(200);
    expect(await laptop.api.session.membership.query()).toMatchObject({
      workspace: { id: beta.workspaceId },
      role: "Viewer",
    });
  });

  it("lets one of two Admins remove themself, ending access here", async () => {
    const { workspace, second, api } = await aWorkspaceOfTwoAdmins();

    const removed = await api.members.remove.mutate({ personId: workspace.admin.id });

    expect(removed).toEqual({ personId: workspace.admin.id, role: "Admin" });
    expect(await refusalOfCall(api.members.list.query())).toMatchObject(NOT_A_MEMBER_ANSWERED);
    expect(await roleHeldBy(workspace.workspaceId, second.id)).toBe("Admin");
  });
});

describe("a removal that fails partway", () => {
  it("keeps the membership and tokens when no audit row lands", async () => {
    const workspace = await app.provision();
    const person = await app.person();
    await app.addMember(workspace.workspaceId, person.id, "Viewer");
    await connectAsHost(app, app.client(), person, { pick: workspace.workspaceId });
    const { api } = await webSignedIn(app, workspace.admin.email);

    const failed = await whileAuditRowsVanish(app, () =>
      refusalOfCall(api.members.remove.mutate({ personId: person.id })),
    );

    expect(failureOf(failed)).toEqual({
      message: "removeMember failed",
      httpStatus: 500,
      refusal: undefined,
    });
    expect(await roleHeldBy(workspace.workspaceId, person.id)).toBe("Viewer");
    expect(await refreshTokensOf(person.id)).toEqual([
      { workspace_id: workspace.workspaceId, revoked: false },
    ]);
    expect(await removalsIn(workspace.workspaceId)).toEqual([]);
  });
});
