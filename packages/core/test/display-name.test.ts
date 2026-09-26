import { describe, expect, expectTypeOf, it } from "vitest";

import { ulid } from "@better-answers/schema";

import type { OperatorPrincipal, PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import {
  applyDisplayNameRule,
  correctDisplayName,
  setDisplayName,
} from "../src/workspaces/index.ts";
import { asANewOperator, bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import { postgresForSuite, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForSuite();

const HUNDRED = "a".repeat(100);

/** A code point past the Basic Multilingual Plane is two UTF-16 units and one character. */
const HUNDRED_ASTRAL = "𝐀".repeat(100);

describe("the display-name rule", () => {
  it.each([
    ["a name as it is typed", "Priya Shah", "Priya Shah"],
    ["the space around a name, trimmed", "  Priya Shah \t", "Priya Shah"],
    ["one character", "Ö", "Ö"],
    ["an apostrophe, a hyphen and an accent", "Siân O'Brien-Smith", "Siân O'Brien-Smith"],
    ["a script other than Latin", "李小龍", "李小龍"],
    ["a hundred characters", HUNDRED, HUNDRED],
    ["a hundred characters, once trimmed", `  ${HUNDRED}  `, HUNDRED],
    ["a hundred characters that are two UTF-16 units each", HUNDRED_ASTRAL, HUNDRED_ASTRAL],
  ])("takes %s", (_case, asked, taken) => {
    expect(applyDisplayNameRule(asked)).toEqual({ ok: true, value: taken });
  });

  it.each([
    ["nothing", "", "display-name-empty"],
    ["spaces alone", "    ", "display-name-empty"],
    ["line breaks and a tab alone", "\n\t\r\n", "display-name-empty"],
    ["a line feed inside it", "Priya\nShah", "display-name-not-one-line"],
    ["an inner carriage return and line feed", "Priya\r\nShah", "display-name-not-one-line"],
    ["a Unicode line separator inside it", "Priya\u2028Shah", "display-name-not-one-line"],
    ["a next-line character, which trimming leaves", "\u0085Priya", "display-name-not-one-line"],
    ["a tab inside it", "Priya\tShah", "display-name-control-character"],
    ["a NUL", "Priya\u0000Shah", "display-name-control-character"],
    ["a bell", "Priya\u0007", "display-name-control-character"],
    ["a DEL", "Priya\u007FShah", "display-name-control-character"],
    ["a C1 control", "Priya\u009BShah", "display-name-control-character"],
    ["a less-than sign", "Priya <priya@acme.invalid", "display-name-angle-bracket"],
    ["a greater-than sign", "Priya > Sam", "display-name-angle-bracket"],
    ["a tag", "<b>Priya</b>", "display-name-angle-bracket"],
    ["a hundred and one characters", `${HUNDRED}a`, "display-name-too-long"],
    ["a hundred and one astral characters", `${HUNDRED_ASTRAL}𝐀`, "display-name-too-long"],
    ["one letter's hundred marks, counted singly", `e${"́".repeat(100)}`, "display-name-too-long"],
    ["a break and a bracket, break first", "Priya\n<Shah>", "display-name-not-one-line"],
    ["a bracket and excess length, bracket first", `<${HUNDRED}`, "display-name-angle-bracket"],
  ])("refuses %s, naming how", (_case, asked, word) => {
    expect(applyDisplayNameRule(asked)).toEqual({ ok: false, error: word });
  });
});

const displayNameHeld = async (personId: string): Promise<string | undefined> => {
  const found = await db().pool.query<{ name: string }>('SELECT name FROM "user" WHERE id = $1', [
    personId,
  ]);
  return found.rows[0]?.name;
};

const identitySetRowsFor = async (personId: string) => {
  const found = await db().pool.query(
    `SELECT id, act, family, actor, subject_kind, subject_id, detail, batch_id
       FROM identity_audit_event WHERE subject_id = $1 ORDER BY at, id`,
    [personId],
  );
  return found.rows;
};

const rowsAnywhereCarrying = async (text: string): Promise<number> => {
  const found = await db().pool.query(
    `SELECT 1 FROM identity_audit_event WHERE row_to_json(identity_audit_event)::text LIKE $1
     UNION ALL SELECT 1 FROM audit_event WHERE row_to_json(audit_event)::text LIKE $1`,
    [`%${text}%`],
  );
  return found.rowCount ?? 0;
};

describe("setting one's own display name", () => {
  it("writes and answers the name the rule takes", async () => {
    const personId = await seedPerson(db().pool, { name: "" });
    const door = openPostgres(db().runtimePool);

    const set = await setDisplayName(bootstrap, door, {
      personId,
      displayName: "  Priya Shah  ",
    });

    expect(set).toEqual({ ok: true, value: { personId, displayName: "Priya Shah" } });
    expect(await displayNameHeld(personId)).toBe("Priya Shah");
  });

  it("replaces the person's earlier name and touches no one else's", async () => {
    const personId = await seedPerson(db().pool, { name: "Priya" });
    const someoneElse = await seedPerson(db().pool, { name: "Sam Okoro" });
    const door = openPostgres(db().runtimePool);

    const set = await setDisplayName(bootstrap, door, { personId, displayName: "Priya Shah" });

    expect(set.ok).toBe(true);
    expect([await displayNameHeld(personId), await displayNameHeld(someoneElse)]).toEqual([
      "Priya Shah",
      "Sam Okoro",
    ]);
  });

  it("refuses what the rule refuses and keeps the old name", async () => {
    const personId = await seedPerson(db().pool, { name: "Priya Shah" });
    const door = openPostgres(db().runtimePool);

    const refusals = [
      await setDisplayName(bootstrap, door, { personId, displayName: "" }),
      await setDisplayName(bootstrap, door, { personId, displayName: "   " }),
      await setDisplayName(bootstrap, door, { personId, displayName: "Priya <admin>" }),
    ];

    expect(refusals).toEqual([
      { ok: false, error: "display-name-empty" },
      { ok: false, error: "display-name-empty" },
      { ok: false, error: "display-name-angle-bracket" },
    ]);
    expect(await displayNameHeld(personId)).toBe("Priya Shah");
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("refuses person-gone for a person no longer there, recording nothing", async () => {
    const door = openPostgres(db().runtimePool);
    const personId = ulid();

    const set = await setDisplayName(bootstrap, door, { personId, displayName: "Priya Shah" });

    expect(set).toEqual({ ok: false, error: "person-gone" });
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("refuses malformed for a person id that is not one", async () => {
    const door = openPostgres(db().runtimePool);

    const set = await setDisplayName(bootstrap, door, {
      personId: "not-a-person-id",
      displayName: "Priya Shah",
    });

    expect(set).toEqual({ ok: false, error: "malformed" });
  });

  it("writes one identity-set row, leaving the workspace's audit log alone", async () => {
    const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Named", {
      name: "Held",
    });
    const auditLogBefore = await db().pool.query(
      "SELECT id FROM audit_event WHERE workspace_id = $1",
      [workspaceId],
    );

    await setDisplayName(bootstrap, door, { personId: adminUserId, displayName: "Priya Shah" });

    expect(await identitySetRowsFor(adminUserId)).toEqual([
      {
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        act: "people.person.named",
        family: "people",
        actor: `human:${adminUserId}`,
        subject_kind: "person",
        subject_id: adminUserId,
        detail: {},
        batch_id: null,
      },
    ]);
    const auditLogAfter = await db().pool.query(
      "SELECT id FROM audit_event WHERE workspace_id = $1",
      [workspaceId],
    );
    expect(auditLogAfter.rows).toEqual(auditLogBefore.rows);
  });

  it("carries the name in no row of either audit log", async () => {
    const personId = await seedPerson(db().pool, { name: "" });
    const door = openPostgres(db().runtimePool);
    const displayName = `Distinct ${ulid()}`;

    const set = await setDisplayName(bootstrap, door, { personId, displayName });

    expect(set.ok).toBe(true);
    expect(await identitySetRowsFor(personId)).toHaveLength(1);
    expect(await rowsAnywhereCarrying(displayName)).toBe(0);
  });

  it("writes the name and its row together, or neither", async () => {
    const personId = await seedPerson(db().pool, { name: "" });
    const door = openPostgres(db().runtimePool);

    const set = await whileWritesAreRefused(db().pool, "identity_audit_event", () =>
      setDisplayName(bootstrap, door, { personId, displayName: "Priya Shah" }),
    );

    expect(set).toMatchObject({ ok: false, error: expect.any(Error) });
    expect(await displayNameHeld(personId)).toBe("");
  });
});

describe("correcting a display name, as the operator", () => {
  const AT = new Date("2026-09-26T12:00:00.000Z");

  const correcting = (input: { personId: string; displayName: string }, signedInAt = AT) =>
    asANewOperator(db(), signedInAt, (operator, tx) =>
      correctDisplayName(operator, tx, { ...input, at: AT }),
    );

  it("writes the name the rule takes, recorded under the operator", async () => {
    const personId = await seedPerson(db().pool, { name: "Rude Name" });

    const { operatorId, answered } = await correcting({ personId, displayName: "  Priya Shah " });

    expect(answered).toEqual({
      ok: true,
      value: { ok: true, value: { personId, displayName: "Priya Shah" } },
    });
    expect(await displayNameHeld(personId)).toBe("Priya Shah");
    expect(await identitySetRowsFor(personId)).toEqual([
      {
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        act: "people.person.renamed",
        family: "people",
        actor: `human:${operatorId}`,
        subject_kind: "person",
        subject_id: personId,
        detail: {},
        batch_id: null,
      },
    ]);
  });

  it("carries neither name in any row of either audit log", async () => {
    const was = `Rude ${ulid()}`;
    const personId = await seedPerson(db().pool, { name: was });
    const displayName = `Corrected ${ulid()}`;

    await correcting({ personId, displayName });

    expect(await rowsAnywhereCarrying(was)).toBe(0);
    expect(await rowsAnywhereCarrying(displayName)).toBe(0);
  });

  it("records a correction to the name already held", async () => {
    const personId = await seedPerson(db().pool, { name: "Priya Shah" });

    const { answered } = await correcting({ personId, displayName: "Priya Shah" });

    expect(answered).toMatchObject({ ok: true, value: { ok: true } });
    expect((await identitySetRowsFor(personId)).map((row) => row.act)).toEqual([
      "people.person.renamed",
    ]);
  });

  it("refuses what the person's own rule refuses, keeping the name", async () => {
    const personId = await seedPerson(db().pool, { name: "Rude Name" });

    const answers = [
      (await correcting({ personId, displayName: "   " })).answered,
      (await correcting({ personId, displayName: "Priya <admin>" })).answered,
      (await correcting({ personId, displayName: "Priya\nShah" })).answered,
    ];

    expect(answers).toEqual([
      { ok: true, value: { ok: false, error: "display-name-empty" } },
      { ok: true, value: { ok: false, error: "display-name-angle-bracket" } },
      { ok: true, value: { ok: false, error: "display-name-not-one-line" } },
    ]);
    expect(await displayNameHeld(personId)).toBe("Rude Name");
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it.each([
    ["a malformed id", "user-missing"],
    ["an unknown id", ulid()],
  ])("refuses %s as no such user, writing nothing", async (_case, personId) => {
    const { answered } = await correcting({ personId, displayName: "Priya Shah" });

    expect(answered).toEqual({ ok: true, value: { ok: false, error: "no-such-user" } });
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("refuses a sign-in over an hour old, changing nothing", async () => {
    const personId = await seedPerson(db().pool, { name: "Rude Name" });

    const { answered } = await correcting(
      { personId, displayName: "Priya Shah" },
      new Date("2026-09-26T10:59:59.999Z"),
    );

    expect(answered).toEqual({ ok: true, value: { ok: false, error: "sign-in-too-old" } });
    expect(await displayNameHeld(personId)).toBe("Rude Name");
    expect(await identitySetRowsFor(personId)).toEqual([]);
  });

  it("admits a sign-in exactly an hour old", async () => {
    const personId = await seedPerson(db().pool, { name: "Rude Name" });

    const { answered } = await correcting(
      { personId, displayName: "Priya Shah" },
      new Date("2026-09-26T11:00:00.000Z"),
    );

    expect(answered).toMatchObject({ ok: true, value: { ok: true } });
  });

  it("lands the name and its row together, or neither", async () => {
    const personId = await seedPerson(db().pool, { name: "Rude Name" });

    await expect(
      whileWritesAreRefused(db().pool, "identity_audit_event", () =>
        correcting({ personId, displayName: "Priya Shah" }),
      ),
    ).rejects.toThrow("the store refused a write to identity_audit_event");
    expect(await displayNameHeld(personId)).toBe("Rude Name");
  });

  it("admits the operator alone, never an Admin or the platform", () => {
    type Corrector = Parameters<typeof correctDisplayName>[0];

    expectTypeOf<OperatorPrincipal>().toExtend<Corrector>();
    expectTypeOf<UserPrincipal>().not.toExtend<Corrector>();
    expectTypeOf<PlatformPrincipal>().not.toExtend<Corrector>();
  });
});
