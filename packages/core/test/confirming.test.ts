import { createHash } from "node:crypto";

import pg from "pg";
import { describe, expect, it } from "vitest";

import { CeilingMet } from "../src/kernel/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import {
  acceptRestoreCode,
  confirmByAuthenticator,
  confirmByPasskey,
  parkAuthenticatorSecret,
  readParkedAuthenticatorSecret,
  readSecondFactor,
  removePasskey,
  replaceFactorsByAuthenticator,
  replaceFactorsByPasskey,
  replaceRecoveryCodes,
  reserveAuthenticatorTry,
  spendRecoveryCode,
} from "../src/workspaces/index.ts";
import { authenticatorFor, passkeyFor, restoreCodeFor } from "./identity-rows.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import { AT, secondFactorSuite } from "./second-factor-suite.ts";
import { addressOf, countWaitingOnLocks, until, whileActsWaitAt } from "./suite-postgres.ts";

const { db, door, aSession, identitySetRowsFor, confirmedAt, recoveryCodesHeldBy } =
  secondFactorSuite();

const after = (seconds: number): Date => new Date(AT.getTime() + seconds * 1000);

const UNCONFIRMED = { confirmed: null, pending: null };

const NOBODY = "01J00000000000000000000000";

const WRONG_CODE = "0000-0000-0000-0000";

const RESTORE_CODE = "7k3m-9pqr-x2v4-h8tw";

/** The SHA-256 of the restore code as typed bare: lower case, no spaces, no dashes. */
const RESTORE_HASH = createHash("sha256").update("7k3m9pqrx2v4h8tw").digest("hex");

const actsOn = async (personId: string) =>
  (await identitySetRowsFor(personId)).map((row) => row.act);

const passkeyRowOf = async (passkeyId: string) =>
  (
    await db().pool.query<{ credential: string; counter: number }>(
      "SELECT credential_id AS credential, counter::int AS counter FROM passkey WHERE id = $1",
      [passkeyId],
    )
  ).rows[0] ?? { credential: "", counter: -1 };

const grantOf = async (sessionId: string) =>
  (
    await db().pool.query<{ granted: Date | null }>(
      "SELECT setup_granted_at AS granted FROM session WHERE id = $1",
      [sessionId],
    )
  ).rows[0]?.granted;

/** The operator's restore as the person's row holds it, with no code written. */
const markedRestored = async (personId: string, at: Date) => {
  await db().pool.query('UPDATE "user" SET restore_required_at = $2 WHERE id = $1', [personId, at]);
};

const failuresOf = async (personId: string) =>
  (
    await db().pool.query<{ kind: string; failures: number }>(
      "SELECT kind, failures FROM second_factor_throttle WHERE user_id = $1 ORDER BY kind",
      [personId],
    )
  ).rows;

const factorsOf = async (personId: string) =>
  (
    await db().pool.query(
      `SELECT (SELECT array_agg(p.id ORDER BY p.id) FROM passkey p WHERE p.user_id = u.id) AS passkeys,
              a.secret, a.verified, u.authenticator_enabled AS enabled,
              u.restore_required_at IS NOT NULL AS "restoreRequired"
         FROM "user" u LEFT JOIN authenticator a ON a.user_id = u.id WHERE u.id = $1`,
      [personId],
    )
  ).rows[0];

const tenCodesFor = async (personId: string): Promise<readonly string[]> => {
  const made = await replaceRecoveryCodes(bootstrap, door(), {
    personId,
    replacing: true,
    now: AT,
  });
  return made.ok ? made.value.recoveryCodes : [];
};

const spending = (personId: string, sessionId: string, code: string, now = AT) =>
  spendRecoveryCode(bootstrap, door(), { personId, sessionId, code, now });

const confirmingByPasskey = async (personId: string, sessionId: string, passkeyId: string) =>
  confirmByPasskey(bootstrap, door(), {
    personId,
    sessionId,
    credentialId: (await passkeyRowOf(passkeyId)).credential,
    counter: 7,
    now: AT,
  });

/** A session that spent one of the person's ten codes; the nine left come back with it. */
const aGrantedSession = async (personId: string) => {
  const [spent = "", ...left] = await tenCodesFor(personId);
  const sessionId = await aSession(personId);
  expect(await spending(personId, sessionId, spent)).toMatchObject({
    ok: true,
    value: { granted: true },
  });
  return { sessionId, left };
};

