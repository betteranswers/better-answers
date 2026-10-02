import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { parse, type Result, type UserPrincipal } from "../src/kernel/index.ts";
import {
  bulkAddToGroup,
  bulkAddToGroupInput,
  bulkChangeRole,
  bulkChangeRoleInput,
  bulkRemoveMembers,
  bulkRemoveMembersInput,
  removeMember,
  removeMemberInput,
  type BulkAddToGroupRefusal,
  type BulkChangeRoleRefusal,
  type BulkOutcome,
  type BulkRemoveMembersRefusal,
} from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { bothHoldingTheirOwnRow, heldAs, membersSuite } from "./members-suite.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import {
  abortTheTransaction,
  countWaitingOnLocks,
  postgresForSuite,
  seedingWith,
  until,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const db = postgresForSuite();

const { joining, rolesOf, auditRowsOf, batchesOf, grantsEndedAbout, grantsHere, endedOf } =
  membersSuite(db);

const ROLE_CHANGED = "people.member.role_changed";
const REMOVED = "people.member.removed";
const MEMBER_ADDED = "people.group.member_added";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** No person id minted now sorts below the first, nor above the second. */
const BELOW_ANY_PERSON = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const ABOVE_ANY_PERSON = "7ZZZZZZZZZZZZZZZZZZZZZZZZZ";

type Act = (
  principal: UserPrincipal,
  tx: Tx,
) => Promise<
  Result<BulkOutcome, BulkChangeRoleRefusal | BulkRemoveMembersRefusal | BulkAddToGroupRefusal>
>;

const changingRoles =
  (personIds: readonly string[], role: string): Act =>
  (principal, tx) =>
    bulkChangeRole(principal, tx, inputOf(bulkChangeRoleInput, { personIds, role }));

const removing =
  (personIds: readonly string[]): Act =>
  (principal, tx) =>
    bulkRemoveMembers(principal, tx, {
      ...inputOf(bulkRemoveMembersInput, { personIds }),
      at: new Date(),
    });

const adding =
  (groupId: string, personIds: readonly string[]): Act =>
  (principal, tx) =>
    bulkAddToGroup(principal, tx, inputOf(bulkAddToGroupInput, { groupId, personIds }));

const asAdmin = (workspace: ProvisionedWorkspace, act: Act) =>
  heldAs(workspace, workspace.adminUserId, act);

const sorted = (ids: readonly string[]): readonly string[] => ids.toSorted(byCodeUnit);

const joiningMany = async (
  workspace: ProvisionedWorkspace,
  role: "Editor" | "Viewer",
  count: number,
) => {
  const joined: string[] = [];
  for (let each = 0; each < count; each += 1) joined.push(await joining(workspace, role));
  return joined;
};

const groupHolding = (workspace: ProvisionedWorkspace, members: readonly string[]) =>
  seedingWith(db().pool, async (seed) => {
    const { workspaceId } = workspace;
    const group = await seed.group({ workspaceId, name: `Sales ${ulid()}` });
    for (const userId of members)
      await seed.groupMember({ workspaceId, groupId: group.id, userId });
    return group.id;
  });

const groupMembersOf = async (workspace: ProvisionedWorkspace, groupId: string) => {
  const rows = await db().pool.query<{ user_id: string }>(
    "SELECT user_id FROM group_member WHERE workspace_id = $1 AND group_id = $2",
    [workspace.workspaceId, groupId],
  );
  return sorted(rows.rows.map((row) => row.user_id));
};

const subjectsOf = async (workspace: ProvisionedWorkspace, act: string) =>
  sorted((await auditRowsOf(workspace, act)).map((row) => row.subject_id));

/** Every event of `act` stands in the one batch, which is a minted id. */
const oneBatchOf = async (workspace: ProvisionedWorkspace, act: string) => {
  const batches = await batchesOf(workspace, act);
  const [batch] = batches;
  expect(batch).toMatch(ULID);
  expect(batches).toEqual(batches.map(() => batch));
  return batches.length;
};

