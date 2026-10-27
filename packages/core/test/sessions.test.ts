import { inspect } from "node:util";

import { assert, describe, expect, it } from "vitest";

import { matching } from "@better-answers/schema/testing/matching";

import { openPostgres } from "../src/store/postgres/index.ts";
import {
  endOneSession,
  endOneSessionInput,
  endOtherSessions,
  readSessions,
} from "../src/workspaces/index.ts";
import { sessionFor } from "./identity-rows.ts";
import { bootstrap, seedPerson } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { answered, postgresForSuite, seedingWith } from "./suite-postgres.ts";

const db = postgresForSuite();

const door = () => openPostgres(db().runtimePool);

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const AN_UNREADABLE_AGENT = "Something/1.0";

const A_BROWSER_ADDRESS = "203.0.113.7";

const STARTED = new Date("2026-10-02T09:00:00.000Z");

const NOBODY_HOLDING = "01J6ZZZZZZZZZZZZZZZZZZZZZZ";

const LATER = new Date("2026-10-02T10:41:00.000Z");

const EXPIRES = new Date("2026-10-09T10:41:00.000Z");

const NOW = new Date("2026-10-03T09:00:00.000Z");

const EXPIRED = new Date("2026-10-03T08:00:00.000Z");

type Seeded = { readonly personId: string; readonly sessionIds: readonly string[] };

const anExpiredSessionOf = (seeded: Seeded): Promise<string> =>
  sessionFor(db().pool, seeded.personId, {
    createdAt: STARTED,
    lastUsedAt: EXPIRED,
    expiresAt: EXPIRED,
    userAgent: MAC_CHROME,
    ipAddress: A_BROWSER_ADDRESS,
  });

const aPersonWith = async (count: number, userAgent: string = MAC_CHROME): Promise<Seeded> => {
  const personId = await seedPerson(db().pool);
  const sessionIds = [];
  for (let at = 0; at < count; at += 1) {
    sessionIds.push(
      await sessionFor(db().pool, personId, {
        createdAt: STARTED,
        lastUsedAt: new Date(LATER.getTime() + at),
        expiresAt: EXPIRES,
        userAgent,
        ipAddress: A_BROWSER_ADDRESS,
      }),
    );
  }
  return { personId, sessionIds };
};

const sessionAt = (seeded: Seeded, at: number): string => {
  const id = seeded.sessionIds[at];
  if (id === undefined) throw new Error(`the person holds no session ${String(at)}`);
  return id;
};

const read = (seeded: Seeded, at: number) =>
  readSessions(bootstrap, door(), {
    personId: seeded.personId,
    sessionId: sessionAt(seeded, at),
    now: NOW,
  });

const signOutOf = (seeded: Seeded, sessionId: string) =>
  endOneSession(bootstrap, door(), {
    ...inputOf(endOneSessionInput, { sessionId }),
    personId: seeded.personId,
    now: NOW,
  });

const signOut = (seeded: Seeded, at: number) => signOutOf(seeded, sessionAt(seeded, at));

const signOutOthers = (seeded: Seeded, at: number) =>
  endOtherSessions(bootstrap, door(), {
    personId: seeded.personId,
    sessionId: sessionAt(seeded, at),
    now: NOW,
  });

const endedSession = (seeded: Seeded, at: number) => ({
  sessionId: sessionAt(seeded, at),
  device: "Chrome on macOS",
  lastActiveAt: matching.any(String),
});

const aSignOutRecord = (
  personId: string,
  sessions: readonly { readonly sessionId: string; readonly device: string }[],
) => ({
  actor: `human:${personId}`,
  subject_id: personId,
  action: "people.person.sessions_ended",
  detail: {
    sessions: [...sessions].sort((one, other) => one.sessionId.localeCompare(other.sessionId)),
  },
});

type Recorded = {
  readonly actor: string;
  readonly subject_id: string;
  readonly action: string;
  readonly detail: { readonly sessions: readonly { readonly sessionId: string }[] };
};

const inIdOrder = (rows: readonly Recorded[]) =>
  rows.map((row) => ({
    ...row,
    detail: {
      sessions: [...row.detail.sessions].sort((one, other) =>
        one.sessionId.localeCompare(other.sessionId),
      ),
    },
  }));

const recordsOf = async (personId: string) =>
  inIdOrder(
    (
      await db().pool.query<Recorded>(
        "SELECT actor, subject_id, action, detail FROM identity_audit_event WHERE subject_id = $1 ORDER BY id",
        [personId],
      )
    ).rows,
  );

const idsHeld = async (personId: string) =>
  (
    await db().pool.query<{ id: string }>(
      "SELECT id FROM session WHERE user_id = $1 ORDER BY created_at, id",
      [personId],
    )
  ).rows.map((row) => row.id);

