import { describe, expect, it } from "vitest";

import { REDACTION_ALWAYS_TIER } from "@better-answers/schema";
import type pg from "pg";

import type { UserPrincipal } from "../src/kernel/index.ts";
import { restoreFinding } from "../src/sources/index.ts";
import { visibilitySuite } from "./sourced-concept.ts";
import { seedingWith, whileWritesAreRefused } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading: acting } = visibilitySuite();

const BUSINESS_FACT = "The sort code is the company's own, printed on every invoice it sends.";

const restoreAs = (who: UserPrincipal, findingId: string, reason: string) =>
  acting(who, (principal, tx) => restoreFinding(principal, tx, { findingId, reason }));

const findingIn = async (
  scenario: Scenario,
  overrides: { readonly tier?: string; readonly category?: string } = {},
): Promise<{ readonly findingId: string }> =>
  seedingWith(db().pool, async (seed) => {
    const row = await seed.finding({ workspaceId: scenario.workspaceId, ...overrides });
    return { findingId: row.id };
  });

type RestoreColumns = {
  readonly restored_at: Date | null;
  readonly restored_by: string | null;
  readonly restore_reason: string | null;
};

const restoreColumnsOf = async (workspaceId: string, findingId: string) => {
  const found = await db().pool.query<RestoreColumns>(
    "SELECT restored_at, restored_by, restore_reason FROM finding WHERE workspace_id = $1 AND id = $2",
    [workspaceId, findingId],
  );
  return found.rows[0];
};

const NOTHING_RESTORED = { restored_at: null, restored_by: null, restore_reason: null } as const;

const restoreEventsOf = async (pool: pg.Pool, workspaceId: string) => {
  const found = await pool.query<{
    id: string;
    act: string;
    family: string;
    actor: string;
    subject_kind: string;
    subject_id: string;
    detail: Record<string, unknown>;
  }>(
    `SELECT id, act, family, actor, subject_kind, subject_id, detail
       FROM audit_event WHERE workspace_id = $1 ORDER BY at, id`,
    [workspaceId],
  );
  return found.rows.filter((row) => row.act === "sources.finding.restored");
};

describe("an Admin's restore of one always-set span", () => {
  it("writes the instant, the Admin's actor id and the reason on the finding, with its ledger row", async () => {
    const scenario = await arrange();
    const { findingId } = await findingIn(scenario);

    const restored = await restoreAs(scenario.admin, findingId, BUSINESS_FACT);

    expect(restored).toMatchObject({ ok: true, value: { findingId } });
    const columns = await restoreColumnsOf(scenario.workspaceId, findingId);
    expect({
      restored_by: columns?.restored_by,
      restore_reason: columns?.restore_reason,
      stamped: columns?.restored_at instanceof Date,
    }).toEqual({
      restored_by: `human:${scenario.admin.userId}`,
      restore_reason: BUSINESS_FACT,
      stamped: true,
    });

    expect(restored.ok ? restored.value.restoredAt : undefined).toEqual(columns?.restored_at);

    expect(await restoreEventsOf(db().pool, scenario.workspaceId)).toEqual([
      {
        id: restored.ok ? restored.value.auditEventId : "",
        act: "sources.finding.restored",
        family: "sources",
        actor: `human:${scenario.admin.userId}`,
        subject_kind: "finding",
        subject_id: findingId,
        detail: { findingId },
      },
    ]);
  });

  it("lets an Admin correct a reason by restoring again, and the ledger keeps both acts", async () => {
    const scenario = await arrange();
    const { findingId } = await findingIn(scenario);
    const corrected = "The account is the company's own; the supplier form prints it in full.";

    await restoreAs(scenario.admin, findingId, BUSINESS_FACT);
    const again = await restoreAs(scenario.admin, findingId, corrected);

    expect(again).toMatchObject({ ok: true });
    expect((await restoreColumnsOf(scenario.workspaceId, findingId))?.restore_reason).toBe(
      corrected,
    );

    expect(
      (await restoreEventsOf(db().pool, scenario.workspaceId)).map((row) => row.subject_id),
    ).toEqual([findingId, findingId]);
  });

  it("restores a name the officer-block rule raised at the always tier, whatever its category says", async () => {
    const scenario = await arrange();
    const { findingId } = await findingIn(scenario, {
      tier: REDACTION_ALWAYS_TIER,
      category: "person-name",
    });

    const restored = await restoreAs(
      scenario.admin,
      findingId,
      "The officer named is the company's own director, as Companies House publishes it.",
    );

    expect(restored).toMatchObject({ ok: true, value: { findingId } });
  });
});