describe("changing the role of many members", () => {
  it("changes each ticked role, the events sharing one batch", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRoles");
    const viewers = await joiningMany(workspace, "Viewer", 3);

    const changed = await asAdmin(workspace, changingRoles(viewers, "Editor"));

    expect(changed).toEqual({ ok: true, value: { changed: sorted(viewers), skipped: 0 } });
    expect(await rolesOf(workspace)).toEqual({
      [workspace.adminUserId]: "Admin",
      [viewers[0] ?? ""]: "Editor",
      [viewers[1] ?? ""]: "Editor",
      [viewers[2] ?? ""]: "Editor",
    });
    expect((await auditRowsOf(workspace, ROLE_CHANGED)).map((row) => row.detail)).toEqual([
      { previousRole: "Viewer", role: "Editor" },
      { previousRole: "Viewer", role: "Editor" },
      { previousRole: "Viewer", role: "Editor" },
    ]);
    expect(await oneBatchOf(workspace, ROLE_CHANGED)).toBe(3);
  });

  it("writes only the members not already at the role", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRolesHeld");
    const viewers = await joiningMany(workspace, "Viewer", 2);
    const editor = await joining(workspace, "Editor");

    const changed = await asAdmin(workspace, changingRoles([...viewers, editor], "Editor"));

    expect(changed).toEqual({ ok: true, value: { changed: sorted(viewers), skipped: 1 } });
    expect(await subjectsOf(workspace, ROLE_CHANGED)).toEqual(sorted(viewers));
  });

  it.each([
    ["ascending", (ids: readonly string[]) => sorted(ids)],
    ["descending", (ids: readonly string[]) => sorted(ids).toReversed()],
  ])("AE1: refuses demoting both Admins, naming both, %s", async (_order, ordered) => {
    const workspace = await provisionedWorkspace(db(), "BulkRolesAE1");
    const second = await joining(workspace, "Admin");
    const admins = [workspace.adminUserId, second];

    const refused = await asAdmin(workspace, changingRoles(ordered(admins), "Viewer"));

    expect(refused).toEqual({
      ok: false,
      error: {
        word: "last-admin",
        items: { [workspace.adminUserId]: "last-admin", [second]: "last-admin" },
      },
    });
    expect(await rolesOf(workspace)).toEqual({
      [workspace.adminUserId]: "Admin",
      [second]: "Admin",
    });
    expect(await auditRowsOf(workspace, ROLE_CHANGED)).toEqual([]);
  });

  it.each([
    ["the other", (caller: string, other: string) => [other, caller] as const],
    ["themself", (caller: string, other: string) => [caller, other] as const],
  ])("lets one of two Admins demote %s", async (_who, split) => {
    const workspace = await provisionedWorkspace(db(), "BulkRolesOneOfTwo");
    const { adminUserId } = workspace;
    const [demoted, staying] = split(adminUserId, await joining(workspace, "Admin"));

    const changed = await asAdmin(workspace, changingRoles([demoted], "Editor"));

    expect(changed).toEqual({ ok: true, value: { changed: [demoted], skipped: 0 } });
    expect(await rolesOf(workspace)).toEqual({ [demoted]: "Editor", [staying]: "Admin" });
    expect(await auditRowsOf(workspace, ROLE_CHANGED)).toEqual([
      {
        actor: `human:${adminUserId}`,
        subject_id: demoted,
        detail: { previousRole: "Admin", role: "Editor" },
      },
    ]);
  });

  it("lets an Admin demote themself among others, another Admin staying", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRolesSelf");
    const { adminUserId } = workspace;
    const second = await joining(workspace, "Admin");
    const viewer = await joining(workspace, "Viewer");
    const ticked = [viewer, adminUserId];
    expect(sorted(ticked)[0]).toBe(adminUserId);

    const changed = await asAdmin(workspace, changingRoles(ticked, "Editor"));

    expect(changed).toEqual({ ok: true, value: { changed: [adminUserId, viewer], skipped: 0 } });
    expect(await rolesOf(workspace)).toEqual({
      [adminUserId]: "Editor",
      [second]: "Admin",
      [viewer]: "Editor",
    });
    expect(await auditRowsOf(workspace, ROLE_CHANGED)).toEqual([
      {
        actor: `human:${adminUserId}`,
        subject_id: adminUserId,
        detail: { previousRole: "Admin", role: "Editor" },
      },
      {
        actor: `human:${adminUserId}`,
        subject_id: viewer,
        detail: { previousRole: "Viewer", role: "Editor" },
      },
    ]);
    expect(await oneBatchOf(workspace, ROLE_CHANGED)).toBe(2);
  });

  it("refuses an id no member holds, writing nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRolesNobody");
    const viewer = await joining(workspace, "Viewer");
    const nobody = ulid();

    const refused = await asAdmin(workspace, changingRoles([viewer, nobody], "Editor"));

    expect(refused).toEqual({
      ok: false,
      error: { word: "no-such-member", items: { [nobody]: "no-such-member" } },
    });
    expect((await rolesOf(workspace))[viewer]).toBe("Viewer");
    expect(await auditRowsOf(workspace, ROLE_CHANGED)).toEqual([]);
  });

  it("counts a person ticked twice once", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRolesTwice");
    const viewer = await joining(workspace, "Viewer");

    const changed = await asAdmin(workspace, changingRoles([viewer, viewer], "Editor"));

    expect(changed).toEqual({ ok: true, value: { changed: [viewer], skipped: 0 } });
    expect(await subjectsOf(workspace, ROLE_CHANGED)).toEqual([viewer]);
  });

  it("refuses a role outside the three, no-such-role", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRolesOwner");
    const viewer = await joining(workspace, "Viewer");

    const refused = await asAdmin(workspace, changingRoles([viewer], "Owner"));

    expect(refused).toEqual({ ok: false, error: "no-such-role" });
    expect((await rolesOf(workspace))[viewer]).toBe("Viewer");
  });

  it.each([
    [ABOVE_ANY_PERSON, "last-admin"],
    [BELOW_ANY_PERSON, "no-such-member"],
  ])("words the set by its first item, beside %s", async (nobody, word) => {
    const workspace = await provisionedWorkspace(db(), "BulkRolesWord");
    const { adminUserId } = workspace;

    const refused = await asAdmin(workspace, changingRoles([adminUserId, nobody], "Editor"));

    expect(refused).toEqual({
      ok: false,
      error: { word, items: { [adminUserId]: "last-admin", [nobody]: "no-such-member" } },
    });
  });
});

