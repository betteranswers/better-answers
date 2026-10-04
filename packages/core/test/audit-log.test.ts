import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { testData } from "@better-answers/schema/testing";

import { parse, type Result, type Role, type UserPrincipal } from "../src/kernel/index.ts";
import {
  addToGroup,
  changeRole,
  changeRoleInput,
  createGroup,
  deleteGroup,
  inviteMembers,
  readAuditLog,
  readAuditLogInput,
  renameGroup,
  type SearchedAuditLogPage,
} from "../src/members/index.ts";
import type { Foldable, Folded, Tx } from "../src/store/postgres/index.ts";
import { recordSignIn } from "../src/workspaces/index.ts";
import {
  bootstrap,
  erasedFromTheSet,
  provisionedWorkspace,
  seedPerson,
  type ProvisionedWorkspace,
} from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { abortTheTransaction, postgresForSuite, readingAs, seedingWith } from "./suite-postgres.ts";

const db = postgresForSuite();

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const memberAt = async (
  workspace: ProvisionedWorkspace,
  role: Role,
  name: string,
): Promise<string> => {
  const userId = await seedPerson(db().pool, { name });
  const client = await db().pool.connect();
  try {
    await testData(client).member({ workspaceId: workspace.workspaceId, userId, role });
  } finally {
    client.release();
  }
  return userId;
};

const acting = <T>(
  workspace: ProvisionedWorkspace,
  userId: string,
  work: (principal: UserPrincipal, tx: Tx) => Promise<Foldable<T>>,
): Promise<Folded<T>> =>
  readingAs(db().runtimePool, { workspaceId: workspace.workspaceId, userId }, work);

/** One transaction each, so each group's event holds an instant of its own. */
const groupsMadeBy = async (
  workspace: ProvisionedWorkspace,
  userId: string,
  names: readonly string[],
): Promise<readonly string[]> => {
  const made: string[] = [];
  for (const name of names) {
    const group = await acting(workspace, userId, (principal, tx) =>
      createGroup(principal, tx, { name }),
    );
    if (!group.ok) throw new Error(`the group ${name} was not made: ${String(group.error)}`);
    made.push(group.value.groupId);
  }
  return made;
};

const readAs = (
  workspace: ProvisionedWorkspace,
  userId: string,
  asked: z.input<typeof readAuditLogInput> = {},
) =>
  acting(workspace, userId, (principal, tx) =>
    readAuditLog(principal, tx, inputOf(readAuditLogInput, asked)),
  );

const pageOf = (read: Result<SearchedAuditLogPage, unknown>): SearchedAuditLogPage => {
  if (!read.ok) throw new Error(`the audit log was refused: ${String(read.error)}`);
  return read.value;
};

const subjectsOf = (page: SearchedAuditLogPage) => page.events.map((event) => event.subjectId);

const namedSubjectsOf = async (workspace: ProvisionedWorkspace) =>
  pageOf(await readAs(workspace, workspace.adminUserId)).events.map(({ act, subject }) => [
    act,
    subject,
  ]);

const done = <T>(answered: Result<T, unknown>): T => {
  if (!answered.ok) throw new Error(`the act was refused: ${String(answered.error)}`);
  return answered.value;
};

const roleChangedOf = async (workspace: ProvisionedWorkspace, personId: string) =>
  done(
    await acting(workspace, workspace.adminUserId, (principal, tx) =>
      changeRole(principal, tx, inputOf(changeRoleInput, { personId, role: "Editor" })),
    ),
  );

const invitedBy = async (workspace: ProvisionedWorkspace, address: string): Promise<string> => {
  const [sent] = done(
    await acting(workspace, workspace.adminUserId, (principal, tx) =>
      inviteMembers(principal, tx, { addresses: [address], role: "Editor", now: new Date() }),
    ),
  );
  return sent?.invitationId ?? "";
};

/** An event in `workspace` whose subject is a row `elsewhere` holds under the same id. */
const eventAboutTheirs = async (
  workspace: ProvisionedWorkspace,
  act: "people.invitation.created" | "people.group.created",
  seedTheirs: (seed: ReturnType<typeof testData>) => Promise<{ readonly id: string }>,
): Promise<void> => {
  await seedingWith(db().pool, async (seed) => {
    const theirs = await seedTheirs(seed);
    await seed.auditEvent({
      workspaceId: workspace.workspaceId,
      act,
      actor: `human:${workspace.adminUserId}`,
      subjectId: theirs.id,
      detail: act === "people.invitation.created" ? { role: "Editor" } : {},
    });
  });
};

