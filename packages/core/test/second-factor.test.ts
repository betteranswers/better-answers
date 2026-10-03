import { describe, expect, it } from "vitest";

import {
  readSecondFactor,
  recordAuthenticatorSetUp,
  removeAuthenticator,
} from "../src/workspaces/index.ts";
import { authenticatorFor, passkeyFor, passkeyUsedAt, recoveryCodeFor } from "./identity-rows.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import { AT, ITS_OWN_AGE, secondFactorSuite } from "./second-factor-suite.ts";

const { db, door, aSession, identitySetRowsFor, confirmedAt, recoveryCodesHeldBy } =
  secondFactorSuite();

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const ageOf = async (sessionId: string) =>
  (
    await db().pool.query<{ createdAt: Date; expiresAt: Date }>(
      'SELECT created_at AS "createdAt", expires_at AS "expiresAt" FROM session WHERE id = $1',
      [sessionId],
    )
  ).rows[0];

const authenticatorsHeldBy = async (personId: string) =>
  (
    await db().pool.query<{ id: string; enabled: boolean }>(
      `SELECT a.id, u.authenticator_enabled AS enabled
         FROM "user" u LEFT JOIN authenticator a ON a.user_id = u.id WHERE u.id = $1`,
      [personId],
    )
  ).rows;

describe("recording an authenticator's setup", () => {
  it("records it, stamps the session and issues ten codes", async () => {
    const personId = await seedPerson(db().pool);
    const authenticatorId = await authenticatorFor(db().pool, personId, { verified: true });
    const sessionId = await aSession(personId, AT);

    const recorded = await recordAuthenticatorSetUp(bootstrap, door(), {
      personId,
      sessionId,
      at: AT,
      carried: ITS_OWN_AGE,
    });

    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value).toMatchObject({
      authenticatorId,
      stamped: true,
      firstRecord: true,
      issued: { madeAt: "2026-10-02T12:00:00.000Z" },
    });
    const codes = recorded.value.issued?.recoveryCodes;
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes ?? []) expect(code).toMatch(RECOVERY_CODE);
    expect(await confirmedAt(sessionId)).toEqual({ confirmed: AT, pending: null });
    expect(await recoveryCodesHeldBy(personId)).toBe(10);
    expect(await identitySetRowsFor(personId)).toEqual([
      { act: "people.person.authenticator_added", detail: { authenticatorId } },
      { act: "people.person.recovery_codes_issued", detail: { replaced: false } },
    ]);
  });

  it("records a setup once, though each finish stamps its session", async () => {
    const personId = await seedPerson(db().pool);
    const authenticatorId = await authenticatorFor(db().pool, personId, { verified: true });
    const sessions = [await aSession(personId, AT), await aSession(personId, AT)];

    const answers = await Promise.all(
      sessions.map((sessionId) =>
        recordAuthenticatorSetUp(bootstrap, door(), {
          personId,
          sessionId,
          at: AT,
          carried: ITS_OWN_AGE,
        }),
      ),
    );

    expect(answers.map((answer) => answer.ok && answer.value.firstRecord).toSorted()).toEqual([
      false,
      true,
    ]);
    for (const sessionId of sessions) {
      expect(await confirmedAt(sessionId)).toEqual({ confirmed: AT, pending: null });
    }
    expect(await identitySetRowsFor(personId)).toEqual([
      { act: "people.person.authenticator_added", detail: { authenticatorId } },
      { act: "people.person.recovery_codes_issued", detail: { replaced: false } },
    ]);
  });

  it("issues no codes to a person who holds some", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: true });
    await recoveryCodeFor(db().pool, personId, AT);

    const recorded = await recordAuthenticatorSetUp(bootstrap, door(), {
      personId,
      sessionId: await aSession(personId),
      at: AT,
      carried: ITS_OWN_AGE,
    });

    expect(recorded).toMatchObject({ ok: true, value: { issued: undefined } });
    expect(await recoveryCodesHeldBy(personId)).toBe(1);
    expect((await identitySetRowsFor(personId)).map((row) => row.act)).toEqual([
      "people.person.authenticator_added",
    ]);
  });

  it("refuses while the setup still waits on a code", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: false });
    const sessionId = await aSession(personId);

    const recorded = await recordAuthenticatorSetUp(bootstrap, door(), {
      personId,
      sessionId,
      at: AT,
      carried: ITS_OWN_AGE,
    });

    expect(recorded).toEqual({ ok: false, error: "no-authenticator" });
    expect(await confirmedAt(sessionId)).toEqual({ confirmed: null, pending: null });
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("stamps no session another person holds", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: true });
    const strangersSession = await aSession(await seedPerson(db().pool));

    const recorded = await recordAuthenticatorSetUp(bootstrap, door(), {
      personId,
      sessionId: strangersSession,
      at: AT,
      carried: ITS_OWN_AGE,
    });

    expect(recorded).toMatchObject({ ok: true, value: { stamped: false } });
    expect(await confirmedAt(strangersSession)).toEqual({ confirmed: null, pending: null });
  });

  it.each([
    [
      "moves the session back to an older carried age",
      { createdAt: "2026-10-01T09:00:00.000Z", expiresAt: "2026-10-02T09:00:00.000Z" },
      { createdAt: "2026-10-01T09:00:00.000Z", expiresAt: "2026-10-02T09:00:00.000Z" },
    ],
    [
      "keeps the session's own age over a newer carried one",
      { createdAt: "2026-10-02T12:30:00.000Z", expiresAt: "2026-11-01T12:00:00.000Z" },
      { createdAt: "2026-10-02T12:00:00.000Z", expiresAt: "2026-10-09T12:00:00.000Z" },
    ],
  ])("%s", async (_case, carried, kept) => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: true });
    const sessionId = await aSession(personId);

    const recorded = await recordAuthenticatorSetUp(bootstrap, door(), {
      personId,
      sessionId,
      at: AT,
      carried: { createdAt: new Date(carried.createdAt), expiresAt: new Date(carried.expiresAt) },
    });

    expect(recorded).toMatchObject({ ok: true, value: { stamped: true } });
    expect(await ageOf(sessionId)).toEqual({
      createdAt: new Date(kept.createdAt),
      expiresAt: new Date(kept.expiresAt),
    });
  });

  it("refuses a malformed person id, writing nothing", async () => {
    const recorded = await recordAuthenticatorSetUp(bootstrap, door(), {
      personId: "not-a-person-id",
      sessionId: "a-session",
      at: AT,
      carried: ITS_OWN_AGE,
    });

    expect(recorded).toEqual({ ok: false, error: "malformed" });
  });
});

