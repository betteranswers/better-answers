import { describe, expect, it } from "vitest";

import { SWEEPS, sweepIdentitySet } from "@better-answers/core/sweeps";
import { ulid } from "@better-answers/schema";

import { consumeIngress, openPostgres } from "../src/store/postgres/index.ts";
import {
  parkedSecretFor,
  passkeyChallengeFor,
  restoreCodeFor,
  secondFactorRowsFor,
  sessionFor,
  signInLinkFor,
  verificationCodeFor,
} from "./identity-rows.ts";
import { seedPerson } from "./platform.ts";
import { addressOf, postgresForEachCase, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForEachCase();

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Two days on, so a row the store stamps with its own `now()` is long past by the pass. */
const NOW = new Date(Date.now() + 2 * DAY_MS);

const at = (fromNowMs: number): Date => new Date(NOW.getTime() + fromNowMs);

const swept = () => sweepIdentitySet(SWEEPS, openPostgres(db().runtimePool), { now: NOW });

const person = async () => {
  const email = addressOf("ada");
  return { email, userId: await seedPerson(db().pool, { email }) };
};

const sessionEnding = (
  userId: string,
  ends: { readonly expiresAt: Date; readonly pendingSince?: Date },
): Promise<string> =>
  sessionFor(db().pool, userId, { createdAt: at(-2 * DAY_MS), lastUsedAt: at(-DAY_MS), ...ends });

const ONE_A_MINUTE = { windowMs: MINUTE_MS, max: 5 };

const countedAt = async (scope: "ip" | "email", key: string, when: Date): Promise<void> => {
  await consumeIngress(openPostgres(db().runtimePool), scope, key, ONE_A_MINUTE, when);
};

const sessionsLeft = async (): Promise<readonly string[]> =>
  (await db().pool.query<{ id: string }>("SELECT id FROM session ORDER BY id")).rows.map(
    (row) => row.id,
  );

const verificationsLeft = async (): Promise<readonly string[]> =>
  (
    await db().pool.query<{ id: string }>("SELECT id FROM verification ORDER BY expires_at")
  ).rows.map((row) => row.id);

const windowsLeft = async (): Promise<readonly string[]> =>
  (
    await db().pool.query<{ key: string }>("SELECT key FROM ingress_counter ORDER BY window_start")
  ).rows.map((row) => row.key);

describe("the identity set's housekeeping", () => {
  it("deletes expired sessions and keeps live ones", async () => {
    const { userId } = await person();
    await sessionEnding(userId, { expiresAt: at(-MINUTE_MS) });
    const live = await sessionEnding(userId, { expiresAt: at(MINUTE_MS) });

    const result = await swept();

    expect(result.sessions).toEqual({ ok: true, value: 1 });
    expect(await sessionsLeft()).toEqual([live]);
  });

  it("deletes a pending session past its hour", async () => {
    const { userId } = await person();
    const daysLeft = at(30 * DAY_MS);
    await sessionEnding(userId, { expiresAt: daysLeft, pendingSince: at(-HOUR_MS - MINUTE_MS) });
    const withinItsHour = await sessionEnding(userId, {
      expiresAt: daysLeft,
      pendingSince: at(-HOUR_MS + MINUTE_MS),
    });

    const result = await swept();

    expect(result.sessions).toEqual({ ok: true, value: 1 });
    expect(await sessionsLeft()).toEqual([withinItsHour]);
  });

  it("deletes link and code rows past a day's grace", async () => {
    const { email } = await person();
    const sessionId = ulid();
    const pastTheGrace = at(-DAY_MS - MINUTE_MS);
    await verificationCodeFor(db().pool, email, pastTheGrace);
    await signInLinkFor(db().pool, email, pastTheGrace);
    await restoreCodeFor(db().pool, email, { hash: "a-restore-hash", expiresAt: pastTheGrace });
    await parkedSecretFor(db().pool, sessionId, pastTheGrace);
    await passkeyChallengeFor(db().pool, sessionId, pastTheGrace);

    const result = await swept();

    expect(result.verifications).toEqual({ ok: true, value: 5 });
    expect(await verificationsLeft()).toEqual([]);
  });

  it("keeps rows within the day's grace, and live ones", async () => {
    const { email } = await person();
    const withinTheGrace = await verificationCodeFor(db().pool, email, at(-DAY_MS + MINUTE_MS));
    const live = await signInLinkFor(db().pool, email, at(5 * MINUTE_MS));

    const result = await swept();

    expect(result.verifications).toEqual({ ok: true, value: 0 });
    expect(await verificationsLeft()).toEqual([withinTheGrace, live]);
  });

  it("deletes ingress windows a day old, keeping later ones", async () => {
    await countedAt("ip", "203.0.113.1", at(-DAY_MS - 2 * MINUTE_MS));
    await countedAt("ip", "203.0.113.2", at(-DAY_MS + 2 * MINUTE_MS));
    await countedAt("ip", "203.0.113.3", NOW);

    const result = await swept();

    expect(result.ingressWindows).toEqual({ ok: true, value: 1 });
    expect(await windowsLeft()).toEqual(["203.0.113.2", "203.0.113.3"]);
  });

  it("leaves second-factor throttle rows, however old", async () => {
    const { userId } = await person();
    await secondFactorRowsFor(db().pool, userId);

    await swept();

    const throttled = await db().pool.query<{ kind: string }>(
      "SELECT kind FROM second_factor_throttle WHERE user_id = $1 ORDER BY kind",
      [userId],
    );
    expect(throttled.rows.map((row) => row.kind)).toEqual(["authenticator", "restore-code"]);
  });

  it("still deletes sessions and windows when codes are refused", async () => {
    const { userId, email } = await person();
    await sessionEnding(userId, { expiresAt: at(-MINUTE_MS) });
    await verificationCodeFor(db().pool, email, at(-2 * DAY_MS));
    await countedAt("ip", "203.0.113.1", at(-2 * DAY_MS));

    const result = await whileWritesAreRefused(db().pool, "verification", swept);

    expect(result.verifications).toEqual({ ok: false, error: expect.any(Error) });
    expect(result.sessions).toEqual({ ok: true, value: 1 });
    expect(result.ingressWindows).toEqual({ ok: true, value: 1 });
    expect(await sessionsLeft()).toEqual([]);
    expect(await windowsLeft()).toEqual([]);
  });

  it("answers counts alone, naming no person or address", async () => {
    const { userId, email } = await person();
    await sessionEnding(userId, { expiresAt: at(-MINUTE_MS) });
    await verificationCodeFor(db().pool, email, at(-2 * DAY_MS));
    await countedAt("email", email, at(-2 * DAY_MS));

    const result = await swept();

    expect(result).toEqual({
      sessions: { ok: true, value: 1 },
      verifications: { ok: true, value: 1 },
      ingressWindows: { ok: true, value: 1 },
    });
  });
});
