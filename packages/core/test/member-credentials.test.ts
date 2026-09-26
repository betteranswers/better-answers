import { describe, expect, it } from "vitest";

import type { Role, UserPrincipal } from "../src/kernel/index.ts";
import { revokeCredentialsHere, revokeCredentialsHereInput } from "../src/members/index.ts";
import { type Tx, withPrincipal } from "../src/store/postgres/index.ts";
import { bothHoldingTheirOwnRow, heldAs, membersSuite } from "./members-suite.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { postgresForSuite, seedingWith, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForSuite();

const { joining, auditRowsOf } = membersSuite(db);

const BEFORE = new Date("2026-09-25T09:00:00.000Z");
const AT = new Date("2026-09-25T10:00:00.000Z");
const AFTER = new Date("2026-09-25T11:00:00.000Z");

const revocationsIn = (workspace: ProvisionedWorkspace) =>
  auditRowsOf(workspace, "people.member.credentials_revoked");

/** The same person, a member of a second workspace too. */
const alsoJoining = (workspace: ProvisionedWorkspace, role: Role, userId: string) =>
  seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: workspace.workspaceId, userId, role }),
  );

const revoking = (principal: UserPrincipal, tx: Tx, personId: string, at = AT) =>
  revokeCredentialsHere(principal, tx, {
    ...inputOf(revokeCredentialsHereInput, { personId }),
    at,
  });

const revokedBy = (workspace: ProvisionedWorkspace, actor: string, personId: string, at = AT) =>
  heldAs(workspace, actor, (principal, tx) => revoking(principal, tx, personId, at));

const instantHeld = async (
  workspace: ProvisionedWorkspace,
  personId: string,
): Promise<Date | null | undefined> => {
  const held = await db().pool.query<{ at: Date | null }>(
    "SELECT credentials_revoked_at AS at FROM member WHERE workspace_id = $1 AND user_id = $2",
    [workspace.workspaceId, personId],
  );
  return held.rows[0]?.at;
};

/** Whether a credential the person was issued at `issuedAt` still resolves in the workspace. */
const resolvedIn = async (workspace: ProvisionedWorkspace, userId: string, issuedAt: Date) => {
  const resolved = await withPrincipal(
    workspace.door,
    { workspaceId: workspace.workspaceId, userId, issuedAt },
    async (principal) => principal.role,
  );
  return resolved.ok ? "admitted" : resolved.error;
};

describe("revoking a member's credentials in this workspace", () => {
  it("writes the membership's instant and records the Admin revoking", async () => {
    const workspace = await provisionedWorkspace(db(), "Revoked");
    const viewer = await joining(workspace, "Viewer");

    const revoked = await revokedBy(workspace, workspace.adminUserId, viewer);

    expect(revoked).toEqual({
      ok: true,
      value: { personId: viewer, revokedAt: AT.toISOString() },
    });
    expect(await instantHeld(workspace, viewer)).toEqual(AT);
    expect(await revocationsIn(workspace)).toEqual([
      { actor: `human:${workspace.adminUserId}`, subject_id: viewer, detail: {} },
    ]);
  });

  it("refuses credentials issued before it here, admitting later ones", async () => {
    const workspace = await provisionedWorkspace(db(), "RefusedHere");
    const elsewhere = await provisionedWorkspace(db(), "AdmittedThere");
    const editor = await joining(workspace, "Editor");
    await alsoJoining(elsewhere, "Editor", editor);

    await revokedBy(workspace, workspace.adminUserId, editor);

    expect({
      beforeHere: await resolvedIn(workspace, editor, BEFORE),
      afterHere: await resolvedIn(workspace, editor, AFTER),
      beforeElsewhere: await resolvedIn(elsewhere, editor, BEFORE),
    }).toEqual({
      beforeHere: "credentials-revoked",
      afterHere: "admitted",
      beforeElsewhere: "admitted",
    });
    expect(await instantHeld(elsewhere, editor)).toBeNull();
  });

  it("ends this workspace's tokens from before the instant, no other's", async () => {
    const workspace = await provisionedWorkspace(db(), "TokensHere");
    const elsewhere = await provisionedWorkspace(db(), "TokensThere");
    const editor = await joining(workspace, "Editor");
    await alsoJoining(elsewhere, "Editor", editor);
    const grants = await seedingWith(db().pool, async (seed) => {
      const { clientId } = await seed.oauthClient();
      const named = new Map<string, string>();
      for (const [grant, referenceId, createdAt] of [
        ["here-old", workspace.workspaceId, BEFORE],
        ["here-new", workspace.workspaceId, AFTER],
        ["there-old", elsewhere.workspaceId, BEFORE],
      ] as const) {
        const token = { clientId, userId: editor, referenceId, createdAt };
        named.set((await seed.oauthRefreshToken(token)).id, `refresh ${grant}`);
        named.set((await seed.oauthAccessToken(token)).id, `access ${grant}`);
      }
      return { clientId, named };
    });

    await revokedBy(workspace, workspace.adminUserId, editor);

    const ended = await db().pool.query<{ id: string }>(
      `SELECT id FROM oauth_refresh_token WHERE client_id = $1 AND revoked IS NOT NULL
       UNION ALL
       SELECT id FROM oauth_access_token WHERE client_id = $1 AND revoked IS NOT NULL`,
      [grants.clientId],
    );
    expect(ended.rows.map((row) => grants.named.get(row.id)).toSorted()).toEqual([
      "access here-old",
      "refresh here-old",
    ]);
  });

  it("never moves a later instant back to an earlier one", async () => {
    const workspace = await provisionedWorkspace(db(), "Forward");
    const viewer = await joining(workspace, "Viewer");
    await revokedBy(workspace, workspace.adminUserId, viewer, AFTER);

    const again = await revokedBy(workspace, workspace.adminUserId, viewer, AT);

    expect(again).toEqual({
      ok: true,
      value: { personId: viewer, revokedAt: AFTER.toISOString() },
    });
    expect(await instantHeld(workspace, viewer)).toEqual(AFTER);
    expect(await revocationsIn(workspace)).toHaveLength(2);
  });

  it("revokes the workspace's only Admin, the Admin themself", async () => {
    const workspace = await provisionedWorkspace(db(), "OnlyAdmin");
    const { adminUserId } = workspace;

    const revoked = await revokedBy(workspace, adminUserId, adminUserId);

    expect(revoked).toEqual({
      ok: true,
      value: { personId: adminUserId, revokedAt: AT.toISOString() },
    });
    expect(await instantHeld(workspace, adminUserId)).toEqual(AT);
  });
});

