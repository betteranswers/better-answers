import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { mountedPaths } from "../src/auth/index.ts";
import { authAsServerBuildsIt } from "./auth-instance.ts";
import { setUpAnAuthenticator, signedInClient } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const { auth: asBuilt, database: unreached } = authAsServerBuildsIt();

afterAll(async () => {
  await unreached.end();
});

/** Read off the instance, so a path a plugin adds on an upgrade is held closed here too. */
const FACTOR_PATHS = mountedPaths(asBuilt).filter(
  (path) => path.startsWith("/passkey/") || path.startsWith("/two-factor/"),
);

/** Written out, not imported: a path dropped from `disabledPaths` then fails here. */
const CLOSED_SESSION_PATHS = [
  "/list-sessions",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/unlink-account",
  "/update-session",
] as const;

const SESSION_FIELDS = ["secondFactorConfirmedAt", "pendingSince", "setupGrantedAt"] as const;

const USER_FIELDS = [
  "passkeyOfferDismissedAt",
  "recoveryCodesAcknowledged",
  "restoreRequiredAt",
] as const;

type Declared = { required?: unknown; input?: unknown; returned?: unknown };

const sessionRead = z.object({
  user: z.record(z.string(), z.unknown()),
  session: z.record(z.string(), z.unknown()),
});

const authenticatorHeldBy = async (personId: string) => {
  const found = await app().database.superuser.query<{
    authenticator_enabled: boolean;
    verified: boolean;
  }>(
    `SELECT u.authenticator_enabled, a.verified
       FROM "user" u JOIN authenticator a ON a.user_id = u.id
      WHERE u.id = $1`,
    [personId],
  );
  return found.rows;
};

describe("an Admin with an authenticator signing in by email code", () => {
  // The library's own factor check skips email-code sign-in; once our gate stands, this session is pending.
  it("gets a whole session while no gate stands", async () => {
    const { admin } = await app().provision();
    await setUpAnAuthenticator(app(), await signedInClient(app(), admin.email));
    expect(await authenticatorHeldBy(admin.id)).toEqual([
      { authenticator_enabled: true, verified: true },
    ]);

    const elsewhere = await signedInClient(app(), admin.email);
    const read = await elsewhere.fetch("/get-session");

    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ user: { id: admin.id } });
  });
});

describe("the endpoints that change, reveal or list factors or sessions", () => {
  it.each([...FACTOR_PATHS, ...CLOSED_SESSION_PATHS])(
    "answers %s as absent, to a signed-in person",
    async (path) => {
      const person = await app().person();
      const client = await signedInClient(app(), person.email);
      expect((await client.fetch("/get-session")).status).toBe(200);

      expect((await client.fetch(path)).status).toBe(404);
      expect((await client.json(path, {})).status).toBe(404);
    },
  );

  it("reads the plugins' paths, the key-revealing one among them", () => {
    expect(FACTOR_PATHS).toContain("/two-factor/get-totp-uri");
    expect(FACTOR_PATHS).toContain("/passkey/verify-registration");
  });
});

describe("a session read", () => {
  it("comes from the database: a deleted session reads as none", async () => {
    const person = await app().person();
    const client = await signedInClient(app(), person.email);
    expect(await (await client.fetch("/get-session")).json()).toMatchObject({
      user: { id: person.id },
    });

    await app().database.superuser.query("DELETE FROM session WHERE user_id = $1", [person.id]);

    expect(await (await client.fetch("/get-session")).json()).toBeNull();
  });

  it("carries none of the second factor's own fields, once written", async () => {
    const person = await app().person();
    const client = await signedInClient(app(), person.email);
    await app().database.superuser.query(
      `UPDATE session SET second_factor_confirmed_at = now(), pending_since = now(),
                          setup_granted_at = now()
        WHERE user_id = $1`,
      [person.id],
    );
    await app().database.superuser.query(
      `UPDATE "user" SET passkey_offer_dismissed_at = now(), recovery_codes_acknowledged = true,
                         restore_required_at = now()
        WHERE id = $1`,
      [person.id],
    );

    const read = sessionRead.parse(await (await client.fetch("/get-session")).json());

    expect(read.user["id"]).toBe(person.id);
    for (const field of SESSION_FIELDS) expect(read.session).not.toHaveProperty(field);
    for (const field of USER_FIELDS) expect(read.user).not.toHaveProperty(field);
  });
});

describe("the second factor's own fields", () => {
  it("are declared for the platform alone to write and read", () => {
    const declared: Record<string, Declared> = {
      ...asBuilt.options.user.additionalFields,
      ...asBuilt.options.session.additionalFields,
    };

    for (const field of [...SESSION_FIELDS, ...USER_FIELDS]) {
      expect(declared[field]).toMatchObject({ required: false, input: false, returned: false });
    }
  });
});
