import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import type { Result, Role, UserPrincipal } from "../src/kernel/index.ts";
import {
  acceptInvitation,
  addToGroup,
  approveRequest,
  changeRole,
  changeRoleInput,
  createGroup,
  declineRequest,
  flagDisplayName,
  flagDisplayNameInput,
  inviteMembers,
  readActivity,
  readActivityInput,
  removeFromGroup,
  removeMember,
  removeMemberInput,
  requestAccess,
  type ActivityPage,
} from "../src/members/index.ts";
import { openPostgres, type Foldable, type Folded, type Tx } from "../src/store/postgres/index.ts";
import { addMember } from "../src/workspaces/index.ts";
import { heldAs } from "./members-suite.ts";
import {
  bootstrap,
  provisionedWorkspace,
  seedPerson,
  type ProvisionedWorkspace,
} from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import {
  abortTheTransaction,
  addressOf,
  answered,
  postgresForSuite,
  readingAs,
  seedingWith,
} from "./suite-postgres.ts";

const db = postgresForSuite();

/** A verified, named person who belongs to no workspace yet. */
const aPerson = (name: string): Promise<string> =>
  seedPerson(db().pool, {
    email: addressOf(name.toLowerCase().replaceAll(" ", ".")),
    emailVerified: true,
    name,
  });

const memberAt = async (workspace: ProvisionedWorkspace, role: Role, name: string) => {
  const personId = await aPerson(name);
  await seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: workspace.workspaceId, userId: personId, role }),
  );
  return personId;
};