describe("removing many members", () => {
  it("removes two of three Admins, the events sharing one batch", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRemoved");
    const second = await joining(workspace, "Admin");
    const third = await joining(workspace, "Admin");

    const removed = await asAdmin(workspace, removing([second, third]));

    expect(removed).toEqual({ ok: true, value: { changed: sorted([second, third]), skipped: 0 } });
    expect(await rolesOf(workspace)).toEqual({ [workspace.adminUserId]: "Admin" });
    expect((await auditRowsOf(workspace, REMOVED)).map((row) => row.detail)).toEqual([
      { role: "Admin", grants: [] },
      { role: "Admin", grants: [] },
    ]);
    expect(await oneBatchOf(workspace, REMOVED)).toBe(2);
  });

  it("lets an Admin remove themself among others, Admins staying", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRemovedSelf");
    const { workspaceId, adminUserId } = workspace;
    const second = await joining(workspace, "Admin");
    const third = await joining(workspace, "Admin");
    const editor = await joining(workspace, "Editor");
    const viewer = await joining(workspace, "Viewer");
    const issued = await grantsHere(workspace, {
      "the caller's": adminUserId,
      "the editor's": editor,
      "the viewer's": viewer,
    });
    const ticked = [viewer, editor, adminUserId];
    expect(sorted(ticked)[0]).toBe(adminUserId);

    const removed = await asAdmin(workspace, removing(ticked));

    expect(removed).toEqual({
      ok: true,
      value: { changed: [adminUserId, editor, viewer], skipped: 0 },
    });
    expect(await rolesOf(workspace)).toEqual({ [second]: "Admin", [third]: "Admin" });
    const grants = [
      { clientId: issued.clientId, workspaceId, issuedAt: issued.issuedAt.toISOString() },
    ];
    const actor = `human:${adminUserId}`;
    expect(await auditRowsOf(workspace, REMOVED)).toEqual([
      { actor, subject_id: adminUserId, detail: { role: "Admin", grants } },
      { actor, subject_id: editor, detail: { role: "Editor", grants } },
      { actor, subject_id: viewer, detail: { role: "Viewer", grants } },
    ]);
    expect(await oneBatchOf(workspace, REMOVED)).toBe(3);
    expect(await endedOf(issued)).toEqual([
      "access the caller's",
      "access the editor's",
      "access the viewer's",
      "refresh the caller's",
      "refresh the editor's",
      "refresh the viewer's",
    ]);
    const filed = { actor, detail: { workspaceId, grants } };
    expect([
      ...(await grantsEndedAbout(adminUserId)),
      ...(await grantsEndedAbout(editor)),
      ...(await grantsEndedAbout(viewer)),
    ]).toEqual([filed, filed, filed]);
  });

  it("AE2: refuses removing the only Admin among four, naming them", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRemovedAE2");
    const { adminUserId } = workspace;
    const others = await joiningMany(workspace, "Editor", 3);

    const refused = await asAdmin(workspace, removing([...others, adminUserId]));

    expect(refused).toEqual({
      ok: false,
      error: { word: "last-admin", items: { [adminUserId]: "last-admin" } },
    });
    expect(Object.keys(await rolesOf(workspace)).toSorted(byCodeUnit)).toEqual(
      sorted([adminUserId, ...others]),
    );
    expect(await auditRowsOf(workspace, REMOVED)).toEqual([]);
  });

  it("skips an id no member holds, counting it", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkRemovedNobody");
    const viewer = await joining(workspace, "Viewer");

    const removed = await asAdmin(workspace, removing([viewer, ulid()]));

    expect(removed).toEqual({ ok: true, value: { changed: [viewer], skipped: 1 } });
    expect(await rolesOf(workspace)).toEqual({ [workspace.adminUserId]: "Admin" });
    expect(await batchesOf(workspace, REMOVED)).toEqual([null]);
  });
});

