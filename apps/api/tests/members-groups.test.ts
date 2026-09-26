import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startApp, type TestApp } from "./harness.ts";
import { seededIn, sessionPointedAt } from "./provoke.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

const CURATED = "admin-curated";

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

/** HR team holds both non-Admin members; Bid writers holds no one. */
const aWorkspaceWithGroups = async () => {
  const workspace = await app.provision();
  const { workspaceId } = workspace;
  const priya = await app.person(undefined, "Priya Shah");
  const sam = await app.person(undefined, "Sam Okoro");
  const groups = await seededIn(app, async (seed) => {
    await seed.member({ workspaceId, userId: priya.id, role: "Editor" });
    await seed.member({ workspaceId, userId: sam.id, role: "Viewer" });
    const hr = await seed.group({ workspaceId, name: "HR team" });
    const bids = await seed.group({ workspaceId, name: "Bid writers" });
    await seed.groupMember({ workspaceId, groupId: hr.id, userId: priya.id });
    await seed.groupMember({ workspaceId, groupId: hr.id, userId: sam.id });
    return { hr: hr.id, bids: bids.id };
  });
  return { workspace, priya, sam, ...groups };
};

type Seeded = Awaited<ReturnType<typeof aWorkspaceWithGroups>>;

type Api = Awaited<ReturnType<typeof webSignedIn>>["api"];

const asTheAdmin = async (seeded: Seeded): Promise<Api> =>
  (await webSignedIn(app, seeded.workspace.admin.email)).api;

type GroupEvent = {
  readonly act: string;
  readonly actor: string;
  readonly subject_id: string;
  readonly detail: Readonly<Record<string, string>>;
};

/** Every group, membership and group event the workspace holds, read past row-level security. */
const standing = async (workspaceId: string) => {
  const { superuser } = app.database;
  const groups = await superuser.query<{ id: string; name: string }>(
    'SELECT id, name FROM "group" WHERE workspace_id = $1 ORDER BY name',
    [workspaceId],
  );
  const memberships = await superuser.query<{ group_id: string; user_id: string }>(
    "SELECT group_id, user_id FROM group_member WHERE workspace_id = $1 ORDER BY group_id, user_id",
    [workspaceId],
  );
  const events = await superuser.query<GroupEvent>(
    `SELECT act, actor, subject_id, detail FROM audit_event
      WHERE workspace_id = $1 AND act LIKE 'people.group.%' ORDER BY id`,
    [workspaceId],
  );
  return { groups: groups.rows, memberships: memberships.rows, events: events.rows };
};

const membersOf = async (workspaceId: string, groupId: string): Promise<readonly string[]> =>
  (await standing(workspaceId)).memberships
    .filter((membership) => membership.group_id === groupId)
    .map((membership) => membership.user_id);

const eventsIn = async (workspaceId: string): Promise<readonly GroupEvent[]> =>
  (await standing(workspaceId)).events;

/** The answer to `call`, having found the workspace's groups exactly as they stood before it. */
const refusedChangingNothing = async (
  workspaceId: string,
  call: () => Promise<unknown>,
): Promise<unknown> => {
  const before = await standing(workspaceId);
  const refused = await refusalOfCall(call());
  expect(await standing(workspaceId), "a refused group act changed something").toEqual(before);
  return refused;
};

const refusedAs = (httpStatus: number, word: string, refusalClass: string) => ({
  data: { httpStatus, refusal: { word, class: refusalClass } },
});

describe("the groups list over tRPC", () => {
  it("lists each group with its member count, in name order", async () => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    expect(await api.members.groups.query()).toEqual([
      { id: seeded.bids, name: "Bid writers", origin: CURATED, memberCount: 0 },
      { id: seeded.hr, name: "HR team", origin: CURATED, memberCount: 2 },
    ]);
  });

  it("never lists another workspace's group", async () => {
    await aWorkspaceWithGroups();
    const mine = await app.provision();
    const { api } = await webSignedIn(app, mine.admin.email);

    expect(await api.members.groups.query()).toEqual([]);
  });
});