const as = <T>(
  workspace: ProvisionedWorkspace,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T>> => heldAs(workspace, userId, work);

const activityOf = (
  workspace: ProvisionedWorkspace,
  personId: string,
  cursor?: string | null,
  reader = workspace.adminUserId,
) =>
  readingAs(db().runtimePool, { workspaceId: workspace.workspaceId, userId: reader }, (p, tx) =>
    readActivity(p, tx, inputOf(readActivityInput, { personId, cursor })),
  );

const pageOf = (read: Result<ActivityPage, unknown>): ActivityPage => {
  if (!read.ok) throw new Error(`the activity was refused: ${String(read.error)}`);
  return read.value;
};

const linesOf = async (workspace: ProvisionedWorkspace, personId: string) =>
  pageOf(await activityOf(workspace, personId)).events.map(({ act, direction }) => [
    act,
    direction,
  ]);

const roleChanged = (
  workspace: ProvisionedWorkspace,
  actor: string,
  personId: string,
  role: Role,
) =>
  as(workspace, actor, (principal, tx) =>
    changeRole(principal, tx, inputOf(changeRoleInput, { personId, role })),
  );

const accepted = async (personId: string, invitationId: string) =>
  answered(
    await acceptInvitation(bootstrap, openPostgres(db().runtimePool), {
      invitationId,
      personId,
      sessionId: ulid(),
      now: new Date(),
    }),
  );

const invited = async (workspace: ProvisionedWorkspace, personId: string) => {
  const found = await db().pool.query<{ email: string }>('SELECT email FROM "user" WHERE id = $1', [
    personId,
  ]);
  const address = found.rows[0]?.email ?? "";
  const [sent] = answered(
    await as(workspace, workspace.adminUserId, (principal, tx) =>
      inviteMembers(principal, tx, { addresses: [address], role: "Viewer", now: new Date() }),
    ),
  );
  return sent?.invitationId ?? "";
};

/** Priya asks to join `workspace`; answers her id and her request's. */
const asked = async (workspace: ProvisionedWorkspace) => {
  const priya = await aPerson("Priya Shah");
  answered(
    await requestAccess(bootstrap, openPostgres(db().runtimePool), {
      slug: workspace.slug,
      requesterId: priya,
      reason: "I have joined the bids team and need the answer library.",
    }),
  );
  const request = await db().pool.query<{ id: string }>(
    "SELECT id FROM access_request WHERE workspace_id = $1 AND requester_id = $2",
    [workspace.workspaceId, priya],
  );
  return { priya, requestId: request.rows[0]?.id ?? "" };
};

describe("a person's activity", () => {
  it("AE4: marks a role change by Hannah, to Priya", async () => {
    const workspace = await provisionedWorkspace(db(), "Hannahs", { name: "Hannah Reid" });
    const hannah = workspace.adminUserId;
    const priya = await memberAt(workspace, "Viewer", "Priya Shah");
    answered(await roleChanged(workspace, hannah, priya, "Editor"));

    const onHannahs = pageOf(await activityOf(workspace, hannah));
    const onPriyas = pageOf(await activityOf(workspace, priya));

    const theChange = {
      act: "people.member.role_changed",
      actor: `human:${hannah}`,
      subjectId: priya,
      by: { kind: "person", displayName: "Hannah Reid" },
      subject: { kind: "person", displayName: "Priya Shah" },
      detail: { previousRole: "Viewer", role: "Editor" },
    };
    expect(onHannahs).toEqual({
      events: [
        expect.objectContaining({ ...theChange, direction: "by" }),
        expect.objectContaining({ act: "platform.workspace.provisioned", direction: "to" }),
      ],
      nextCursor: null,
    });
    expect(onPriyas).toEqual({
      events: [expect.objectContaining({ ...theChange, direction: "to" })],
      nextCursor: null,
    });
    expect(onPriyas.events[0]?.id).toBe(onHannahs.events[0]?.id);
  });

  it("marks a self-demotion once, as both", async () => {
    const workspace = await provisionedWorkspace(db(), "Demoted");
    const sam = await memberAt(workspace, "Admin", "Sam Okoro");
    answered(await roleChanged(workspace, workspace.adminUserId, workspace.adminUserId, "Editor"));

    const page = pageOf(await activityOf(workspace, workspace.adminUserId, null, sam));

    expect(page.events.map(({ act, direction }) => [act, direction])).toEqual([
      ["people.member.role_changed", "both"],
      ["platform.workspace.provisioned", "to"],
    ]);
  });

  it("shows a declined request through the requester's id", async () => {
    const workspace = await provisionedWorkspace(db(), "Declined");
    const { priya, requestId } = await asked(workspace);
    answered(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        declineRequest(principal, tx, { requestId }),
      ),
    );

    expect(await linesOf(workspace, priya)).toEqual([
      ["people.request.declined", "to"],
      ["people.request.asked", "both"],
    ]);
  });

  it("shows Priya's request and its approval after she joins", async () => {
    const workspace = await provisionedWorkspace(db(), "Approved");
    const { priya, requestId } = await asked(workspace);
    const approved = answered(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        approveRequest(principal, tx, { requestId, now: new Date() }),
      ),
    );
    await accepted(priya, approved.invitationId);

    expect(await linesOf(workspace, priya)).toEqual([
      ["people.member.joined", "both"],
      ["people.request.approved", "to"],
      ["people.request.asked", "both"],
    ]);
  });

  it("shows an earlier membership beneath the later one", async () => {
    const workspace = await provisionedWorkspace(db(), "Rejoined");
    const priya = await aPerson("Priya Shah");
    await accepted(priya, await invited(workspace, priya));
    answered(await roleChanged(workspace, workspace.adminUserId, priya, "Editor"));
    answered(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        removeMember(principal, tx, {
          ...inputOf(removeMemberInput, { personId: priya }),
          at: new Date(),
        }),
      ),
    );
    await accepted(priya, await invited(workspace, priya));

    expect(await linesOf(workspace, priya)).toEqual([
      ["people.member.joined", "both"],
      ["people.member.removed", "to"],
      ["people.member.role_changed", "to"],
      ["people.member.joined", "both"],
    ]);
  });

  it("shows group changes through the member's id", async () => {
    const workspace = await provisionedWorkspace(db(), "Grouped");
    const priya = await memberAt(workspace, "Viewer", "Priya Shah");
    const { groupId } = answered(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        createGroup(principal, tx, { name: "Bid writers" }),
      ),
    );
    answered(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        addToGroup(principal, tx, { groupId, userId: priya }),
      ),
    );
    answered(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        removeFromGroup(principal, tx, { groupId, userId: priya }),
      ),
    );

    expect(await linesOf(workspace, priya)).toEqual([
      ["people.group.member_removed", "to"],
      ["people.group.member_added", "to"],
    ]);
  });

  it("shows the platform adding Priya as done to her", async () => {
    const workspace = await provisionedWorkspace(db(), "PlatformAdded");
    const email = addressOf("priya.shah");
    const priya = await seedPerson(db().pool, { email, emailVerified: true, name: "Priya Shah" });
    answered(
      await addMember(bootstrap, workspace.door, {
        workspaceId: workspace.workspaceId,
        email,
        role: "Editor",
      }),
    );

    expect(await linesOf(workspace, priya)).toEqual([["people.member.added", "to"]]);
  });

  it("shows the first Admin's provisioning as done to them", async () => {
    const workspace = await provisionedWorkspace(db(), "Provisioned");

    expect(await linesOf(workspace, workspace.adminUserId)).toEqual([
      ["platform.workspace.provisioned", "to"],
    ]);
  });

  it("shows an Admin's flag on Priya's display name", async () => {
    const workspace = await provisionedWorkspace(db(), "Flagged");
    const priya = await memberAt(workspace, "Viewer", "Priya Shah");
    answered(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        flagDisplayName(principal, tx, inputOf(flagDisplayNameInput, { personId: priya })),
      ),
    );

    expect(await linesOf(workspace, priya)).toEqual([["people.person.name_flagged", "to"]]);
  });

  it("leaves out an invitation sent before she joined", async () => {
    const workspace = await provisionedWorkspace(db(), "Invited");
    const priya = await aPerson("Priya Shah");
    await accepted(priya, await invited(workspace, priya));

    expect(await linesOf(workspace, priya)).toEqual([["people.member.joined", "both"]]);
  });

  it("never shows another workspace's events, even by its cursor", async () => {
    const ours = await provisionedWorkspace(db(), "OurActivity");
    const theirs = await provisionedWorkspace(db(), "TheirActivity");
    const priya = await memberAt(ours, "Viewer", "Priya Shah");
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: theirs.workspaceId, userId: priya, role: "Viewer" }),
    );
    answered(await roleChanged(ours, ours.adminUserId, priya, "Editor"));
    answered(await roleChanged(theirs, theirs.adminUserId, priya, "Admin"));
    answered(await roleChanged(theirs, theirs.adminUserId, priya, "Viewer"));
    const theirFirst = pageOf(await activityOf(theirs, priya)).events[0]?.id;

    const page = pageOf(await activityOf(ours, priya));
    const byTheirCursor = pageOf(await activityOf(ours, priya, theirFirst));

    expect(page.events.map((event) => event.detail)).toEqual([
      { previousRole: "Viewer", role: "Editor" },
    ]);
    expect(byTheirCursor).toEqual({ events: [], nextCursor: null });
  });

  it("answers an unknown person an empty stream", async () => {
    const workspace = await provisionedWorkspace(db(), "Nobody");

    expect(pageOf(await activityOf(workspace, ulid()))).toEqual({ events: [], nextCursor: null });
  });

  it("finds every act naming the person in its detail alone", async () => {
    const workspace = await provisionedWorkspace(db(), "NamedInDetail");
    const priya = await aPerson("Priya Shah");
    const namings = [
      ["userId", "people.group.member_added"],
      ["userId", "people.group.member_removed"],
      ["userId", "people.member.added"],
      ["requesterId", "people.request.asked"],
      ["requesterId", "people.request.approved"],
      ["requesterId", "people.request.declined"],
      ["adminUserId", "platform.workspace.provisioned"],
    ] as const;
    await seedingWith(db().pool, async (seed) => {
      for (const [key, act] of namings) {
        await seed.auditEvent({
          workspaceId: workspace.workspaceId,
          act,
          detail: { [key]: priya },
        });
      }
    });

    expect((await linesOf(workspace, priya)).toSorted()).toEqual(
      namings.map(([, act]) => [act, "to"]).toSorted(),
    );
  });
});