/** An Admin holding a passkey and an authenticator, with a session granted their replacement. */
const anAdminRecovering = async () => {
  const { adminUserId: personId } = await provisionedWorkspace(db(), "Acme");
  await passkeyFor(db().pool, personId);
  await authenticatorFor(db().pool, personId, { verified: true });
  return { personId, ...(await aGrantedSession(personId)) };
};

const reserving = (personId: string, now = AT, at = door()) =>
  reserveAuthenticatorTry(bootstrap, at, { personId, now });

const failingTimes = async (personId: string, times: number, now = AT) => {
  const answers = [];
  for (let failure = 0; failure < times; failure += 1) {
    answers.push(await reserving(personId, now));
  }
  return answers;
};

const aRestoredPerson = async (expiresAt = after(24 * 3600)) => {
  const email = addressOf("priya");
  const personId = await seedPerson(db().pool, { email, restoreRequiredAt: AT });
  await restoreCodeFor(db().pool, email, { hash: RESTORE_HASH, expiresAt });
  return { personId, sessionId: await aSession(personId) };
};

const accepting = (personId: string, sessionId: string, code: string) =>
  acceptRestoreCode(bootstrap, door(), { personId, sessionId, code, now: AT });

const waitsAt = async (personId: string, now: Date) => {
  const read = await readSecondFactor(bootstrap, door(), { personId, now });
  return read.ok ? read.value.waits : undefined;
};

describe("confirming by passkey", () => {
  it("stamps the existing session and creates no other", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);
    const sessionId = await aSession(personId);

    const confirmed = await confirmingByPasskey(personId, sessionId, passkeyId);

    expect(confirmed).toEqual({ ok: true, value: undefined });
    expect(await confirmedAt(sessionId)).toEqual({ confirmed: AT, pending: null });
    expect((await passkeyRowOf(passkeyId)).counter).toBe(7);
    const sessions = await db().pool.query("SELECT id FROM session WHERE user_id = $1", [personId]);
    expect(sessions.rows).toEqual([{ id: sessionId }]);
    expect(await identitySetRowsFor(personId)).toEqual([
      { act: "people.person.second_factor_confirmed", detail: { method: "passkey" } },
    ]);
  });

  it("refuses another person's credential, stamping nothing", async () => {
    const personId = await seedPerson(db().pool);
    const sessionId = await aSession(personId);
    const strangersPasskey = await passkeyFor(db().pool, await seedPerson(db().pool));

    const confirmed = await confirmingByPasskey(personId, sessionId, strangersPasskey);

    expect(confirmed).toEqual({ ok: false, error: "passkey-not-yours" });
    expect(await confirmedAt(sessionId)).toEqual(UNCONFIRMED);
    expect((await passkeyRowOf(strangersPasskey)).counter).toBe(0);
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("refuses a session the person does not hold", async () => {
    const strangersSession = await aSession(await seedPerson(db().pool));
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);

    const confirmed = await confirmingByPasskey(personId, strangersSession, passkeyId);

    expect(confirmed).toEqual({ ok: false, error: "session-gone" });
    expect(await confirmedAt(strangersSession)).toEqual(UNCONFIRMED);
    expect((await passkeyRowOf(passkeyId)).counter).toBe(0);
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("stamps nothing when the passkey's removal wins the race", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);
    const sessionId = await aSession(personId);

    const confirmed = await whileActsWaitAt(
      db().pool,
      "identity_audit_event",
      "INSERT",
      async (release) => {
        const removed = removePasskey(bootstrap, door(), { personId, passkeyId });
        await until(async () => (await countWaitingOnLocks(db().pool)) === 1);
        const confirming = confirmingByPasskey(personId, sessionId, passkeyId);
        await until(async () => (await countWaitingOnLocks(db().pool)) === 2);
        await release();
        expect(await removed).toEqual({ ok: true, value: { passkeyId } });
        return confirming;
      },
    );

    expect(confirmed).toEqual({ ok: false, error: "passkey-not-yours" });
    expect(await confirmedAt(sessionId)).toEqual(UNCONFIRMED);
    expect(await actsOn(personId)).toEqual(["people.person.passkey_removed"]);
  });
});