describe("what the restore act refuses", () => {
  it.each([
    ["a Viewer", (scenario: Scenario) => scenario.viewer, {}, "role-forbids"],
    ["an Editor", (scenario: Scenario) => scenario.editor, {}, "role-forbids"],
    [
      "a default-on finding",
      (scenario: Scenario) => scenario.admin,
      { tier: "default-on", category: "home-address" },
      "not-the-always-set",
    ],
    [
      "a default-off finding",
      (scenario: Scenario) => scenario.admin,
      { tier: "default-off", category: "person-name" },
      "not-the-always-set",
    ],
  ] as const)(
    "refuses %s, and neither the row nor the ledger moves",
    async (_who, principalOf, overrides, refusal) => {
      const scenario = await arrange();
      const { findingId } = await findingIn(scenario, overrides);

      const restored = await restoreAs(principalOf(scenario), findingId, BUSINESS_FACT);

      expect(restored).toEqual({ ok: false, error: refusal });
      expect(await restoreColumnsOf(scenario.workspaceId, findingId)).toEqual(NOTHING_RESTORED);
      expect(await restoreEventsOf(db().pool, scenario.workspaceId)).toEqual([]);
    },
  );

  it("refuses a blank reason as malformed — a restore is the reason it was made for", async () => {
    const scenario = await arrange();
    const { findingId } = await findingIn(scenario);

    expect(await restoreAs(scenario.admin, findingId, "   ")).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(await restoreColumnsOf(scenario.workspaceId, findingId)).toEqual(NOTHING_RESTORED);
    expect(await restoreEventsOf(db().pool, scenario.workspaceId)).toEqual([]);
  });

  it("refuses an absent reason as malformed, which the column's own schema would have admitted", async () => {
    const scenario = await arrange();
    const { findingId } = await findingIn(scenario);

    for (const absent of [null, undefined]) {
      expect(await restoreAs(scenario.admin, findingId, absent as unknown as string)).toEqual({
        ok: false,
        error: "malformed",
      });
    }
    expect(await restoreColumnsOf(scenario.workspaceId, findingId)).toEqual(NOTHING_RESTORED);
    expect(await restoreEventsOf(db().pool, scenario.workspaceId)).toEqual([]);
  });

  it("refuses an id that is not the minter's shape as malformed, before any read", async () => {
    const scenario = await arrange();

    expect(await restoreAs(scenario.admin, "not-an-id", BUSINESS_FACT)).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("says no-such-finding for another workspace's finding, and leaves it as it was", async () => {
    const mine = await arrange();
    const theirs = await arrange();
    const { findingId } = await findingIn(theirs);

    expect(await restoreAs(mine.admin, findingId, BUSINESS_FACT)).toEqual({
      ok: false,
      error: "no-such-finding",
    });
    expect(await restoreColumnsOf(theirs.workspaceId, findingId)).toEqual(NOTHING_RESTORED);
    expect(await restoreEventsOf(db().pool, theirs.workspaceId)).toEqual([]);
  });
});

describe("the restore and its ledger row land or fail together", () => {
  it("leaves the finding unrestored when the ledger refuses the event", async () => {
    const scenario = await arrange();
    const { findingId } = await findingIn(scenario);

    await expect(
      whileWritesAreRefused(db().pool, "audit_event", () =>
        restoreAs(scenario.admin, findingId, BUSINESS_FACT),
      ),
    ).rejects.toThrow("the store refused a write to audit_event");

    expect(await restoreColumnsOf(scenario.workspaceId, findingId)).toEqual(NOTHING_RESTORED);
  });
});