describe("the audit log", () => {
  it("reads events newest first, naming actors from the person row", async () => {
    const workspace = await provisionedWorkspace(db(), "Logged", { name: "Priya Shah" });
    const [bidWriters] = await groupsMadeBy(workspace, workspace.adminUserId, ["Bid writers"]);

    const page = pageOf(await readAs(workspace, workspace.adminUserId));

    expect(page).toEqual({
      events: [
        {
          id: expect.any(String),
          act: "people.group.created",
          family: "people",
          subjectKind: "group",
          subjectId: bidWriters,
          actor: `human:${workspace.adminUserId}`,
          at: expect.stringMatching(ISO_INSTANT),
          by: { kind: "person", displayName: "Priya Shah" },
          subject: { kind: "group", name: "Bid writers" },
          detail: {},
        },
        {
          id: expect.any(String),
          act: "platform.workspace.provisioned",
          family: "platform",
          subjectKind: "workspace",
          subjectId: workspace.workspaceId,
          actor: "process:better-answers-bootstrap",
          at: expect.stringMatching(ISO_INSTANT),
          by: { kind: "platform" },
          subject: null,
          detail: { adminUserId: workspace.adminUserId, role: "Admin" },
        },
      ],
      nextCursor: null,
      searchTooBroad: false,
    });
    const [newest, oldest] = page.events;
    expect(Date.parse(newest?.at ?? "")).toBeGreaterThan(Date.parse(oldest?.at ?? ""));
  });

  it("names a person with no display name a former member", async () => {
    const workspace = await provisionedWorkspace(db(), "Unnamed");
    const unnamed = await memberAt(workspace, "Admin", "");
    await groupsMadeBy(workspace, unnamed, ["Estimators"]);

    const page = pageOf(await readAs(workspace, workspace.adminUserId));

    expect(page.events.map((event) => event.by)).toEqual([
      { kind: "former-member" },
      { kind: "platform" },
    ]);
  });

  it("names a removed member by the name they gave", async () => {
    const workspace = await provisionedWorkspace(db(), "Removed");
    const leaver = await memberAt(workspace, "Admin", "Sam Okoro");
    await groupsMadeBy(workspace, leaver, ["Estimators"]);
    await db().pool.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      workspace.workspaceId,
      leaver,
    ]);

    const page = pageOf(await readAs(workspace, workspace.adminUserId));

    expect(page.events[0]?.by).toEqual({ kind: "person", displayName: "Sam Okoro" });
  });

  it("names each ended grant's client and workspace, else its ids", async () => {
    const workspace = await provisionedWorkspace(db(), "Granted");
    const gone = "https://gone.example.invalid/metadata";
    const claude = await seedingWith(db().pool, async (seed) => {
      const client = await seed.oauthClient({ name: "Claude" });
      await seed.auditEvent({
        workspaceId: workspace.workspaceId,
        act: "people.member.credentials_revoked",
        actor: `human:${workspace.adminUserId}`,
        detail: {
          grants: [
            ...[client.clientId, gone].map((clientId) => ({
              clientId,
              workspaceId: workspace.workspaceId,
              issuedAt: "2026-09-26T09:00:00.000Z",
            })),
            { clientId: gone, workspaceId: null, issuedAt: "2026-09-26T09:00:00.000Z" },
          ],
        },
      });
      return client.clientId;
    });

    const page = pageOf(await readAs(workspace, workspace.adminUserId));

    const issuedAt = "2026-09-26T09:00:00.000Z";
    const inGranted = { workspaceId: workspace.workspaceId, workspaceName: "Granted", issuedAt };
    expect(page.events[0]?.detail).toEqual({
      grants: [
        { clientId: claude, clientName: "Claude", ...inGranted },
        { clientId: gone, clientName: gone, ...inGranted },
        { clientId: gone, clientName: gone, workspaceId: null, workspaceName: null, issuedAt },
      ],
    });
  });

  it("reads one family alone when asked for it", async () => {
    const workspace = await provisionedWorkspace(db(), "Filtered");
    await groupsMadeBy(workspace, workspace.adminUserId, ["Site team"]);

    const people = pageOf(await readAs(workspace, workspace.adminUserId, { family: "people" }));
    const platform = pageOf(await readAs(workspace, workspace.adminUserId, { family: "platform" }));
    const knowledge = pageOf(
      await readAs(workspace, workspace.adminUserId, { family: "knowledge" }),
    );

    expect(people.events.map((event) => event.act)).toEqual(["people.group.created"]);
    expect(platform.events.map((event) => event.act)).toEqual(["platform.workspace.provisioned"]);
    expect(knowledge).toEqual({ events: [], nextCursor: null, searchTooBroad: false });
  });

  it("pages from the newest, each resuming where the last stopped", async () => {
    const workspace = await provisionedWorkspace(db(), "Paged");
    const [one, two, three, four] = await groupsMadeBy(workspace, workspace.adminUserId, [
      "One",
      "Two",
      "Three",
      "Four",
    ]);

    const first = pageOf(await readAs(workspace, workspace.adminUserId, { limit: 2 }));
    const second = pageOf(
      await readAs(workspace, workspace.adminUserId, { limit: 2, cursor: first.nextCursor }),
    );
    const last = pageOf(
      await readAs(workspace, workspace.adminUserId, { limit: 2, cursor: second.nextCursor }),
    );

    expect(subjectsOf(first)).toEqual([four, three]);
    expect(first.nextCursor).toBe(first.events[1]?.id);
    expect(subjectsOf(second)).toEqual([two, one]);
    expect(subjectsOf(last)).toEqual([workspace.workspaceId]);
    expect(last.nextCursor).toBeNull();
  });

  it("says no page follows one that ends on the oldest", async () => {
    const workspace = await provisionedWorkspace(db(), "Exact");
    await groupsMadeBy(workspace, workspace.adminUserId, ["One"]);

    const page = pageOf(await readAs(workspace, workspace.adminUserId, { limit: 2 }));

    expect(page.events).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("pages within the family asked for", async () => {
    const workspace = await provisionedWorkspace(db(), "FamilyPaged");
    const [one, two] = await groupsMadeBy(workspace, workspace.adminUserId, ["One", "Two"]);

    const first = pageOf(
      await readAs(workspace, workspace.adminUserId, { family: "people", limit: 1 }),
    );
    const second = pageOf(
      await readAs(workspace, workspace.adminUserId, {
        family: "people",
        limit: 1,
        cursor: first.nextCursor,
      }),
    );

    expect([...subjectsOf(first), ...subjectsOf(second)]).toEqual([two, one]);
    expect(second.nextCursor).toBeNull();
  });

  it("never reads another workspace's events, even by another workspace's cursor", async () => {
    const ours = await provisionedWorkspace(db(), "Ours");
    const theirs = await provisionedWorkspace(db(), "Theirs", { name: "Una Elsewhere" });
    await groupsMadeBy(theirs, theirs.adminUserId, ["Their group", "Their other group"]);
    const theirPage = pageOf(await readAs(theirs, theirs.adminUserId, { limit: 1 }));

    const page = pageOf(await readAs(ours, ours.adminUserId));
    const byTheirCursor = pageOf(
      await readAs(ours, ours.adminUserId, { cursor: theirPage.nextCursor }),
    );

    expect(subjectsOf(page)).toEqual([ours.workspaceId]);
    expect(byTheirCursor).toEqual({ events: [], nextCursor: null, searchTooBroad: false });
  });

  it("never reads the identity-set audit log", async () => {
    const workspace = await provisionedWorkspace(db(), "Identity");
    const signedIn = await recordSignIn(
      bootstrap,
      workspace.door,
      workspace.adminUserId,
      "email_code",
    );
    expect(signedIn.ok).toBe(true);

    const page = pageOf(await readAs(workspace, workspace.adminUserId));

    expect(page.events.map((event) => event.act)).toEqual(["platform.workspace.provisioned"]);
  });

  it.each(["Editor", "Viewer"] as const)("refuses a member at %s, role-forbids", async (role) => {
    const workspace = await provisionedWorkspace(db(), `Refused${role}`);
    const member = await memberAt(workspace, role, "Una Member");

    expect(await readAs(workspace, member)).toEqual({ ok: false, error: "role-forbids" });
  });

  it("answers the store's own failure rather than an empty page", async () => {
    const workspace = await provisionedWorkspace(db(), "Unread");
    let read: Result<unknown, unknown> | undefined;

    await expect(
      acting(workspace, workspace.adminUserId, async (principal, tx) => {
        await abortTheTransaction(tx);
        read = await readAuditLog(principal, tx, inputOf(readAuditLogInput, {}));
      }),
    ).rejects.toThrow(/did not commit/);

    expect(read).toEqual({ ok: false, error: expect.any(Error) });
  });
});

