import { describe, expect, it } from "vitest";

import { PASSKEY_NAME_MAX_LENGTH } from "@better-answers/schema/second-factor";

import {
  dismissPasskeyOffer,
  readSecondFactor,
  recordPasskeyAdded,
  recordPasskeyUse,
  removePasskey,
  renamePasskey,
} from "../src/workspaces/index.ts";
import { authenticatorFor, passkeyFor, recoveryCodeFor } from "./identity-rows.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import { AT, ITS_OWN_AGE, secondFactorSuite } from "./second-factor-suite.ts";

const { db, door, aSession, identitySetRowsFor, recoveryCodesHeldBy, ...reads } =
  secondFactorSuite();

const LATER = new Date("2026-10-03T09:41:00.000Z");

const confirmedAt = async (sessionId: string) => (await reads.confirmedAt(sessionId))?.confirmed;

/** A person, and a passkey somebody else holds. */
const aStrangersPasskey = async () => {
  const personId = await seedPerson(db().pool);
  const strangerId = await seedPerson(db().pool);
  return { personId, strangerId, strangersPasskey: await passkeyFor(db().pool, strangerId) };
};

const passkeysHeldBy = async (personId: string) =>
  (
    await db().pool.query<{ id: string; name: string | null }>(
      "SELECT id, name FROM passkey WHERE user_id = $1 ORDER BY id",
      [personId],
    )
  ).rows;

const lastUseOf = async (passkeyId: string) =>
  (
    await db().pool.query<{ at: Date }>("SELECT at FROM passkey_last_use WHERE passkey_id = $1", [
      passkeyId,
    ])
  ).rows[0]?.at;

const credentialOf = async (passkeyId: string) =>
  (
    await db().pool.query<{ credential: string }>(
      "SELECT credential_id AS credential FROM passkey WHERE id = $1",
      [passkeyId],
    )
  ).rows[0]?.credential ?? "";

const added = async (personId: string, passkeyId: string, sessionId: string) =>
  recordPasskeyAdded(bootstrap, door(), {
    personId,
    passkeyId,
    sessionId,
    at: AT,
    carried: ITS_OWN_AGE,
  });

