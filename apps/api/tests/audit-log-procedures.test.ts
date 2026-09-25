import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startApp, type TestApp } from "./harness.ts";
import { makeGroups } from "./harness-people.ts";
import {
  NOT_A_MEMBER_ANSWERED,
  refusalToAMemberAt,
  refusalToAnotherWorkspacesAdmin,
  refusalToTheAdmin,
  ROLE_FORBIDS_ANSWERED,
} from "./people-refusals.ts";
import { webSignedIn } from "./web-client.ts";

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

const signInsOf = async (personId: string): Promise<number> => {
  const found = await app.database.superuser.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM identity_audit_event
      WHERE act = 'people.person.signed_in' AND subject_id = $1`,
    [personId],
  );
  return found.rows[0]?.held ?? 0;
};

describe("the audit log over tRPC", () => {
  it("answers an Admin the workspace's events newest first, actors named", async () => {
    const workspace = await app.provision();
    const { workspaceId, admin } = workspace;
    const unnamed = await app.person(undefined, "");
    await app.addMember(workspaceId, unnamed.id, "Admin");
    await makeGroups(app, { workspaceId, userId: unnamed.id, names: ["Estimators"] });
    await makeGroups(app, { workspaceId, userId: admin.id, names: ["Bid writers"] });
    const { api } = await webSignedIn(app, admin.email);

    const page = await api.members.auditLog.query({});

    expect(page.events.map(({ act, by }) => [act, by])).toEqual([
      ["people.group.created", { kind: "person", displayName: admin.name }],
      ["people.group.created", { kind: "former-member" }],
      ["platform.workspace.provisioned", { kind: "platform" }],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("crosses each instant as ISO-8601 text", async () => {
    const workspace = await app.provision();
    const { api } = await webSignedIn(app, workspace.admin.email);

    const [provisioned] = (await api.members.auditLog.query({})).events;

    expect(provisioned?.at).toBe(new Date(provisioned?.at ?? "").toISOString());
  });

  it("answers no sign-in, which the identity-set audit log keeps", async () => {
    const workspace = await app.provision();
    const { api } = await webSignedIn(app, workspace.admin.email);
    await webSignedIn(app, workspace.admin.email);

    const page = await api.members.auditLog.query({});

    expect(await signInsOf(workspace.admin.id)).toBe(2);
    expect(page.events.map((event) => event.act)).toEqual(["platform.workspace.provisioned"]);
  });

  it("answers one family, a page at a time", async () => {
    const workspace = await app.provision();
    const { workspaceId, admin } = workspace;
    await makeGroups(app, { workspaceId, userId: admin.id, names: ["One", "Two", "Three"] });
    const { api } = await webSignedIn(app, admin.email);

    const first = await api.members.auditLog.query({ family: "people", limit: 2 });
    const rest = await api.members.auditLog.query({
      family: "people",
      limit: 2,
      cursor: first.nextCursor,
    });

    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).toBe(first.events[1]?.id);
    expect(rest.events.map((event) => event.act)).toEqual(["people.group.created"]);
    expect(rest.nextCursor).toBeNull();
  });

  it("never answers an event of another workspace", async () => {
    const mine = await app.provision();
    const theirs = await app.provision();
    await makeGroups(app, {
      workspaceId: theirs.workspaceId,
      userId: theirs.admin.id,
      names: ["Theirs"],
    });
    const { api } = await webSignedIn(app, mine.admin.email);

    const page = await api.members.auditLog.query({});

    expect(page.events.map((event) => [event.act, event.subjectId])).toEqual([
      ["platform.workspace.provisioned", mine.workspaceId],
    ]);
  });
});

describe("what the audit log refuses", () => {
  it.each(["Editor", "Viewer"] as const)("refuses a member at %s, role-forbids", async (role) => {
    const refused = await refusalToAMemberAt(app, role, (api) => api.members.auditLog.query({}));

    expect(refused).toMatchObject(ROLE_FORBIDS_ANSWERED);
  });

  it("refuses an Admin of another workspace pointed at this one", async () => {
    const refused = await refusalToAnotherWorkspacesAdmin(app, (api) =>
      api.members.auditLog.query({}),
    );

    expect(refused).toMatchObject(NOT_A_MEMBER_ANSWERED);
  });

  it.each([
    ["a cursor that is no event's id", { cursor: "not-an-id" }],
    ["a page of no events", { limit: 0 }],
    ["a page past fifty events", { limit: 51 }],
  ])("refuses %s, malformed", async (_asked, input) => {
    const refused = await refusalToTheAdmin(app, (api) => api.members.auditLog.query(input));

    expect(refused).toMatchObject({
      data: { httpStatus: 400, refusal: { word: "malformed", class: "malformed" } },
    });
  });
});