describe("reading a person's own sessions", () => {
  it("lists the person's sessions alone, the current one first", async () => {
    const person = await aPersonWith(3);
    const other = await aPersonWith(1);

    const held = answered(await read(person, 1));

    expect(held.map((session) => [session.id, session.current])).toEqual([
      [sessionAt(person, 1), true],
      [sessionAt(person, 2), false],
      [sessionAt(person, 0), false],
    ]);
    expect(held.map((session) => session.device)).toEqual([
      "Chrome on macOS",
      "Chrome on macOS",
      "Chrome on macOS",
    ]);
    expect(
      held.map((session) => session.id),
      "another person's session is listed",
    ).not.toContain(sessionAt(other, 0));
  });

  it("carries no field holding an address", async () => {
    const person = await aPersonWith(1);

    const held = answered(await read(person, 0));

    expect(JSON.stringify(held)).not.toContain(A_BROWSER_ADDRESS);
    expect(JSON.stringify(held)).not.toMatch(/ip/i);
  });

  it("names an agent it cannot read as an unknown device", async () => {
    const person = await aPersonWith(2, AN_UNREADABLE_AGENT);

    const held = answered(await read(person, 0));

    expect(held.map((session) => session.device)).toEqual(["Unknown device", "Unknown device"]);
  });

  it("refuses an id the boundary does not name", async () => {
    await aPersonWith(1);

    expect(
      await readSessions(bootstrap, door(), { personId: "x", sessionId: "y", now: NOW }),
    ).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("leaves a session past its expiry unlisted", async () => {
    const person = await aPersonWith(1);
    const expired = await anExpiredSessionOf(person);

    const held = answered(await read(person, 0));

    expect(held.map((session) => session.id)).toEqual([sessionAt(person, 0)]);
    expect(await idsHeld(person.personId), "the row is the sweep's to delete").toContain(expired);
  });
});

describe("signing one session out", () => {
  it("ends it, keeps the current one, and records it", async () => {
    const person = await aPersonWith(2);

    const ended = await signOut(person, 0);

    expect(ended).toEqual({ ok: true, value: { ended: 1 } });
    expect(await idsHeld(person.personId)).toEqual([sessionAt(person, 1)]);
    expect(await recordsOf(person.personId)).toEqual([
      aSignOutRecord(person.personId, [endedSession(person, 0)]),
    ]);
  });

  it("refuses a session another person holds, ending nothing", async () => {
    const person = await aPersonWith(1);
    const elsewhere = await aPersonWith(1);

    const refused = await signOutOf(person, sessionAt(elsewhere, 0));

    expect(refused).toEqual({ ok: false, error: "session-gone" });
    expect(await idsHeld(person.personId)).toEqual(person.sessionIds);
    expect(await idsHeld(elsewhere.personId)).toEqual(elsewhere.sessionIds);
    expect(await recordsOf(person.personId)).toEqual([]);
  });

  it("refuses a session no one holds, ending nothing", async () => {
    const person = await aPersonWith(1);

    const refused = await signOutOf(person, NOBODY_HOLDING);

    expect(refused).toEqual({ ok: false, error: "session-gone" });
    expect(await idsHeld(person.personId)).toEqual(person.sessionIds);
  });

  it("refuses an expired session, leaving it to the sweep", async () => {
    const person = await aPersonWith(1);
    const expired = await anExpiredSessionOf(person);

    const refused = await signOutOf(person, expired);

    expect(refused).toEqual({ ok: false, error: "session-gone" });
    expect(await idsHeld(person.personId)).toContain(expired);
    expect(await recordsOf(person.personId)).toEqual([]);
  });
});

describe("signing every other session out", () => {
  it("ends the rest, keeps the current one, and records each", async () => {
    const person = await aPersonWith(3);

    const ended = await signOutOthers(person, 1);

    expect(ended).toEqual({ ok: true, value: { ended: 2 } });
    expect(await idsHeld(person.personId)).toEqual([sessionAt(person, 1)]);
    expect(await recordsOf(person.personId)).toEqual([
      aSignOutRecord(person.personId, [endedSession(person, 0), endedSession(person, 2)]),
    ]);
  });

  it("writes no record when this session is alone", async () => {
    const person = await aPersonWith(1);

    const ended = await signOutOthers(person, 0);

    expect(ended).toEqual({ ok: true, value: { ended: 0 } });
    expect(await recordsOf(person.personId)).toEqual([]);
  });

  it("leaves a personal token and an assistant's access working", async () => {
    const person = await aPersonWith(2);
    const grants = await seedingWith(db().pool, async (seed) => {
      const { clientId } = await seed.oauthClient({ name: "Claude" });
      const refresh = await seed.oauthRefreshToken({
        clientId,
        userId: person.personId,
        createdAt: STARTED,
      });
      const access = await seed.oauthAccessToken({
        clientId,
        userId: person.personId,
        createdAt: STARTED,
      });
      return { refresh, access };
    });

    const ended = await signOutOthers(person, 0);

    assert(ended.ok, inspect(ended));
    expect(ended.value.ended).toBe(1);
    const held = await db().pool.query<{ revoked: Date | null }>(
      "SELECT revoked FROM oauth_refresh_token WHERE id = $1",
      [grants.refresh.id],
    );
    expect(held.rows).toEqual([{ revoked: null }]);
    const accessHeld = await db().pool.query("SELECT 1 FROM oauth_access_token WHERE id = $1", [
      grants.access.id,
    ]);
    expect(accessHeld.rowCount).toBe(1);
  });

  it("ends the live sessions alone, and records those", async () => {
    const person = await aPersonWith(2);
    const expired = await anExpiredSessionOf(person);

    const ended = await signOutOthers(person, 0);

    expect(ended).toEqual({ ok: true, value: { ended: 1 } });
    expect(new Set(await idsHeld(person.personId))).toEqual(
      new Set([sessionAt(person, 0), expired]),
    );
    expect(await recordsOf(person.personId)).toEqual([
      aSignOutRecord(person.personId, [endedSession(person, 1)]),
    ]);
  });
});