describe("recording a passkey added", () => {
  it("records it by id and confirms the adding session", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);
    const sessionId = await aSession(personId);

    const recorded = await added(personId, passkeyId, sessionId);

    expect(recorded).toEqual({ ok: true, value: { passkeyId, stamped: true, issued: undefined } });
    expect(await confirmedAt(sessionId)).toEqual(AT);
    expect(await identitySetRowsFor(personId)).toEqual([
      { action: "people.person.passkey_added", detail: { passkeyId } },
    ]);
  });

  it("issues no codes to someone needing no factor", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);

    await added(personId, passkeyId, await aSession(personId));

    expect(await recoveryCodesHeldBy(personId)).toBe(0);
  });

  it("issues ten codes to an Admin who holds none", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const passkeyId = await passkeyFor(db().pool, adminUserId);

    const recorded = await added(adminUserId, passkeyId, await aSession(adminUserId));

    expect(recorded).toMatchObject({
      ok: true,
      value: { issued: { madeAt: "2026-10-02T12:00:00.000Z" } },
    });
    expect(recorded.ok && recorded.value.issued?.recoveryCodes).toHaveLength(10);
    expect(await recoveryCodesHeldBy(adminUserId)).toBe(10);
    expect((await identitySetRowsFor(adminUserId)).map((row) => row.action)).toEqual([
      "people.person.passkey_added",
      "people.person.recovery_codes_issued",
    ]);
  });

  it("issues ten codes to the operator who holds none", async () => {
    const operatorId = await seedPerson(db().pool, { operator: true });
    const passkeyId = await passkeyFor(db().pool, operatorId);

    const recorded = await added(operatorId, passkeyId, await aSession(operatorId));

    expect(recorded.ok && recorded.value.issued?.recoveryCodes).toHaveLength(10);
  });

  it("issues no codes to an Admin who holds some", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const passkeyId = await passkeyFor(db().pool, adminUserId);
    await recoveryCodeFor(db().pool, adminUserId, AT);

    const recorded = await added(adminUserId, passkeyId, await aSession(adminUserId));

    expect(recorded).toMatchObject({ ok: true, value: { issued: undefined } });
    expect(await recoveryCodesHeldBy(adminUserId)).toBe(1);
  });

  it("stamps no session another person holds", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);
    const strangersSession = await aSession(await seedPerson(db().pool));

    const recorded = await added(personId, passkeyId, strangersSession);

    expect(recorded).toMatchObject({ ok: true, value: { stamped: false } });
    expect(await confirmedAt(strangersSession)).toBeNull();
  });

  it("refuses a passkey another person holds, recording nothing", async () => {
    const personId = await seedPerson(db().pool);
    const strangersPasskey = await passkeyFor(db().pool, await seedPerson(db().pool));
    const sessionId = await aSession(personId);

    const recorded = await added(personId, strangersPasskey, sessionId);

    expect(recorded).toEqual({ ok: false, error: "no-passkey" });
    expect(await confirmedAt(sessionId)).toBeNull();
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("refuses a malformed id, writing nothing", async () => {
    const personId = await seedPerson(db().pool);

    expect(await added("not-a-person-id", await passkeyFor(db().pool, personId), "s")).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(await added(personId, "not-a-passkey-id", "s")).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});

describe("renaming a passkey", () => {
  it("stores the trimmed name, recording the passkey by id", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);

    const renamed = await renamePasskey(bootstrap, door(), {
      personId,
      passkeyId,
      name: "  Work laptop ",
    });

    expect(renamed).toEqual({ ok: true, value: { passkeyId, name: "Work laptop" } });
    expect(await passkeysHeldBy(personId)).toEqual([{ id: passkeyId, name: "Work laptop" }]);
    expect(await identitySetRowsFor(personId)).toEqual([
      { action: "people.person.passkey_renamed", detail: { passkeyId } },
    ]);
  });

  it.each([
    ["a blank name", "   ", "passkey-name-empty"],
    ["a name past the limit", "x".repeat(PASSKEY_NAME_MAX_LENGTH + 1), "passkey-name-too-long"],
    ["a name with a control character", "Work\u0007laptop", "malformed"],
    ["a name over two lines", "Work\nlaptop", "malformed"],
  ])("refuses %s, keeping its name", async (_case, name, refusal) => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);

    const renamed = await renamePasskey(bootstrap, door(), { personId, passkeyId, name });

    expect(renamed).toEqual({ ok: false, error: refusal });
    expect(await passkeysHeldBy(personId)).toEqual([{ id: passkeyId, name: "MacBook" }]);
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("takes a name exactly at the limit", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);
    const name = "é".repeat(PASSKEY_NAME_MAX_LENGTH);

    const renamed = await renamePasskey(bootstrap, door(), { personId, passkeyId, name });

    expect(renamed).toEqual({ ok: true, value: { passkeyId, name } });
  });

  it("refuses another person's passkey", async () => {
    const { personId, strangerId, strangersPasskey } = await aStrangersPasskey();

    const renamed = await renamePasskey(bootstrap, door(), {
      personId,
      passkeyId: strangersPasskey,
      name: "Mine now",
    });

    expect(renamed).toEqual({ ok: false, error: "no-passkey" });
    expect(await passkeysHeldBy(strangerId)).toEqual([{ id: strangersPasskey, name: "MacBook" }]);
  });
});

