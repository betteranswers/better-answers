import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { testData } from "@better-answers/schema/testing";

import type { Result, Role, UserPrincipal } from "../src/kernel/index.ts";
import {
  createGroup,
  readAuditLog,
  readAuditLogInput,
  type AuditLogPage,
} from "../src/members/index.ts";
import type { Foldable, Folded, Tx } from "../src/store/postgres/index.ts";
import { recordSignIn } from "../src/workspaces/index.ts";
import {
  bootstrap,
  provisionedWorkspace,
  seedPerson,
  type ProvisionedWorkspace,
} from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { abortTheTransaction, postgresForSuite, readingAs } from "./suite-postgres.ts";

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

const pageOf = (read: Result<AuditLogPage, unknown>): AuditLogPage => {
  if (!read.ok) throw new Error(`the audit log was refused: ${String(read.error)}`);
  return read.value;
};

const subjectsOf = (page: AuditLogPage) => page.events.map((event) => event.subjectId);

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
          detail: { adminUserId: workspace.adminUserId, role: "Admin" },
        },
      ],
      nextCursor: null,
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
    expect(knowledge).toEqual({ events: [], nextCursor: null });
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
    expect(byTheirCursor).toEqual({ events: [], nextCursor: null });
  });

  it("never reads the identity-set audit log", async () => {
    const workspace = await provisionedWorkspace(db(), "Identity");
    const signedIn = await recordSignIn(bootstrap, workspace.door, workspace.adminUserId);
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
