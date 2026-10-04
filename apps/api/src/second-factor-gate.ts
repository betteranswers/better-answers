import {
  type Clock,
  isPending,
  mayTake,
  type PendingStep,
  type Result,
  type SecondFactorRefusal,
  type SecondFactorStanding,
} from "@better-answers/core/kernel";
import type { PostgresDoor } from "@better-answers/core/store/postgres";
import {
  judgeTheSession,
  type SessionNamed,
  type SessionStanding,
} from "@better-answers/core/workspaces";

import type { SessionReader } from "./auth/verify.ts";
import { IDENTITY_PRINCIPAL } from "./identity-principal.ts";

/** What a pending session meets, in every transport's refusal. */
export const SECOND_FACTOR_PENDING = "second-factor-pending" satisfies SecondFactorRefusal;

/** The tRPC procedures a pending session may still call: the pending pages read these. */
export const PENDING_PROCEDURES: ReadonlyMap<string, PendingStep> = new Map<string, PendingStep>([
  ["session.operator", "read-the-operator-standing"],
  ["person.secondFactor", "read-the-second-factor"],
]);

/** The library's paths a pending session may still reach. */
export const PENDING_LIBRARY_PATHS: ReadonlyMap<string, PendingStep> = new Map<string, PendingStep>(
  [
    ["/get-session", "read-the-session"],
    ["/sign-out", "sign-out"],
    ["/oauth2/end-session", "sign-out"],
  ],
);

/** Paths acting on no session the browser holds: a sign-in makes one; a client or a bearer reads none. */
export const SESSIONLESS_LIBRARY_PATHS: ReadonlySet<string> = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
  "/callback/:id",
  "/email-otp/check-verification-otp",
  "/email-otp/send-verification-otp",
  "/error",
  "/jwks",
  "/oauth2/introspect",
  "/oauth2/public-client",
  "/oauth2/public-client-prelogin",
  "/oauth2/register",
  "/oauth2/revoke",
  "/oauth2/token",
  "/oauth2/userinfo",
  "/ok",
  "/sign-in/email-otp",
  "/sign-in/social",
]);

/** Reached by a pending session too, whose post-login rule then sends it on before any consent. */
export const AUTHORIZE_PATH = "/oauth2/authorize";

export type Gatekeeping = { readonly door: PostgresDoor; readonly clock: Clock };

/** The session's standing now, its pending hour started, stopped or ended by this read. */
export const judged = (
  deps: Gatekeeping,
  session: SessionNamed,
): Promise<Result<SessionStanding, "session-gone" | Error>> =>
  judgeTheSession(IDENTITY_PRINCIPAL, deps.door, { session, now: deps.clock.now() });

/** A failed read is pending too: the gate never opens on a fault. */
export const pendingOr = (read: Result<SessionStanding, "session-gone" | Error>): boolean =>
  !read.ok || isPending(read.value.standing);

/** Undefined: the step is the session's to take. */
export const refusalFor = (
  standing: SecondFactorStanding,
  step: PendingStep | undefined,
): typeof SECOND_FACTOR_PENDING | undefined =>
  mayTake(standing, step) ? undefined : SECOND_FACTOR_PENDING;

type SessionRead = NonNullable<Awaited<ReturnType<SessionReader>>>;

type GatedSession = SessionRead & { readonly standing: SecondFactorStanding };

/** Null for no session, or one this read ended. */
export type GatedSessionReader = (headers: Headers) => Promise<GatedSession | null>;

/** The library's session, judged: a fault throws, so the gate never opens on one. */
export const gatedReader =
  (read: SessionReader, deps: Gatekeeping): GatedSessionReader =>
  async (headers) => {
    const session = await read(headers);
    if (session === null) return null;
    const standing = await judged(deps, { id: session.session.id });
    if (standing.ok) return { ...session, standing: standing.value.standing };
    if (standing.error instanceof Error) throw standing.error;
    return null;
  };
