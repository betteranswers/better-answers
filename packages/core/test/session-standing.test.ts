import { describe, expect, it } from "vitest";

import {
  KERNEL_REFUSALS,
  mayTake,
  PENDING_SESSION_LIFETIME_MS,
  PENDING_STEPS,
  pendingClockOf,
  standingOf,
  type PendingStep,
  type SecondFactorFacts,
} from "../src/kernel/index.ts";
import { judgeTheSession } from "../src/workspaces/index.ts";
import { authenticatorFor, passkeyFor } from "./identity-rows.ts";
import { bootstrap, provisionedWorkspace, seedPerson } from "./platform.ts";
import { AT, secondFactorSuite } from "./second-factor-suite.ts";

const { db, door, aSession, confirmedAt } = secondFactorSuite();

const facts = (held: Partial<SecondFactorFacts>): SecondFactorFacts => ({
  mustHoldOne: false,
  holdsAFactor: false,
  confirmed: false,
  setupGranted: false,
  ...held,
});

describe("a session's second-factor standing", () => {
  it("asks nothing of a person who needs no factor", () => {
    expect([
      standingOf(facts({})),
      standingOf(facts({ holdsAFactor: true })),
      standingOf(facts({ holdsAFactor: true, confirmed: true, setupGranted: true })),
    ]).toEqual(["not-required", "not-required", "not-required"]);
  });

  it("counts a stamp only while a factor stands to confirm", () => {
    expect([
      standingOf(facts({ mustHoldOne: true, holdsAFactor: true, confirmed: true })),
      standingOf(facts({ mustHoldOne: true, confirmed: true })),
    ]).toEqual(["confirmed", "setup"]);
  });

  it("sends a holder to confirm, a granted session to setup", () => {
    expect([
      standingOf(facts({ mustHoldOne: true, holdsAFactor: true })),
      standingOf(facts({ mustHoldOne: true, holdsAFactor: true, setupGranted: true })),
      standingOf(
        facts({ mustHoldOne: true, holdsAFactor: true, setupGranted: true, confirmed: true }),
      ),
    ]).toEqual(["confirm", "setup", "confirmed"]);
  });

  it("sends a person holding nothing to setup, granted or not", () => {
    expect([
      standingOf(facts({ mustHoldOne: true })),
      standingOf(facts({ mustHoldOne: true, setupGranted: true })),
    ]).toEqual(["setup", "setup"]);
  });

  it("refuses a pending session in a word outside sign-in's class", () => {
    expect(KERNEL_REFUSALS["second-factor-pending"]).toBe("precondition");
  });
});

const EVERY_STEP_BUT_SETUP: readonly PendingStep[] = [
  "read-the-session",
  "sign-out",
  "read-the-second-factor",
  "read-the-operator-standing",
  "confirm",
  "spend-a-recovery-code",
  "give-the-restore-code",
];

describe("what a pending session may still do", () => {
  it("names every step of the pending set", () => {
    expect([...PENDING_STEPS].sort()).toEqual([...EVERY_STEP_BUT_SETUP, "set-up-a-factor"].sort());
  });

  it("lets a session that is not pending take anything", () => {
    for (const standing of ["not-required", "confirmed"] as const) {
      expect(mayTake(standing, undefined)).toBe(true);
      expect(mayTake(standing, "set-up-a-factor")).toBe(true);
    }
  });

  it("refuses a pending session anything outside the pending set", () => {
    expect([mayTake("confirm", undefined), mayTake("setup", undefined)]).toEqual([false, false]);
  });

  it("lets a pending session confirm, recover and sign out", () => {
    for (const step of EVERY_STEP_BUT_SETUP) {
      expect([step, mayTake("confirm", step), mayTake("setup", step)]).toEqual([step, true, true]);
    }
  });

  it("opens setup only to a session with nothing to confirm", () => {
    expect([mayTake("confirm", "set-up-a-factor"), mayTake("setup", "set-up-a-factor")]).toEqual([
      false,
      true,
    ]);
  });
});

const ONE_HOUR_MS = 3_600_000;

const after = (ms: number): Date => new Date(AT.getTime() + ms);