/**
 * Sixty events, oldest first, the `index`th at `secondOf(index)`; every third names Priya as actor
 * and subject.
 */
const sixtyEventsOf = async (
  workspace: ProvisionedWorkspace,
  priya: string,
  secondOf = (index: number) => index,
) =>
  seedingWith(db().pool, async (seed) => {
    const seeded: { id: string; at: Date }[] = [];
    for (let index = 0; index < 60; index += 1) {
      const at = new Date(Date.UTC(2026, 8, 1, 9, 0, secondOf(index)));
      const common = { workspaceId: workspace.workspaceId, at };
      const shapes = [
        { act: "people.group.created", actor: `human:${priya}`, detail: {} },
        {
          act: "people.group.member_added",
          actor: `human:${workspace.adminUserId}`,
          detail: { userId: priya },
        },
        {
          act: "people.member.role_changed",
          actor: `human:${priya}`,
          subjectId: priya,
          detail: { previousRole: "Admin", role: "Editor" },
        },
      ] as const;
      const shape = shapes[index % 3] ?? shapes[0];
      seeded.push({ id: (await seed.auditEvent({ ...common, ...shape })).id, at });
    }
    return seeded;
  });

/** The order the read promises, spelled out: the later instant first, then the greater id. */
const newestFirst = (events: readonly { id: string; at: Date }[]) =>
  events.toSorted((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1));

