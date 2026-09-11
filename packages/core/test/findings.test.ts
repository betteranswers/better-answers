import { describe, expect, it } from "vitest";

import { REDACTION_ALWAYS_TIER } from "@better-answers/schema";
import type pg from "pg";

import type { UserPrincipal } from "../src/kernel/index.ts";
import { restoreFinding } from "../src/sources/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { readingAs, seedingWith, whileWritesAreRefused } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * The finding restore act through the `sources` slice's export (`[TEST1]`, `[DESIGN2]`): an
 * Admin lets one span of the **always set** back into a document with a reason, because the
 * company's own bank details on its own supplier form are a business fact and not a person's
 * data (the S0 spec, *The acts on the ledger*; ADR 0020).
 *
 * What a caller can observe is the finding's three restore columns, the ledger row that landed
 * with them, and the refusal word when nothing landed — so every test below asserts on those
 * and never on how the act reached them. Real Postgres, rows through the factory, and each
 * expected value written down (`[TEST2]`, `[TEST4]`, `[TEST9]`).
 *
 * **The always set is read off the row's `tier` and never off its category.** The officer-block
 * post-pass raises a `person-name` — ordinarily a default-off category — at the always tier, and
 * that span is exactly the one an Admin restores; the last test here is that hazard.
 */

const { db, arrange } = suiteWithBundles();

/** The sentence an Admin types, written down once so every assertion below reads the same one. */
const BUSINESS_FACT = "The sort code is the company's own, printed on every invoice it sends.";

const acting = <T>(
  who: UserPrincipal,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => readingAs(db().runtimePool, who, work);

/** The restore act as a person at this role would reach it, through the slice's own export. */
const restoreAs = (who: UserPrincipal, findingId: string, reason: string) =>
  acting(who, (principal, tx) => restoreFinding(principal, tx, { findingId, reason }));

/** One finding in this workspace at the tier and category the test is about. */
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

/** The three columns a restore writes, as the superuser reads them off the row. */
const restoreColumnsOf = async (workspaceId: string, findingId: string) => {
  const found = await db().pool.query<RestoreColumns>(
    "SELECT restored_at, restored_by, restore_reason FROM finding WHERE workspace_id = $1 AND id = $2",
    [workspaceId, findingId],
  );
  return found.rows[0];
};

const NOTHING_RESTORED = { restored_at: null, restored_by: null, restore_reason: null } as const;

/**
 * The ledger rows of the restore act with the pair the **database** derives from the act's
 * name beside them. `ledgerRowsOf` reads the columns a caller wrote; the family and the
 * subject kind are the generated ones, and a new act is the one moment they are worth
 * asserting — they are what says `sources.finding.restored` reached the right family with
 * the right subject without a migration naming either.
 */
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
    // The act answers the instant the row carries: the database's `now()`, not a clock the
    // act was handed (ADR 0040), so the two are the same fact read twice.
    expect(restored.ok ? restored.value.restoredAt : undefined).toEqual(columns?.restored_at);
    // The detail is the finding's id and nothing else (`[AUDIT5]`): the reason is free text an
    // Admin typed and could name a person, so it lands on the row and never on the ledger.
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
    // The ledger is never rewritten (`[AUDIT3]`): a correction is its own act and both rows stand.
    expect(
      (await restoreEventsOf(db().pool, scenario.workspaceId)).map((row) => row.subject_id),
    ).toEqual([findingId, findingId]);
  });

  it("restores a name the officer-block rule raised at the always tier, whatever its category says", async () => {
    // The hazard, written down as a test: the post-pass raises a `person-name` — a default-off
    // category — at the always tier, and that span is restorable because the **tier** is what
    // the always set means. An act that read the category would refuse the one restore an
    // Admin most wants (the S0 spec, *The seam*).
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
  // The pair both ways (`[TEST7]`): the Admin above restores, and each of these four writes
  // nothing at all — no row, no ledger event, and the refusal word that says which rule stopped it.
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
  it("leaves the finding unrestored when the ledger refuses the event (`[AUDIT1]`)", async () => {
    const scenario = await arrange();
    const { findingId } = await findingIn(scenario);

    // `[TEST8]`: the failure is provoked inside the act's own transaction, so the assertion is
    // on the transaction's outcome first — the door rejects bare and the row it wrote goes
    // with it — and on what the store holds afterwards second.
    await expect(
      whileWritesAreRefused(db().pool, "audit_event", () =>
        restoreAs(scenario.admin, findingId, BUSINESS_FACT),
      ),
    ).rejects.toThrow("the store refused a write to audit_event");

    expect(await restoreColumnsOf(scenario.workspaceId, findingId)).toEqual(NOTHING_RESTORED);
  });
});
