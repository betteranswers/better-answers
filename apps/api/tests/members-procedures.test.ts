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

type MemberRow = { readonly id: string; readonly user_id: string; readonly created_at: Date };

const memberRowsOf = async (workspaceId: string): Promise<readonly MemberRow[]> =>
  (
    await app.database.superuser.query<MemberRow>(
      "SELECT id, user_id, created_at FROM member WHERE workspace_id = $1",
      [workspaceId],
    )
  ).rows;

const joinedAtOf = (rows: readonly MemberRow[], personId: string): string | undefined =>
  rows.find((row) => row.user_id === personId)?.created_at.toISOString();

/** An Admin, an Editor in two groups and a Viewer in none. */
const aWorkspaceOfThree = async () => {
  const workspace = await app.provision();
  const editor = await app.person(undefined, "Priya Shah");
  const viewer = await app.person(undefined, "Sam Okoro");
  await app.addMember(workspace.workspaceId, editor.id, "Editor");
  await app.addMember(workspace.workspaceId, viewer.id, "Viewer");
  const groups = await seededIn(app, async (seed) => {
    const { workspaceId } = workspace;
    const hr = await seed.group({ workspaceId, name: "HR team" });
    const bids = await seed.group({ workspaceId, name: "Bid writers" });
    await seed.groupMember({ workspaceId, groupId: hr.id, userId: editor.id });
    await seed.groupMember({ workspaceId, groupId: bids.id, userId: editor.id });
    return { hr: hr.id, bids: bids.id };
  });
  return { workspace, editor, viewer, groups };
};

describe("the members list over tRPC", () => {
  it("lists each member's name, address, role, groups and when joined", async () => {
    const { workspace, editor, viewer, groups } = await aWorkspaceOfThree();
    const { admin } = workspace;
    const { api } = await webSignedIn(app, admin.email);

    const listed = await api.members.list.query();

    const rows = await memberRowsOf(workspace.workspaceId);
    expect(listed).toEqual([
      {
        personId: editor.id,
        displayName: "Priya Shah",
        address: editor.email,
        role: "Editor",
        groups: [
          { groupId: groups.bids, name: "Bid writers" },
          { groupId: groups.hr, name: "HR team" },
        ],
        joinedAt: joinedAtOf(rows, editor.id),
      },
      {
        personId: viewer.id,
        displayName: "Sam Okoro",
        address: viewer.email,
        role: "Viewer",
        groups: [],
        joinedAt: joinedAtOf(rows, viewer.id),
      },
      {
        personId: admin.id,
        displayName: "Test person",
        address: admin.email,
        role: "Admin",
        groups: [],
        joinedAt: joinedAtOf(rows, admin.id),
      },
    ]);
  });

  it("names no member row's own key anywhere in its answer", async () => {
    const { workspace } = await aWorkspaceOfThree();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const answered = JSON.stringify(await api.members.list.query());

    const keys = (await memberRowsOf(workspace.workspaceId)).map((row) => row.id);
    expect(keys).toHaveLength(3);
    expect(keys.filter((key) => answered.includes(key))).toEqual([]);
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