describe("confirming by authenticator", () => {
  it("stamps the session and clears the failures counted", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: true });
    const sessionId = await aSession(personId);
    await failingTimes(personId, 3);

    const confirmed = await confirmByAuthenticator(bootstrap, door(), {
      personId,
      sessionId,
      now: AT,
    });

    expect(confirmed).toEqual({ ok: true, value: undefined });
    expect(await confirmedAt(sessionId)).toEqual({ confirmed: AT, pending: null });
    expect(await failuresOf(personId)).toEqual([]);
    expect(await identitySetRowsFor(personId)).toEqual([
      { act: "people.person.second_factor_confirmed", detail: { method: "authenticator" } },
    ]);
  });

  it("refuses while the setup still waits on its code", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: false });
    const sessionId = await aSession(personId);

    const confirmed = await confirmByAuthenticator(bootstrap, door(), {
      personId,
      sessionId,
      now: AT,
    });

    expect(confirmed).toEqual({ ok: false, error: "no-authenticator" });
    expect(await confirmedAt(sessionId)).toEqual(UNCONFIRMED);
  });

  it("refuses a person nobody holds, before their session", async () => {
    const sessionId = await aSession(await seedPerson(db().pool));

    const confirmed = await confirmByAuthenticator(bootstrap, door(), {
      personId: NOBODY,
      sessionId,
      now: AT,
    });

    expect(confirmed).toEqual({ ok: false, error: "person-gone" });
  });
});

describe("the authenticator's failures", () => {
  it("cost nothing five times, then double up to fifteen minutes", async () => {
    const personId = await seedPerson(db().pool);
    const waits: number[] = [];
    let now = AT;
    for (let failure = 0; failure < 12; failure += 1) {
      const [counted] = await failingTimes(personId, 1, now);
      const waitSeconds = counted?.ok === true ? counted.value.waitSeconds : -1;
      waits.push(waitSeconds);
      now = new Date(now.getTime() + waitSeconds * 1000);
    }

    expect(waits).toEqual([0, 0, 0, 0, 0, 30, 60, 120, 240, 480, 900, 900]);
  });

  it("answer the wait left, and none once it passes", async () => {
    const personId = await seedPerson(db().pool);
    await failingTimes(personId, 6);

    const waits = await Promise.all([after(10), after(30)].map((now) => waitsAt(personId, now)));

    expect(waits).toEqual([
      { authenticator: 20, "recovery-code": 0, "restore-code": 0 },
      { authenticator: 0, "recovery-code": 0, "restore-code": 0 },
    ]);
  });

  it("cost an attempt stamped before them no wait", async () => {
    const personId = await seedPerson(db().pool);
    await failingTimes(personId, 5, after(1));

    // Of two attempts at once, the one stamped first can read the other's failure.
    const reserved = await reserving(personId, AT);

    expect(reserved).toEqual({ ok: true, value: { waitSeconds: 30, noticeDue: false } });
  });

  it("pass one of four tries sent at once", async () => {
    const personId = await seedPerson(db().pool);
    await failingTimes(personId, 5);

    const tries = await Promise.all([1, 2, 3, 4].map(() => reserving(personId)));

    expect(tries.filter((tried) => tried.ok)).toEqual([
      { ok: true, value: { waitSeconds: 30, noticeDue: false } },
    ]);
    expect(tries.filter((tried) => !tried.ok)).toEqual(
      [1, 2, 3].map(() => ({ ok: false, error: new CeilingMet(30) })),
    );
    expect(await failuresOf(personId)).toEqual([{ kind: "authenticator", failures: 6 }]);
  });

  it("make one notice due, and another only after a confirm", async () => {
    const personId = await seedPerson(db().pool);
    await authenticatorFor(db().pool, personId, { verified: true });
    const noticesDue = async (times: number) =>
      (await failingTimes(personId, times)).map((counted) => counted.ok && counted.value.noticeDue);

    const first = await noticesDue(7);
    await confirmByAuthenticator(bootstrap, door(), {
      personId,
      sessionId: await aSession(personId),
      now: AT,
    });
    const second = await noticesDue(5);

    expect(first).toEqual([false, false, false, false, true, false, false]);
    expect(second).toEqual([false, false, false, false, true]);
  });

  it("leave a recovery code and a passkey working meanwhile", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);
    await failingTimes(personId, 6);
    const [code = ""] = await tenCodesFor(personId);

    const spent = await spending(personId, await aSession(personId), code, after(1));
    const confirmed = await confirmingByPasskey(personId, await aSession(personId), passkeyId);

    expect(spent).toMatchObject({ ok: true, value: { granted: true } });
    expect(confirmed).toEqual({ ok: true, value: undefined });
  });
});

