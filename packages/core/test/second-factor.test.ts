import { describe, expect, it } from "vitest";

import { openPostgres } from "../src/store/postgres/index.ts";
import {
  readSecondFactor,
  recordAuthenticatorSetUp,
  removeAuthenticator,
} from "../src/workspaces/index.ts";
import { authenticatorFor, passkeyFor, recoveryCodeFor, sessionFor } from "./identity-rows.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

const door = () => openPostgres(db().runtimePool);

const AT = new Date("2026-10-02T12:00:00.000Z");

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const aSession = (userId: string, pendingSince?: Date) =>
  sessionFor(db().pool, userId, {
    createdAt: AT,
    lastUsedAt: AT,
    expiresAt: new Date("2026-10-09T12:00:00.000Z"),
    ...(pendingSince === undefined ? {} : { pendingSince }),
  });

const identitySetRowsFor = async (personId: string) =>
  (
    await db().pool.query<{ act: string; detail: unknown }>(
      "SELECT act, detail FROM identity_audit_event WHERE subject_id = $1 ORDER BY at, id",
      [personId],
    )
  ).rows;

const confirmedAt = async (sessionId: string) =>
  (
    await db().pool.query<{ confirmed: Date | null; pending: Date | null }>(
      "SELECT second_factor_confirmed_at AS confirmed, pending_since AS pending FROM session WHERE id = $1",
      [sessionId],
    )
  ).rows[0];

const recoveryCodesHeldBy = async (personId: string) =>
  (
    await db().pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM recovery_code WHERE user_id = $1",
      [personId],
    )
  ).rows[0]?.count;

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
    });

    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value).toMatchObject({ authenticatorId, stamped: true });
    expect(recorded.value.recoveryCodes).toHaveLength(10);
    expect(new Set(recorded.value.recoveryCodes).size).toBe(10);
    for (const code of recorded.value.recoveryCodes ?? []) expect(code).toMatch(RECOVERY_CODE);
    expect(await confirmedAt(sessionId)).toEqual({ confirmed: AT, pending: null });
    expect(await recoveryCodesHeldBy(personId)).toBe(10);
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
    });

    expect(recorded).toMatchObject({ ok: true, value: { recoveryCodes: undefined } });
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
    });

    expect(recorded).toMatchObject({ ok: true, value: { stamped: false } });
    expect(await confirmedAt(strangersSession)).toEqual({ confirmed: null, pending: null });
  });

  it("refuses a malformed person id, writing nothing", async () => {
    const recorded = await recordAuthenticatorSetUp(bootstrap, door(), {
      personId: "not-a-person-id",
      sessionId: "a-session",
      at: AT,
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
        passkeys: 0,
        authenticator: "none",
        recoveryCodes: undefined,
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

    expect(read).toEqual({
      ok: true,
      value: {
        mustHoldOne: true,
        passkeys: 1,
        authenticator: "set-up",
        recoveryCodes: { unused: 2, madeAt: "2026-10-02T12:00:00.000Z" },
      },
    });
  });

  it("answers a setup that waits on its code", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: false });

    const read = await readSecondFactor(bootstrap, door(), { personId });

    expect(read).toMatchObject({ ok: true, value: { authenticator: "awaiting-code" } });
  });

  it("refuses a person nobody holds", async () => {
    const read = await readSecondFactor(bootstrap, door(), {
      personId: "01J00000000000000000000000",
    });

    expect(read).toEqual({ ok: false, error: "person-gone" });
  });
});