describe("adding many members to a group", () => {
  it("AE8: adds eight of ten, counting two already in", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkAddedAE8");
    const ticked = await joiningMany(workspace, "Viewer", 10);
    const alreadyIn = ticked.slice(0, 2);
    const sales = await groupHolding(workspace, alreadyIn);

    const added = await asAdmin(workspace, adding(sales, ticked));

    const newlyIn = sorted(ticked.slice(2));
    expect(added).toEqual({ ok: true, value: { changed: newlyIn, skipped: 2 } });
    expect(await groupMembersOf(workspace, sales)).toEqual(sorted(ticked));
    expect(
      (await auditRowsOf(workspace, MEMBER_ADDED)).map((row) => [row.subject_id, row.detail]),
    ).toEqual(newlyIn.map((userId) => [sales, { userId }]));
    expect(await oneBatchOf(workspace, MEMBER_ADDED)).toBe(8);
  });

  it("refuses an id no member holds, adding nobody", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkAddedNobody");
    const viewer = await joining(workspace, "Viewer");
    const sales = await groupHolding(workspace, []);
    const nobody = ulid();

    const refused = await asAdmin(workspace, adding(sales, [viewer, nobody]));

    expect(refused).toEqual({
      ok: false,
      error: { word: "no-such-member", items: { [nobody]: "no-such-member" } },
    });
    expect(await groupMembersOf(workspace, sales)).toEqual([]);
    expect(await auditRowsOf(workspace, MEMBER_ADDED)).toEqual([]);
  });

  it("refuses a group this workspace does not hold, no-such-group", async () => {
    const ours = await provisionedWorkspace(db(), "BulkAddedOurs");
    const theirs = await provisionedWorkspace(db(), "BulkAddedTheirs");
    const viewer = await joining(ours, "Viewer");
    const theirGroup = await groupHolding(theirs, []);

    const refused = await asAdmin(ours, adding(theirGroup, [viewer]));

    expect(refused).toEqual({ ok: false, error: "no-such-group" });
    expect(await groupMembersOf(theirs, theirGroup)).toEqual([]);
  });
});

