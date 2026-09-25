import { ulid } from "@better-answers/schema";
import { describe, expect, it } from "vitest";

import { openPostgres } from "../src/store/postgres/index.ts";
import { applyDisplayNameRule, setDisplayName } from "../src/workspaces/index.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
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
    ["a hundred characters once the space around them is gone", `  ${HUNDRED}  `, HUNDRED],
    ["a hundred characters that are two UTF-16 units each", HUNDRED_ASTRAL, HUNDRED_ASTRAL],
  ])("takes %s", (_case, asked, taken) => {
    expect(applyDisplayNameRule(asked)).toEqual({ ok: true, value: taken });
  });

  it.each([
    ["nothing", "", "display-name-empty"],
    ["spaces alone", "    ", "display-name-empty"],
    ["line breaks and a tab alone", "\n\t\r\n", "display-name-empty"],
    ["a line feed inside it", "Priya\nShah", "display-name-not-one-line"],
    ["a carriage return and a line feed inside it", "Priya\r\nShah", "display-name-not-one-line"],
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
    ["a hundred and one characters past the BMP", `${HUNDRED_ASTRAL}𝐀`, "display-name-too-long"],
    [
      "one letter under a hundred combining marks, counted mark by mark",
      `e${"́".repeat(100)}`,
      "display-name-too-long",
    ],
    ["a break and a bracket, the break named first", "Priya\n<Shah>", "display-name-not-one-line"],
    [
      "a bracket in a name too long, the bracket named first",
      `<${HUNDRED}`,
      "display-name-angle-bracket",
    ],
  ])("refuses %s, naming how", (_case, asked, word) => {
    expect(applyDisplayNameRule(asked)).toEqual({ ok: false, error: word });
  });
});

describe("setting one's own display name", () => {
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

  it("writes one identity-set row and nothing to a workspace's ledger", async () => {
    const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Named", {
      name: "Held",
    });
    const ledgerBefore = await db().pool.query(
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
    const ledgerAfter = await db().pool.query(
      "SELECT id FROM audit_event WHERE workspace_id = $1",
      [workspaceId],
    );
    expect(ledgerAfter.rows).toEqual(ledgerBefore.rows);
  });

  it("carries the name in no row of either ledger", async () => {
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
