import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { betterAuth, type Session } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, jwt, organization, twoFactor } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth/types";
import { drizzle } from "drizzle-orm/node-postgres";
import { decodeJwt } from "jose";
import type pg from "pg";
import type { Logger } from "pino";
import { z } from "zod";

import {
  attempt,
  type Clock,
  err,
  isPending,
  type Result,
  ulid,
} from "@better-answers/core/kernel";
import { withIdentityWrite, type PostgresDoor } from "@better-answers/core/store/postgres";
import {
  hasNoDisplayName,
  recordConsent,
  recordPasskeyUse,
  recordSignIn,
  type SignInMethod,
  workspacesHeldBy,
} from "@better-answers/core/workspaces";
import {
  account,
  authenticator,
  invitation,
  INVITATION_EXPIRY_SECONDS,
  jwks,
  member,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  passkey,
  rateLimit,
  session,
  user,
  verification,
  workspace,
} from "@better-answers/schema";
import { EMAIL_CODE_ATTEMPTS, EMAIL_CODE_LENGTH } from "@better-answers/schema/email-code";

import type { EmailSender } from "../email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { PRODUCT_NAME } from "../product-name.ts";
import {
  AUTHORIZE_PATH,
  judged,
  PENDING_LIBRARY_PATHS,
  pendingOr,
  refusalFor,
  SECOND_FACTOR_PENDING,
  SESSIONLESS_LIBRARY_PATHS,
} from "../second-factor-gate.ts";
import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  CIMD_ALLOWED_CLIENT_HOSTS,
  CLIENT_IP_HEADER,
  EMAIL_CODE_LIFETIME_SECONDS,
  OAUTH_SCOPES,
  PASSKEY_VERIFY_PATH,
  REFRESH_TOKEN_LIFETIME_SECONDS,
  SIGN_IN_PATH,
} from "./constants.ts";
import { codeHashOf } from "./link-token.ts";
import { dropAnExpiredPromotionLock } from "./promotion-lock.ts";
import { accessControl, creatorRole, roles } from "./roles.ts";
import { signInEmail } from "./sign-in-email.ts";
import { keepALink, signInMethodOfThisCall } from "./sign-in-link.ts";
import { surfacingUniqueViolations } from "./unique-violations.ts";

type AuthEndpoint = NonNullable<BetterAuthPlugin["endpoints"]>[string];

type WidenedAuthorize<P extends { readonly endpoints: object }> = Omit<P, "endpoints"> & {
  readonly endpoints: Omit<P["endpoints"], "oauth2Authorize"> & {
    readonly oauth2Authorize: AuthEndpoint;
  };
};

const widenAuthorize = <P extends { readonly endpoints: object }>(plugin: P): WidenedAuthorize<P> =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a declaration gap: better-auth types `oauth2Authorize`'s openapi metadata outside `Endpoint`; the runtime value fits
  plugin as WidenedAuthorize<P>;

type ClientMetadataFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type AuthDependencies = {
  readonly database: pg.Pool;
  readonly door: PostgresDoor;

  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly secret: string;
  readonly sendEmail: EmailSender;
  readonly fetchClientMetadataResource: ClientMetadataFetch;
  readonly logger: Logger;
  readonly clock: Clock;
};

const identitySchema = {
  user,
  session,
  account,
  verification,
  jwks,
  workspace,
  member,
  invitation,
  oauthClient,
  oauthResource,
  oauthClientResource,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  oauthClientAssertion,
  rateLimit,
  authenticator,
  passkey,
};

type AuditEvent =
  | "auth.sign_in"
  | "auth.workspace_pick"
  | "auth.consent"
  | "auth.token_issue"
  | "auth.token_refresh"
  | "auth.revocation";

const AUDITED_PATHS: ReadonlyMap<string, AuditEvent> = new Map([
  ["/sign-in/email-otp", "auth.sign_in"],
  [PASSKEY_VERIFY_PATH, "auth.sign_in"],
  ["/organization/set-active", "auth.workspace_pick"],
  ["/oauth2/consent", "auth.consent"],
  ["/oauth2/token", "auth.token_issue"],
  ["/oauth2/revoke", "auth.revocation"],
]);

const auditedEvent = (path: string): AuditEvent | undefined => AUDITED_PATHS.get(path);

/**
 * Their writes change a member or a workspace with no audit event; the short name check tells
 * anyone whether a company is a customer.
 */