describe("the group acts over tRPC", () => {
  it("creates a group and records it under the Admin", async () => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    const { groupId } = await api.members.createGroup.mutate({ name: "Site leads" });

    const now = await standing(seeded.workspace.workspaceId);
    expect(now.groups).toContainEqual({ id: groupId, name: "Site leads" });
    expect(now.events).toEqual([
      {
        act: "people.group.created",
        actor: `human:${seeded.workspace.admin.id}`,
        subject_id: groupId,
        detail: {},
      },
    ]);
  });

  it("creates a name another workspace already uses", async () => {
    const theirs = await aWorkspaceWithGroups();
    const mine = await app.provision();
    const { api } = await webSignedIn(app, mine.admin.email);

    const { groupId } = await api.members.createGroup.mutate({ name: "HR team" });

    expect((await standing(mine.workspaceId)).groups).toEqual([{ id: groupId, name: "HR team" }]);
    expect(await membersOf(theirs.workspace.workspaceId, theirs.hr)).toHaveLength(2);
  });

  it.each([
    {
      why: "a name taken here",
      name: "HR team",
      word: "name-taken",
      status: 409,
      class: "conflict",
    },
    { why: "a blank name", name: "   ", word: "malformed", status: 400, class: "malformed" },
  ])("refuses $why, $word, recording nothing", async (asked) => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    const refused = await refusedChangingNothing(seeded.workspace.workspaceId, () =>
      api.members.createGroup.mutate({ name: asked.name }),
    );

    expect(refused).toMatchObject(refusedAs(asked.status, asked.word, asked.class));
  });

  it("renames a group and records it", async () => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    await api.members.renameGroup.mutate({ groupId: seeded.hr, name: "People team" });

    const now = await standing(seeded.workspace.workspaceId);
    expect(now.groups).toEqual([
      { id: seeded.bids, name: "Bid writers" },
      { id: seeded.hr, name: "People team" },
    ]);
    expect(now.events.map((event) => [event.act, event.subject_id])).toEqual([
      ["people.group.renamed", seeded.hr],
    ]);
  });

  it("refuses a rename to a name taken here, name-taken", async () => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    const refused = await refusedChangingNothing(seeded.workspace.workspaceId, () =>
      api.members.renameGroup.mutate({ groupId: seeded.hr, name: "Bid writers" }),
    );

    expect(refused).toMatchObject(refusedAs(409, "name-taken", "conflict"));
  });

  it("deletes a group, taking its members out of it", async () => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    await api.members.deleteGroup.mutate({ groupId: seeded.hr });

    const now = await standing(seeded.workspace.workspaceId);
    expect(now.groups).toEqual([{ id: seeded.bids, name: "Bid writers" }]);
    expect(now.memberships).toEqual([]);
    expect(now.events.map((event) => [event.act, event.subject_id])).toEqual([
      ["people.group.deleted", seeded.hr],
    ]);
    const listed = await api.members.list.query();
    expect(listed.map((member) => member.groups)).toEqual([[], [], []]);
  });

  it("adds a member to a group, shown on their row", async () => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    await api.members.addToGroup.mutate({ groupId: seeded.bids, userId: seeded.sam.id });

    expect(await membersOf(seeded.workspace.workspaceId, seeded.bids)).toEqual([seeded.sam.id]);
    expect(await eventsIn(seeded.workspace.workspaceId)).toEqual([
      {
        act: "people.group.member_added",
        actor: `human:${seeded.workspace.admin.id}`,
        subject_id: seeded.bids,
        detail: { userId: seeded.sam.id },
      },
    ]);
    const sam = (await api.members.list.query()).find(
      (member) => member.personId === seeded.sam.id,
    );
    expect(sam?.groups).toEqual([
      { groupId: seeded.bids, name: "Bid writers" },
      { groupId: seeded.hr, name: "HR team" },
    ]);
  });

  it("removes a member from a group and records whom", async () => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    await api.members.removeFromGroup.mutate({ groupId: seeded.hr, userId: seeded.sam.id });

    expect(await membersOf(seeded.workspace.workspaceId, seeded.hr)).toEqual([seeded.priya.id]);
    expect(await eventsIn(seeded.workspace.workspaceId)).toEqual([
      {
        act: "people.group.member_removed",
        actor: `human:${seeded.workspace.admin.id}`,
        subject_id: seeded.hr,
        detail: { userId: seeded.sam.id },
      },
    ]);
  });

  it.each([
    { act: "addToGroup", group: "hr", word: "already-in-group", status: 409, class: "conflict" },
    { act: "removeFromGroup", group: "bids", word: "not-in-group", status: 404, class: "absent" },
  ] as const)("refuses $act where it changes nothing, $word", async (asked) => {
    const seeded = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    const refused = await refusedChangingNothing(seeded.workspace.workspaceId, () =>
      api.members[asked.act].mutate({ groupId: seeded[asked.group], userId: seeded.sam.id }),
    );

    expect(refused).toMatchObject(refusedAs(asked.status, asked.word, asked.class));
  });
});

