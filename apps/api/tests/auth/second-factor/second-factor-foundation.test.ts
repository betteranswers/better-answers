import { describe, expect, it } from "vitest";
import { z } from "zod";

import { mountedPaths } from "../../../src/auth/index.ts";
import { authAsBuiltForSuite } from "../../support/auth-instance.ts";
import {
  setUpAnAuthenticator,
  signedInByEmailOnly,
  signedInClient,
} from "../../support/provoke.ts";
import { appForSuite } from "../../support/suite-app.ts";

const app = appForSuite();

const asBuilt = authAsBuiltForSuite();

const FACTOR_PATHS = mountedPaths(asBuilt).filter(
  (path) => path.startsWith("/passkey/") || path.startsWith("/two-factor/"),
);

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
  "promotedAt",
] as const;

type Declared = { required?: unknown; input?: unknown; returned?: unknown };

const sessionRead = z.object({
  user: z.record(z.string(), z.unknown()),
  session: z.record(z.string(), z.unknown()),
});

const authenticatorRowsOf = async (personId: string) => {
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
  // Better Auth's two-factor check skips email-code sign-in, so the API marks the session pending itself.
  it("can read its session but gets 403 from /me", async () => {
    const { admin } = await app().provision();
    await setUpAnAuthenticator(app(), await signedInByEmailOnly(app(), admin.email));
    expect(await authenticatorRowsOf(admin.id)).toEqual([
      { authenticator_enabled: true, verified: true },
    ]);

    const elsewhere = await signedInByEmailOnly(app(), admin.email);
    const read = await elsewhere.fetch("/get-session");
    const me = await elsewhere.fetch("/me");

    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ user: { id: admin.id } });
    expect(me.status).toBe(403);
    expect(await me.json()).toEqual({ error: "second-factor-pending" });
  });
});

describe("the endpoints that change, reveal or list factors or sessions", () => {
  it.each([...FACTOR_PATHS, ...CLOSED_SESSION_PATHS])(
    "answers 404 at %s to a signed-in person",
    async (path) => {
      const person = await app().person();
      const client = await signedInClient(app(), person.email);
      expect((await client.fetch("/get-session")).status).toBe(200);

      expect((await client.fetch(path)).status).toBe(404);
      expect((await client.json(path, {})).status).toBe(404);
    },
  );

  it("finds the plugin paths, including /two-factor/get-totp-uri", () => {
    expect(FACTOR_PATHS).toContain("/two-factor/get-totp-uri");
    expect(FACTOR_PATHS).toContain("/passkey/verify-registration");
  });
});

describe("a session read", () => {
  it("returns null once the session row is deleted", async () => {
    const person = await app().person();
    const client = await signedInClient(app(), person.email);
    expect(await (await client.fetch("/get-session")).json()).toMatchObject({
      user: { id: person.id },
    });

    await app().database.superuser.query("DELETE FROM session WHERE user_id = $1", [person.id]);

    expect(await (await client.fetch("/get-session")).json()).toBeNull();
  });

  it("omits the second-factor fields even when they are set", async () => {
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
                         restore_required_at = now(), promoted_at = now()
        WHERE id = $1`,
      [person.id],
    );

    const read = sessionRead.parse(await (await client.fetch("/get-session")).json());

    expect(read.user["id"]).toBe(person.id);
    for (const field of SESSION_FIELDS) expect(read.session).not.toHaveProperty(field);
    for (const field of USER_FIELDS) expect(read.user).not.toHaveProperty(field);
  });
});

describe("the second-factor fields", () => {
  it("are optional, never accepted as input, and never returned", () => {
    const declared: Record<string, Declared> = {
      ...asBuilt.options.user.additionalFields,
      ...asBuilt.options.session.additionalFields,
    };

    for (const field of [...SESSION_FIELDS, ...USER_FIELDS]) {
      expect(declared[field]).toMatchObject({ required: false, input: false, returned: false });
    }
  });
});