describe("removing an authenticator", () => {
  it("lets a person needing no factor remove their only one", async () => {
    const personId = await seedPerson(db().pool);
    const authenticatorId = await authenticatorFor(db().pool, personId, { verified: true });

    const removed = await removeAuthenticator(bootstrap, door(), { personId });

    expect(removed).toEqual({ ok: true, value: { authenticatorId } });
    expect(await authenticatorsHeldBy(personId)).toEqual([{ id: null, enabled: false }]);
    expect(await identitySetRowsFor(personId)).toEqual([
      { act: "people.person.authenticator_removed", detail: { authenticatorId } },
    ]);
  });

  it("refuses an Admin's last second factor", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const authenticatorId = await authenticatorFor(db().pool, adminUserId, { verified: true });

    const removed = await removeAuthenticator(bootstrap, door(), { personId: adminUserId });

    expect(removed).toEqual({ ok: false, error: "last-second-factor" });
    expect(await authenticatorsHeldBy(adminUserId)).toEqual([
      { id: authenticatorId, enabled: true },
    ]);
    expect(await identitySetRowsFor(adminUserId)).toEqual([]);
  });

  it("refuses the operator's last second factor", async () => {
    const operatorId = await seedPerson(db().pool, { operator: true });
    await authenticatorFor(db().pool, operatorId, { verified: true });

    const removed = await removeAuthenticator(bootstrap, door(), { personId: operatorId });

    expect(removed).toEqual({ ok: false, error: "last-second-factor" });
  });

  it("lets an Admin who holds a passkey remove it", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const authenticatorId = await authenticatorFor(db().pool, adminUserId, { verified: true });
    await passkeyFor(db().pool, adminUserId);

    const removed = await removeAuthenticator(bootstrap, door(), { personId: adminUserId });

    expect(removed).toEqual({ ok: true, value: { authenticatorId } });
  });

  it("refuses to remove a setup still waiting on a code", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: false });

    const removed = await removeAuthenticator(bootstrap, door(), { personId });

    expect(removed).toEqual({ ok: false, error: "no-authenticator" });
  });
});

