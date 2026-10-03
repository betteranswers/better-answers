import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import {
  acceptInvitation,
  bulkChangeRole,
  bulkChangeRoleInput,
  changeRole,
  changeRoleInput,
} from "../src/members/index.ts";
import { removeAuthenticator, removePasskey, setOperatorMark } from "../src/workspaces/index.ts";
import { authenticatorFor, passkeyFor } from "./identity-rows.ts";
import { heldAs, membersSuite } from "./members-suite.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import { AT, secondFactorSuite } from "./second-factor-suite.ts";
import { inputOf } from "./suite-input.ts";
import { seedingWith } from "./suite-postgres.ts";

const { db, door, aSession, confirmedAt } = secondFactorSuite();

const { joining } = membersSuite(db);

const confirmedSession = async (personId: string, pendingSince?: Date) => {
  const sessionId = await aSession(personId, pendingSince);
  await db().pool.query("UPDATE session SET second_factor_confirmed_at = $2 WHERE id = $1", [
    sessionId,
    AT,
  ]);
  return sessionId;
};

const isPromoted = async (personId: string) =>
  (
    await db().pool.query<{ promoted: boolean }>(
      'SELECT promoted_at IS NOT NULL AS promoted FROM "user" WHERE id = $1',
      [personId],
    )
  ).rows[0]?.promoted;

describe("becoming one who must hold a second factor", () => {
  it("clears every session's stamp and hour on becoming Admin", async () => {
    const workspace = await provisionedWorkspace(db(), "Promoted");
    const editor = await joining(workspace, "Editor");
    const stamped = await confirmedSession(editor, AT);
    const plain = await aSession(editor);

    const moved = await heldAs(workspace, workspace.adminUserId, (principal, tx) =>
      changeRole(principal, tx, inputOf(changeRoleInput, { personId: editor, role: "Admin" })),
    );

    expect(moved).toMatchObject({ ok: true, value: { role: "Admin", promoted: true } });
    expect([await confirmedAt(stamped), await confirmedAt(plain)]).toEqual([
      { confirmed: null, pending: null },
      { confirmed: null, pending: null },
    ]);
    expect(await isPromoted(editor)).toBe(true);
  });

  it("promotes no one already an Admin in another workspace", async () => {
    const elsewhere = await provisionedWorkspace(db(), "Elsewhere");
    const here = await provisionedWorkspace(db(), "Here");
    const editor = await joining(here, "Editor");
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: elsewhere.workspaceId, userId: editor, role: "Admin" }),
    );
    const stamped = await confirmedSession(editor);

    const moved = await heldAs(here, here.adminUserId, (principal, tx) =>
      changeRole(principal, tx, inputOf(changeRoleInput, { personId: editor, role: "Admin" })),
    );

    expect(moved).toMatchObject({ ok: true, value: { promoted: false } });
    expect(await confirmedAt(stamped)).toEqual({ confirmed: AT, pending: null });
    expect(await isPromoted(editor)).toBe(false);
  });

  it("names each person a bulk move promotes", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkPromoted");
    const viewer = await joining(workspace, "Viewer");
    const stamped = await confirmedSession(viewer);

    const moved = await heldAs(workspace, workspace.adminUserId, (principal, tx) =>
      bulkChangeRole(
        principal,
        tx,
        inputOf(bulkChangeRoleInput, { personIds: [viewer], role: "Admin" }),
      ),
    );

    expect(moved).toMatchObject({ ok: true, value: { promoted: [viewer] } });
    expect(await confirmedAt(stamped)).toEqual({ confirmed: null, pending: null });
  });

  it("promotes a person joining by an Admin invitation", async () => {
    const workspace = await provisionedWorkspace(db(), "Invited");
    const email = `invitee-${ulid().toLowerCase()}@example.test`;
    const personId = await seedPerson(db().pool, { email, emailVerified: true, name: "Priya" });
    const stamped = await confirmedSession(personId);
    const invitation = await seedingWith(db().pool, (seed) =>
      seed.invitation({
        workspaceId: workspace.workspaceId,
        email,
        inviterId: workspace.adminUserId,
        role: "Admin",
      }),
    );

    const joined = await acceptInvitation(bootstrap, door(), {
      invitationId: invitation.id,
      personId,
      sessionId: stamped,
      now: AT,
    });

    expect(joined).toMatchObject({ ok: true, value: { role: "Admin", promoted: true } });
    expect(await confirmedAt(stamped)).toEqual({ confirmed: null, pending: null });
  });

  it("promotes a person granted the operator mark", async () => {
    const email = `operator-${ulid().toLowerCase()}@example.test`;
    const personId = await seedPerson(db().pool, { email });
    const stamped = await confirmedSession(personId);

    await setOperatorMark(bootstrap, door(), { email, change: "grant" });

    expect(await confirmedAt(stamped)).toEqual({ confirmed: null, pending: null });
    expect(await isPromoted(personId)).toBe(true);
  });
});

type Removal = (personId: string, removing: string) => Promise<unknown>;

/** The removing session's stamp and another's, once `remove` has run on the first. */
const stampsAfter = async (personId: string, remove: Removal) => {
  const removing = await confirmedSession(personId);
  const other = await confirmedSession(personId);
  await remove(personId, removing);
  return [await confirmedAt(removing), await confirmedAt(other)];
};

const KEPT_HERE_ENDED_THERE = [
  { confirmed: AT, pending: null },
  { confirmed: null, pending: null },
];

describe("a confirmation outliving its factor", () => {
  it("ends with a removed passkey, except on the removing session", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);

    const stamps = await stampsAfter(personId, (_, sessionId) =>
      removePasskey(bootstrap, door(), { personId, passkeyId, sessionId }),
    );

    expect(stamps).toEqual(KEPT_HERE_ENDED_THERE);
  });

  it("ends with a removed authenticator, except on the removing session", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: true });

    const stamps = await stampsAfter(personId, (_, sessionId) =>
      removeAuthenticator(bootstrap, door(), { personId, sessionId }),
    );

    expect(stamps).toEqual(KEPT_HERE_ENDED_THERE);
  });
});