const CLOSED_ORGANISATION_PATHS = [
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/update-member-role",
  "/organization/remove-member",
  "/organization/leave",
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/check-slug",
] as const;

/**
 * Each adds, removes, reveals or spends a factor past our gate; our routes call the few they need
 * as server functions.
 */
const CLOSED_FACTOR_PATHS = [
  "/passkey/delete-passkey",
  "/passkey/generate-authenticate-options",
  "/passkey/generate-register-options",
  "/passkey/list-user-passkeys",
  "/passkey/update-passkey",
  "/passkey/verify-authentication",
  "/passkey/verify-registration",
  "/two-factor/disable",
  "/two-factor/enable",
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
  "/two-factor/send-otp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
  "/two-factor/verify-totp",
] as const;

/**
 * `/update-session` lets a session write its own fields; the rest list sessions with their
 * addresses, end them unrecorded, or drop a linked account.
 */
const CLOSED_SESSION_PATHS = [
  "/list-sessions",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/unlink-account",
  "/update-session",
] as const;

const tokenResponse = z.object({ access_token: z.string() }).optional().catch(undefined);
const mintedClaims = z.object({
  user: z.string().nullish(),
  sub: z.string().optional(),
  workspace: z.string().nullish(),
  jti: z.string().optional(),
  client_id: z.string().optional(),
  azp: z.string().optional(),
});

const bodyFields = z
  .object({
    client_id: z.string().optional(),
    grant_type: z.string().optional(),
    organizationId: z.string().optional(),
    accept: z.boolean().optional(),
    oauth_query: z.string().optional(),
  })
  .partial()
  .catch({});
const signedInUser = z
  .object({ user: z.object({ id: z.string() }) })
  .optional()
  .catch(undefined);
const redirectedTo = z.object({ url: z.string() }).optional().catch(undefined);
/** A before-hook reads the body ahead of the endpoint's own validation. */
const signInAddress = z.object({ email: z.string() }).optional().catch(undefined);

/** The credential a passkey sign-in presents, as the library's verify was handed it. */
const presentedCredential = z
  .object({ response: z.object({ id: z.string() }) })
  .optional()
  .catch(undefined);

/** Refused before a passkey is kept or a session made, so neither exists without it. */
export const USER_NOT_VERIFIED = "USER_NOT_VERIFIED";

/** The site a passkey is made for and the origin its answers come from, for the library and our confirm. */
export const passkeyPartyOf = (publicUrl: string) => {
  const address = new URL(publicUrl);
  return { rpID: address.hostname, origin: address.origin };
};

const userNotVerified = (): APIError =>
  new APIError("BAD_REQUEST", {
    code: USER_NOT_VERIFIED,
    message: "The device did not verify its user",
  });

/**
 * A consent the library defers to a fresh sign-in answers a redirect too, but only the one it
 * wrote carries a code.
 */
const carriesACode = (redirect: z.infer<typeof redirectedTo>): boolean =>
  redirect !== undefined && (URL.parse(redirect.url)?.searchParams.has("code") ?? false);

/**
 * Reading a stale cookie's session expires every session cookie, so a sign-in's own new session
 * is read before the request's.
 */
const sessionOfCall = async (ctx: Parameters<typeof getSessionFromCtx>[0]) =>
  ctx.context.session ?? ctx.context.newSession ?? (await getSessionFromCtx(ctx));

const clientIdOfQuery = (query: string | undefined): string | undefined =>
  query === undefined ? undefined : (new URLSearchParams(query).get("client_id") ?? undefined);

type AuditFields = z.infer<typeof bodyFields>;

type GateContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

type AuditedCall = {
  readonly fields: AuditFields;
  readonly refused: boolean;
  readonly issued: z.infer<typeof tokenResponse>;
  readonly signedIn: z.infer<typeof signedInUser>;
  readonly redirect: z.infer<typeof redirectedTo>;
};

type Outcome = "refused" | "declined" | "deferred" | "ok";

type AuditLine = {
  readonly event: AuditEvent;

  /** The library's path the call ran, which names how a sign-in was made. */
  readonly path: string;
  readonly principal: string | undefined;
  readonly workspaceId: string | undefined;
  readonly clientId: string | undefined;
  readonly tokenId: string | undefined;
};

const isRedirect = (failure: Error): boolean =>
  failure instanceof APIError && failure.statusCode >= 300 && failure.statusCode < 400;

const openedLine = (
  event: AuditEvent,
  path: string,
  principal: string | undefined,
  fields: AuditFields,
): AuditLine => ({
  event,
  path,
  principal,
  workspaceId: undefined,
  clientId: fields.client_id ?? clientIdOfQuery(fields.oauth_query),
  tokenId: undefined,
});