describe("a pending session's clock", () => {
  it("lasts an hour from the first pending read", () => {
    expect(PENDING_SESSION_LIFETIME_MS).toBe(ONE_HOUR_MS);
  });

  it("starts on the first pending read, then runs its hour", () => {
    expect([
      pendingClockOf("confirm", null, AT),
      pendingClockOf("setup", null, AT),
      pendingClockOf("confirm", AT, after(ONE_HOUR_MS)),
      pendingClockOf("setup", AT, after(ONE_HOUR_MS)),
    ]).toEqual(["start", "start", "run", "run"]);
  });

  it("ends a session pending past its hour, never at it", () => {
    expect([
      pendingClockOf("confirm", AT, after(ONE_HOUR_MS + 1)),
      pendingClockOf("setup", AT, after(ONE_HOUR_MS + 1)),
    ]).toEqual(["end", "end"]);
  });

  it("stops once the session is no longer pending", () => {
    expect([
      pendingClockOf("confirmed", AT, after(ONE_HOUR_MS * 2)),
      pendingClockOf("not-required", AT, AT),
      pendingClockOf("confirmed", null, AT),
      pendingClockOf("not-required", null, AT),
    ]).toEqual(["stop", "stop", "none", "none"]);
  });
});

const judged = (sessionId: string, now: Date) =>
  judgeTheSession(bootstrap, door(), { session: { id: sessionId }, now });

const stamp = (sessionId: string) =>
  db().pool.query("UPDATE session SET second_factor_confirmed_at = $2 WHERE id = $1", [
    sessionId,
    AT,
  ]);

const promotedAt = async (personId: string) =>
  (
    await db().pool.query<{ promoted: Date | null }>(
      'SELECT promoted_at AS promoted FROM "user" WHERE id = $1',
      [personId],
    )
  ).rows[0]?.promoted;

const sessionsOf = async (personId: string) =>
  (
    await db().pool.query<{ id: string }>("SELECT id FROM session WHERE user_id = $1", [personId])
  ).rows.map((row) => row.id);

describe("judging a session at the gate", () => {
  it("answers a confirmed Admin holding a passkey as confirmed", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    await passkeyFor(db().pool, adminUserId);
    const sessionId = await aSession(adminUserId);
    await stamp(sessionId);

    expect(await judged(sessionId, AT)).toEqual({
      ok: true,
      value: { sessionId, personId: adminUserId, standing: "confirmed" },
    });
  });

  it("reads an authenticator still waiting on its code as none", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    await authenticatorFor(db().pool, adminUserId, { verified: false });
    const sessionId = await aSession(adminUserId);
    await stamp(sessionId);

    expect(await judged(sessionId, AT)).toMatchObject({ ok: true, value: { standing: "setup" } });
  });

  it("asks an Admin holding an authenticator to confirm", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    await authenticatorFor(db().pool, adminUserId, { verified: true });

    expect(await judged(await aSession(adminUserId), AT)).toMatchObject({
      ok: true,
      value: { standing: "confirm" },
    });
  });

  it("holds the operator to the Admin's rule", async () => {
    const operatorId = await seedPerson(db().pool, { operator: true });
    await passkeyFor(db().pool, operatorId);

    expect(await judged(await aSession(operatorId), AT)).toMatchObject({
      ok: true,
      value: { standing: "confirm" },
    });
  });

  it("asks nothing of a person in no workspace", async () => {
    const personId = await seedPerson(db().pool);
    const sessionId = await aSession(personId);

    expect(await judged(sessionId, AT)).toMatchObject({
      ok: true,
      value: { standing: "not-required" },
    });
    expect(await confirmedAt(sessionId)).toEqual({ confirmed: null, pending: null });
  });

  it("counts a grant only from after the restore", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    await passkeyFor(db().pool, adminUserId);
    const granted = await aSession(adminUserId);
    await db().pool.query("UPDATE session SET setup_granted_at = $2 WHERE id = $1", [granted, AT]);

    const before = await judged(granted, AT);
    await db().pool.query('UPDATE "user" SET restore_required_at = $2 WHERE id = $1', [
      adminUserId,
      after(1),
    ]);
    const since = await judged(granted, AT);

    expect([before, since]).toMatchObject([
      { ok: true, value: { standing: "setup" } },
      { ok: true, value: { standing: "confirm" } },
    ]);
  });

  it("finds a session by its token as by its id", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const sessionId = await aSession(adminUserId);

    expect(
      await judgeTheSession(bootstrap, door(), {
        session: { token: `token-${sessionId}` },
        now: AT,
      }),
    ).toEqual({ ok: true, value: { sessionId, personId: adminUserId, standing: "setup" } });
  });

  it("answers a session nobody holds as gone", async () => {
    expect(await judged("no-such-session", AT)).toEqual({ ok: false, error: "session-gone" });
  });
});