type Verb = {
  readonly name: string;
  readonly call: (api: Api, seeded: Seeded) => Promise<unknown>;
};

const EVERY_VERB: readonly Verb[] = [
  { name: "groups", call: (api) => api.members.groups.query() },
  { name: "createGroup", call: (api) => api.members.createGroup.mutate({ name: "Site leads" }) },
  {
    name: "renameGroup",
    call: (api, seeded) => api.members.renameGroup.mutate({ groupId: seeded.hr, name: "Leads" }),
  },
  {
    name: "deleteGroup",
    call: (api, seeded) => api.members.deleteGroup.mutate({ groupId: seeded.hr }),
  },
  {
    name: "addToGroup",
    call: (api, seeded) =>
      api.members.addToGroup.mutate({ groupId: seeded.bids, userId: seeded.sam.id }),
  },
  {
    name: "removeFromGroup",
    call: (api, seeded) =>
      api.members.removeFromGroup.mutate({ groupId: seeded.hr, userId: seeded.sam.id }),
  },
];

/** The acts that name a group, so a group of another workspace can be named to them. */
const TARGETING_VERBS = EVERY_VERB.filter(
  (verb) => verb.name !== "groups" && verb.name !== "createGroup",
);

describe("who may see and change groups", () => {
  it.each(
    EVERY_VERB.flatMap((verb) => [
      { ...verb, role: "Editor" as const },
      { ...verb, role: "Viewer" as const },
    ]),
  )("refuses $name to a member at $role, changing nothing", async (verb) => {
    const seeded = await aWorkspaceWithGroups();
    const actor = await app.person();
    await app.addMember(seeded.workspace.workspaceId, actor.id, verb.role);
    const { api } = await webSignedIn(app, actor.email);

    const refused = await refusedChangingNothing(seeded.workspace.workspaceId, () =>
      verb.call(api, seeded),
    );

    expect(refused).toMatchObject(refusedAs(403, "role-forbids", "forbidden"));
  });

  it.each(EVERY_VERB)("refuses $name to an Admin pointed from elsewhere", async (verb) => {
    const seeded = await aWorkspaceWithGroups();
    const elsewhere = await app.provision();
    const { api } = await webSignedIn(app, elsewhere.admin.email);
    await sessionPointedAt(app, elsewhere.admin.id, seeded.workspace.workspaceId);

    const refused = await refusedChangingNothing(seeded.workspace.workspaceId, () =>
      verb.call(api, seeded),
    );

    expect(refused).toMatchObject(refusedAs(401, "not-a-member", "unauthenticated"));
  });

  it.each(TARGETING_VERBS)("refuses $name another workspace's group as none here", async (verb) => {
    const theirs = await aWorkspaceWithGroups();
    const mine = await app.provision();
    const { api } = await webSignedIn(app, mine.admin.email);

    const refused = await refusedChangingNothing(theirs.workspace.workspaceId, () =>
      verb.call(api, theirs),
    );

    expect(refused).toMatchObject(refusedAs(404, "no-such-group", "absent"));
    expect(await eventsIn(mine.workspaceId)).toEqual([]);
  });

  it("refuses adding a member of another workspace, no-such-member", async () => {
    const seeded = await aWorkspaceWithGroups();
    const theirs = await aWorkspaceWithGroups();
    const api = await asTheAdmin(seeded);

    const refused = await refusedChangingNothing(seeded.workspace.workspaceId, () =>
      api.members.addToGroup.mutate({ groupId: seeded.bids, userId: theirs.sam.id }),
    );

    expect(refused).toMatchObject(refusedAs(404, "no-such-member", "absent"));
  });
});
