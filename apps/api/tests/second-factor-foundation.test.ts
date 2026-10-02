import { createHmac } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { mountedPaths } from "../src/auth/index.ts";
import { authAsServerBuildsIt, authOver } from "./auth-instance.ts";
import type { TestApp, TestClient } from "./harness.ts";
import { signedInClient } from "./provoke.ts";
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

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The key as an authenticator reads it from the setup address: RFC 4648 base32, unpadded. */
const keyOf = (setupAddress: string): Buffer => {
  const written = new URL(setupAddress).searchParams.get("secret") ?? "";
  const bits = written
    .split("")
    .map((letter) => BASE32.indexOf(letter).toString(2).padStart(5, "0"))
    .join("");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
};

/** The six digits an authenticator shows now: RFC 6238, SHA-1 over thirty seconds. */
const codeShownNow = (key: Buffer): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7f_ff_ff_ff) % 1_000_000).padStart(6, "0");
};

const setUp = z.object({ totpURI: z.string() });

/** Through the library's own enable and first verify, called as server functions. */
const setUpAnAuthenticator = async (suite: TestApp, client: TestClient): Promise<void> => {
  const auth = authOver(suite);
  const enabled = setUp.parse(
    await auth.api.enableTwoFactor({
      headers: new Headers({ cookie: client.cookies() }),
      body: { method: "totp" },
    }),
  );
  await auth.api.verifyTOTP({
    headers: new Headers({ cookie: client.cookies() }),
    body: { code: codeShownNow(keyOf(enabled.totpURI)) },
  });
};

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
});
