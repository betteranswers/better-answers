import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import type pg from "pg";

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

export const verificationCodeFor = async (pool: pg.Pool, identifier: string): Promise<string> => {
  const verificationId = ulid();
  const superuser = await pool.connect();
  try {
    await superuser.query(
      `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, 'code', now(), now(), now())`,
      [verificationId, identifier],
    );
  } finally {
    superuser.release();
  }
  return verificationId;
};

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

/** The row the operator's correction of a display name leaves, stamped now, before its act exists. */
export const correctionOf = async (
  pool: pg.Pool,
  person: { readonly personId: string; readonly operatorId: string },
): Promise<void> => {
  await pool.query(
    `INSERT INTO identity_audit_event (id, act, actor, subject_id, detail)
     VALUES ($1, 'people.person.renamed', $2, $3, '{}'::jsonb)`,
    [ulid(), `human:${person.operatorId}`, person.personId],
  );
};

type CredentialPair = {
  readonly earlier: string;
  readonly later: string;
};

const OAUTH_CLIENT_ID = "https://c.example/x";

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