describe("the pending clock a judged session carries", () => {
  it("starts on the first pending read, and only then", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const sessionId = await aSession(adminUserId);

    await judged(sessionId, AT);
    await judged(sessionId, after(ONE_HOUR_MS / 2));

    expect(await confirmedAt(sessionId)).toEqual({ confirmed: null, pending: AT });
  });

  it("keeps a session made hours before its first pending read", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const sessionId = await aSession(adminUserId);

    const read = await judged(sessionId, after(ONE_HOUR_MS * 5));

    expect(read).toMatchObject({ ok: true, value: { standing: "setup" } });
    expect(await confirmedAt(sessionId)).toEqual({
      confirmed: null,
      pending: after(ONE_HOUR_MS * 5),
    });
  });

  it("keeps a session at its hour, ending one past it", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    const atItsHour = await aSession(adminUserId, AT);
    const pastItsHour = await aSession(adminUserId, AT);

    const kept = await judged(atItsHour, after(ONE_HOUR_MS));
    const ended = await judged(pastItsHour, after(ONE_HOUR_MS + 1));

    expect([kept.ok, ended]).toEqual([true, { ok: false, error: "session-gone" }]);
    expect(await sessionsOf(adminUserId)).toEqual([atItsHour]);
  });

  it("stops the clock of a session no longer pending", async () => {
    const { workspaceId, adminUserId } = await provisionedWorkspace(db(), "Acme");
    const sessionId = await aSession(adminUserId, AT);
    await db().pool.query("UPDATE member SET role = 'Editor' WHERE workspace_id = $1", [
      workspaceId,
    ]);

    const read = await judged(sessionId, after(ONE_HOUR_MS * 2));

    expect(read).toMatchObject({ ok: true, value: { standing: "not-required" } });
    expect(await confirmedAt(sessionId)).toEqual({ confirmed: null, pending: null });
  });

  it("clears the promotion once a confirmed session is read", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    await passkeyFor(db().pool, adminUserId);
    await db().pool.query('UPDATE "user" SET promoted_at = $2 WHERE id = $1', [adminUserId, AT]);
    const pending = await aSession(adminUserId);
    const confirmed = await aSession(adminUserId);
    await stamp(confirmed);

    await judged(pending, AT);
    const stillPromoted = await promotedAt(adminUserId);
    await judged(confirmed, AT);

    expect([stillPromoted, await promotedAt(adminUserId)]).toEqual([AT, null]);
    expect(await confirmedAt(confirmed)).toEqual({ confirmed: AT, pending: null });
  });

  it("answers a store fault as a failure, never as gone", async () => {
    const personId = await seedPerson(db().pool);
    const sessionId = await aSession(personId);
    await db().pool.query(
      'ALTER TABLE session RENAME COLUMN pending_since TO "pending_since_gone"',
    );
    try {
      const read = await judged(sessionId, AT);

      expect(read.ok).toBe(false);
      expect(!read.ok && read.error instanceof Error).toBe(true);
    } finally {
      await db().pool.query(
        'ALTER TABLE session RENAME COLUMN "pending_since_gone" TO pending_since',
      );
    }
  });

  it("never waits on a row another transaction holds", async () => {
    const { adminUserId } = await provisionedWorkspace(db(), "Acme");
    await passkeyFor(db().pool, adminUserId);
    const confirmed = await aSession(adminUserId);
    await stamp(confirmed);
    const pastItsHour = await aSession(adminUserId, AT);
    const holder = await db().pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query('SELECT 1 FROM "user" WHERE id = $1 FOR UPDATE', [adminUserId]);
      await holder.query("SELECT 1 FROM session WHERE user_id = $1 FOR UPDATE", [adminUserId]);

      const reads = [
        await judged(confirmed, AT),
        await judged(pastItsHour, after(ONE_HOUR_MS + 1)),
      ];

      expect(reads).toMatchObject([
        { ok: true, value: { standing: "confirmed" } },
        { ok: false, error: "session-gone" },
      ]);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    expect(await sessionsOf(adminUserId)).toHaveLength(2);
  });
});