describe("what revoking a member's credentials refuses", () => {
  it.each(["Editor", "Viewer"] as const)("refuses a revoker at %s, role-forbids", async (role) => {
    const workspace = await provisionedWorkspace(db(), `Unrevoked${role}`);
    const revoker = await joining(workspace, role);

    const refused = await revokedBy(workspace, revoker, workspace.adminUserId);

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await instantHeld(workspace, workspace.adminUserId)).toBeNull();
    expect(await revocationsIn(workspace)).toEqual([]);
  });

  it("refuses a person who is a member elsewhere alone, no-such-member", async () => {
    const ours = await provisionedWorkspace(db(), "OursOnly");
    const theirs = await provisionedWorkspace(db(), "TheirsOnly");
    const elsewhere = await joining(theirs, "Viewer");

    const refused = await revokedBy(ours, ours.adminUserId, elsewhere);

    expect(refused).toEqual({ ok: false, error: "no-such-member" });
    expect(await instantHeld(theirs, elsewhere)).toBeNull();
    expect([...(await revocationsIn(ours)), ...(await revocationsIn(theirs))]).toEqual([]);
  });

  it("leaves instant and tokens unchanged when its audit event fails", async () => {
    const workspace = await provisionedWorkspace(db(), "Unrecorded");
    const viewer = await joining(workspace, "Viewer");
    const token = await seedingWith(db().pool, (seed) =>
      seed.oauthRefreshToken({
        userId: viewer,
        referenceId: workspace.workspaceId,
        createdAt: BEFORE,
      }),
    );

    const failed = await whileWritesAreRefused(db().pool, "audit_event", () =>
      revokedBy(workspace, workspace.adminUserId, viewer),
    );

    expect(failed).toEqual({ ok: false, error: expect.any(Error) });
    expect(await instantHeld(workspace, viewer)).toBeNull();
    const held = await db().pool.query<{ revoked: Date | null }>(
      "SELECT revoked FROM oauth_refresh_token WHERE id = $1",
      [token.id],
    );
    expect(held.rows).toEqual([{ revoked: null }]);
  });

  it("answers the deadlock between two Admins revoking each other changed-meanwhile", async () => {
    const workspace = await provisionedWorkspace(db(), "RevokedAtOnce");
    const fellowAdmin = await joining(workspace, "Admin");

    const answered = await bothHoldingTheirOwnRow(
      workspace,
      [workspace.adminUserId, fellowAdmin],
      revoking,
    );

    const [refused, ...others] = answered.filter((answer) => !answer.ok);
    expect({ refused, others }).toEqual({
      refused: { ok: false, error: "changed-meanwhile" },
      others: [],
    });
    expect(await revocationsIn(workspace)).toHaveLength(1);
  });
});