describe("reserving an authenticator try", () => {
  it("refuses a malformed person id", async () => {
    expect(await reserving("not-an-id")).toEqual({ ok: false, error: "malformed" });
  });

  it("counts nothing for a person nobody holds", async () => {
    expect(await reserving(NOBODY)).toEqual({ ok: false, error: "person-gone" });
    expect(await failuresOf(NOBODY)).toEqual([]);
  });

  it("answers the store's failure, not a wait", async () => {
    const personId = await seedPerson(db().pool);
    const gone = new pg.Pool(db().runtimePool.options);
    await gone.end();

    expect(await reserving(personId, AT, openPostgres(gone))).toEqual({
      ok: false,
      error: expect.any(Error),
    });
  });
});

describe("spending a recovery code", () => {
  it("grants only the spending session, leaving it unconfirmed", async () => {
    const personId = await seedPerson(db().pool);
    const [code = ""] = await tenCodesFor(personId);
    const spender = await aSession(personId);
    const other = await aSession(personId);

    const spent = await spending(personId, spender, code);

    expect(spent).toEqual({ ok: true, value: { granted: true, unused: 9 } });
    expect([await grantOf(spender), await grantOf(other)]).toEqual([AT, null]);
    expect(await confirmedAt(spender)).toEqual(UNCONFIRMED);
    expect(await actsOn(personId)).toEqual([
      "people.person.recovery_codes_issued",
      "people.person.recovery_code_used",
    ]);
  });

  it("counts a wrong code, then refuses even a right one", async () => {
    const personId = await seedPerson(db().pool);
    const [code = ""] = await tenCodesFor(personId);
    const sessionId = await aSession(personId);
    const answers = [];
    for (let failure = 0; failure < 6; failure += 1) {
      answers.push(await spending(personId, sessionId, WRONG_CODE));
    }

    const waited = await spending(personId, sessionId, code, after(10));

    expect(answers.slice(4)).toEqual([
      {
        ok: true,
        value: { granted: false, refusal: "recovery-code-wrong", waitSeconds: 0, noticeDue: true },
      },
      {
        ok: true,
        value: {
          granted: false,
          refusal: "recovery-code-wrong",
          waitSeconds: 30,
          noticeDue: false,
        },
      },
    ]);
    expect(waited).toEqual({ ok: false, error: new CeilingMet(20) });
    expect(!waited.ok && waited.error instanceof CeilingMet && waited.error.retryAfterSeconds).toBe(
      20,
    );
    expect(await recoveryCodesHeldBy(personId)).toBe(10);
    expect(await grantOf(sessionId)).toBeNull();
  });

  it("counts its failures apart from the authenticator's", async () => {
    const personId = await seedPerson(db().pool);
    await failingTimes(personId, 5);
    await tenCodesFor(personId);

    const wrong = await spending(personId, await aSession(personId), WRONG_CODE);

    expect(wrong).toEqual({
      ok: true,
      value: { granted: false, refusal: "recovery-code-wrong", waitSeconds: 0, noticeDue: false },
    });
    expect(await failuresOf(personId)).toEqual([
      { kind: "authenticator", failures: 5 },
      { kind: "recovery-code", failures: 1 },
    ]);
  });

  it("forgets only its own failures when the right code works", async () => {
    const personId = await seedPerson(db().pool);
    await failingTimes(personId, 2);
    const [code = ""] = await tenCodesFor(personId);
    const sessionId = await aSession(personId);
    await spending(personId, sessionId, WRONG_CODE);

    await spending(personId, sessionId, code);

    expect(await failuresOf(personId)).toEqual([{ kind: "authenticator", failures: 2 }]);
  });

  it("refuses a restored person, spending and counting nothing", async () => {
    const personId = await seedPerson(db().pool);
    const [code = ""] = await tenCodesFor(personId);
    await markedRestored(personId, AT);
    const sessionId = await aSession(personId);

    const answers = [
      await spending(personId, sessionId, code),
      await spending(personId, sessionId, WRONG_CODE),
    ];

    expect(answers).toEqual([
      { ok: false, error: "restore-code-needed" },
      { ok: false, error: "restore-code-needed" },
    ]);
    expect(await recoveryCodesHeldBy(personId)).toBe(10);
    expect(await grantOf(sessionId)).toBeNull();
    expect(await failuresOf(personId)).toEqual([]);
  });

  it("refuses a session the person does not hold, spending nothing", async () => {
    const personId = await seedPerson(db().pool);
    const [code = ""] = await tenCodesFor(personId);
    const strangersSession = await aSession(await seedPerson(db().pool));

    const spent = await spending(personId, strangersSession, code);

    expect(spent).toEqual({ ok: false, error: "session-gone" });
    expect(await recoveryCodesHeldBy(personId)).toBe(10);
    expect(await grantOf(strangersSession)).toBeNull();
  });

  it("leaves the old factors and codes when setup is abandoned", async () => {
    const { personId } = await anAdminRecovering();

    const read = await readSecondFactor(bootstrap, door(), { personId });

    expect(read).toMatchObject({
      ok: true,
      value: { authenticator: "set-up", recoveryCodes: { unused: 9 } },
    });
    expect(read.ok && read.value.passkeys).toHaveLength(1);
  });
});

