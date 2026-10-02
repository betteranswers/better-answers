import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { openPostgres } from "../src/store/postgres/index.ts";
import {
  acknowledgeRecoveryCodes,
  replaceRecoveryCodes,
  spendRecoveryCode,
} from "../src/workspaces/index.ts";
import { bootstrap, seedPerson } from "./platform.ts";
import { postgresForSuite, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForSuite();

const door = () => openPostgres(db().runtimePool);

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const MADE_AT = new Date("2026-10-02T12:00:00.000Z");

const MADE_EARLIER = new Date("2026-10-01T09:00:00.000Z");

const issuedTo = async (personId: string, replacing = false, now = MADE_AT) => {
  const issued = await replaceRecoveryCodes(bootstrap, door(), { personId, replacing, now });
  if (!issued.ok) throw new Error(`no codes were issued: ${String(issued.error)}`);
  return issued.value;
};

const codesFor = async (personId: string, replacing = false): Promise<readonly string[]> =>
  (await issuedTo(personId, replacing)).recoveryCodes;

const firstOf = (codes: readonly string[]): string => codes[0] ?? "";

const actsOn = async (personId: string) =>
  (
    await db().pool.query<{ act: string; detail: unknown }>(
      "SELECT act, detail FROM identity_audit_event WHERE subject_id = $1 ORDER BY at, id",
      [personId],
    )
  ).rows;

const acknowledged = async (personId: string) =>
  (
    await db().pool.query<{ acknowledged: boolean }>(
      'SELECT recovery_codes_acknowledged AS acknowledged FROM "user" WHERE id = $1',
      [personId],
    )
  ).rows[0]?.acknowledged;

describe("replacing recovery codes", () => {
  it("issues ten new codes and voids every earlier one", async () => {
    const personId = await seedPerson(db().pool);
    const earlier = await codesFor(personId);

    const later = await codesFor(personId, true);

    expect(later).toHaveLength(10);
    for (const code of later) expect(code).toMatch(RECOVERY_CODE);
    expect(later.filter((code) => earlier.includes(code))).toEqual([]);
    expect(
      await spendRecoveryCode(bootstrap, door(), { personId, code: firstOf(earlier) }),
    ).toEqual({ ok: false, error: "recovery-code-wrong" });
    expect(await actsOn(personId)).toEqual([
      { act: "people.person.recovery_codes_issued", detail: { replaced: false } },
      { act: "people.person.recovery_codes_issued", detail: { replaced: true } },
    ]);
  });

  it("stores each code hashed in lower case without its dashes", async () => {
    const personId = await seedPerson(db().pool);
    const codes = await codesFor(personId);

    const stored = await db().pool.query<{ hash: string }>(
      "SELECT code_hash AS hash FROM recovery_code WHERE user_id = $1",
      [personId],
    );

    expect(stored.rows.map((row) => row.hash).toSorted()).toEqual(
      codes
        .map((code) =>
          createHash("sha256").update(code.replaceAll("-", "").toLowerCase()).digest("hex"),
        )
        .toSorted(),
    );
  });

  it("answers the one instant its ten rows were made", async () => {
    const personId = await seedPerson(db().pool);

    const { madeAt } = await issuedTo(personId);

    const made = await db().pool.query<{ at: Date }>(
      "SELECT DISTINCT created_at AS at FROM recovery_code WHERE user_id = $1",
      [personId],
    );
    expect(madeAt).toBe("2026-10-02T12:00:00.000Z");
    expect(made.rows).toEqual([{ at: new Date("2026-10-02T12:00:00.000Z") }]);
  });

  it("asks for the new set to be saved again", async () => {
    const personId = await seedPerson(db().pool);
    const { madeAt } = await issuedTo(personId);
    await acknowledgeRecoveryCodes(bootstrap, door(), { personId, madeAt });

    await codesFor(personId, true);

    expect(await acknowledged(personId)).toBe(false);
  });

  it("refuses a first set while one is held, writing nothing", async () => {
    const personId = await seedPerson(db().pool);
    const held = await codesFor(personId);

    const again = await replaceRecoveryCodes(bootstrap, door(), {
      personId,
      replacing: false,
      now: MADE_AT,
    });

    expect(again).toEqual({ ok: false, error: "recovery-codes-held" });
    expect(await actsOn(personId)).toEqual([
      { act: "people.person.recovery_codes_issued", detail: { replaced: false } },
    ]);
    expect(await spendRecoveryCode(bootstrap, door(), { personId, code: firstOf(held) })).toEqual({
      ok: true,
      value: { unused: 9 },
    });
  });

  it("refuses a person nobody holds", async () => {
    const replaced = await replaceRecoveryCodes(bootstrap, door(), {
      personId: "01J00000000000000000000000",
      replacing: false,
      now: MADE_AT,
    });

    expect(replaced).toEqual({ ok: false, error: "person-gone" });
  });
});

describe("each recovery-code act", () => {
  it.each([
    [
      "replacing",
      () =>
        replaceRecoveryCodes(bootstrap, door(), {
          personId: "not-an-id",
          replacing: false,
          now: MADE_AT,
        }),
    ],
    [
      "spending",
      () => spendRecoveryCode(bootstrap, door(), { personId: "not-an-id", code: "abcd" }),
    ],
    [
      "acknowledging",
      () =>
        acknowledgeRecoveryCodes(bootstrap, door(), {
          personId: "not-an-id",
          madeAt: "2026-10-02T12:00:00.000Z",
        }),
    ],
  ])("refuses a malformed person id when %s", async (_act, asked) => {
    expect(await asked()).toEqual({ ok: false, error: "malformed" });
  });

  it("answers the store's failure when replacing", async () => {
    const personId = await seedPerson(db().pool);

    const answered = await whileWritesAreRefused(db().pool, "recovery_code", () =>
      replaceRecoveryCodes(bootstrap, door(), { personId, replacing: false, now: MADE_AT }),
    );

    expect(answered).toEqual({ ok: false, error: expect.any(Error) });
  });

  it("answers the store's failure when spending", async () => {
    const personId = await seedPerson(db().pool);
    const code = firstOf(await codesFor(personId));

    const answered = await whileWritesAreRefused(db().pool, "recovery_code", () =>
      spendRecoveryCode(bootstrap, door(), { personId, code }),
    );

    expect(answered).toEqual({ ok: false, error: expect.any(Error) });
  });

  it("answers the store's failure when acknowledging", async () => {
    const personId = await seedPerson(db().pool);
    const { madeAt } = await issuedTo(personId);

    const answered = await whileWritesAreRefused(db().pool, "user", () =>
      acknowledgeRecoveryCodes(bootstrap, door(), { personId, madeAt }),
    );

    expect(answered).toEqual({ ok: false, error: expect.any(Error) });
  });
});

describe("spending a recovery code", () => {
  it("works once, leaving nine", async () => {
    const personId = await seedPerson(db().pool);
    const code = firstOf(await codesFor(personId));

    const spent = await spendRecoveryCode(bootstrap, door(), { personId, code });
    const again = await spendRecoveryCode(bootstrap, door(), { personId, code });

    expect(spent).toEqual({ ok: true, value: { unused: 9 } });
    expect(again).toEqual({ ok: false, error: "recovery-code-wrong" });
    expect((await actsOn(personId)).map((row) => row.act)).toEqual([
      "people.person.recovery_codes_issued",
      "people.person.recovery_code_used",
    ]);
  });

  it("ignores spaces, dashes and letter case in a typed code", async () => {
    const personId = await seedPerson(db().pool);
    const code = firstOf(await codesFor(personId));
    const typed = ` ${code.replaceAll("-", " - ").toUpperCase()}\t`;

    const spent = await spendRecoveryCode(bootstrap, door(), { personId, code: typed });

    expect(spent).toEqual({ ok: true, value: { unused: 9 } });
  });

  it("lets one of two spends of the same code succeed", async () => {
    const personId = await seedPerson(db().pool);
    const code = firstOf(await codesFor(personId));

    const answers = await Promise.all([
      spendRecoveryCode(bootstrap, door(), { personId, code }),
      spendRecoveryCode(bootstrap, door(), { personId, code }),
    ]);

    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers).toContainEqual({ ok: false, error: "recovery-code-wrong" });
  });

  it("refuses another person's code, writing nothing", async () => {
    const personId = await seedPerson(db().pool);
    const strangersCode = firstOf(await codesFor(await seedPerson(db().pool)));
    await codesFor(personId);

    const spent = await spendRecoveryCode(bootstrap, door(), { personId, code: strangersCode });

    expect(spent).toEqual({ ok: false, error: "recovery-code-wrong" });
    expect((await actsOn(personId)).map((row) => row.act)).toEqual([
      "people.person.recovery_codes_issued",
    ]);
  });

  it.each([
    ["nothing", ""],
    ["a code one character short", "abcd-efgh-jkmn-pqr"],
    ["a letter outside the alphabet", "abcd-efgh-jkmn-pqru"],
  ])("refuses %s", async (_case, code) => {
    const personId = await seedPerson(db().pool);
    await codesFor(personId);

    const spent = await spendRecoveryCode(bootstrap, door(), { personId, code });

    expect(spent).toEqual({ ok: false, error: "recovery-code-wrong" });
  });
});