/** One address per workspace, as an address is one person's across the platform. */
const addressOf = (workspace: ProvisionedWorkspace): string =>
  `priya.${workspace.workspaceId.toLowerCase()}@example.com`;

/** Priya made a group herself, was added to another, then had her role changed. */
const priyaOf = async (workspace: ProvisionedWorkspace) => {
  const priya = await seedPerson(db().pool, { name: "Priya Shah", email: addressOf(workspace) });
  await seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: workspace.workspaceId, userId: priya, role: "Admin" }),
  );
  const [estimators = ""] = await groupsMadeBy(workspace, priya, ["Estimators"]);
  const [bidWriters = ""] = await groupsMadeBy(workspace, workspace.adminUserId, ["Bid writers"]);
  done(
    await acting(workspace, workspace.adminUserId, (principal, tx) =>
      addToGroup(principal, tx, { groupId: bidWriters, userId: priya }),
    ),
  );
  await roleChangedOf(workspace, priya);
  return { priya, estimators, bidWriters };
};

/** Groups "Crew 001" upward, each with its creation's event; answers their ids in id order. */
const crewsSeeded = (workspace: ProvisionedWorkspace, count: number) =>
  seedingWith(db().pool, async (seed) => {
    const ids: string[] = [];
    for (let crew = 1; crew <= count; crew += 1) {
      const name = `Crew ${String(crew).padStart(3, "0")}`;
      const group = await seed.group({ workspaceId: workspace.workspaceId, name });
      await seed.auditEvent({
        workspaceId: workspace.workspaceId,
        act: "people.group.created",
        actor: `human:${workspace.adminUserId}`,
        subjectId: group.id,
        detail: {},
      });
      ids.push(group.id);
    }
    return ids.toSorted();
  });

