import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { testData } from "@better-answers/schema/testing";

import { dropAnExpiredPromotionLock, PROMOTION_LOCK_PREFIX } from "../src/auth/promotion-lock.ts";
import { signIn } from "./flow.ts";
import type { TestApp } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

/** Typed out rather than imported, so a wrong prefix in the api cannot seed its own test. */
const LOCK_PREFIX = "revoke-unproven-account-access:";

const MINUTE_MS = 60_000;

/** The library's reservation id: the lock's primary key, so a row left behind blocks the next. */
const reservationIdOf = (identifier: string): string =>
  createHash("sha256").update(`reserve:${identifier}`).digest("base64url");

const withSuperuser = async <T>(work: (data: ReturnType<typeof testData>) => Promise<T>) => {
  const client = await app().database.superuser.connect();
  try {
    return await work(testData(client));
  } finally {
    client.release();
  }
};

/** A promotion lock for `personId`, as the library writes one. */
const lockFor = (personId: string, expiresAt: Date) =>
  withSuperuser((data) =>
    data.verification({
      id: reservationIdOf(`${LOCK_PREFIX}${personId}`),
      identifier: `${LOCK_PREFIX}${personId}`,
      value: personId,
      expiresAt,
    }),
  );

/** Left by a sign-in that died, expired a minute ago on the process clock the library judges by. */
const orphanedLockFor = (personId: string) => lockFor(personId, new Date(Date.now() - MINUTE_MS));

const anUnprovenPerson = async () => {
  const person = await app().person();
  await app().setEmailVerified(person.email, false);
  return person;
};

/** Signed in once, so holding a session, with an account linked and the address unproven again. */
const anUnprovenPersonWithAccess = async () => {
  const person = await app().person();
  await signIn(app(), app().client(), person.email);
  await app().setEmailVerified(person.email, false);
  await withSuperuser((data) => data.account({ userId: person.id }));
  return person;
};

const accessOf = async (personId: string) => {
  const read = await app().database.superuser.query<{
    verified: boolean;
    sessions: number;
    accounts: number;
  }>(
    `SELECT u.email_verified AS verified,
            (SELECT count(*)::int FROM session s WHERE s.user_id = u.id) AS sessions,
            (SELECT count(*)::int FROM account a WHERE a.user_id = u.id) AS accounts
       FROM "user" u WHERE u.id = $1`,
    [personId],
  );
  return read.rows[0];
};

const rowsNamed = async (identifier: string): Promise<number> =>
  (
    await app().database.superuser.query("SELECT 1 FROM verification WHERE identifier = $1", [
      identifier,
    ])
  ).rowCount ?? -1;

const linesSince = (before: number, event: string) =>
  app()
    .logs.slice(before)
    .filter((line) => line["event"] === event);

/**
 * Refuses the hook's clear alone, so the library's own clear after it lands. A sequence outlives
 * the refused statement's rollback.
 */
const whileTheFirstLockDeleteIsRefused = async <T>(work: () => Promise<T>): Promise<T> => {
  const superuser = app().database.superuser;
  await superuser.query("CREATE SEQUENCE test_lock_deletes");
  await superuser.query(
    `CREATE FUNCTION test_refuse_first_lock_delete() RETURNS trigger
       LANGUAGE plpgsql SECURITY DEFINER AS $$
     BEGIN
       IF nextval('test_lock_deletes') = 1 THEN
         RAISE EXCEPTION 'the store refused the first lock delete';
       END IF;
       RETURN OLD;
     END $$`,
  );
  await superuser.query(
    `CREATE TRIGGER test_refuse_first_lock_delete BEFORE DELETE ON verification FOR EACH ROW
     WHEN (OLD.identifier LIKE '${LOCK_PREFIX}%') EXECUTE FUNCTION test_refuse_first_lock_delete()`,
  );
  try {
    return await work();
  } finally {
    await superuser.query("DROP TRIGGER test_refuse_first_lock_delete ON verification");
    await superuser.query("DROP FUNCTION test_refuse_first_lock_delete()");
    await superuser.query("DROP SEQUENCE test_lock_deletes");
  }
};