describe("acknowledging recovery codes", () => {
  it("refuses a person nobody holds", async () => {
    const answered = await acknowledgeRecoveryCodes(bootstrap, door(), {
      personId: "01J00000000000000000000000",
      madeAt: "2026-10-02T12:00:00.000Z",
    });

    expect(answered).toEqual({ ok: false, error: "person-gone" });
  });

  it("records that the person saved the set", async () => {
    const personId = await seedPerson(db().pool);
    const { madeAt } = await issuedTo(personId);

    const answered = await acknowledgeRecoveryCodes(bootstrap, door(), { personId, madeAt });

    expect(answered).toEqual({ ok: true, value: undefined });
    expect(await acknowledged(personId)).toBe(true);
  });

  it("refuses a set since replaced, marking nothing", async () => {
    const personId = await seedPerson(db().pool);
    await issuedTo(personId, false, MADE_EARLIER);
    await issuedTo(personId, true, MADE_AT);

    const answered = await acknowledgeRecoveryCodes(bootstrap, door(), {
      personId,
      madeAt: "2026-10-01T09:00:00.000Z",
    });

    expect(answered).toEqual({ ok: false, error: "changed-meanwhile" });
    expect(await acknowledged(personId)).toBe(false);
  });

  it("refuses a malformed instant, marking nothing", async () => {
    const personId = await seedPerson(db().pool);
    await codesFor(personId);

    const answered = await acknowledgeRecoveryCodes(bootstrap, door(), {
      personId,
      madeAt: "yesterday",
    });

    expect(answered).toEqual({ ok: false, error: "malformed" });
    expect(await acknowledged(personId)).toBe(false);
  });
});
