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
  type JWTPayload,
  type ProtectedHeaderParameters,
} from "jose";
import { z } from "zod";

import type { Claims } from "@better-answers/core/kernel";

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

const bearerExtra = z.object({
  tokenId: z.string().min(1),
  claims: z.object({
    workspaceId: z.string(),
    userId: z.string(),
    issuedAt: z.date(),
  }),
});

/** Undefined when the auth info was not made by this module's verifier. */
export const bearerOf = (authInfo: AuthInfo): VerifiedBearer | undefined => {
  const parsed = bearerExtra.safeParse(authInfo.extra);
  return parsed.success ? parsed.data : undefined;
};

export type JwksSource = () => Promise<JSONWebKeySet>;

const invalid = (message: string): OAuthError =>
  new OAuthError(OAuthErrorCode.InvalidToken, message);

const headerOf = (token: string): ProtectedHeaderParameters => {
  try {
    return decodeProtectedHeader(token);
  } catch {
    throw invalid("the bearer is not a JWT");
  }
};

type SurfaceToken = {
  readonly payload: z.infer<typeof accessTokenClaims>;
  readonly claims: Claims;
};

const surfaceTokenOf = (verified: JWTPayload): SurfaceToken => {
  const parsed = accessTokenClaims.safeParse(verified);
  if (!parsed.success) throw invalid("the bearer's claims are not the surface's");
  const { data } = parsed;
  const userId = data.user ?? data.sub;
  if (data.workspace === null || data.workspace === undefined || userId === undefined) {
    throw invalid("the bearer names no workspace");
  }
  return {
    payload: data,
    claims: { workspaceId: data.workspace, userId, issuedAt: new Date(data.iat * 1000) },
  };
};

/**
 * The verifier refuses with `invalid_token` when a bearer's signature, issuer, audience, expiry or
 * claims fail. An unseen key id rereads the key set once.
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

      return jwtVerify(token, await currentKeys(true), verifyOptions);
    }
  };

  const payloadOf = async (token: string): Promise<JWTPayload> => {
    try {
      return (await verify(token)).payload;
    } catch (cause) {
      throw invalid(cause instanceof Error ? cause.message : "the bearer did not verify");
    }
  };

  return {
    async verifyAccessToken(token) {
      if (headerOf(token).alg === undefined) throw invalid("the bearer names no algorithm");
      const { payload, claims } = surfaceTokenOf(await payloadOf(token));
      return {
        token,
        clientId: payload.azp ?? payload.client_id ?? "",
        scopes: payload.scope.split(" ").filter((scope) => scope !== ""),
        expiresAt: payload.exp,
        resource: new URL(options.audience),
        extra: { claims, tokenId: payload.jti } satisfies z.input<typeof bearerExtra>,
      };
    },
  };
};

const sessionShape = z.object({
  user: z.object({ id: z.string().min(1) }),
  session: z.object({
    createdAt: z.coerce.date(),
    activeOrganizationId: z.string().nullish(),
  }),
});

type SessionRecord = {
  readonly user: { readonly id: string };
  readonly session: {
    readonly id: string;
    readonly createdAt: Date;
    readonly activeOrganizationId?: string | null | undefined;
  };
};
export type SessionReader = (headers: Headers) => Promise<SessionRecord | null>;

/** Undefined when the headers carry no session, or a session with no workspace chosen. */
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
