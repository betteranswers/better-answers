import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startApp, type TestApp } from "./harness.ts";
import { seededIn, sessionPointedAt } from "./provoke.ts";
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
    const elsewhere = await app.provision();
    const { api } = await webSignedIn(app, elsewhere.admin.email);
    await sessionPointedAt(app, elsewhere.admin.id, workspace.workspaceId);

    const refused = await refusalOfCall(api.members.list.query());

    expect(refused).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
    });
  });
});
