import { describe, expect, it } from "vitest";

import type { Role, UserPrincipal } from "@better-answers/core/kernel";
import { type Tx, withPrincipal } from "@better-answers/core/store/postgres";
import { matching } from "@better-answers/schema/testing/matching";

import {
  endEverySignInAndTokenHere,
  endEverySignInAndTokenHereInput,
} from "../../src/members/index.ts";
import { endedGrants } from "../support/identity-rows.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "../support/platform.ts";
import { inputOf } from "../support/suite-input.ts";
import { postgresForSuite, seedingWith, whileWritesAreRefused } from "../support/suite-postgres.ts";
import { actingOnEachOther, heldAs, membersSuite } from "./members-suite.ts";

const db = postgresForSuite();

const { joining, auditRowsOf, grantsEndedAbout } = membersSuite(db);

const BEFORE = new Date("2026-09-25T09:00:00.000Z");
const AT = new Date("2026-09-25T10:00:00.000Z");
const AFTER = new Date("2026-09-25T11:00:00.000Z");

const revocationsIn = (workspace: ProvisionedWorkspace) =>
  auditRowsOf(workspace, "people.member.credentials_revoked");

const alsoJoining = (workspace: ProvisionedWorkspace, role: Role, userId: string) =>
  seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: workspace.workspaceId, userId, role }),
  );

const revoking = (principal: UserPrincipal, tx: Tx, personId: string, at = AT) =>
  endEverySignInAndTokenHere(principal, tx, {
    ...inputOf(endEverySignInAndTokenHereInput, { personId }),
    at,
  });

const revokedBy = (workspace: ProvisionedWorkspace, actor: string, personId: string, at = AT) =>
  heldAs(workspace, actor, (principal, tx) => revoking(principal, tx, personId, at), at);

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

const resolvedIn = async (workspace: ProvisionedWorkspace, userId: string, issuedAt: Date) => {
  const resolved = await withPrincipal(
    workspace.door,
    { workspaceId: workspace.workspaceId, userId, issuedAt },
    async (principal) => principal.role,
  );
  return resolved.ok ? "admitted" : resolved.error;
};

describe("ending a member's sign-ins and tokens in this workspace", () => {
  it("stores the revocation time and records the revoking Admin", async () => {
    const workspace = await provisionedWorkspace(db(), "Revoked");
    const viewer = await joining(workspace, "Viewer");

    const revoked = await revokedBy(workspace, workspace.adminUserId, viewer);

    expect(revoked).toEqual({
      ok: true,
      value: { personId: viewer, revokedAt: AT.toISOString() },
    });
    expect(await instantHeld(workspace, viewer)).toEqual(AT);
    expect(await revocationsIn(workspace)).toEqual([
      { actor: `human:${workspace.adminUserId}`, subject_id: viewer, detail: { grants: [] } },
    ]);
  });

  it("writes no identity-set row when no grant ended", async () => {
    const workspace = await provisionedWorkspace(db(), "NoGrant");
    const viewer = await joining(workspace, "Viewer");

    await revokedBy(workspace, workspace.adminUserId, viewer);

    expect(await grantsEndedAbout(viewer)).toEqual([]);
  });

  it("refuses only credentials issued here before the revocation", async () => {
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

  it("ends only this workspace's tokens issued before the revocation", async () => {
    const workspace = await provisionedWorkspace(db(), "TokensHere");
    const elsewhere = await provisionedWorkspace(db(), "TokensThere");
    const editor = await joining(workspace, "Editor");
    await alsoJoining(elsewhere, "Editor", editor);
    const grants = await seedingWith(db().pool, async (seed) => {
      const { clientId } = await seed.oauthClient({ name: "Claude" });
      const labelById = new Map<string, string>();
      for (const [grant, referenceId, createdAt] of [
        ["here-old", workspace.workspaceId, BEFORE],
        ["here-new", workspace.workspaceId, AFTER],
        ["there-old", elsewhere.workspaceId, BEFORE],
      ] as const) {
        const token = { clientId, userId: editor, referenceId, createdAt };
        labelById.set((await seed.oauthRefreshToken(token)).id, `refresh ${grant}`);
        labelById.set((await seed.oauthAccessToken(token)).id, `access ${grant}`);
      }
      return { clientId, labelById };
    });

    await revokedBy(workspace, workspace.adminUserId, editor);

    expect(await endedGrants(db().pool, grants)).toEqual(["access here-old", "refresh here-old"]);
    const ended = [
      {
        clientId: grants.clientId,
        workspaceId: workspace.workspaceId,
        issuedAt: BEFORE.toISOString(),
      },
    ];
    expect((await revocationsIn(workspace)).map((row) => row.detail)).toEqual([{ grants: ended }]);
    expect(await grantsEndedAbout(editor)).toEqual([
      {
        actor: `human:${workspace.adminUserId}`,
        detail: { workspaceId: workspace.workspaceId, grants: ended },
      },
    ]);
  });

  it("never moves the revocation time earlier", async () => {
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

  it("lets the only Admin revoke their own sign-ins", async () => {
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

describe("what ending a member's sign-ins and tokens refuses", () => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses revocation by the %s role with role-forbids",
    async (role) => {
      const workspace = await provisionedWorkspace(db(), `Unrevoked${role}`);
      const revoker = await joining(workspace, role);

      const refused = await revokedBy(workspace, revoker, workspace.adminUserId);

      expect(refused).toEqual({ ok: false, error: "role-forbids" });
      expect(await instantHeld(workspace, workspace.adminUserId)).toBeNull();
      expect(await revocationsIn(workspace)).toEqual([]);
    },
  );

  it("refuses a member of only another workspace with no-such-member", async () => {
    const ours = await provisionedWorkspace(db(), "OursOnly");
    const theirs = await provisionedWorkspace(db(), "TheirsOnly");
    const elsewhere = await joining(theirs, "Viewer");

    const refused = await revokedBy(ours, ours.adminUserId, elsewhere);

    expect(refused).toEqual({ ok: false, error: "no-such-member" });
    expect(await instantHeld(theirs, elsewhere)).toBeNull();
    expect([...(await revocationsIn(ours)), ...(await revocationsIn(theirs))]).toEqual([]);
  });

  it("changes nothing when the audit event fails", async () => {
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

    expect(failed).toEqual({ ok: false, error: matching.any(Error) });
    expect(await instantHeld(workspace, viewer)).toBeNull();
    const held = await db().pool.query<{ revoked: Date | null }>(
      "SELECT revoked FROM oauth_refresh_token WHERE id = $1",
      [token.id],
    );
    expect(held.rows).toEqual([{ revoked: null }]);
  });

  it("returns changed-meanwhile when two Admins revoke each other at once", async () => {
    const workspace = await provisionedWorkspace(db(), "RevokedAtOnce");
    const fellowAdmin = await joining(workspace, "Admin");

    const answered = await actingOnEachOther(
      workspace,
      [workspace.adminUserId, fellowAdmin],
      revoking,
      AT,
    );

    const [refused, ...others] = answered.filter((answer) => !answer.ok);
    expect({ refused, others }).toEqual({
      refused: { ok: false, error: "changed-meanwhile" },
      others: [],
    });
    expect(await revocationsIn(workspace)).toHaveLength(1);
  });
});