const EACH_ACT = [
  ["change roles", (personId: string) => changingRoles([personId], "Editor")],
  ["remove members", (personId: string) => removing([personId])],
  ["add to a group", (personId: string, groupId: string) => adding(groupId, [personId])],
] as const;

describe.each(EACH_ACT)("who may %s in bulk", (_verb, actOn) => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses a member at %s, before any read",
    async (role) => {
      const workspace = await provisionedWorkspace(db(), `BulkForbidden${role}`);
      const actor = await joining(workspace, role);
      const viewer = await joining(workspace, "Viewer");

      const refused = await heldAs(workspace, actor, async (principal, tx) => {
        await abortTheTransaction(tx);
        return actOn(viewer, ulid())(principal, tx);
      });

      expect(refused).toEqual({ ok: false, error: "role-forbids" });
      expect((await rolesOf(workspace))[viewer]).toBe("Viewer");
    },
  );
});

const EACH_SCHEMA = [
  ["change roles", bulkChangeRoleInput, { role: "Editor" }],
  ["remove members", bulkRemoveMembersInput, {}],
  ["add to a group", bulkAddToGroupInput, { groupId: ulid() }],
] as const;

describe.each(EACH_SCHEMA)("the set asked to %s", (_verb, schema, rest) => {
  it.each([
    [201, "too-big"],
    [0, "too-small"],
  ])("refuses %i ids, malformed", (count, issue) => {
    const personIds = Array.from({ length: count }, () => ulid());

    expect(parse(schema, { ...rest, personIds })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { personIds: issue } },
    });
  });

  it("takes 200 ids", () => {
    const personIds = Array.from({ length: 200 }, () => ulid());

    expect(parse(schema, { ...rest, personIds })).toMatchObject({ ok: true });
  });
});

describe("a ticked member already gone", () => {
  const removedMeanwhile = async (name: string) => {
    const workspace = await provisionedWorkspace(db(), name);
    const second = await joining(workspace, "Admin");
    const gone = await joining(workspace, "Viewer");
    const staying = await joining(workspace, "Viewer");
    await heldAs(workspace, second, (principal, tx) =>
      removeMember(principal, tx, {
        ...inputOf(removeMemberInput, { personId: gone }),
        at: new Date(),
      }),
    );
    return { workspace, gone, staying };
  };

  it("skips on Remove a person another Admin removed first", async () => {
    const { workspace, gone, staying } = await removedMeanwhile("BulkGoneRemoved");

    const removed = await asAdmin(workspace, removing([gone, staying]));

    expect(removed).toEqual({ ok: true, value: { changed: [staying], skipped: 1 } });
    expect(await subjectsOf(workspace, REMOVED)).toEqual(sorted([gone, staying]));
  });

  it("names them no-such-member on a role change or group add", async () => {
    const { workspace, gone, staying } = await removedMeanwhile("BulkGoneNamed");
    const sales = await groupHolding(workspace, []);
    const named = {
      ok: false,
      error: { word: "no-such-member", items: { [gone]: "no-such-member" } },
    };

    expect(await asAdmin(workspace, changingRoles([gone, staying], "Editor"))).toEqual(named);
    expect(await asAdmin(workspace, adding(sales, [gone, staying]))).toEqual(named);
    expect((await rolesOf(workspace))[staying]).toBe("Viewer");
    expect(await groupMembersOf(workspace, sales)).toEqual([]);
  });
});

