import type pg from "pg";

import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

export type IdentityRows = {
  readonly sessionId: string;
  readonly accountId: string;
  readonly verificationId: string;
};

export const identityRowsFor = async (
  pool: pg.Pool,
  person: { readonly userId: string; readonly email: string },
): Promise<IdentityRows> => {
  const sessionId = ulid();
  const accountId = ulid();
  const superuser = await pool.connect();
  try {
    await superuser.query(
      `INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
       VALUES ($1, now(), $2, now(), now(), '203.0.113.7', 'Mozilla/5.0', $3)`,
      [sessionId, `token-${sessionId}`, person.userId],
    );
    await superuser.query(
      `INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at)
       VALUES ($1, $2, 'google', $3, now(), now())`,
      [accountId, `google-${accountId}`, person.userId],
    );
  } finally {
    superuser.release();
  }
  return { sessionId, accountId, verificationId: await verificationCodeFor(pool, person.email) };
};

export type SecondFactorRows = {
  readonly passkeyId: string;
  readonly authenticatorId: string;
  readonly recoveryCodeIds: readonly string[];
};

/** A passkey and its last use, an authenticator, two recovery codes, and the person's three flags set. */
export const secondFactorRowsFor = async (
  pool: pg.Pool,
  userId: string,
): Promise<SecondFactorRows> => {
  const passkeyId = ulid();
  const authenticatorId = ulid();
  const recoveryCodeIds = [ulid(), ulid()];
  const superuser = await pool.connect();
  try {
    await superuser.query(
      `INSERT INTO passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, 'MacBook', 'public-key', $2, $3, 0, 'multiDevice', true)`,
      [passkeyId, userId, `credential-${passkeyId}`],
    );
    await superuser.query("INSERT INTO passkey_last_use (passkey_id, at) VALUES ($1, now())", [
      passkeyId,
    ]);
    await superuser.query(
      `INSERT INTO authenticator (id, secret, backup_codes, user_id)
       VALUES ($1, 'sealed-secret', 'sealed-codes', $2)`,
      [authenticatorId, userId],
    );
    for (const id of recoveryCodeIds) {
      await superuser.query(
        "INSERT INTO recovery_code (id, user_id, code_hash) VALUES ($1, $2, $3)",
        [id, userId, `hash-${id}`],
      );
    }
    await superuser.query(
      `UPDATE "user" SET authenticator_enabled = true, passkey_offer_dismissed_at = now(),
              recovery_codes_acknowledged = true
        WHERE id = $1`,
      [userId],
    );
  } finally {
    superuser.release();
  }
  return { passkeyId, authenticatorId, recoveryCodeIds };
};

export const lastActiveIn = async (
  pool: pg.Pool,
  workspaceId: string,
  userId: string,
): Promise<void> => {
  await pool.query(
    "INSERT INTO workspace_last_active (workspace_id, user_id, at) VALUES ($1, $2, now())",
    [workspaceId, userId],
  );
};

const verificationRow = async (
  pool: pg.Pool,
  row: { readonly id: string; readonly identifier: string; readonly value: string },
): Promise<string> => {
  const superuser = await pool.connect();
  try {
    await superuser.query(
      `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now(), now())`,
      [row.id, row.identifier, row.value],
    );
  } finally {
    superuser.release();
  }
  return row.id;
};

/** A sign-in code's row in the shape Better Auth writes it: keyed by the address, hashed, no tries spent. */
export const verificationCodeFor = async (pool: pg.Pool, email: string): Promise<string> =>
  verificationRow(pool, {
    id: ulid(),
    identifier: `sign-in-otp-${email.toLowerCase()}`,
    value: "hashed-code:0",
  });