/** Finds the lock by its value, a person's id, so it is orphaned whatever form its name is stored in. */
const whileLockDeletesAreRefused = async <T>(work: () => Promise<T>): Promise<T> => {
  const superuser = app().database.superuser;
  await superuser.query(
    `CREATE FUNCTION test_refuse_lock_deletes() RETURNS trigger
       LANGUAGE plpgsql SECURITY DEFINER AS $$
     BEGIN
       IF EXISTS (SELECT 1 FROM "user" WHERE id = OLD.value) THEN
         RAISE EXCEPTION 'the store refused a lock delete';
       END IF;
       RETURN OLD;
     END $$`,
  );
  await superuser.query(
    `CREATE TRIGGER test_refuse_lock_deletes BEFORE DELETE ON verification FOR EACH ROW
     EXECUTE FUNCTION test_refuse_lock_deletes()`,
  );
  try {
    return await work();
  } finally {
    await superuser.query("DROP TRIGGER test_refuse_lock_deletes ON verification");
    await superuser.query("DROP FUNCTION test_refuse_lock_deletes()");
  }
};

const locksHeldFor = (personId: string) =>
  app().database.superuser.query<{ identifier: string }>(
    "SELECT identifier FROM verification WHERE value = $1",
    [personId],
  );

/** The lock lands after the code is asked for, so only the sign-in itself can clear it. */
const askedThenLeftALock = async (person: { readonly id: string; readonly email: string }) => {
  const asking = app().client();
  const asked = await asking.json("/email-otp/send-verification-otp", {
    email: person.email,
    type: "sign-in",
  });
  expect(asked.status).toBe(200);
  await orphanedLockFor(person.id);
  return asking;
};

const signInByCode = (client: ReturnType<TestApp["client"]>, email: string) =>
  client.json("/sign-in/email-otp", { email, otp: app().codeSentTo(email) });

describe("a sign-in after a promotion left its lock behind", () => {
  it("by code, still ends earlier access and proves the address", async () => {
    const person = await anUnprovenPersonWithAccess();
    const asking = await askedThenLeftALock(person);

    const signedIn = await signInByCode(asking, person.email);

    expect(signedIn.status).toBe(200);
    expect(await accessOf(person.id)).toEqual({ verified: true, sessions: 1, accounts: 0 });
  });

  it("by link, does the same", async () => {
    const person = await anUnprovenPersonWithAccess();
    const asking = await askedThenLeftALock(person);

    const signedIn = await asking.json("/sign-in-link/sign-in", {
      token: app().linkSentTo(person.email),
    });

    expect(signedIn.status).toBe(200);
    expect(await accessOf(person.id)).toEqual({ verified: true, sessions: 1, accounts: 0 });
  });

  it("still signs in when the clear is refused, logging it", async () => {
    const person = await anUnprovenPersonWithAccess();
    const asking = await askedThenLeftALock(person);
    const before = app().logs.length;

    const signedIn = await whileTheFirstLockDeleteIsRefused(() =>
      signInByCode(asking, person.email),
    );

    expect(signedIn.status).toBe(200);
    expect(linesSince(before, "auth.promotion_lock_not_cleared")).toMatchObject([
      {
        level: 40,
        msg: "auth.promotion_lock_not_cleared",
        reason: expect.stringContaining("the store refused the first lock delete"),
      },
    ]);
    expect(await accessOf(person.id)).toEqual({ verified: false, sessions: 2, accounts: 1 });
  });

  it("clears a lock the library itself left behind", async () => {
    const person = await anUnprovenPerson();
    await whileLockDeletesAreRefused(() => signIn(app(), app().client(), person.email));
    expect((await locksHeldFor(person.id)).rows).toEqual([
      { identifier: `${LOCK_PREFIX}${person.id}` },
    ]);
    await app().setEmailVerified(person.email, false);
    await withSuperuser((data) => data.account({ userId: person.id }));
    await app().database.superuser.query(
      "UPDATE verification SET expires_at = $2 WHERE value = $1",
      [person.id, new Date(Date.now() - MINUTE_MS)],
    );

    await signIn(app(), app().client(), person.email);

    expect(await accessOf(person.id)).toEqual({ verified: true, sessions: 1, accounts: 0 });
  });

  it("leaves a live lock for the library to wait on", async () => {
    const person = await anUnprovenPersonWithAccess();
    const asking = app().client();
    const asked = await asking.json("/email-otp/send-verification-otp", {
      email: person.email,
      type: "sign-in",
    });
    expect(asked.status).toBe(200);
    await lockFor(person.id, new Date(Date.now() + MINUTE_MS));

    const signedIn = await signInByCode(asking, person.email);

    expect(signedIn.status).toBe(200);
    expect(await rowsNamed(`${LOCK_PREFIX}${person.id}`)).toBe(1);
    expect(await accessOf(person.id)).toEqual({ verified: false, sessions: 2, accounts: 1 });
  });

  it("leaves the lock when only a code is asked for", async () => {
    const person = await anUnprovenPerson();
    await orphanedLockFor(person.id);

    const asked = await app().client().json("/email-otp/send-verification-otp", {
      email: person.email,
      type: "sign-in",
    });

    expect(asked.status).toBe(200);
    expect(await rowsNamed(`${LOCK_PREFIX}${person.id}`)).toBe(1);
  });

  it("with no address, meets the library's own refusal", async () => {
    const refused = await app().client().json("/sign-in/email-otp", { otp: "123456" });

    expect(refused.status).toBe(400);
  });
});