describe("a member of another workspace, ticked here", () => {
  const aStranger = async (name: string) => {
    const ours = await provisionedWorkspace(db(), `${name}Ours`);
    const theirs = await provisionedWorkspace(db(), `${name}Theirs`);
    const stranger = await joining(theirs, "Viewer");
    return { ours, theirs, stranger, nobody: ulid() };
  };

  it("skips them on Remove, as it skips a random id", async () => {
    const { ours, theirs, stranger, nobody } = await aStranger("BulkStrangerRemoved");

    const answers = [
      await asAdmin(ours, removing([stranger])),
      await asAdmin(ours, removing([nobody])),
    ];

    expect(answers).toEqual([
      { ok: true, value: { changed: [], skipped: 1 } },
      { ok: true, value: { changed: [], skipped: 1 } },
    ]);
    expect((await rolesOf(theirs))[stranger]).toBe("Viewer");
  });

  it("names them no-such-member, as it names a random id", async () => {
    const { ours, theirs, stranger, nobody } = await aStranger("BulkStrangerNamed");
    const sales = await groupHolding(ours, []);
    const namedAs = (personId: string) => ({
      ok: false,
      error: { word: "no-such-member", items: { [personId]: "no-such-member" } },
    });

    for (const personId of [stranger, nobody]) {
      expect(await asAdmin(ours, changingRoles([personId], "Editor"))).toEqual(namedAs(personId));
      expect(await asAdmin(ours, adding(sales, [personId]))).toEqual(namedAs(personId));
    }
    expect((await rolesOf(theirs))[stranger]).toBe("Viewer");
  });
});

const RACES = [
  [
    "role changes, disjoint",
    "disjoint",
    (ids: readonly string[]) => changingRoles(ids, "Editor"),
    ROLE_CHANGED,
  ],
  [
    "role changes, overlapping",
    "overlapping",
    (ids: readonly string[]) => changingRoles(ids, "Editor"),
    ROLE_CHANGED,
  ],
  ["removals, disjoint", "disjoint", (ids: readonly string[]) => removing(ids), REMOVED],
  ["removals, overlapping", "overlapping", (ids: readonly string[]) => removing(ids), REMOVED],
] as const;