describe("replacing the factors", () => {
  it("keeps the new passkey alone and issues ten fresh codes", async () => {
    const { personId, sessionId, left } = await anAdminRecovering();
    const keptPasskeyId = await passkeyFor(db().pool, personId);

    const replaced = await replaceFactorsByPasskey(bootstrap, door(), {
      personId,
      sessionId,
      keptPasskeyId,
      now: after(60),
    });

    expect(replaced).toMatchObject({
      ok: true,
      value: { issued: { madeAt: "2026-10-02T12:01:00.000Z" } },
    });
    expect(replaced.ok && replaced.value.issued.recoveryCodes).toHaveLength(10);
    expect(await factorsOf(personId)).toEqual({
      passkeys: [keptPasskeyId],
      secret: null,
      verified: null,
      enabled: false,
      restoreRequired: false,
    });
    expect(await grantOf(sessionId)).toBeNull();
    expect(await confirmedAt(sessionId)).toEqual({ confirmed: after(60), pending: null });
    expect((await identitySetRowsFor(personId)).slice(-2)).toEqual([
      { act: "people.person.recovery_codes_issued", detail: { replaced: true } },
      { act: "people.person.factors_replaced", detail: { by: "passkey" } },
    ]);
    expect(await spending(personId, sessionId, left[0] ?? "")).toMatchObject({
      ok: true,
      value: { granted: false },
    });
  });

  it("installs the parked authenticator secret, removing every passkey", async () => {
    const { personId, sessionId } = await anAdminRecovering();
    const encryptedSecret = "sealed-new-secret";
    const parked = await parkAuthenticatorSecret(bootstrap, door(), {
      personId,
      sessionId,
      encryptedSecret,
      now: AT,
    });
    const read = await readParkedAuthenticatorSecret(bootstrap, door(), {
      sessionId,
      now: after(60),
    });

    const replaced = await replaceFactorsByAuthenticator(bootstrap, door(), {
      personId,
      sessionId,
      encryptedSecret,
      now: after(60),
    });

    expect([parked, read]).toEqual([
      { ok: true, value: undefined },
      { ok: true, value: encryptedSecret },
    ]);
    expect(replaced.ok && replaced.value.issued.recoveryCodes).toHaveLength(10);
    expect(await factorsOf(personId)).toEqual({
      passkeys: null,
      secret: encryptedSecret,
      verified: true,
      enabled: true,
      restoreRequired: false,
    });
    expect(
      await readParkedAuthenticatorSecret(bootstrap, door(), { sessionId, now: after(60) }),
    ).toEqual({ ok: true, value: undefined });
    expect((await identitySetRowsFor(personId)).at(-1)).toEqual({
      act: "people.person.factors_replaced",
      detail: { by: "authenticator" },
    });
  });

  it("parks one secret a session, for ten minutes", async () => {
    const { personId, sessionId } = await anAdminRecovering();
    for (const encryptedSecret of ["sealed-first", "sealed-second"]) {
      await parkAuthenticatorSecret(bootstrap, door(), {
        personId,
        sessionId,
        encryptedSecret,
        now: AT,
      });
    }

    const reads = await Promise.all(
      [after(599), after(600)].map((now) =>
        readParkedAuthenticatorSecret(bootstrap, door(), { sessionId, now }),
      ),
    );

    expect(reads).toEqual([
      { ok: true, value: "sealed-second" },
      { ok: true, value: undefined },
    ]);
  });

  it("refuses a secret other than the one parked", async () => {
    const { personId, sessionId } = await anAdminRecovering();
    await parkAuthenticatorSecret(bootstrap, door(), {
      personId,
      sessionId,
      encryptedSecret: "sealed-parked",
      now: AT,
    });

    const replaced = await replaceFactorsByAuthenticator(bootstrap, door(), {
      personId,
      sessionId,
      encryptedSecret: "sealed-elsewhere",
      now: AT,
    });

    expect(replaced).toEqual({ ok: false, error: "changed-meanwhile" });
    expect(await factorsOf(personId)).toMatchObject({ secret: "sealed-secret", enabled: true });
    expect(await grantOf(sessionId)).toEqual(AT);
  });

  it("refuses a session without the grant, changing nothing", async () => {
    const { personId } = await anAdminRecovering();
    const sessionId = await aSession(personId);
    const keptPasskeyId = await passkeyFor(db().pool, personId);
    const before = await factorsOf(personId);

    const replaced = await replaceFactorsByPasskey(bootstrap, door(), {
      personId,
      sessionId,
      keptPasskeyId,
      now: AT,
    });
    const parked = await parkAuthenticatorSecret(bootstrap, door(), {
      personId,
      sessionId,
      encryptedSecret: "sealed-new-secret",
      now: AT,
    });

    expect([replaced, parked]).toEqual([
      { ok: false, error: "setup-not-granted" },
      { ok: false, error: "setup-not-granted" },
    ]);
    expect(await factorsOf(personId)).toEqual(before);
    expect(await confirmedAt(sessionId)).toEqual(UNCONFIRMED);
  });

  it("refuses a grant older than the operator's restore", async () => {
    const { personId, sessionId } = await anAdminRecovering();
    await markedRestored(personId, after(60));
    const keptPasskeyId = await passkeyFor(db().pool, personId);
    const asked = { personId, sessionId, now: after(60) };

    const read = await readSecondFactor(bootstrap, door(), asked);
    const replaced = await replaceFactorsByPasskey(bootstrap, door(), { ...asked, keptPasskeyId });
    const parked = await parkAuthenticatorSecret(bootstrap, door(), {
      ...asked,
      encryptedSecret: "sealed-new-secret",
    });

    expect(read).toMatchObject({
      ok: true,
      value: { restoreRequired: true, thisSession: { confirmed: false, setupGranted: false } },
    });
    expect([replaced, parked]).toEqual([
      { ok: false, error: "setup-not-granted" },
      { ok: false, error: "setup-not-granted" },
    ]);
    expect(await factorsOf(personId)).toMatchObject({
      secret: "sealed-secret",
      restoreRequired: true,
    });
    expect(
      await readParkedAuthenticatorSecret(bootstrap, door(), { sessionId, now: after(60) }),
    ).toEqual({ ok: true, value: undefined });
  });

  it("refuses to keep a passkey the person does not hold", async () => {
    const { personId, sessionId } = await anAdminRecovering();
    const strangersPasskey = await passkeyFor(db().pool, await seedPerson(db().pool));

    const replaced = await replaceFactorsByPasskey(bootstrap, door(), {
      personId,
      sessionId,
      keptPasskeyId: strangersPasskey,
      now: AT,
    });

    expect(replaced).toEqual({ ok: false, error: "no-passkey" });
    expect(await grantOf(sessionId)).toEqual(AT);
  });

  it("refuses to park under another person's session", async () => {
    const personId = await seedPerson(db().pool);
    const strangersSession = await aSession(await seedPerson(db().pool));

    const parked = await parkAuthenticatorSecret(bootstrap, door(), {
      personId,
      sessionId: strangersSession,
      encryptedSecret: "sealed-new-secret",
      now: AT,
    });

    expect(parked).toEqual({ ok: false, error: "session-gone" });
  });

  it("forgets a parked secret once a passkey replaces them", async () => {
    const { personId, sessionId } = await anAdminRecovering();
    const asked = { personId, sessionId, now: AT };
    await parkAuthenticatorSecret(bootstrap, door(), {
      ...asked,
      encryptedSecret: "sealed-unused",
    });

    await replaceFactorsByPasskey(bootstrap, door(), {
      ...asked,
      keptPasskeyId: await passkeyFor(db().pool, personId),
    });

    expect(await readParkedAuthenticatorSecret(bootstrap, door(), asked)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

describe("accepting a restore code", () => {
  it("grants the session once for the right code", async () => {
    const { personId, sessionId } = await aRestoredPerson();

    const accepted = await accepting(personId, sessionId, " 7K3M 9PQR-x2v4-H8TW ");
    const again = await accepting(personId, await aSession(personId), RESTORE_CODE);

    expect(accepted).toEqual({ ok: true, value: { granted: true } });
    expect(again).toMatchObject({ ok: true, value: { granted: false } });
    expect(await grantOf(sessionId)).toEqual(AT);
    expect(await identitySetRowsFor(personId)).toEqual([
      { act: "people.person.restore_code_accepted", detail: {} },
    ]);
  });

  it("adds nothing for a wrong or an expired code", async () => {
    const { personId, sessionId } = await aRestoredPerson(after(-1));

    const answers = [
      await accepting(personId, sessionId, WRONG_CODE),
      await accepting(personId, sessionId, RESTORE_CODE),
    ];

    expect(answers).toEqual([
      {
        ok: true,
        value: { granted: false, refusal: "restore-code-wrong", waitSeconds: 0, noticeDue: false },
      },
      {
        ok: true,
        value: { granted: false, refusal: "restore-code-wrong", waitSeconds: 0, noticeDue: false },
      },
    ]);
    expect(await grantOf(sessionId)).toBeNull();
    expect(await failuresOf(personId)).toEqual([{ kind: "restore-code", failures: 2 }]);
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("waits after six wrong codes, refusing even the right one", async () => {
    const { personId, sessionId } = await aRestoredPerson();
    for (let failure = 0; failure < 6; failure += 1) {
      await accepting(personId, sessionId, WRONG_CODE);
    }

    const waited = await accepting(personId, sessionId, RESTORE_CODE);

    expect(waited).toEqual({ ok: false, error: new CeilingMet(30) });
    expect(await grantOf(sessionId)).toBeNull();
  });

  it("refuses another person's session, keeping the code", async () => {
    const { personId, sessionId } = await aRestoredPerson();
    const strangersSession = await aSession(await seedPerson(db().pool));

    const refused = await accepting(personId, strangersSession, RESTORE_CODE);
    const accepted = await accepting(personId, sessionId, RESTORE_CODE);

    expect([refused, accepted]).toEqual([
      { ok: false, error: "session-gone" },
      { ok: true, value: { granted: true } },
    ]);
  });

  it("takes no code once no restore is required", async () => {
    const email = addressOf("priya");
    const personId = await seedPerson(db().pool, { email });
    await restoreCodeFor(db().pool, email, { hash: RESTORE_HASH, expiresAt: after(60) });
    const sessionId = await aSession(personId);

    const accepted = await accepting(personId, sessionId, RESTORE_CODE);

    expect(accepted).toMatchObject({ ok: true, value: { granted: false } });
    expect(await grantOf(sessionId)).toBeNull();
  });

  it("lets a restored person set up a first factor", async () => {
    const { personId, sessionId } = await aRestoredPerson();
    await accepting(personId, sessionId, RESTORE_CODE);
    const keptPasskeyId = await passkeyFor(db().pool, personId);

    const replaced = await replaceFactorsByPasskey(bootstrap, door(), {
      personId,
      sessionId,
      keptPasskeyId,
      now: AT,
    });

    expect(replaced).toMatchObject({ ok: true });
    expect(await factorsOf(personId)).toMatchObject({
      passkeys: [keptPasskeyId],
      restoreRequired: false,
    });
    expect(await grantOf(sessionId)).toBeNull();
  });
});

describe("reading a person's second factor for a session", () => {
  it("answers the restore marker, the waits and this session", async () => {
    const { personId, sessionId } = await aRestoredPerson();
    await failingTimes(personId, 6);

    const read = await readSecondFactor(bootstrap, door(), { personId, sessionId, now: after(10) });

    expect(read).toMatchObject({
      ok: true,
      value: {
        codesAcknowledged: false,
        restoreRequired: true,
        waits: { authenticator: 20, "recovery-code": 0, "restore-code": 0 },
        thisSession: { confirmed: false, setupGranted: false },
      },
    });
  });

  it("answers a granted session that is not yet confirmed", async () => {
    const personId = await seedPerson(db().pool);
    const { sessionId } = await aGrantedSession(personId);

    const read = await readSecondFactor(bootstrap, door(), { personId, sessionId, now: AT });

    expect(read).toMatchObject({
      ok: true,
      value: { thisSession: { confirmed: false, setupGranted: true } },
    });
  });
});
