import { boundarySchemas, ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { groupNameTakenAgain } from "@better-answers/schema/testing/probes";
import { describe, expect, it } from "vitest";

import { attempt } from "../src/kernel/index.ts";
import type { Result, Role, UserPrincipal } from "../src/kernel/index.ts";
import { type ProvisionedWorkspace, provisionedWorkspace, seedPerson } from "./platform.ts";
import {
  folded,
  type Foldable,
  type Folded,
  type Tx,
  withPrincipal,
} from "../src/store/postgres/index.ts";
import {
  addToGroup,
  createGroup,
  deleteGroup,
  holdsEveryGroup,
  listGroups,
  removeFromGroup,
  renameGroup,
} from "../src/members/index.ts";
import {
  abortTheTransaction,
  answered,
  postgresForSuite,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const db = postgresForSuite();

type Workspace = ProvisionedWorkspace;

const provisioned = (name: string): Promise<Workspace> => provisionedWorkspace(db(), name);

const seedMemberAt = async (workspace: Workspace, role: Role): Promise<string> => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const person = await seed.user();
    await seed.member({ workspaceId: workspace.workspaceId, userId: person.id, role });
    return person.id;
  } finally {
    client.release();
  }
};

const asPerson = async <T>(
  workspace: Workspace,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T>> =>
  folded<T>(
    await withPrincipal(
      workspace.door,
      { workspaceId: workspace.workspaceId, userId, issuedAt: new Date() },
      work,
    ),
  );

const asAdmin = <T>(
  workspace: Workspace,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T>> => asPerson(workspace, workspace.adminUserId, work);

const peopleActs = async (
  workspaceId: string,
): Promise<
  readonly {
    act: string;
    actor: string;
    subject_kind: string;
    subject_id: string;
    detail: Record<string, string>;
  }[]
> => {
  const rows = await db().pool.query<{
    act: string;
    actor: string;
    subject_kind: string;
    subject_id: string;
    detail: Record<string, string>;
  }>(
    "SELECT act, actor, subject_kind, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND family = 'people' ORDER BY id",
    [workspaceId],
  );
  return rows.rows;
};

const groupRowCount = async (workspaceId: string): Promise<number> => {
  const counted = await db().pool.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM "group" WHERE workspace_id = $1`,
    [workspaceId],
  );
  return counted.rows[0]?.held ?? -1;
};

const madeGroup = async (workspace: Workspace, name: string): Promise<string> => {
  const made = await asAdmin(workspace, (principal, tx) => createGroup(principal, tx, { name }));
  if (!made.ok) throw new Error(`the group was not made: ${String(made.error)}`);
  return made.value.groupId;
};

const putInGroup = (workspace: Workspace, groupId: string, userId: string) =>
  asAdmin(workspace, (principal, tx) => addToGroup(principal, tx, { groupId, userId }));

const oneGroupOnePerson = async (
  name: string,
  role: Role = "Viewer",
): Promise<{ workspace: Workspace; person: string; groupId: string }> => {
  const workspace = await provisioned(name);
  const person = await seedMemberAt(workspace, role);
  const groupId = await madeGroup(workspace, "HR team");
  expect(await putInGroup(workspace, groupId, person)).toEqual({
    ok: true,
    value: { groupId, userId: person },
  });
  return { workspace, person, groupId };
};

describe("making a group", () => {
  it("gives an Admin a listed group and writes the act", async () => {
    const workspace = await provisioned("Acme");

    const groupId = await madeGroup(workspace, "HR team");

    const listed = await asAdmin(workspace, listGroups);
    expect(listed).toEqual({
      ok: true,
      value: [{ id: groupId, name: "HR team", origin: "admin-curated", memberCount: 0 }],
    });
    expect(await peopleActs(workspace.workspaceId)).toEqual([
      {
        act: "people.group.created",
        actor: `human:${workspace.adminUserId}`,
        subject_kind: "group",
        subject_id: groupId,
        detail: {},
      },
    ]);
  });

  it("refuses a taken name, adding neither group nor audit event", async () => {
    const workspace = await provisioned("Beta");
    await madeGroup(workspace, "HR team");

    const again = await asAdmin(workspace, (principal, tx) =>
      createGroup(principal, tx, { name: "HR team" }),
    );

    expect(again).toEqual({ ok: false, error: "name-taken" });
    expect(await groupRowCount(workspace.workspaceId)).toBe(1);
    expect(await peopleActs(workspace.workspaceId)).toHaveLength(1);
  });

  it("refuses a name blank once trimmed, writing no row", async () => {
    const workspace = await provisioned("Gamma");

    const made = await asAdmin(workspace, (principal, tx) =>
      createGroup(principal, tx, { name: "   " }),
    );

    expect(made).toEqual({ ok: false, error: "malformed" });
    expect(await groupRowCount(workspace.workspaceId)).toBe(0);
  });
});

describe("renaming a group", () => {
  it("keeps its id and its members under the new name", async () => {
    const { workspace, groupId } = await oneGroupOnePerson("Delta");

    const renamed = await asAdmin(workspace, (principal, tx) =>
      renameGroup(principal, tx, { groupId, name: "People team" }),
    );

    expect(renamed).toEqual({ ok: true, value: { groupId } });

    expect(await asAdmin(workspace, listGroups)).toEqual({
      ok: true,
      value: [{ id: groupId, name: "People team", origin: "admin-curated", memberCount: 1 }],
    });
  });

  it("refuses a name another group holds, and renames nothing", async () => {
    const workspace = await provisioned("Epsilon");
    const groupId = await madeGroup(workspace, "HR team");
    await madeGroup(workspace, "Sales executives");

    const renamed = await asAdmin(workspace, (principal, tx) =>
      renameGroup(principal, tx, { groupId, name: "Sales executives" }),
    );

    expect(renamed).toEqual({ ok: false, error: "name-taken" });
    const listed = await asAdmin(workspace, listGroups);
    expect(listed.ok && listed.value.map((group) => group.name)).toEqual([
      "HR team",
      "Sales executives",
    ]);
  });

  it("refuses a group id nobody holds", async () => {
    const workspace = await provisioned("Zeta");

    const renamed = await asAdmin(workspace, (principal, tx) =>
      renameGroup(principal, tx, { groupId: ulid(), name: "Nobody's" }),
    );

    expect(renamed).toEqual({ ok: false, error: "no-such-group" });
  });
});

describe("deleting a group", () => {
  it("takes its memberships with it and writes the act", async () => {
    const { workspace, groupId } = await oneGroupOnePerson("Eta", "Editor");

    const deleted = await asAdmin(workspace, (principal, tx) =>
      deleteGroup(principal, tx, { groupId }),
    );

    expect(deleted).toEqual({ ok: true, value: { groupId } });
    expect(await asAdmin(workspace, listGroups)).toEqual({ ok: true, value: [] });
    const memberships = await db().pool.query("SELECT 1 FROM group_member WHERE group_id = $1", [
      groupId,
    ]);
    expect(memberships.rowCount).toBe(0);
    expect((await peopleActs(workspace.workspaceId)).map((event) => event.act)).toEqual([
      "people.group.created",
      "people.group.member_added",
      "people.group.deleted",
    ]);
  });

  it("refuses a group id nobody holds, and deletes nothing", async () => {
    const workspace = await provisioned("Theta");
    await madeGroup(workspace, "HR team");

    const deleted = await asAdmin(workspace, (principal, tx) =>
      deleteGroup(principal, tx, { groupId: ulid() }),
    );

    expect(deleted).toEqual({ ok: false, error: "no-such-group" });
    expect(await groupRowCount(workspace.workspaceId)).toBe(1);
  });
});

describe("who is in a group", () => {
  it("puts one person in several groups, each act naming both", async () => {
    const workspace = await provisioned("Iota");
    const person = await seedMemberAt(workspace, "Viewer");
    const hr = await madeGroup(workspace, "HR team");
    const sales = await madeGroup(workspace, "Sales executives");

    for (const groupId of [hr, sales]) {
      expect(await putInGroup(workspace, groupId, person)).toEqual({
        ok: true,
        value: { groupId, userId: person },
      });
    }

    expect(await asAdmin(workspace, listGroups)).toEqual({
      ok: true,
      value: [
        { id: hr, name: "HR team", origin: "admin-curated", memberCount: 1 },
        { id: sales, name: "Sales executives", origin: "admin-curated", memberCount: 1 },
      ],
    });

    expect(
      (await peopleActs(workspace.workspaceId))
        .filter((event) => event.act === "people.group.member_added")
        .map((event) => ({ subject: event.subject_id, detail: event.detail })),
    ).toEqual([
      { subject: hr, detail: { userId: person } },
      { subject: sales, detail: { userId: person } },
    ]);
  });

  it("refuses a person outside the workspace, and adds nobody", async () => {
    const workspace = await provisioned("Kappa");
    const groupId = await madeGroup(workspace, "HR team");
    const stranger = await seedPerson(db().pool);

    const added = await putInGroup(workspace, groupId, stranger);

    expect(added).toEqual({ ok: false, error: "no-such-member" });
    const memberships = await db().pool.query("SELECT 1 FROM group_member WHERE group_id = $1", [
      groupId,
    ]);
    expect(memberships.rowCount).toBe(0);
  });

  it("refuses a repeat add, so the audit log records one", async () => {
    const { workspace, person, groupId } = await oneGroupOnePerson("Lambda");

    const again = await putInGroup(workspace, groupId, person);

    expect(again).toEqual({ ok: false, error: "already-in-group" });
    expect(
      (await peopleActs(workspace.workspaceId)).filter(
        (event) => event.act === "people.group.member_added",
      ),
    ).toHaveLength(1);
  });

  it("takes a person out, and refuses a second removal", async () => {
    const { workspace, person, groupId } = await oneGroupOnePerson("Mu");

    const removed = await asAdmin(workspace, (principal, tx) =>
      removeFromGroup(principal, tx, { groupId, userId: person }),
    );
    const again = await asAdmin(workspace, (principal, tx) =>
      removeFromGroup(principal, tx, { groupId, userId: person }),
    );

    expect(removed).toEqual({ ok: true, value: { groupId, userId: person } });
    expect(again).toEqual({ ok: false, error: "not-in-group" });
    expect((await peopleActs(workspace.workspaceId)).map((event) => event.act)).toEqual([
      "people.group.created",
      "people.group.member_added",
      "people.group.member_removed",
    ]);
  });

  it("refuses removal from a group id nobody holds", async () => {
    const workspace = await provisioned("Nu");
    const person = await seedMemberAt(workspace, "Viewer");

    const removed = await asAdmin(workspace, (principal, tx) =>
      removeFromGroup(principal, tx, { groupId: ulid(), userId: person }),
    );

    expect(removed).toEqual({ ok: false, error: "no-such-group" });
  });
});

type Verb = {
  readonly name: string;

  readonly run: (principal: UserPrincipal, tx: Tx) => Promise<Result<unknown, string | Error>>;
};

const everyVerb = (groupId: string, userId: string): readonly Verb[] => [
  { name: "make", run: (principal, tx) => createGroup(principal, tx, { name: "Attempted" }) },
  {
    name: "rename",
    run: (principal, tx) => renameGroup(principal, tx, { groupId, name: "Attempted" }),
  },
  { name: "delete", run: (principal, tx) => deleteGroup(principal, tx, { groupId }) },
  { name: "add to", run: (principal, tx) => addToGroup(principal, tx, { groupId, userId }) },
  {
    name: "remove from",
    run: (principal, tx) => removeFromGroup(principal, tx, { groupId, userId }),
  },
  { name: "list", run: listGroups },
];

const namingAGroup = (verbs: readonly Verb[]): readonly Verb[] =>
  verbs.filter((verb) => verb.name !== "make" && verb.name !== "list");

const namingAPerson = (verbs: readonly Verb[]): readonly Verb[] =>
  verbs.filter((verb) => verb.name === "add to" || verb.name === "remove from");

type VerbOutcome = { readonly verb: string; readonly outcome: unknown };

const outcomesOf = async (
  verbs: readonly Verb[],
  principal: UserPrincipal,
  tx: Tx,
): Promise<VerbOutcome[]> => {
  const outcomes: VerbOutcome[] = [];
  for (const verb of verbs) {
    outcomes.push({ verb: verb.name, outcome: await verb.run(principal, tx) });
  }
  return outcomes;
};

const eachVerb = async (
  workspace: Workspace,
  verbs: readonly Verb[],
  outcomes: VerbOutcome[],
  before: (tx: Tx) => Promise<void> = async () => undefined,
): Promise<void> => {
  await asPerson(workspace, workspace.adminUserId, async (principal, tx) => {
    await before(tx);
    outcomes.push(...(await outcomesOf(verbs, principal, tx)));
  });
};

const refusedAlike = (verbs: readonly Verb[], error: unknown): readonly VerbOutcome[] =>
  verbs.map((verb) => ({ verb: verb.name, outcome: { ok: false, error } }));

const whileTheTableIsGone = async <T>(table: string, work: () => Promise<T>): Promise<T> => {
  await db().pool.query(`ALTER TABLE "${table}" RENAME TO "${table}_gone"`);
  try {
    return await work();
  } finally {
    await db().pool.query(`ALTER TABLE "${table}_gone" RENAME TO "${table}"`);
  }
};

describe("what a group act refuses before it reads anything", () => {
  it("refuses a malformed group id to every verb naming one", async () => {
    const workspace = await provisioned("Shapeless");
    const person = await seedMemberAt(workspace, "Viewer");
    const verbs = namingAGroup(everyVerb("' OR true --", person));
    const outcomes: VerbOutcome[] = [];

    await eachVerb(workspace, verbs, outcomes);

    expect(outcomes).toEqual(refusedAlike(verbs, "malformed"));
    expect(await groupRowCount(workspace.workspaceId)).toBe(0);
  });

  it("refuses a malformed person id to both verbs naming one", async () => {
    const { workspace, groupId } = await oneGroupOnePerson("Nameless");
    const verbs = namingAPerson(everyVerb(groupId, "' OR true --"));
    const outcomes: VerbOutcome[] = [];

    await eachVerb(workspace, verbs, outcomes);

    expect(outcomes).toEqual(refusedAlike(verbs, "malformed"));
  });

  it("refuses a rename to a blank name, renaming nothing", async () => {
    const { workspace, groupId } = await oneGroupOnePerson("Blank");

    const renamed = await asAdmin(workspace, (principal, tx) =>
      renameGroup(principal, tx, { groupId, name: "   " }),
    );

    expect(renamed).toEqual({ ok: false, error: "malformed" });
    expect(await asAdmin(workspace, listGroups)).toEqual({
      ok: true,
      value: [{ id: groupId, name: "HR team", origin: "admin-curated", memberCount: 1 }],
    });
  });
});

describe("an act whose statement the store refuses", () => {
  it("hands back the store's failure from every verb, writing nothing", async () => {
    const { workspace, person, groupId } = await oneGroupOnePerson("Failing");
    const verbs = everyVerb(groupId, person);
    const outcomes: VerbOutcome[] = [];

    await expect(eachVerb(workspace, verbs, outcomes, abortTheTransaction)).rejects.toThrow(
      /did not commit/,
    );

    expect(outcomes).toEqual(refusedAlike(verbs, expect.any(Error)));

    expect((await peopleActs(workspace.workspaceId)).map((event) => event.act)).toEqual([
      "people.group.created",
      "people.group.member_added",
    ]);
  });

  it("answers the store's failure, not a membership it never wrote", async () => {
    const workspace = await provisioned("Unwritten");
    const person = await seedMemberAt(workspace, "Viewer");
    const groupId = await madeGroup(workspace, "HR team");
    let added: unknown;

    await expect(
      whileWritesAreRefused(db().pool, "group_member", () =>
        asPerson(workspace, workspace.adminUserId, async (principal, tx) => {
          added = await addToGroup(principal, tx, { groupId, userId: person });
        }),
      ),
    ).rejects.toThrow(/did not commit/);

    expect(added).toEqual({ ok: false, error: expect.any(Error) });
    expect(await asAdmin(workspace, listGroups)).toEqual({
      ok: true,
      value: [{ id: groupId, name: "HR team", origin: "admin-curated", memberCount: 0 }],
    });
  });

  it("answers the store's failure, not a refusal word", async () => {
    const { workspace, person } = await oneGroupOnePerson("Wordless");
    let removed: unknown;

    await expect(
      whileTheTableIsGone("group", () =>
        asPerson(workspace, workspace.adminUserId, async (principal, tx) => {
          removed = await removeFromGroup(principal, tx, { groupId: ulid(), userId: person });
        }),
      ),
    ).rejects.toThrow(/did not commit/);

    expect(removed).toEqual({ ok: false, error: expect.any(Error) });
  });
});

describe("a role that may not shape who sees what", () => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses a %s the held-groups check, but answers the Admin",
    async (role) => {
      const { workspace, person, groupId } = await oneGroupOnePerson(`Asking${role}`, role);
      const asked = boundarySchemas.group.select.shape.id.parse(groupId);

      const refused = await asPerson(workspace, person, (principal, tx) =>
        holdsEveryGroup(principal, tx, [asked]),
      );
      const held = await asAdmin(workspace, (principal, tx) =>
        holdsEveryGroup(principal, tx, [asked]),
      );

      expect(refused).toEqual({ ok: false, error: "role-forbids" });
      expect(held).toEqual({ ok: true, value: true });
    },
  );

  it.each(["Editor", "Viewer"] as const)(
    "refuses every verb to a %s inside the group",
    async (role) => {
      const { workspace, person, groupId } = await oneGroupOnePerson(`Refused${role}`, role);

      const outcomes = await asPerson(workspace, person, (principal, tx) =>
        outcomesOf(everyVerb(groupId, person), principal, tx),
      );

      expect(outcomes.ok).toBe(true);
      if (!outcomes.ok) return;
      expect(outcomes.value).toEqual(refusedAlike(everyVerb(groupId, person), "role-forbids"));

      expect((await peopleActs(workspace.workspaceId)).map((event) => event.act)).toEqual([
        "people.group.created",
        "people.group.member_added",
      ]);
    },
  );
});

describe("an Admin of another workspace", () => {
  it("reaches and lists none of this workspace's groups", async () => {
    const { workspace: ours, person: ourPerson, groupId } = await oneGroupOnePerson("Ours");
    const theirs = await provisioned("Theirs");

    const naming = namingAGroup(everyVerb(groupId, ourPerson));
    const outcomes = answered(
      await asAdmin(theirs, async (principal, tx) => ({
        attempted: await outcomesOf(naming, principal, tx),
        listed: await listGroups(principal, tx),
      })),
    );

    expect(outcomes.attempted).toEqual(refusedAlike(naming, "no-such-group"));
    expect(outcomes.listed).toEqual({ ok: true, value: [] });

    expect(await asAdmin(ours, listGroups)).toEqual({
      ok: true,
      value: [{ id: groupId, name: "HR team", origin: "admin-curated", memberCount: 1 }],
    });

    expect(await peopleActs(theirs.workspaceId)).toEqual([]);
  });

  it("makes its own group under a name another workspace holds", async () => {
    const ours = await provisioned("Named");
    const theirs = await provisioned("AlsoNamed");
    await madeGroup(ours, "HR team");

    const made = await madeGroup(theirs, "HR team");

    expect(made).toEqual(expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/));
    expect(await groupRowCount(ours.workspaceId)).toBe(1);
  });
});

describe("an act whose transaction fails after it", () => {
  it("leaves neither the group nor its audit event behind", async () => {
    const workspace = await provisioned("Together");
    let groupId: string | undefined;

    await expect(
      asPerson(workspace, workspace.adminUserId, async (principal, tx) => {
        const made = await createGroup(principal, tx, { name: "HR team" });
        expect(made.ok).toBe(true);
        if (made.ok) groupId = made.value.groupId;

        await attempt(() => groupNameTakenAgain(tx, workspace.workspaceId, "HR team"));
      }),
    ).rejects.toThrow(/did not commit/);

    expect(groupId).toBeDefined();
    expect(await groupRowCount(workspace.workspaceId)).toBe(0);

    expect(await peopleActs(workspace.workspaceId)).toEqual([]);
  });
});