describe("reading a person's second factor", () => {
  it("answers nothing held for a new person", async () => {
    const personId = await seedPerson(db().pool);

    const read = await readSecondFactor(bootstrap, door(), { personId });

    expect(read).toEqual({
      ok: true,
      value: {
        mustHoldOne: false,
        operator: false,
        promoted: false,
        passkeys: [],
        authenticator: "none",
        recoveryCodes: undefined,
        codesAcknowledged: false,
        passkeyOfferDismissed: false,
        restoreRequired: false,
        waits: { authenticator: 0, "recovery-code": 0, "restore-code": 0 },
        thisSession: undefined,
      },
    });
  });

  it("answers an Admin's authenticator and unused codes", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    await authenticatorFor(db().pool, adminUserId, { verified: true });
    await passkeyFor(db().pool, adminUserId);
    await recoveryCodeFor(db().pool, adminUserId, AT);
    await recoveryCodeFor(db().pool, adminUserId, AT);

    const read = await readSecondFactor(bootstrap, door(), { personId: adminUserId });

    expect(read).toMatchObject({
      ok: true,
      value: {
        mustHoldOne: true,
        authenticator: "set-up",
        recoveryCodes: { unused: 2, madeAt: "2026-10-02T12:00:00.000Z" },
      },
    });
    expect(read.ok && read.value.passkeys).toHaveLength(1);
  });

  it("answers each passkey's name, added and last used times", async () => {
    const personId = await seedPerson(db().pool);
    const used = await passkeyFor(db().pool, personId);
    const unused = await passkeyFor(db().pool, personId);
    await db().pool.query(
      "UPDATE passkey SET created_at = $2, name = CASE WHEN id = $1 THEN 'Phone' ELSE name END WHERE user_id = $3",
      [unused, AT, personId],
    );
    await db().pool.query("UPDATE passkey SET created_at = $2 WHERE id = $1", [
      used,
      new Date("2026-10-01T08:00:00.000Z"),
    ]);
    await passkeyUsedAt(db().pool, used, new Date("2026-10-02T09:41:00.000Z"));

    const read = await readSecondFactor(bootstrap, door(), { personId });

    expect(read).toMatchObject({
      ok: true,
      value: {
        passkeys: [
          {
            id: used,
            name: "MacBook",
            createdAt: "2026-10-01T08:00:00.000Z",
            lastUsedAt: "2026-10-02T09:41:00.000Z",
          },
          { id: unused, name: "Phone", createdAt: "2026-10-02T12:00:00.000Z", lastUsedAt: null },
        ],
      },
    });
  });

  it("dates a passkey written with no time of its own", async () => {
    const personId = await seedPerson(db().pool);
    await passkeyFor(db().pool, personId);

    const read = await readSecondFactor(bootstrap, door(), { personId });

    expect(read.ok && read.value.passkeys[0]?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("answers a setup that waits on its code", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: false });

    const read = await readSecondFactor(bootstrap, door(), { personId });

    expect(read).toMatchObject({ ok: true, value: { authenticator: "awaiting-code" } });
  });

  it("answers this session's standing and the workspace it administers", async () => {
    const { adminUserId, workspaceId } = await provisionedWorkspace(db(), "Acme");
    await passkeyFor(db().pool, adminUserId);
    const sessionId = await aSession(adminUserId);
    await db().pool.query("UPDATE session SET active_workspace_id = $2 WHERE id = $1", [
      sessionId,
      workspaceId,
    ]);

    const read = await readSecondFactor(bootstrap, door(), { personId: adminUserId, sessionId });

    expect(read).toMatchObject({
      ok: true,
      value: {
        mustHoldOne: true,
        promoted: true,
        thisSession: {
          confirmed: false,
          setupGranted: false,
          adminOf: "Acme",
          standing: "confirm",
        },
      },
    });
  });

  it("names no workspace the session's person does not administer", async () => {
    const personId = await seedPerson(db().pool, { operator: true });
    const sessionId = await aSession(personId);

    const read = await readSecondFactor(bootstrap, door(), { personId, sessionId });

    expect(read).toMatchObject({
      ok: true,
      value: { operator: true, thisSession: { adminOf: null, standing: "setup" } },
    });
  });

  it("refuses a person nobody holds", async () => {
    const read = await readSecondFactor(bootstrap, door(), {
      personId: "01J00000000000000000000000",
    });

    expect(read).toEqual({ ok: false, error: "person-gone" });
  });
});
