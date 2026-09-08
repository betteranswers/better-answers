import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import { attempt } from "../src/kernel/index.ts";
import type { Result, Role, UserPrincipal } from "../src/kernel/index.ts";
import { type ProvisionedWorkspace, provisionedWorkspace, seedPerson } from "./platform.ts";
import { type Tx, withPrincipal } from "../src/store/postgres/index.ts";
import {
  addToGroup,
  createGroup,
  deleteGroup,
  listGroups,
  removeFromGroup,
  renameGroup,
} from "../src/members/index.ts";
import { abortTheTransaction, postgresForSuite, whileWritesAreRefused } from "./suite-postgres.ts";

/**
 * The members slice's group acts through its entry point (`[TEST1]`), against real
 * Postgres: what each act does, what it refuses to a role that may not perform it, what
 * it refuses to an Admin of another workspace, and the ledger row it writes beside its
 * own rows.
 *
 * Every act runs inside the transaction that resolved the Principal (`withPrincipal`), so
 * the role is decided in the same transaction as the write it authorises — which is also
 * why a cross-workspace refusal needs no argument of its own: another workspace's group
 * id resolves to no row under this transaction's scope.
 */

const db = postgresForSuite();

type Workspace = ProvisionedWorkspace;

const provisioned = (name: string): Promise<Workspace> => provisionedWorkspace(db(), name);

/** A person of this workspace at the role named; their person id. */
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