const actsOf = (page: SearchedAuditLogPage) => page.events.map((event) => event.act);

describe("searching the audit log", () => {
  it("finds a person as actor, subject or group member, paged", async () => {
    const workspace = await provisionedWorkspace(db(), "Searched", { name: "Hannah Wright" });
    const { priya, estimators, bidWriters } = await priyaOf(workspace);
    await groupsMadeBy(workspace, workspace.adminUserId, ["Site team"]);

    const first = pageOf(
      await readAs(workspace, workspace.adminUserId, { search: "Priya", limit: 2 }),
    );
    const second = pageOf(
      await readAs(workspace, workspace.adminUserId, {
        search: "Priya",
        limit: 2,
        cursor: first.nextCursor,
      }),
    );

    expect([...subjectsOf(first), ...subjectsOf(second)]).toEqual([priya, bidWriters, estimators]);
    expect(actsOf(first)).toEqual(["people.member.role_changed", "people.group.member_added"]);
    expect(first.nextCursor).toBe(first.events[1]?.id);
    expect(second.nextCursor).toBeNull();
  });

  it("finds a person by their address", async () => {
    const workspace = await provisionedWorkspace(db(), "SearchedByAddress");
    const { priya } = await priyaOf(workspace);

    const page = pageOf(
      await readAs(workspace, workspace.adminUserId, {
        search: addressOf(workspace).toUpperCase(),
      }),
    );

    expect(subjectsOf(page)[0]).toBe(priya);
    expect(page.events).toHaveLength(3);
  });

  it("finds a group's events by its name", async () => {
    const workspace = await provisionedWorkspace(db(), "SearchedByGroup");
    const { bidWriters } = await priyaOf(workspace);

    const page = pageOf(await readAs(workspace, workspace.adminUserId, { search: "bid writ" }));

    expect(actsOf(page)).toEqual(["people.group.member_added", "people.group.created"]);
    expect(new Set(subjectsOf(page))).toEqual(new Set([bidWriters]));
  });

  it("finds events by the words of their act", async () => {
    const workspace = await provisionedWorkspace(db(), "SearchedByAct");
    await priyaOf(workspace);

    const page = pageOf(
      await readAs(workspace, workspace.adminUserId, { search: "  Role   changed " }),
    );

    expect(actsOf(page)).toEqual(["people.member.role_changed"]);
  });

  it("searches within the family asked for", async () => {
    const workspace = await provisionedWorkspace(db(), "SearchedInFamily", { name: "Hannah" });

    const people = pageOf(
      await readAs(workspace, workspace.adminUserId, { search: "Hannah", family: "people" }),
    );
    const platform = pageOf(
      await readAs(workspace, workspace.adminUserId, { search: "Hannah", family: "platform" }),
    );

    expect(people).toEqual({ events: [], nextCursor: null, searchTooBroad: false });
    expect(actsOf(platform)).toEqual(["platform.workspace.provisioned"]);
  });

  it("answers an empty last page when nothing matches", async () => {
    const workspace = await provisionedWorkspace(db(), "SearchedForNothing");
    await priyaOf(workspace);

    expect(await readAs(workspace, workspace.adminUserId, { search: "Zebedee" })).toEqual({
      ok: true,
      value: { events: [], nextCursor: null, searchTooBroad: false },
    });
  });

  it("reads % and _ in a search as themselves", async () => {
    const workspace = await provisionedWorkspace(db(), "SearchedLiterally");
    const [sure, plain, underscored] = await groupsMadeBy(workspace, workspace.adminUserId, [
      "100% sure",
      "100 sure",
      "site_team",
    ]);
    await groupsMadeBy(workspace, workspace.adminUserId, ["siteXteam"]);

    const percent = pageOf(await readAs(workspace, workspace.adminUserId, { search: "100%" }));
    const underscore = pageOf(await readAs(workspace, workspace.adminUserId, { search: "e_t" }));

    expect(subjectsOf(percent)).toEqual([sure]);
    expect(subjectsOf(percent)).not.toContain(plain);
    expect(subjectsOf(underscore)).toEqual([underscored]);
  });

  it("never finds a person known only to another workspace", async () => {
    const ours = await provisionedWorkspace(db(), "OurSearch");
    const theirs = await provisionedWorkspace(db(), "TheirSearch", { name: "Una Elsewhere" });
    await groupsMadeBy(theirs, theirs.adminUserId, ["Their group"]);

    expect(pageOf(await readAs(ours, ours.adminUserId, { search: "Una Elsewhere" }))).toEqual({
      events: [],
      nextCursor: null,
      searchTooBroad: false,
    });
  });

  it("reads a search naming 100 groups whole", async () => {
    const workspace = await provisionedWorkspace(db(), "SearchedHundred");
    await crewsSeeded(workspace, 100);

    const page = pageOf(await readAs(workspace, workspace.adminUserId, { search: "Crew" }));

    expect(page.searchTooBroad).toBe(false);
  });

  it("flags a search naming over 100 groups, reading 100", async () => {
    const workspace = await provisionedWorkspace(db(), "SearchedTooBroadly");
    const crews = await crewsSeeded(workspace, 101);

    const first = pageOf(await readAs(workspace, workspace.adminUserId, { search: "Crew" }));
    const rest = pageOf(
      await readAs(workspace, workspace.adminUserId, { search: "Crew", cursor: first.nextCursor }),
    );

    expect([first.searchTooBroad, rest.searchTooBroad]).toEqual([true, true]);
    expect(new Set([...subjectsOf(first), ...subjectsOf(rest)])).toEqual(
      new Set(crews.slice(0, 100)),
    );
    expect(rest.nextCursor).toBeNull();
  });

  it("refuses a search over 100 characters, malformed", () => {
    expect(parse(readAuditLogInput, { search: "a".repeat(100) }).ok).toBe(true);
    expect(parse(readAuditLogInput, { search: "a".repeat(101) })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { search: expect.anything() } },
    });
  });
});

