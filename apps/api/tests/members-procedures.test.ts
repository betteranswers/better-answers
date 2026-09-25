import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until, whileWritesAreRefused } from "@better-answers/core/testing/postgres";

import { startApp, type TestApp } from "./harness.ts";
import { revocationHeldOpen, seededIn, sessionPointedAt, someoneWaitsOnALock } from "./provoke.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

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

/** Signed in to a workspace of their own, with a session that names `workspaceId` instead. */
const anAdminOfElsewherePointedAt = async (workspaceId: string) => {
  const elsewhere = await app.provision();
  const { api } = await webSignedIn(app, elsewhere.admin.email);
  await sessionPointedAt(app, elsewhere.admin.id, workspaceId);
  return api;
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
      },
      {
        personId: viewer.id,
        displayName: "Sam Okoro",
        address: viewer.email,
        role: "Viewer",
        groups: [],
        joinedAt: seeded.viewerRow.createdAt.toISOString(),
      },
      {
        personId: admin.id,
        displayName: "Test person",
        address: admin.email,
        role: "Admin",
        groups: [],
        joinedAt: expect.stringMatching(ISO_INSTANT),
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
    const workspace = await app.provision();
    const person = await app.person();
    await app.addMember(workspace.workspaceId, person.id, role);
    const { api } = await webSignedIn(app, person.email);

    const refused = await refusalOfCall(api.members.list.query());

    expect(refused).toMatchObject({
      data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
    });
  });

  it("refuses an Admin of another workspace pointed at this one", async () => {
    const workspace = await app.provision();
    const api = await anAdminOfElsewherePointedAt(workspace.workspaceId);

    const refused = await refusalOfCall(api.members.list.query());

    expect(refused).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
    });
  });
});

const ROLE_CHANGED = "people.member.role_changed";

const roleHeldBy = async (workspaceId: string, personId: string): Promise<string | undefined> => {
  const held = await app.database.superuser.query<{ role: string }>(
    "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, personId],
  );
  return held.rows[0]?.role;
};

const roleChangesIn = async (workspaceId: string) => {
  const rows = await app.database.superuser.query<{
    actor: string;
    subject_id: string;
    detail: Readonly<Record<string, string>>;
  }>(
    "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY id",
    [workspaceId, ROLE_CHANGED],
  );
  return rows.rows;
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
    const workspace = await app.provision();
    const second = await app.person();
    await app.addMember(workspace.workspaceId, second.id, "Admin");
    const { api: theirs } = await webSignedIn(app, second.email);
    const { api: mine } = await webSignedIn(app, workspace.admin.email);
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

  it("refuses demoting the only Admin, last-admin, recording nothing", async () => {
    const workspace = await app.provision();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const refused = await refusalOfCall(
      api.members.changeRole.mutate({ personId: workspace.admin.id, role: "Editor" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 412, refusal: { word: "last-admin", class: "precondition" } },
    });
    expect(await roleHeldBy(workspace.workspaceId, workspace.admin.id)).toBe("Admin");
    expect(await roleChangesIn(workspace.workspaceId)).toEqual([]);
  });

  it("lets one of two Admins demote themself", async () => {
    const workspace = await app.provision();
    const second = await app.person();
    await app.addMember(workspace.workspaceId, second.id, "Admin");
    const { api } = await webSignedIn(app, workspace.admin.email);

    await api.members.changeRole.mutate({ personId: workspace.admin.id, role: "Editor" });

    expect(await roleHeldBy(workspace.workspaceId, workspace.admin.id)).toBe("Editor");
    expect(await roleHeldBy(workspace.workspaceId, second.id)).toBe("Admin");
  });
});

describe("who may change a role", () => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses a member at %s, role-forbids, recording nothing",
    async (role) => {
      const { workspace, viewer } = await aWorkspaceOfThree();
      const actor = await app.person();
      await app.addMember(workspace.workspaceId, actor.id, role);
      const { api } = await webSignedIn(app, actor.email);

      const refused = await refusalOfCall(
        api.members.changeRole.mutate({ personId: viewer.id, role: "Editor" }),
      );

      expect(refused).toMatchObject({
        data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
      });
      expect(await roleHeldBy(workspace.workspaceId, viewer.id)).toBe("Viewer");
      expect(await roleChangesIn(workspace.workspaceId)).toEqual([]);
    },
  );

  it("refuses an Admin of another workspace pointed at this one", async () => {
    const { workspace, viewer } = await aWorkspaceOfThree();
    const api = await anAdminOfElsewherePointedAt(workspace.workspaceId);

    const refused = await refusalOfCall(
      api.members.changeRole.mutate({ personId: viewer.id, role: "Editor" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
    });
    expect(await roleHeldBy(workspace.workspaceId, viewer.id)).toBe("Viewer");
    expect(await roleChangesIn(workspace.workspaceId)).toEqual([]);
  });

  it("refuses a member of another workspace as no member here", async () => {
    const mine = await app.provision();
    const theirs = await app.provision();
    const stranger = await app.person();
    await app.addMember(theirs.workspaceId, stranger.id, "Viewer");
    const { api } = await webSignedIn(app, mine.admin.email);

    const refused = await refusalOfCall(
      api.members.changeRole.mutate({ personId: stranger.id, role: "Admin" }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-member", class: "absent" } },
    });
    expect(await roleHeldBy(theirs.workspaceId, stranger.id)).toBe("Viewer");
    expect(await roleChangesIn(theirs.workspaceId)).toEqual([]);
  });
});

describe("a role change that fails partway", () => {
  it("leaves no rows when its audit event cannot land", async () => {
    const { workspace, viewer } = await aWorkspaceOfThree();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const failed = await whileWritesAreRefused(app.database.superuser, "audit_event", () =>
      refusalOfCall(api.members.changeRole.mutate({ personId: viewer.id, role: "Editor" })),
    );

    expect(failed).toHaveProperty("message", "changeRole failed");
    expect(failed).toHaveProperty("data.httpStatus", 500);
    expect(failed).not.toHaveProperty("data.refusal");
    expect(await roleHeldBy(workspace.workspaceId, viewer.id)).toBe("Viewer");
    expect(await roleChangesIn(workspace.workspaceId)).toEqual([]);
  });

  it("refuses the change when a revocation lands while it waits", async () => {
    const { workspace, viewer } = await aWorkspaceOfThree();
    const { api } = await webSignedIn(app, workspace.admin.email);
    const revocation = await revocationHeldOpen(app, workspace.admin.id);
    try {
      const changing = refusalOfCall(
        api.members.changeRole.mutate({ personId: viewer.id, role: "Editor" }),
      );
      await until(() => someoneWaitsOnALock(app));
      await revocation.land();

      expect(await changing).toMatchObject({
        data: {
          httpStatus: 401,
          refusal: { word: "credentials-revoked", class: "unauthenticated" },
        },
      });
    } finally {
      await revocation.abandon();
    }
    expect(await roleHeldBy(workspace.workspaceId, viewer.id)).toBe("Viewer");
    expect(await roleChangesIn(workspace.workspaceId)).toEqual([]);
  });
});