const asPerson = <T>(
  workspace: Workspace,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Result<T, string>> =>
  withPrincipal(
    workspace.door,
    { workspaceId: workspace.workspaceId, userId, issuedAt: new Date() },
    work,
  );

/** Run `work` as this workspace's first Admin and read the value the transaction committed. */
const asAdmin = async <T>(
  workspace: Workspace,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => {
  const resolved = await asPerson(workspace, workspace.adminUserId, work);
  if (!resolved.ok) throw new Error(`the Admin's principal did not resolve: ${resolved.error}`);
  return resolved.value;
};

/** Every people act on this workspace's ledger, oldest first — ids are minted in order. */
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

/** A made group's id, through the act, so no test reaches past the seam to arrange one. */
const madeGroup = async (workspace: Workspace, name: string): Promise<string> => {
  const made = await asAdmin(workspace, (principal, tx) => createGroup(principal, tx, { name }));
  if (!made.ok) throw new Error(`the group was not made: ${String(made.error)}`);
  return made.value.groupId;
};

const putInGroup = (workspace: Workspace, groupId: string, userId: string) =>
  asAdmin(workspace, (principal, tx) => addToGroup(principal, tx, { groupId, userId }));

/**
 * A workspace holding one group with one person in it — the arrange four of the acts
 * below share, every step of it through the slice's own entry point. The role is the
 * caller's to choose because group membership is orthogonal to it: a group changes only
 * what a person may see.
 */
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
  it("gives an Admin a group to list, and writes the act on the ledger beside it", async () => {
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

  it("refuses a name the workspace already holds, and leaves no second group and no ledger row", async () => {
    const workspace = await provisioned("Beta");
    await madeGroup(workspace, "HR team");

    const again = await asAdmin(workspace, (principal, tx) =>
      createGroup(principal, tx, { name: "HR team" }),
    );

    expect(again).toEqual({ ok: false, error: "name-taken" });
    expect(await groupRowCount(workspace.workspaceId)).toBe(1);
    expect(await peopleActs(workspace.workspaceId)).toHaveLength(1);
  });

  it("refuses a name that is blank once trimmed, before any row exists", async () => {
    const workspace = await provisioned("Gamma");

    const made = await asAdmin(workspace, (principal, tx) =>
      createGroup(principal, tx, { name: "   " }),
    );

    expect(made).toEqual({ ok: false, error: "malformed" });
    expect(await groupRowCount(workspace.workspaceId)).toBe(0);
  });
});

describe("renaming a group", () => {
  it("keeps its id and its membership, so an audience naming it still names the same people", async () => {
    const { workspace, groupId } = await oneGroupOnePerson("Delta");

    const renamed = await asAdmin(workspace, (principal, tx) =>
      renameGroup(principal, tx, { groupId, name: "People team" }),
    );

    expect(renamed).toEqual({ ok: true, value: { groupId } });
    // The id an audience holds is untouched, and so is who is in the group: a rename is
    // one act, never a rebuild.
    expect(await asAdmin(workspace, listGroups)).toEqual({
      ok: true,
      value: [{ id: groupId, name: "People team", origin: "admin-curated", memberCount: 1 }],
    });
  });

  it("refuses a name another group in the workspace already holds, and renames nothing", async () => {
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
  it("lets one person sit in several groups at once, each act naming the group and the person", async () => {
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
    // The group is the subject, so `subject_kind` and `subject_id` index everything about
    // one group; the person rides in the detail as an id, never a name or an address.
    expect(
      (await peopleActs(workspace.workspaceId))
        .filter((event) => event.act === "people.group.member_added")
        .map((event) => ({ subject: event.subject_id, detail: event.detail })),
    ).toEqual([
      { subject: hr, detail: { userId: person } },
      { subject: sales, detail: { userId: person } },
    ]);
  });

  it("refuses a person who is not a member of the workspace, and adds nobody", async () => {
    const workspace = await provisioned("Kappa");
    const groupId = await madeGroup(workspace, "HR team");
    const stranger = await seedPerson(db().pool);

    const added = await putInGroup(workspace, groupId, stranger);

    expect(added).toEqual({ ok: false, error: "not-a-member" });
    const memberships = await db().pool.query("SELECT 1 FROM group_member WHERE group_id = $1", [
      groupId,
    ]);
    expect(memberships.rowCount).toBe(0);
  });

  it("refuses a second add of the same person, so the ledger never says it happened twice", async () => {
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

  it("refuses a group id nobody holds when taking a person out", async () => {
    const workspace = await provisioned("Nu");
    const person = await seedMemberAt(workspace, "Viewer");

    const removed = await asAdmin(workspace, (principal, tx) =>
      removeFromGroup(principal, tx, { groupId: ulid(), userId: person }),
    );

    expect(removed).toEqual({ ok: false, error: "no-such-group" });
  });
});

/** The six acts, each as one call, so a refusal can be asserted per verb rather than once. */
type Verb = {
  readonly name: string;
  /** Every act's error is a refusal word or the store's Error — the result convention's rule 2. */
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

/** The verbs that name a group, and the two that name a person beside it. */
const namingAGroup = (verbs: readonly Verb[]): readonly Verb[] =>
  verbs.filter((verb) => verb.name !== "make" && verb.name !== "list");

const namingAPerson = (verbs: readonly Verb[]): readonly Verb[] =>
  verbs.filter((verb) => verb.name === "add to" || verb.name === "remove from");

type VerbOutcome = { readonly verb: string; readonly outcome: unknown };

/**
 * Run every verb in one Admin's transaction, in order, filling `outcomes` as it goes. The
 * array is the caller's because a transaction that fails to commit rejects, and what each
 * verb answered before it did is exactly what the caller is asserting (`[TEST8]`).
 */
const eachVerb = async (
  workspace: Workspace,
  verbs: readonly Verb[],
  outcomes: VerbOutcome[],
  before: (tx: Tx) => Promise<void> = async () => undefined,
): Promise<void> => {
  await asPerson(workspace, workspace.adminUserId, async (principal, tx) => {
    await before(tx);
    for (const verb of verbs) {
      outcomes.push({ verb: verb.name, outcome: await verb.run(principal, tx) });
    }
  });
};

const refusedAlike = (verbs: readonly Verb[], error: unknown): readonly VerbOutcome[] =>
  verbs.map((verb) => ({ verb: verb.name, outcome: { ok: false, error } }));

/**
 * Run `work` with `table` renamed away, so every statement against it fails — how a test
 * reaches an act's store-failure arm when the statement that has to fail is not the first
 * one the act runs.
 */
const whileTheTableIsGone = async <T>(table: string, work: () => Promise<T>): Promise<T> => {
  await db().pool.query(`ALTER TABLE "${table}" RENAME TO "${table}_gone"`);
  try {
    return await work();
  } finally {
    await db().pool.query(`ALTER TABLE "${table}_gone" RENAME TO "${table}"`);
  }
};

/**
 * The boundary each verb crosses **before any statement runs** (ADR 0028): an id or a name
 * of another shape is a caller's mistake to be told about, never a string handed to a
 * parameterised query as if it were an id the platform had minted.
 */
describe("what a group act refuses before it reads anything", () => {
  it("refuses a group id of no known form to every verb that names one", async () => {
    const workspace = await provisioned("Shapeless");
    const person = await seedMemberAt(workspace, "Viewer");
    const verbs = namingAGroup(everyVerb("' OR true --", person));
    const outcomes: VerbOutcome[] = [];

    await eachVerb(workspace, verbs, outcomes);

    expect(outcomes).toEqual(refusedAlike(verbs, "malformed"));
    expect(await groupRowCount(workspace.workspaceId)).toBe(0);
  });

  it("refuses a person id of no known form to both verbs that name one", async () => {
    const { workspace, groupId } = await oneGroupOnePerson("Nameless");
    const verbs = namingAPerson(everyVerb(groupId, "' OR true --"));
    const outcomes: VerbOutcome[] = [];

    await eachVerb(workspace, verbs, outcomes);

    // `no-such-group` and `not-a-member` are facts about this workspace; a person id of no
    // known form is a fact about the request, and the two are not interchangeable.
    expect(outcomes).toEqual(refusedAlike(verbs, "malformed"));
  });

  it("refuses a rename to a name that is blank once trimmed, and renames nothing", async () => {
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

/**
 * The store failing under an act is not a refusal a caller can act on, and every verb here
 * hands it back as itself. Provoked against the real database rather than behind a fake
 * door (`[TEST1]`, `[TEST3]`), and asserted with the transaction's own outcome (`[TEST8]`).
 */
describe("an act whose statement the store refuses", () => {
  it("hands the caller the store's own failure from every verb, and writes nothing", async () => {
    const { workspace, person, groupId } = await oneGroupOnePerson("Failing");
    const verbs = everyVerb(groupId, person);
    const outcomes: VerbOutcome[] = [];

    await expect(eachVerb(workspace, verbs, outcomes, abortTheTransaction)).rejects.toThrow(
      /did not commit/,
    );

    expect(outcomes).toEqual(refusedAlike(verbs, expect.any(Error)));
    // The arrange block's two acts and nothing this transaction attempted.
    expect((await peopleActs(workspace.workspaceId)).map((event) => event.act)).toEqual([
      "people.group.created",
      "people.group.member_added",
    ]);
  });

  it("hands the caller the store's own failure rather than a membership it never wrote", async () => {
    const workspace = await provisioned("Unwritten");
    const person = await seedMemberAt(workspace, "Viewer");
    const groupId = await madeGroup(workspace, "HR team");
    let added: unknown;

    // The two preconditions read fine — the group is there and the person is a member — and
    // the row itself is what the store refuses, which is the arm no aborted transaction
    // reaches because it fails the read first.
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

  it("hands the caller the store's own failure rather than a word for a statement that changed nothing", async () => {
    const { workspace, person } = await oneGroupOnePerson("Wordless");
    let removed: unknown;

    // Nothing was removed, so the act reads the group to know which of two words the caller
    // deserves — and that read is what meets the store. The table is renamed away for the
    // act, which is one shape of a store that has lost a relation under it.
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
    "refuses every verb to a %s, with the one word, even from inside the group",
    async (role) => {
      // Being in the group is the point of the arrangement: a group changes what a person
      // may *see*, never what they may *do*, so membership is no back door to a role.
      const { workspace, person, groupId } = await oneGroupOnePerson(`Refused${role}`, role);

      const outcomes = await asPerson(workspace, person, async (principal, tx) => {
        const refused: { verb: string; outcome: unknown }[] = [];
        for (const verb of everyVerb(groupId, person)) {
          refused.push({ verb: verb.name, outcome: await verb.run(principal, tx) });
        }
        return refused;
      });

      expect(outcomes.ok).toBe(true);
      if (!outcomes.ok) return;
      expect(outcomes.value).toEqual(
        everyVerb(groupId, person).map((verb) => ({
          verb: verb.name,
          outcome: { ok: false, error: "role-forbids" },
        })),
      );
      // Nothing the six verbs would have written is on the ledger: only the Admin's make
      // and add above are, and the person is still in the group they could not leave.
      expect((await peopleActs(workspace.workspaceId)).map((event) => event.act)).toEqual([
        "people.group.created",
        "people.group.member_added",
      ]);
    },
  );
});

describe("an Admin of another workspace", () => {
  it("reaches no verb of this workspace's groups, and sees none of them in its own list", async () => {
    const { workspace: ours, person: ourPerson, groupId } = await oneGroupOnePerson("Ours");
    const theirs = await provisioned("Theirs");

    // Every verb but `make`, which names no group of ours, and `list`, which has no
    // argument to name another workspace with — both are asserted on their own below.
    const naming = everyVerb(groupId, ourPerson).filter(
      (verb) => verb.name !== "make" && verb.name !== "list",
    );
    const outcomes = await asAdmin(theirs, async (principal, tx) => {
      const attempted: { verb: string; outcome: unknown }[] = [];
      for (const verb of naming) {
        attempted.push({ verb: verb.name, outcome: await verb.run(principal, tx) });
      }
      return { attempted, listed: await listGroups(principal, tx) };
    });

    expect(outcomes.attempted).toEqual(
      naming.map((verb) => ({ verb: verb.name, outcome: { ok: false, error: "no-such-group" } })),
    );
    expect(outcomes.listed).toEqual({ ok: true, value: [] });
    // Ours is untouched — still there, still named, still holding its one person.
    expect(await asAdmin(ours, listGroups)).toEqual({
      ok: true,
      value: [{ id: groupId, name: "HR team", origin: "admin-curated", memberCount: 1 }],
    });
    // And no act of theirs reached our ledger.
    expect(await peopleActs(theirs.workspaceId)).toEqual([]);
  });

  it("may make a group of its own under a name another workspace already holds", async () => {
    const ours = await provisioned("Named");
    const theirs = await provisioned("AlsoNamed");
    await madeGroup(ours, "HR team");

    const made = await madeGroup(theirs, "HR team");

    expect(made).toEqual(expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/));
    expect(await groupRowCount(ours.workspaceId)).toBe(1);
  });
});

describe("an act whose transaction fails after it", () => {
  // `[AUDIT1]` and `[TEST8]`: the act's rows and its ledger row land or fail together, so
  // the proof is a failure provoked inside the transaction after both have landed — and
  // the assertion is on the transaction's outcome first, because Postgres aborts whatever
  // the work does with the caught rejection.
  it("leaves neither the group nor its ledger row behind", async () => {
    const workspace = await provisioned("Together");
    let groupId: string | undefined;

    await expect(
      asPerson(workspace, workspace.adminUserId, async (principal, tx) => {
        const made = await createGroup(principal, tx, { name: "HR team" });
        expect(made.ok).toBe(true);
        if (made.ok) groupId = made.value.groupId;
        // A second row under the name the act just took: the unique index refuses it,
        // which proves the act's row landed and aborts the transaction it landed in.
        await attempt(() =>
          tx.query(
            `INSERT INTO "group" (id, workspace_id, name, origin) VALUES ($1, $2, 'HR team', 'admin-curated')`,
            [ulid(), workspace.workspaceId],
          ),
        );
      }),
    ).rejects.toThrow(/did not commit/);

    expect(groupId).toBeDefined();
    expect(await groupRowCount(workspace.workspaceId)).toBe(0);
    // Read as the superuser, so a row that survived could not hide behind the policy.
    expect(await peopleActs(workspace.workspaceId)).toEqual([]);
  });
});
