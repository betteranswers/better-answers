import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";
import { z } from "zod";

import type { Claims } from "@better-answers/core/kernel";

/**
 * The two credential paths reduced to `Claims` (the resolver's input): an OAuth bearer
 * verified in process against Better Auth's own JWKS, and a Better Auth cookie session.
 * Nothing past this file knows which library minted either (ADR 0009).
 */

/** The claim set prototype 61 observed on the wire: `{workspace, user}` and no role. */
const accessTokenClaims = z.object({
  jti: z.string().min(1),
  iat: z.number(),
  exp: z.number(),
  scope: z.string().default(""),
  client_id: z.string().optional(),
  azp: z.string().optional(),
  sub: z.string().optional(),
  user: z.string().nullish(),
  workspace: z.string().nullish(),
});

export type VerifiedBearer = {
  readonly claims: Claims;
  readonly tokenId: string;
};

/** What the surface reads back out of `authInfo.extra` — parsed, never cast. */
const bearerExtra = z.object({
  tokenId: z.string().min(1),
  claims: z.object({
    workspaceId: z.string(),
    userId: z.string(),
    issuedAt: z.date(),
  }),
});

export const bearerOf = (authInfo: AuthInfo): VerifiedBearer | undefined => {
  const parsed = bearerExtra.safeParse(authInfo.extra);
  return parsed.success ? parsed.data : undefined;
};

export type JwksSource = () => Promise<JSONWebKeySet>;

const invalid = (message: string): OAuthError =>
  new OAuthError(OAuthErrorCode.InvalidToken, message);

/**
 * An `OAuthTokenVerifier` (the SDK's seam) over jose: signature against the JWKS the
 * authorization server publishes, `iss`, **`aud` equal to the MCP URL exactly** (the
 * audience check is ours — research 80 row 24 found the SDK never wires it), `exp`.
 * The key set is read in process and re-read once when a token names a `kid` it does
 * not hold, which is what a rotation looks like from here.
 */
export const createTokenVerifier = (options: {
  readonly issuer: string;
  readonly audience: string;
  readonly jwks: JwksSource;
}): OAuthTokenVerifier => {
  let keys: ReturnType<typeof createLocalJWKSet> | undefined;

  const currentKeys = async (refresh = false) => {
    if (keys === undefined || refresh) keys = createLocalJWKSet(await options.jwks());
    return keys;
  };

  const verify = async (token: string) => {
    const verifyOptions = { issuer: options.issuer, audience: options.audience };
    try {
      return await jwtVerify(token, await currentKeys(), verifyOptions);
    } catch (cause) {
      if (!(cause instanceof joseErrors.JWKSNoMatchingKey)) throw cause;
      // A `kid` this process has not seen: read the set once more before refusing.
      return jwtVerify(token, await currentKeys(true), verifyOptions);
    }
  };

  return {
    async verifyAccessToken(token) {
      let header: ReturnType<typeof decodeProtectedHeader>;
      try {
        header = decodeProtectedHeader(token);
      } catch {
        throw invalid("the bearer is not a JWT");
      }
      if (header.alg === undefined) throw invalid("the bearer names no algorithm");

      let payload;
      try {
        payload = (await verify(token)).payload;
      } catch (cause) {
        throw invalid(cause instanceof Error ? cause.message : "the bearer did not verify");
      }
      const parsed = accessTokenClaims.safeParse(payload);
      if (!parsed.success) throw invalid("the bearer's claims are not the surface's");
      const { data } = parsed;
      const userId = data.user ?? data.sub;
      if (data.workspace === null || data.workspace === undefined || userId === undefined) {
        throw invalid("the bearer names no workspace");
      }

      const claims: Claims = {
        workspaceId: data.workspace,
        userId,
        issuedAt: new Date(data.iat * 1000),
      };
      return {
        token,
        clientId: data.azp ?? data.client_id ?? "",
        scopes: data.scope.split(" ").filter((scope) => scope !== ""),
        expiresAt: data.exp,
        resource: new URL(options.audience),
        extra: { claims, tokenId: data.jti } satisfies z.input<typeof bearerExtra>,
      };
    },
  };
};

/** The Better Auth session shape this module reads; the active workspace is the organisation plugin's field. */
const sessionShape = z.object({
  user: z.object({ id: z.string().min(1) }),
  session: z.object({
    createdAt: z.coerce.date(),
    activeOrganizationId: z.string().nullish(),
  }),
});

/** What Better Auth's `getSession` answers, as far as this module reads it. */
export type SessionRecord = {
  readonly user: { readonly id: string };
  readonly session: { readonly createdAt: Date; readonly activeOrganizationId?: string | null };
};
export type SessionReader = (headers: Headers) => Promise<SessionRecord | null>;

/**
 * The cookie-session path: a signed-in person with an active workspace becomes the
 * same `Claims` a bearer does, and goes through the same resolver. No active
 * workspace is no claims — the picker has not been passed.
 */
export const sessionClaims = async (
  readSession: SessionReader,
  headers: Headers,
): Promise<Claims | undefined> => {
  const parsed = sessionShape.safeParse(await readSession(headers));
  if (!parsed.success) return undefined;
  const workspaceId = parsed.data.session.activeOrganizationId;
  if (workspaceId === null || workspaceId === undefined) return undefined;
  return {
    workspaceId,
    userId: parsed.data.user.id,
    issuedAt: parsed.data.session.createdAt,
  };
};
