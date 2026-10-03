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

/**
 * A passkey and its last use, an authenticator, two recovery codes, failed confirms of two kinds,
 * and the person's four flags set.
 */
export const secondFactorRowsFor = async (
  pool: pg.Pool,
  userId: string,
): Promise<SecondFactorRows> => {
  const passkeyId = ulid();
  const authenticatorId = ulid();
  const recoveryCodeIds = [ulid(), ulid()];
  await pool.query(
    `INSERT INTO passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up)
     VALUES ($1, 'MacBook', 'public-key', $2, $3, 0, 'multiDevice', true)`,
    [passkeyId, userId, `credential-${passkeyId}`],
  );
  await pool.query("INSERT INTO passkey_last_use (passkey_id, at) VALUES ($1, now())", [passkeyId]);
  await pool.query(
    `INSERT INTO authenticator (id, secret, backup_codes, user_id)
     VALUES ($1, 'sealed-secret', 'sealed-codes', $2)`,
    [authenticatorId, userId],
  );
  for (const id of recoveryCodeIds) {
    await pool.query("INSERT INTO recovery_code (id, user_id, code_hash) VALUES ($1, $2, $3)", [
      id,
      userId,
      `hash-${id}`,
    ]);
  }
  await pool.query(
    `INSERT INTO second_factor_throttle (user_id, kind, failures, wait_until, noticed_at)
     VALUES ($1, 'authenticator', 6, now(), now()), ($1, 'restore-code', 1, NULL, NULL)`,
    [userId],
  );
  await pool.query(
    `UPDATE "user" SET authenticator_enabled = true, passkey_offer_dismissed_at = now(),
            recovery_codes_acknowledged = true, restore_required_at = now()
      WHERE id = $1`,
    [userId],
  );
  return { passkeyId, authenticatorId, recoveryCodeIds };
};

/** An authenticator as the plugin writes one: `verified` false while its setup waits on a code. */
export const authenticatorFor = async (
  pool: pg.Pool,
  userId: string,
  state: { readonly verified: boolean },
): Promise<string> => {
  const authenticatorId = ulid();
  await pool.query(
    `INSERT INTO authenticator (id, secret, backup_codes, user_id, verified)
     VALUES ($1, 'sealed-secret', 'sealed-codes', $2, $3)`,
    [authenticatorId, userId, state.verified],
  );
  if (state.verified) {
    await pool.query('UPDATE "user" SET authenticator_enabled = true WHERE id = $1', [userId]);
  }
  return authenticatorId;
};

/** A recovery code stored as its hash; the hash is the code itself, which no spend reaches. */
export const recoveryCodeFor = async (
  pool: pg.Pool,
  userId: string,
  createdAt: Date,
): Promise<string> => {
  const recoveryCodeId = ulid();
  await pool.query(
    "INSERT INTO recovery_code (id, user_id, code_hash, created_at) VALUES ($1, $2, $1, $3)",
    [recoveryCodeId, userId, createdAt],
  );
  return recoveryCodeId;
};

export const passkeyFor = async (pool: pg.Pool, userId: string): Promise<string> => {
  const passkeyId = ulid();
  await pool.query(
    `INSERT INTO passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up)
     VALUES ($1, 'MacBook', 'public-key', $2, $3, 0, 'multiDevice', true)`,
    [passkeyId, userId, `credential-${passkeyId}`],
  );
  return passkeyId;
};

/** As a passkey sign-in leaves it. */
export const passkeyUsedAt = async (pool: pg.Pool, passkeyId: string, at: Date): Promise<void> => {
  await pool.query("INSERT INTO passkey_last_use (passkey_id, at) VALUES ($1, $2)", [
    passkeyId,
    at,
  ]);
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
  row: {
    readonly id: string;
    readonly identifier: string;
    readonly value: string;
    readonly expiresAt?: Date;
  },
): Promise<string> => {
  const superuser = await pool.connect();
  try {
    await superuser.query(
      `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, COALESCE($4, now()), now(), now())`,
      [row.id, row.identifier, row.value, row.expiresAt ?? null],
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

/** An operator's restore code as issued: keyed by the address, and kept only as the code's hash. */
export const restoreCodeFor = async (
  pool: pg.Pool,
  email: string,
  code: { readonly hash: string; readonly expiresAt: Date },
): Promise<string> =>
  verificationRow(pool, {
    id: ulid(),
    identifier: `operator-restore-${email.toLowerCase()}`,
    value: code.hash,
    expiresAt: code.expiresAt,
  });

/** A replacement setup's secret, sealed and parked under the session that started it. */
export const parkedSecretFor = async (pool: pg.Pool, sessionId: string): Promise<string> =>
  verificationRow(pool, {
    id: ulid(),
    identifier: `second-factor-enrol:${sessionId}`,
    value: "sealed-secret",
  });

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
  at: {
    readonly createdAt: Date;
    readonly lastUsedAt: Date;
    readonly expiresAt: Date;
    readonly pendingSince?: Date;
  },
): Promise<string> => {
  const sessionId = ulid();
  await pool.query(
    `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, pending_since)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      at.expiresAt,
      `token-${sessionId}`,
      at.createdAt,
      at.lastUsedAt,
      userId,
      at.pendingSince ?? null,
    ],
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