describe("two bulk acts racing", () => {
  it.each(RACES)("lands one whole, refusing the other: %s", async (_race, rows, actOn, act) => {
    const workspace = await provisionedWorkspace(db(), `BulkRaced${act}${rows}`);
    const second = await joining(workspace, "Admin");
    const [shared, firsts, seconds] = [
      await joiningMany(workspace, "Viewer", rows === "overlapping" ? 1 : 0),
      await joiningMany(workspace, "Viewer", 2),
      await joiningMany(workspace, "Viewer", 2),
    ];
    const setOf = new Map([
      [workspace.adminUserId, [...shared, ...firsts]],
      [second, [...shared, ...seconds]],
    ]);

    const answers = await bothHoldingTheirOwnRow(
      workspace,
      [workspace.adminUserId, second],
      (principal, tx) => actOn(setOf.get(principal.userId) ?? [])(principal, tx),
    );

    const landed = answers.flatMap((answer) => (answer.ok ? [answer.value.changed] : []));
    expect(answers.flatMap((answer) => (answer.ok ? [] : [answer.error]))).toEqual([
      "changed-meanwhile",
    ]);
    expect(landed).toHaveLength(1);
    expect(await subjectsOf(workspace, act)).toEqual(landed[0]);
    const won = new Set<string>(landed[0]);
    const untouched = [...setOf.values()].flat().filter((id) => !won.has(id));
    const roles = await rolesOf(workspace);
    expect(untouched.map((id) => roles[id])).toEqual(["Viewer", "Viewer"]);
  });

  it("writes one member_added per person for two overlapping adds", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkAddsRaced");
    const second = await joining(workspace, "Admin");
    const [shared, firsts, seconds] = [
      await joiningMany(workspace, "Viewer", 2),
      await joiningMany(workspace, "Viewer", 1),
      await joiningMany(workspace, "Viewer", 1),
    ];
    const sales = await groupHolding(workspace, []);
    const firstAdded = Promise.withResolvers<undefined>();

    /** It commits only once the second waits on its rows, so the second inserts after it. */
    const addingFirst = heldAs(workspace, workspace.adminUserId, async (principal, tx) => {
      const added = await adding(sales, [...shared, ...firsts])(principal, tx);
      firstAdded.resolve(undefined);
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      return added;
    });
    await firstAdded.promise;
    const addingSecond = heldAs(workspace, second, adding(sales, [...shared, ...seconds]));

    expect([await addingFirst, await addingSecond]).toEqual([
      { ok: true, value: { changed: sorted([...shared, ...firsts]), skipped: 0 } },
      { ok: true, value: { changed: seconds, skipped: 2 } },
    ]);
    expect(await subjectsOf(workspace, MEMBER_ADDED)).toEqual([sales, sales, sales, sales]);
    expect(
      sorted(
        (await auditRowsOf(workspace, MEMBER_ADDED)).map((row) => String(row.detail["userId"])),
      ),
    ).toEqual(sorted([...shared, ...firsts, ...seconds]));
  });

  it("answers an add caught in a deadlock changed-meanwhile", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkAddDeadlocked");
    const viewer = await joining(workspace, "Viewer");
    const sales = await groupHolding(workspace, []);
    const holder = await db().pool.connect();
    const HOLD = "SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE";
    const callerHeld = Promise.withResolvers<undefined>();
    const actNow = Promise.withResolvers<undefined>();
    try {
      await holder.query("BEGIN");
      // The holder waits first and checks for a deadlock last, so the add finds the cycle.
      await holder.query("SET LOCAL deadlock_timeout = '30s'");
      await holder.query(HOLD, [workspace.workspaceId, viewer]);
      const addingTheViewer = asAdmin(workspace, async (principal, tx) => {
        callerHeld.resolve(undefined);
        await actNow.promise;
        return adding(sales, [viewer])(principal, tx);
      });
      await callerHeld.promise;
      const waitingOnTheCaller = holder.query(HOLD, [workspace.workspaceId, workspace.adminUserId]);
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      actNow.resolve(undefined);

      expect(await addingTheViewer).toEqual({ ok: false, error: "changed-meanwhile" });
      await waitingOnTheCaller;
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    expect(await groupMembersOf(workspace, sales)).toEqual([]);
  });
});

describe("a bulk act whose audit event fails", () => {
  it.each(EACH_ACT)("leaves every row as it was: %s", async (_verb, actOn) => {
    const workspace = await provisionedWorkspace(db(), "BulkUnrecorded");
    const viewer = await joining(workspace, "Viewer");
    const sales = await groupHolding(workspace, []);
    const act = actOn(viewer, sales);

    const failed = await whileWritesAreRefused(db().pool, "audit_event", () =>
      asAdmin(workspace, act),
    );

    expect(failed).toEqual({ ok: false, error: expect.any(Error) });
    expect(await rolesOf(workspace)).toEqual({
      [workspace.adminUserId]: "Admin",
      [viewer]: "Viewer",
    });
    expect(await groupMembersOf(workspace, sales)).toEqual([]);
  });
});