describe("the audit log's subjects", () => {
  it("names a member by their display name", async () => {
    const workspace = await provisionedWorkspace(db(), "Promoted");
    const priya = await memberAt(workspace, "Viewer", "Priya Shah");
    await roleChangedOf(workspace, priya);

    expect((await namedSubjectsOf(workspace))[0]).toEqual([
      "people.member.role_changed",
      { kind: "person", displayName: "Priya Shah" },
    ]);
  });

  it("names a group by its name as it stands now", async () => {
    const workspace = await provisionedWorkspace(db(), "Regrouped");
    const [groupId = ""] = await groupsMadeBy(workspace, workspace.adminUserId, ["Bid writers"]);
    done(
      await acting(workspace, workspace.adminUserId, (principal, tx) =>
        renameGroup(principal, tx, { groupId, name: "Bid team" }),
      ),
    );

    expect(await namedSubjectsOf(workspace)).toEqual([
      ["people.group.renamed", { kind: "group", name: "Bid team" }],
      ["people.group.created", { kind: "group", name: "Bid team" }],
      ["platform.workspace.provisioned", null],
    ]);
  });

  it("reads a deleted group's events as a deleted group", async () => {
    const workspace = await provisionedWorkspace(db(), "Ungrouped");
    const [groupId = ""] = await groupsMadeBy(workspace, workspace.adminUserId, ["Site team"]);
    done(
      await acting(workspace, workspace.adminUserId, (principal, tx) =>
        deleteGroup(principal, tx, { groupId }),
      ),
    );

    expect(await namedSubjectsOf(workspace)).toEqual([
      ["people.group.deleted", { kind: "deleted-group" }],
      ["people.group.created", { kind: "deleted-group" }],
      ["platform.workspace.provisioned", null],
    ]);
  });

  it("names an erased person a former member", async () => {
    const workspace = await provisionedWorkspace(db(), "Forgotten");
    const priya = await memberAt(workspace, "Viewer", "Priya Shah");
    await roleChangedOf(workspace, priya);
    await erasedFromTheSet(db(), workspace.workspaceId, priya);

    expect((await namedSubjectsOf(workspace))[0]).toEqual([
      "people.member.role_changed",
      { kind: "former-member" },
    ]);
  });

  it("names an invitation by the address it was sent to", async () => {
    const workspace = await provisionedWorkspace(db(), "Invited");
    await invitedBy(workspace, "jo.bloggs@example.invalid");

    expect((await namedSubjectsOf(workspace))[0]).toEqual([
      "people.invitation.created",
      { kind: "invitation", address: "jo.bloggs@example.invalid" },
    ]);
  });

  it("reads an invitation erasure deleted without its address", async () => {
    const workspace = await provisionedWorkspace(db(), "Unaddressed");
    const invitationId = await invitedBy(workspace, "jo.bloggs@example.invalid");
    await db().pool.query("DELETE FROM invitation WHERE id = $1", [invitationId]);

    expect((await namedSubjectsOf(workspace))[0]).toEqual([
      "people.invitation.created",
      { kind: "erased-invitation" },
    ]);
  });

  it("never names another workspace's invitation by its id", async () => {
    const ours = await provisionedWorkspace(db(), "OurInvitations");
    const theirs = await provisionedWorkspace(db(), "TheirInvitations");
    await eventAboutTheirs(ours, "people.invitation.created", (seed) =>
      seed.invitation({
        workspaceId: theirs.workspaceId,
        inviterId: theirs.adminUserId,
        email: "una.elsewhere@example.invalid",
      }),
    );

    expect((await namedSubjectsOf(ours))[0]).toEqual([
      "people.invitation.created",
      { kind: "erased-invitation" },
    ]);
  });

  it("never names another workspace's group by its id", async () => {
    const ours = await provisionedWorkspace(db(), "OurGroups");
    const theirs = await provisionedWorkspace(db(), "TheirGroups");
    await eventAboutTheirs(ours, "people.group.created", (seed) =>
      seed.group({ workspaceId: theirs.workspaceId, name: "Their group" }),
    );

    expect((await namedSubjectsOf(ours))[0]).toEqual([
      "people.group.created",
      { kind: "deleted-group" },
    ]);
  });
});