const signInMethodOf = (path: string): SignInMethod =>
  path === PASSKEY_VERIFY_PATH ? "passkey" : signInMethodOfThisCall();

const claimsOfIssued = (issued: AuditedCall["issued"]) => {
  if (issued === undefined) return undefined;
  const claims = mintedClaims.safeParse(decodeJwt(issued.access_token));
  return claims.success ? claims.data : undefined;
};

/** Named from the grant whatever the outcome, so a refused refresh never reads as a first issue. */
const tokenLine = (line: AuditLine, call: AuditedCall): AuditLine => {
  const event = call.fields.grant_type === "refresh_token" ? "auth.token_refresh" : line.event;
  const claims = claimsOfIssued(call.issued);
  if (claims === undefined) return { ...line, event };
  return {
    event,
    path: line.path,
    principal: claims.user ?? claims.sub,
    workspaceId: claims.workspace ?? undefined,
    clientId: line.clientId ?? claims.azp ?? claims.client_id,
    tokenId: claims.jti,
  };
};

const auditLineOf = (line: AuditLine, call: AuditedCall): AuditLine => {
  if (line.event === "auth.workspace_pick") {
    return { ...line, workspaceId: call.fields.organizationId };
  }
  if (line.event === "auth.token_issue") return tokenLine(line, call);
  if (line.event === "auth.sign_in" && call.signedIn !== undefined) {
    return { ...line, principal: call.signedIn.user.id };
  }
  return line;
};

const outcomeOf = (event: AuditEvent, call: AuditedCall): Outcome => {
  if (call.refused) return "refused";
  if (event !== "auth.consent") return "ok";
  if (call.fields.accept === false) return "declined";
  return carriesACode(call.redirect) ? "ok" : "deferred";
};

const auditRecord = (line: AuditLine, outcome: Outcome) => ({
  event: line.event,
  principal: line.principal ?? null,
  workspace: line.workspaceId ?? null,
  client_id: line.clientId ?? null,
  outcome,
  token_id: line.tokenId ?? null,
});

type Written = Result<undefined, string | Error>;

type Recorder = (line: AuditLine, session: Session | undefined) => Promise<Written>;

const reasonOf = (error: string | Error): string =>
  error instanceof Error ? error.message : error;

/**
 * A sign-in or a consent is an audit event; anything else, and anything refused, declined or
 * deferred, is a log line to `logger`.
 */