describe("removing a passkey", () => {
  it("lets someone needing no factor remove their only one", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);
    await recordPasskeyUse(bootstrap, door(), {
      credentialId: await credentialOf(passkeyId),
      at: AT,
    });

    const removed = await removePasskey(bootstrap, door(), { personId, passkeyId });

    expect(removed).toEqual({ ok: true, value: { passkeyId } });
    expect(await passkeysHeldBy(personId)).toEqual([]);
    expect(await lastUseOf(passkeyId)).toBeUndefined();
    expect(await identitySetRowsFor(personId)).toEqual([
      { action: "people.person.passkey_removed", detail: { passkeyId } },
    ]);
  });

  it.each([
    ["an Admin's", async () => (await provisionedWorkspace(db(), "Acme")).adminUserId],
    ["the operator's", () => seedPerson(db().pool, { operator: true })],
    [
      "a half-set-up Admin's",
      async () => {
        const { adminUserId } = await provisionedWorkspace(db(), "Acme");
        await authenticatorFor(db().pool, adminUserId, { verified: false });
        return adminUserId;
      },
    ],
  ])("refuses to remove %s last factor", async (_whose, someoneWhoMustHoldOne) => {
    const personId = await someoneWhoMustHoldOne();
    const passkeyId = await passkeyFor(db().pool, personId);

    const removed = await removePasskey(bootstrap, door(), { personId, passkeyId });

    expect(removed).toEqual({ ok: false, error: "last-second-factor" });
    expect(await passkeysHeldBy(personId)).toHaveLength(1);
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("lets an Admin with an authenticator remove their passkey", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    await authenticatorFor(db().pool, adminUserId, { verified: true });
    const passkeyId = await passkeyFor(db().pool, adminUserId);

    const removed = await removePasskey(bootstrap, door(), { personId: adminUserId, passkeyId });

    expect(removed).toEqual({ ok: true, value: { passkeyId } });
  });

  it("leaves an Admin one of two passkeys removed at once", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const passkeys = [
      await passkeyFor(db().pool, adminUserId),
      await passkeyFor(db().pool, adminUserId),
    ];

    const answers = await Promise.all(
      passkeys.map((passkeyId) =>
        removePasskey(bootstrap, door(), { personId: adminUserId, passkeyId }),
      ),
    );

    expect(answers.map((answer) => answer.ok).toSorted()).toEqual([false, true]);
    expect(answers.find((answer) => !answer.ok)).toEqual({
      ok: false,
      error: "last-second-factor",
    });
    expect(await passkeysHeldBy(adminUserId)).toHaveLength(1);
  });

  it("refuses another person's passkey", async () => {
    const { personId, strangerId, strangersPasskey } = await aStrangersPasskey();

    const removed = await removePasskey(bootstrap, door(), {
      personId,
      passkeyId: strangersPasskey,
    });

    expect(removed).toEqual({ ok: false, error: "no-passkey" });
    expect(await passkeysHeldBy(strangerId)).toHaveLength(1);
  });
});

describe("recording a passkey's use", () => {
  it("keeps the latest use of the passkey holding the credential", async () => {
    const personId = await seedPerson(db().pool);
    const passkeyId = await passkeyFor(db().pool, personId);
    const credentialId = await credentialOf(passkeyId);

    await recordPasskeyUse(bootstrap, door(), { credentialId, at: AT });
    await recordPasskeyUse(bootstrap, door(), { credentialId, at: LATER });

    expect(await lastUseOf(passkeyId)).toEqual(LATER);
  });

  it("writes nothing for a credential no passkey holds", async () => {
    const used = await recordPasskeyUse(bootstrap, door(), {
      credentialId: "no-such-credential",
      at: AT,
    });

    expect(used).toEqual({ ok: true, value: { recorded: false } });
  });
});

describe("dismissing the passkey offer", () => {
  it("keeps the first dismissal, which the second-factor read answers", async () => {
    const personId = await seedPerson(db().pool);

    const first = await dismissPasskeyOffer(bootstrap, door(), { personId, now: AT });
    const again = await dismissPasskeyOffer(bootstrap, door(), { personId, now: LATER });

    expect(first).toEqual({ ok: true, value: undefined });
    expect(again).toEqual({ ok: true, value: undefined });
    expect(
      (
        await db().pool.query<{ at: Date }>(
          'SELECT passkey_offer_dismissed_at AS at FROM "user" WHERE id = $1',
          [personId],
        )
      ).rows[0]?.at,
    ).toEqual(AT);
    expect(await readSecondFactor(bootstrap, door(), { personId })).toMatchObject({
      ok: true,
      value: { passkeyOfferDismissed: true },
    });
  });

  it("refuses a person nobody holds", async () => {
    const dismissed = await dismissPasskeyOffer(bootstrap, door(), {
      personId: "01J00000000000000000000000",
      now: AT,
    });

    expect(dismissed).toEqual({ ok: false, error: "person-gone" });
  });
});