describe("paging a person's activity", () => {
  it("pages sixty events as fifty then ten, none repeated", async () => {
    const workspace = await provisionedWorkspace(db(), "Paged");
    const priya = await memberAt(workspace, "Viewer", "Priya Shah");
    const expected = newestFirst(await sixtyEventsOf(workspace, priya)).map(({ id }) => id);

    const first = pageOf(await activityOf(workspace, priya));
    const rest = pageOf(await activityOf(workspace, priya, first.nextCursor));

    expect(first.events.map((event) => event.id)).toEqual(expected.slice(0, 50));
    expect(first.nextCursor).toBe(expected[49]);
    expect(rest.events.map((event) => event.id)).toEqual(expected.slice(50));
    expect(rest.nextCursor).toBeNull();
  });

  it("pages events sharing an instant across the page's end", async () => {
    const workspace = await provisionedWorkspace(db(), "PagedTies");
    const priya = await memberAt(workspace, "Viewer", "Priya Shah");
    const fourAnInstant = (index: number) => Math.floor(index / 4);
    const expected = newestFirst(await sixtyEventsOf(workspace, priya, fourAnInstant));

    const first = pageOf(await activityOf(workspace, priya));
    const rest = pageOf(await activityOf(workspace, priya, first.nextCursor));

    // Unless the page's last event and the next share an instant, the tie-break goes untested.
    expect(expected[50]?.at).toEqual(expected[49]?.at);
    expect([...first.events, ...rest.events].map((event) => event.id)).toEqual(
      expected.map(({ id }) => id),
    );
    expect(first.nextCursor).toBe(expected[49]?.id);
    expect(rest.nextCursor).toBeNull();
  });
});

/** The reader's own activity, asked on a transaction the store has aborted, so none commits. */
const readAfterTheStoreFailed = async (workspace: ProvisionedWorkspace, reader: string) => {
  let read: Result<unknown, unknown> | undefined;
  const reading = readingAs(
    db().runtimePool,
    { workspaceId: workspace.workspaceId, userId: reader },
    async (principal, tx) => {
      await abortTheTransaction(tx);
      read = await readActivity(principal, tx, inputOf(readActivityInput, { personId: reader }));
    },
  );
  await expect(reading).rejects.toThrow(/did not commit/);
  return read;
};

