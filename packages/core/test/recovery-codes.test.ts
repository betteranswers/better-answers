import { describe, expect, it } from "vitest";

import { openPostgres } from "../src/store/postgres/index.ts";
import {
  acknowledgeRecoveryCodes,
  replaceRecoveryCodes,
  spendRecoveryCode,
} from "../src/workspaces/index.ts";
import { bootstrap, seedPerson } from "./platform.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

const door = () => openPostgres(db().runtimePool);

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const codesFor = async (personId: string): Promise<readonly string[]> => {
  const issued = await replaceRecoveryCodes(bootstrap, door(), { personId });
  if (!issued.ok) throw new Error(`no codes were issued: ${String(issued.error)}`);
  return issued.value.recoveryCodes;
};

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

    const later = await codesFor(personId);

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

  it("asks for the new set to be saved again", async () => {
    const personId = await seedPerson(db().pool);
    await codesFor(personId);
    await acknowledgeRecoveryCodes(bootstrap, door(), { personId });

    await codesFor(personId);

    expect(await acknowledged(personId)).toBe(false);
  });

  it("refuses a person nobody holds", async () => {
    const replaced = await replaceRecoveryCodes(bootstrap, door(), {
      personId: "01J00000000000000000000000",
    });

    expect(replaced).toEqual({ ok: false, error: "person-gone" });
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
  it("records that the person saved the set", async () => {
    const personId = await seedPerson(db().pool);
    await codesFor(personId);

    const answered = await acknowledgeRecoveryCodes(bootstrap, door(), { personId });

    expect(answered).toEqual({ ok: true, value: undefined });
    expect(await acknowledged(personId)).toBe(true);
  });
});