/** The rows Better Auth writes for an address asked to verify or reset, though the product never sends either. */
export const otherCodesFor = async (pool: pg.Pool, email: string): Promise<readonly string[]> => [
  await verificationRow(pool, {
    id: ulid(),
    identifier: `email-verification-otp-${email.toLowerCase()}`,
    value: "hashed-code:0",
  }),
  await verificationRow(pool, {
    id: ulid(),
    identifier: `forget-password-otp-${email.toLowerCase()}`,
    value: "hashed-code:0",
  }),
];

/** The row a sign-in link keeps beside its code: its id the link's hash, keyed by the address. */
export const signInLinkFor = async (pool: pg.Pool, email: string): Promise<string> =>
  verificationRow(pool, {
    id: `${ulid().toLowerCase()}-link`,
    identifier: `sign-in-link-${email.toLowerCase()}`,
    value: '{"nonce":"n","sealed":"s"}',
  });

export const sessionFor = async (
  pool: pg.Pool,
  userId: string,
  at: { readonly createdAt: Date; readonly lastUsedAt: Date; readonly expiresAt: Date },
): Promise<string> => {
  const sessionId = ulid();
  await pool.query(
    `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, at.expiresAt, `token-${sessionId}`, at.createdAt, at.lastUsedAt, userId],
  );
  return sessionId;
};

type CredentialPair = {
  readonly earlier: string;
  readonly later: string;
};

export const OAUTH_CLIENT_ID = "https://c.example/x";

export const issuedCredentialsFor = async (
  pool: pg.Pool,
  userId: string,
  issued: {
    readonly sessions: CredentialPair;
    readonly refreshTokens: CredentialPair;
    readonly accessTokens: CredentialPair;
    readonly moments: { readonly earlier: Date; readonly later: Date };
  },
): Promise<void> => {
  const superuser = await pool.connect();
  try {
    for (const [id, createdAt] of [
      [issued.sessions.earlier, issued.moments.earlier],
      [issued.sessions.later, issued.moments.later],
    ] as const) {
      await superuser.query(
        "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ($1, now(), $2, $3, now(), $4)",
        [id, `token-${id}`, createdAt, userId],
      );
    }
    await superuser.query(
      "INSERT INTO oauth_client (id, client_id, redirect_uris) VALUES ('c', $1, ARRAY['https://c.example/cb'])",
      [OAUTH_CLIENT_ID],
    );
    for (const [id, createdAt] of [
      [issued.refreshTokens.earlier, issued.moments.earlier],
      [issued.refreshTokens.later, issued.moments.later],
    ] as const) {
      await superuser.query(
        "INSERT INTO oauth_refresh_token (id, token, client_id, user_id, expires_at, created_at, scopes) VALUES ($1, $2, $3, $4, now(), $5, ARRAY['knowledge:read'])",
        [id, `token-${id}`, OAUTH_CLIENT_ID, userId, createdAt],
      );
    }
    for (const [id, createdAt] of [
      [issued.accessTokens.earlier, issued.moments.earlier],
      [issued.accessTokens.later, issued.moments.later],
    ] as const) {
      await testData(superuser).oauthAccessToken({
        id,
        clientId: OAUTH_CLIENT_ID,
        userId,
        createdAt,
      });
    }
  } finally {
    superuser.release();
  }
};

/** Seeded tokens named by grant, so an assertion reads which ones an act ended. */
export type NamedGrants = {
  readonly clientId: string;
  readonly labelById: ReadonlyMap<string, string>;
};

export const endedGrants = async (
  pool: pg.Pool,
  grants: NamedGrants,
): Promise<readonly string[]> => {
  const held = await pool.query<{ id: string }>(
    `SELECT id FROM oauth_refresh_token WHERE client_id = $1
     UNION ALL
     SELECT id FROM oauth_access_token WHERE client_id = $1`,
    [grants.clientId],
  );
  const stillHeld = new Set(held.rows.map((row) => row.id));
  return [...grants.labelById]
    .filter(([id]) => !stillHeld.has(id))
    .map(([, name]) => name)
    .toSorted();
};