describe("who may read a person's activity", () => {
  it.each(["Editor", "Viewer"] as const)("refuses a member at %s, role-forbids", async (role) => {
    const workspace = await provisionedWorkspace(db(), `Refused${role}`);
    const reader = await memberAt(workspace, role, "Una Member");

    expect(await activityOf(workspace, workspace.adminUserId, null, reader)).toEqual({
      ok: false,
      error: "role-forbids",
    });
  });

  it("refuses before reading anything, on an aborted transaction too", async () => {
    const workspace = await provisionedWorkspace(db(), "RefusedFirst");
    const reader = await memberAt(workspace, "Viewer", "Una Member");

    expect(await readAfterTheStoreFailed(workspace, reader)).toEqual({
      ok: false,
      error: "role-forbids",
    });
  });

  it("answers the store's own failure rather than an empty page", async () => {
    const workspace = await provisionedWorkspace(db(), "ActivityUnread");

    expect(await readAfterTheStoreFailed(workspace, workspace.adminUserId)).toEqual({
      ok: false,
      error: expect.any(Error),
    });
  });
});

const PEOPLE = 30;

/** Most events are about concepts; a tenth add someone to a group, a tenth ask to join. */
const busyEvent = (index: number, named: string) => {
  if (index % 10 === 0) return { act: "people.group.member_added", detail: { userId: named } };
  if (index % 10 === 1) return { act: "people.request.asked", detail: { requesterId: named } };
  return { act: "knowledge.concept.published", detail: {} };
};

/** Three thousand events across thirty actors, a hundred of them Priya's own acts. */
const aBusyLog = async (workspace: ProvisionedWorkspace, priya: string) => {
  const actors = [priya, ...Array.from({ length: PEOPLE - 1 }, () => ulid())];
  await seedingWith(db().pool, async (seed) => {
    for (let index = 0; index < 3_000; index += 1) {
      await seed.auditEvent({
        workspaceId: workspace.workspaceId,
        actor: `human:${actors[index % PEOPLE] ?? priya}`,
        ...busyEvent(index, actors[(index + 3) % PEOPLE] ?? priya),
      });
    }
  });
  await db().pool.query("ANALYZE audit_event");
};

/** The plan Postgres ran for the read's one statement, run again with the same values. */
const planOfTheRead = (workspace: ProvisionedWorkspace, priya: string) =>
  readingAs(
    db().runtimePool,
    { workspaceId: workspace.workspaceId, userId: workspace.adminUserId },
    async (principal, tx) => {
      const sent: { statement: string; values: unknown[] | undefined }[] = [];
      const spied = new Proxy(tx, {
        get: (target, key) =>
          key === "query"
            ? (statement: string, values?: unknown[]) => {
                sent.push({ statement, values });
                return target.query(statement, values);
              }
            : Reflect.get(target, key),
      });
      answered(
        await readActivity(principal, spied, inputOf(readActivityInput, { personId: priya })),
      );
      const read = sent.find(({ statement }) => statement.includes("UNION ALL"));
      if (read === undefined) throw new Error("the read sent no statement over its arms");
      const plan = await tx.query<{ "QUERY PLAN": string }>(
        `EXPLAIN (ANALYZE, COSTS OFF) ${read.statement}`,
        read.values,
      );
      return { ok: true, value: plan.rows.map((row) => row["QUERY PLAN"]).join("\n") } as const;
    },
  );

describe("reading a busy audit log", () => {
  it("reads each arm through an index, own acts by actor", async () => {
    const workspace = await provisionedWorkspace(db(), "Busy");
    const priya = await memberAt(workspace, "Admin", "Priya Shah");
    await aBusyLog(workspace, priya);

    const plan = answered(await planOfTheRead(workspace, priya));

    expect(plan).toMatch(/Index Scan Backward using audit_event_actor_idx on audit_event /);
    expect(plan).not.toMatch(/Seq Scan/);
  });
});
