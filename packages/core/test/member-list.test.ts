import { testData } from "@better-answers/schema/testing";
import { describe, expect, it } from "vitest";

import type { Role } from "../src/kernel/index.ts";
import { listMembers } from "../src/members/index.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { postgresForSuite, readingAs } from "./suite-postgres.ts";

const db = postgresForSuite();

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const joining = async (workspace: ProvisionedWorkspace, name: string, role: Role) => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const person = await seed.user({ name });
    const member = await seed.member({
      workspaceId: workspace.workspaceId,
      userId: person.id,
      role,
    });
    return { person, member };
  } finally {
    client.release();
  }
};

const inGroups = async (
  workspace: ProvisionedWorkspace,
  personId: string,
  names: readonly string[],
): Promise<readonly string[]> => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const ids: string[] = [];
    for (const name of names) {
      const group = await seed.group({ workspaceId: workspace.workspaceId, name });
      await seed.groupMember({
        workspaceId: workspace.workspaceId,
        groupId: group.id,
        userId: personId,
      });
      ids.push(group.id);
    }
    return ids;
  } finally {
    client.release();
  }
};

const listedAs = (workspace: ProvisionedWorkspace, userId: string) =>
  readingAs(db().runtimePool, { workspaceId: workspace.workspaceId, userId }, listMembers);

describe("the member list", () => {
  it("lists members by person id in display-name order, ignoring case", async () => {
    const workspace = await provisionedWorkspace(db(), "Listed");
    const sam = await joining(workspace, "sam Okoro", "Viewer");
    const priya = await joining(workspace, "Priya Shah", "Editor");
    const [hr, bids] = await inGroups(workspace, priya.person.id, ["HR team", "Bid writers"]);

    const listed = await listedAs(workspace, workspace.adminUserId);

    expect(listed).toEqual({
      ok: true,
      value: [
        {
          personId: priya.person.id,
          displayName: "Priya Shah",
          address: priya.person.email,
          role: "Editor",
          groups: [
            { groupId: bids, name: "Bid writers" },
            { groupId: hr, name: "HR team" },
          ],
          joinedAt: priya.member.createdAt.toISOString(),
        },
        {
          personId: sam.person.id,
          displayName: "sam Okoro",
          address: sam.person.email,
          role: "Viewer",
          groups: [],
          joinedAt: sam.member.createdAt.toISOString(),
        },
        {
          personId: workspace.adminUserId,
          displayName: "Test person",
          address: expect.any(String),
          role: "Admin",
          groups: [],
          joinedAt: expect.stringMatching(ISO_INSTANT),
        },
      ],
    });
  });

  it("orders two members of one display name by their address", async () => {
    const workspace = await provisionedWorkspace(db(), "Namesakes");
    const first = await joining(workspace, "Alex Kerr", "Viewer");
    const second = await joining(workspace, "Alex Kerr", "Viewer");

    const listed = await listedAs(workspace, workspace.adminUserId);

    const byAddress = [first.person, second.person]
      .toSorted((one, other) => one.email.localeCompare(other.email))
      .map((person) => person.id);
    expect(listed.ok && listed.value.slice(0, 2).map((member) => member.personId)).toEqual(
      byAddress,
    );
  });

  it.each(["Editor", "Viewer"] as const)("refuses a member at %s, role-forbids", async (role) => {
    const workspace = await provisionedWorkspace(db(), `Refused${role}`);
    const { person } = await joining(workspace, "Una Member", role);

    expect(await listedAs(workspace, person.id)).toEqual({ ok: false, error: "role-forbids" });
  });

  it("never lists a member of another workspace", async () => {
    const ours = await provisionedWorkspace(db(), "Ours");
    const theirs = await provisionedWorkspace(db(), "Theirs");
    await joining(theirs, "Una Elsewhere", "Editor");

    const listed = await listedAs(ours, ours.adminUserId);

    expect(listed.ok && listed.value.map((member) => member.personId)).toEqual([ours.adminUserId]);
  });
});