export const createAuth = (deps: AuthDependencies) => {
  const audit = deps.logger.child({ module: "auth" });

  const workspacesOf = async (userId: string): Promise<readonly string[]> => {
    const held = await workspacesHeldBy(IDENTITY_PRINCIPAL, deps.door, userId);
    if (held.ok) return held.value;
    if (held.error instanceof Error) throw held.error;
    audit.warn(
      { event: "auth.workspaces_read", principal: userId, outcome: held.error },
      "auth.workspaces_read",
    );
    return [];
  };

  const soleOf = (held: readonly string[]): string | undefined =>
    held.length === 1 ? held[0] : undefined;
  const soleWorkspaceOf = async (userId: string): Promise<string | undefined> =>
    soleOf(await workspacesOf(userId));

  const consentedWorkspaceOf = (session: Session, held: readonly string[]): string | undefined => {
    const stillActive = activeWorkspaceOf(session);
    return stillActive !== undefined && held.includes(stillActive) ? stillActive : soleOf(held);
  };

  const recordConsentOf: Recorder = async (line, session) => {
    const personId = line.principal ?? "";
    const held = await workspacesHeldBy(IDENTITY_PRINCIPAL, deps.door, personId);
    if (!held.ok) return held;
    const workspaceId =
      session === undefined ? undefined : consentedWorkspaceOf(session, held.value);
    if (workspaceId === undefined) return err("no-consented-workspace");
    return recordConsent(IDENTITY_PRINCIPAL, deps.door, {
      personId,
      workspaceId,
      clientId: line.clientId ?? "",
    });
  };

  /** A token's issue, refusal or refresh and a workspace pick stay log lines for good. */
  const recorders = new Map<AuditEvent, Recorder>([
    [
      "auth.sign_in",
      (line) =>
        recordSignIn(
          IDENTITY_PRINCIPAL,
          deps.door,
          line.principal ?? "",
          signInMethodOf(line.path),
        ),
    ],
    ["auth.consent", recordConsentOf],
  ]);

  /**
   * Outside the library's transaction, once its write has landed: a failed row is a log line,
   * never a refusal the person meets.
   */
  const recordOnAuditLog = async (
    recorder: Recorder,
    line: AuditLine,
    session: Session | undefined,
  ): Promise<void> => {
    const written = await recorder(line, session);
    if (written.ok) return;
    audit.error(
      { ...auditRecord(line, "ok"), recorded: false, reason: reasonOf(written.error) },
      line.event,
    );
  };

  /** A lock left standing is today's skipped promotion, so a failed clear never costs the sign-in. */
  const clearAnExpiredPromotionLock = async (email: string): Promise<void> => {
    const cleared = await attempt(() =>
      dropAnExpiredPromotionLock(deps.door, email, deps.clock.now()),
    );
    if (!cleared.ok)
      audit.warn(
        { event: "auth.promotion_lock_not_cleared", reason: cleared.error.message },
        "auth.promotion_lock_not_cleared",
      );
  };

  /** Counts as both factors. A last use not kept is a log line, never a refused sign-in. */
  const confirmingAPasskeySignIn = async (
    presented: z.output<typeof presentedCredential>,
  ): Promise<{ readonly secondFactorConfirmedAt: Date }> => {
    const at = deps.clock.now();
    const used =
      presented === undefined
        ? undefined
        : await recordPasskeyUse(IDENTITY_PRINCIPAL, deps.door, {
            credentialId: presented.response.id,
            at,
          });
    if (used?.ok === false) {
      audit.warn(
        { event: "auth.passkey_use_not_kept", reason: used.error.message },
        "auth.passkey_use_not_kept",
      );
    }
    return { secondFactorConfirmedAt: at };
  };

  /** Over HTTP alone: the api's own routes call closed endpoints as server functions and gate themselves. */
  const gatedToken = async (ctx: GateContext): Promise<string | undefined> => {
    if (ctx.request === undefined || SESSIONLESS_LIBRARY_PATHS.has(ctx.path)) return undefined;
    if (ctx.path === AUTHORIZE_PATH) return undefined;
    const token = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    );
    return typeof token === "string" ? token : undefined;
  };

  const readWithoutRenewal = (ctx: GateContext) =>
    ctx.path === "/get-session"
      ? { context: { query: { ...ctx.query, disableRefresh: true } } }
      : undefined;

  /** Past its hour, the row may outlive a skipped delete; signed out, as every other root reads it. */
  const endedHere = (ctx: GateContext) => {
    if (!PENDING_LIBRARY_PATHS.has(ctx.path)) throw new APIError("UNAUTHORIZED");
    return readWithoutRenewal(ctx);
  };

  /** A pending session reads itself without renewing it, and reaches nothing else here. */
  const gateTheLibrary = async (ctx: GateContext) => {
    const token = await gatedToken(ctx);
    if (token === undefined) return undefined;
    const standing = await judged(deps, { token });
    if (!standing.ok && standing.error instanceof Error) throw standing.error;
    if (!standing.ok) return endedHere(ctx);
    if (refusalFor(standing.value.standing, PENDING_LIBRARY_PATHS.get(ctx.path)) !== undefined) {
      throw new APIError("FORBIDDEN", {
        code: SECOND_FACTOR_PENDING,
        message: "Confirm the second factor first",
      });
    }
    return isPending(standing.value.standing) ? readWithoutRenewal(ctx) : undefined;
  };

  const db = drizzle(deps.database, { schema: identitySchema });

  return betterAuth({
    appName: PRODUCT_NAME,
    baseURL: deps.publicUrl,

    basePath: "/",
    secret: deps.secret,
    database: surfacingUniqueViolations(
      drizzleAdapter(db, { provider: "pg", schema: identitySchema }),
    ),

    trustedOrigins: [deps.publicUrl],
    /**
     * /token serves callers with no OAuth flow, which the library asks off under a provider;
     * /update-user writes a display name past its rule.
     */
    disabledPaths: [
      "/token",
      "/update-user",
      ...CLOSED_ORGANISATION_PATHS,
      ...CLOSED_FACTOR_PATHS,
      ...CLOSED_SESSION_PATHS,
    ],
    user: {
      additionalFields: {
        credentialsRevokedAt: { type: "date", required: false, input: false },
        /** Undeclared, the library would hand the column back on every session it answers. */
        operator: { type: "boolean", required: false, input: false, returned: false },
        passkeyOfferDismissedAt: { type: "date", required: false, input: false, returned: false },
        recoveryCodesAcknowledged: {
          type: "boolean",
          required: false,
          input: false,
          returned: false,
        },
        restoreRequiredAt: { type: "date", required: false, input: false, returned: false },
        promotedAt: { type: "date", required: false, input: false, returned: false },
      },
    },
    session: {
      /** Our confirmation stamp is the one freshness rule, so the library's own never refuses. */
      freshAge: 0,
      additionalFields: {
        secondFactorConfirmedAt: { type: "date", required: false, input: false, returned: false },
        pendingSince: { type: "date", required: false, input: false, returned: false },
        setupGrantedAt: { type: "date", required: false, input: false, returned: false },
      },
    },
    /**
     * The library's lookup deletes every expired row, so another person's sign-in would make a
     * code just expired read as wrong. The daily sweep deletes them.
     */
    verification: { disableCleanup: true },
    /**
     * The api counts every endpoint itself. The library counts a run of requests, not a
     * window, and every page its handler is handed.
     */
    rateLimit: { enabled: false },
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: {
        generateId: () => ulid(),
      },
      /**
       * The library defaults this to NODE_ENV === "test": unset, the fence is off under every
       * test runner and the suites asserting it still pass.
       */
      disableOriginCheck: false,
    },
    databaseHooks: {
      /** A first sign-in may carry a name, which would reach the row past the display-name rule. */
      user: {
        create: {
          before: async (person) => ({ data: { ...person, name: "" } }),
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            const confirmed =
              context?.path === PASSKEY_VERIFY_PATH
                ? await confirmingAPasskeySignIn(presentedCredential.parse(context.body))
                : {};
            const only = await soleWorkspaceOf(session.userId);
            const active = only === undefined ? {} : { activeOrganizationId: only };
            return { data: { ...session, ...confirmed, ...active } };
          },
        },
      },
    },
    hooks: {
      /**
       * The library proves an unverified address under a lock, and one a dead sign-in left would
       * skip it until the daily sweep.
       */
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email-otp") {
          const asked = signInAddress.parse(ctx.body);
          if (asked !== undefined) await clearAnExpiredPromotionLock(asked.email);
        }
        return gateTheLibrary(ctx);
      }),
      after: createAuthMiddleware(async (ctx) => {
        const event = auditedEvent(ctx.path);
        if (event === undefined) return;
        const { returned } = ctx.context;
        const call: AuditedCall = {
          fields: bodyFields.parse(ctx.body),
          refused: returned instanceof Error && !isRedirect(returned),
          issued: tokenResponse.parse(returned),
          signedIn: signedInUser.parse(returned),
          redirect: redirectedTo.parse(returned),
        };
        const session = await sessionOfCall(ctx);

        const line = auditLineOf(openedLine(event, ctx.path, session?.user.id, call.fields), call);
        const outcome = outcomeOf(event, call);
        const recorder = outcome === "ok" ? recorders.get(line.event) : undefined;
        if (recorder === undefined) audit.info(auditRecord(line, outcome), line.event);
        else await recordOnAuditLog(recorder, line, session?.session);
      }),
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      organization({
        ac: accessControl,
        roles,
        creatorRole,

        /**
         * Unset, the plugin reads the id generator to decide, and a custom minter switches that
         * heuristic off, dropping the verification ask.
         */
        requireEmailVerificationOnInvitation: true,

        invitationExpiresIn: INVITATION_EXPIRY_SECONDS,

        schema: {
          organization: { modelName: "workspace", fields: { slug: "shortName" } },
          member: {
            fields: { organizationId: "workspaceId" },
            additionalFields: {
              credentialsRevokedAt: {
                type: "date",
                required: false,
                input: false,
                returned: false,
              },
            },
          },
          invitation: { fields: { organizationId: "workspaceId" } },
          session: { fields: { activeOrganizationId: "activeWorkspaceId" } },
        },
      }),
      emailOTP({
        otpLength: EMAIL_CODE_LENGTH,
        expiresIn: EMAIL_CODE_LIFETIME_SECONDS,
        allowedAttempts: EMAIL_CODE_ATTEMPTS,
        storeOTP: { hash: (otp) => Promise.resolve(codeHashOf(otp)) },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") return;
          const kept = await attempt(() =>
            keepALink(
              { door: deps.door, secret: deps.secret, publicUrl: deps.publicUrl },
              email,
              otp,
            ),
          );
          // The code alone still signs in, so a link that could not be kept never costs the email.
          if (!kept.ok)
            audit.warn(
              { event: "auth.link_not_kept", reason: kept.error.message },
              "auth.link_not_kept",
            );
          await deps.sendEmail(signInEmail(email, otp, kept.ok ? kept.value : undefined));
        },
      }),
      widenAuthorize(
        oauthProvider({
          /**
           * No page may carry a query of its own: the signed query is appended with an
           * unconditional ?, and a second breaks the signature.
           */
          loginPage: `${deps.publicUrl}${SIGN_IN_PATH}`,

          consentPage: `${deps.publicUrl}/consent`,
          scopes: [...OAUTH_SCOPES],
          accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
          refreshTokenExpiresIn: REFRESH_TOKEN_LIFETIME_SECONDS,

          resources: [deps.mcpUrl],

          clientRegistrationDefaultScopes: [...OAUTH_SCOPES],
          clientRegistrationAllowedScopes: [...OAUTH_SCOPES],

          clientRegistrationDefaultResources: [deps.mcpUrl],
          clientRegistrationAllowedResources: [deps.mcpUrl],

          /**
           * The api's own count by client address governs every `/oauth2/*` path, so a client
           * meets one refusal, with `Retry-After`. Registration stays refused outright.
           */
          rateLimit: {
            authorize: false,
            token: false,
            introspect: false,
            revoke: false,
            register: false,
            userinfo: false,
          },
          postLogin: {
            page: `${deps.publicUrl}/choose-workspace`,

            consentReferenceId: async ({ session, user: person }) => {
              const active = consentedWorkspaceOf(session, await workspacesOf(person.id));
              if (active === undefined) {
                throw new APIError("BAD_REQUEST", {
                  error: "set_workspace",
                  error_description: "a workspace must be chosen before consent",
                });
              }
              return active;
            },

            shouldRedirect: async ({ session, user: person }) => {
              // A pending session confirms on the way, from the post-login page, before any consent.
              if (pendingOr(await judged(deps, { id: session.id }))) return true;
              // The post-login page asks for a display name first; skipping it for a person
              // in one workspace would carry an unnamed person straight to consent.
              if (hasNoDisplayName(person.name)) return true;
              const held = await workspacesOf(person.id);
              const active = activeWorkspaceOf(session);
              if (active !== undefined && held.includes(active)) return false;

              const only = soleOf(held);
              if (only !== undefined) {
                await withIdentityWrite(IDENTITY_PRINCIPAL, deps.door, (tx) =>
                  tx.query(
                    "UPDATE session SET active_workspace_id = $1, updated_at = now() WHERE id = $2",
                    [only, session.id],
                  ),
                );
                return false;
              }
              return true;
            },
          },

          customAccessTokenClaims: async ({ user: person, referenceId }) => ({
            workspace: referenceId ?? null,
            user: person?.id ?? null,
          }),
        }),
      ),
      twoFactor({
        issuer: PRODUCT_NAME,
        allowPasswordless: true,
        /** Its lock counts per account, so a mailbox holder guessing codes could lock an Admin out. */
        accountLockout: { enabled: false },
        schema: {
          twoFactor: { modelName: "authenticator" },
          user: { fields: { twoFactorEnabled: "authenticatorEnabled" } },
        },
      }),
      passkeyPlugin({
        ...passkeyPartyOf(deps.publicUrl),
        rpName: PRODUCT_NAME,
        authenticatorSelection: { userVerification: "required" },
        /** The library verifies with user verification optional; a passkey counts only with it. */
        registration: {
          afterVerification: ({ verification }) => {
            if (verification.registrationInfo?.userVerified !== true) throw userNotVerified();
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) throw userNotVerified();
          },
        },
      }),
      cimd({
        fetchClientMetadataResource: deps.fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
        metadataRevalidationInterval: "60m",

        isMetadataDocumentUrlAllowed: (clientIdUrl) => {
          const hostname = URL.parse(clientIdUrl)?.hostname;
          return CIMD_ALLOWED_CLIENT_HOSTS.some((allowed) => allowed === hostname);
        },
      }),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;

const sessionWorkspace = z.object({
  activeOrganizationId: z.string().nullish(),
});

const activeWorkspaceOf = (session: Session): string | undefined => {
  const parsed = sessionWorkspace.safeParse(session);
  const active = parsed.success ? parsed.data.activeOrganizationId : undefined;
  return active === null || active === undefined || active === "" ? undefined : active;
};