describe("dropping an expired promotion lock", () => {
  const door = () => app().doors.postgres;

  it("takes a lock that expires at the moment given", async () => {
    const person = await anUnprovenPerson();
    const now = new Date();
    await lockFor(person.id, now);

    expect(await dropAnExpiredPromotionLock(door(), person.email, now)).toBe(1);
    expect(await rowsNamed(`${LOCK_PREFIX}${person.id}`)).toBe(0);
  });

  it("leaves a lock that expires a millisecond later", async () => {
    const person = await anUnprovenPerson();
    const now = new Date();
    await lockFor(person.id, new Date(now.getTime() + 1));

    expect(await dropAnExpiredPromotionLock(door(), person.email, now)).toBe(0);
    expect(await rowsNamed(`${LOCK_PREFIX}${person.id}`)).toBe(1);
  });

  it("leaves a verified person's lock", async () => {
    const person = await app().person();
    await app().setEmailVerified(person.email, true);
    await orphanedLockFor(person.id);

    expect(await dropAnExpiredPromotionLock(door(), person.email, new Date())).toBe(0);
    expect(await rowsNamed(`${LOCK_PREFIX}${person.id}`)).toBe(1);
  });

  it("leaves another person's lock", async () => {
    const person = await anUnprovenPerson();
    const other = await anUnprovenPerson();
    await orphanedLockFor(person.id);
    await orphanedLockFor(other.id);

    expect(await dropAnExpiredPromotionLock(door(), person.email, new Date())).toBe(1);
    expect(await rowsNamed(`${LOCK_PREFIX}${other.id}`)).toBe(1);
  });

  it("finds the person by an address given in another case", async () => {
    const person = await anUnprovenPerson();
    await orphanedLockFor(person.id);

    expect(await dropAnExpiredPromotionLock(door(), person.email.toUpperCase(), new Date())).toBe(
      1,
    );
  });

  it("leaves the person's other expired rows", async () => {
    const person = await anUnprovenPerson();
    await orphanedLockFor(person.id);
    const code = `sign-in-otp-${person.email}`;
    await withSuperuser((data) =>
      data.verification({ identifier: code, expiresAt: new Date(Date.now() - MINUTE_MS) }),
    );

    expect(await dropAnExpiredPromotionLock(door(), person.email, new Date())).toBe(1);
    expect(await rowsNamed(code)).toBe(1);
  });
});

describe("the library this clears behind", () => {
  const distFile = (name: string) =>
    readFileSync(new URL(name, import.meta.resolve("better-auth")), "utf8");

  it("still names its lock the api's prefix and an id", () => {
    expect(PROMOTION_LOCK_PREFIX).toBe(LOCK_PREFIX);
    expect(distFile("db/revoke-unproven-account-access.mjs")).toContain(
      `\`${PROMOTION_LOCK_PREFIX}\${userId}\``,
    );
  });

  it("still keys a reservation on its identifier", () => {
    expect(distFile("db/internal-adapter.mjs")).toContain('"reserve:" + data.identifier');
  });
});
