import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import { acceptInvitation } from "../src/members/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import {
  addressOf,
  countWaitingOnLocks,
  postgresForSuite,
  seedingWith,
  until,
  whileActsWaitAt,
} from "./suite-postgres.ts";

const db = postgresForSuite();

const door = () => openPostgres(db().runtimePool);

/** A workspace, a waiting Editor invitation to a verified, named person, and that person. */
const anInvitation = async (name: string) => {
  const workspace = await provisionedWorkspace(db(), name);
  const address = addressOf("priya");
  const personId = await seedPerson(db().pool, {
    email: address,
    emailVerified: true,
    name: "Priya Shah",
  });
  const invitation = await seedingWith(db().pool, (seed) =>
    seed.invitation({
      workspaceId: workspace.workspaceId,
      email: address,
      inviterId: workspace.adminUserId,
      role: "Editor",
    }),
  );
  return { workspace, personId, invitationId: invitation.id };
};

const accepting = (personId: string, invitationId: string) =>
  acceptInvitation(bootstrap, door(), {
    invitationId,
    personId,
    sessionId: ulid(),
    now: new Date(),
  });

const membersOf = async (workspaceId: string, personId: string) =>
  (
    await db().pool.query<{ role: string }>(
      "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, personId],
    )
  ).rows;

const joinedEvents = async (personId: string) =>
  (
    await db().pool.query<{ act: string }>(
      "SELECT act FROM audit_event WHERE subject_id = $1 AND act = 'people.member.joined'",
      [personId],
    )
  ).rows;

const statusOf = async (invitationId: string) =>
  (
    await db().pool.query<{ status: string }>("SELECT status FROM invitation WHERE id = $1", [
      invitationId,
    ])
  ).rows[0]?.status;

describe("accepting an invitation", () => {
  it("leaves one membership; the second answers already-a-member", async () => {
    const { workspace, personId, invitationId } = await anInvitation("Twice");

    const [first, second] = await whileActsWaitAt(
      db().pool,
      "member",
      "INSERT",
      async (release) => {
        const firstAccept = accepting(personId, invitationId);
        await until(async () => (await countWaitingOnLocks(db().pool)) >= 1);
        const secondAccept = accepting(personId, invitationId);
        await until(async () => (await countWaitingOnLocks(db().pool)) >= 2);
        await release();
        return Promise.all([firstAccept, secondAccept]);
      },
    );

    expect(first).toEqual({
      ok: true,
      value: { workspaceId: workspace.workspaceId, workspaceName: "Twice", role: "Editor" },
    });
    expect(second).toEqual({ ok: false, error: "already-a-member" });
    expect(await membersOf(workspace.workspaceId, personId)).toEqual([{ role: "Editor" }]);
    expect(await joinedEvents(personId)).toHaveLength(1);
  });
  it("answers already-a-member from the index, landing nothing", async () => {
    const { workspace, personId, invitationId } = await anInvitation("Raced");

    const raced = await whileActsWaitAt(db().pool, "invitation", "UPDATE", async (release) => {
      const accept = accepting(personId, invitationId);
      await until(async () => (await countWaitingOnLocks(db().pool)) >= 1);
      await seedingWith(db().pool, (seed) =>
        seed.member({ workspaceId: workspace.workspaceId, userId: personId, role: "Viewer" }),
      );
      await release();
      return accept;
    });

    expect(raced).toEqual({ ok: false, error: "already-a-member" });
    expect(await membersOf(workspace.workspaceId, personId)).toEqual([{ role: "Viewer" }]);
    expect(await joinedEvents(personId)).toEqual([]);
    expect(await statusOf(invitationId)).toBe("pending");
  });
});
