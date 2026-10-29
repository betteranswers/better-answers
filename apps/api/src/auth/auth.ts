import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { betterAuth, type Session } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP, jwt, organization, twoFactor } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth/types";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import type { Logger } from "pino";
import { z } from "zod";

import { attempt, type Clock, err, isPending, ulid } from "@better-answers/core/kernel";
import { withIdentityWrite, type PostgresDoor } from "@better-answers/core/store/postgres";
import {
  hasNoDisplayName,
  recordConsent,
  recordPasskeyUse,
  recordSignIn,
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
  session as sessionTable,
  user,
  verification as verificationTable,
  workspace,
} from "@better-answers/schema";
import { EMAIL_CODE_ATTEMPTS, EMAIL_CODE_LENGTH } from "@better-answers/schema/email-code";

import type { EmailSender } from "../email/email.ts";
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
  signInMethodOf,
  auditRecord,
  reasonOf,
  presentedCredential,
  signInAddress,
  auditedEvent,
  bodyFields,
  isRedirect,
  tokenResponse,
  signedInUser,
  redirectedTo,
  sessionOfCall,
  auditLineOf,
  openedLine,
  outcomeOf,
  type Recorder,
  type AuditEvent,
  type AuditLine,
  type GateContext,
  type AuditedCall,
} from "./audit-line.ts";
import {
  CLOSED_ORGANISATION_PATHS,
  CLOSED_FACTOR_PATHS,
  CLOSED_SESSION_PATHS,
} from "./closed-paths.ts";
import { grantLeftItsWorkspace } from "./consent-grant.ts";
import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  CIMD_ALLOWED_CLIENT_HOSTS,
  CLIENT_IP_HEADER,
  EMAIL_CODE_LIFETIME_SECONDS,
  OAUTH_SCOPES,
  PASSKEY_VERIFY_PATH,
  REFRESH_TOKEN_LIFETIME_SECONDS,
  SESSION_LIFETIME_SECONDS,
  SESSION_RENEWAL_AGE_SECONDS,
  SIGN_IN_PATH,
} from "./constants.ts";
import { dropAnExpiredPromotionLock } from "./promotion-lock.ts";
import { accessControl, creatorRole, roles } from "./roles.ts";
import { codeHashOf } from "./sign-in/link-token.ts";
import { signInEmail } from "./sign-in/sign-in-email.ts";
import { keepALink } from "./sign-in/sign-in-link.ts";
import { surfacingUniqueViolations } from "./unique-violations.ts";

type AuthEndpoint = NonNullable<BetterAuthPlugin["endpoints"]>[string];

type WidenedAuthorize<P extends { readonly endpoints: object }> = Omit<P, "endpoints"> & {
  readonly endpoints: Omit<P["endpoints"], "oauth2Authorize"> & {
    readonly oauth2Authorize: AuthEndpoint;
  };
};

const widenAuthorize = <P extends { readonly endpoints: object }>(plugin: P): WidenedAuthorize<P> =>
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- a declaration gap: better-auth types `oauth2Authorize`'s openapi metadata outside `Endpoint`; the runtime value fits
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
  session: sessionTable,
  account,
  verification: verificationTable,
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
  authenticator,
  passkey,
};

export const USER_NOT_VERIFIED = "USER_NOT_VERIFIED";

export const passkeyPartyOf = (publicUrl: string) => {
  const address = new URL(publicUrl);
  return { rpID: address.hostname, origin: address.origin };
};

const userNotVerified = (): APIError =>
  new APIError("BAD_REQUEST", {
    code: USER_NOT_VERIFIED,
    message: "The device did not verify its user",
  });

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

  const endedHere = (ctx: GateContext) => {
    if (!PENDING_LIBRARY_PATHS.has(ctx.path)) throw new APIError("UNAUTHORIZED");
    return readWithoutRenewal(ctx);
  };

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
    disabledPaths: [
      "/token",
      "/update-user",
      "/oauth2/consent",
      "/oauth2/client/rotate-keys",
      ...CLOSED_ORGANISATION_PATHS,
      ...CLOSED_FACTOR_PATHS,
      ...CLOSED_SESSION_PATHS,
    ],
    user: {
      additionalFields: {
        credentialsRevokedAt: { type: "date", required: false, input: false },
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
      freshAge: 0,
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: SESSION_RENEWAL_AGE_SECONDS,
      additionalFields: {
        secondFactorConfirmedAt: { type: "date", required: false, input: false, returned: false },
        pendingSince: { type: "date", required: false, input: false, returned: false },
        setupGrantedAt: { type: "date", required: false, input: false, returned: false },
      },
    },
    verification: { disableCleanup: true },
    rateLimit: { enabled: false },
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: {
        generateId: () => ulid(),
      },
      disableOriginCheck: false,
    },
    databaseHooks: {
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
              if (grantLeftItsWorkspace(active)) {
                throw new APIError("CONFLICT", {
                  error: "workspace_moved",
                  error_description: "the session left the workspace the consent page named",
                });
              }
              if (active === undefined) {
                throw new APIError("BAD_REQUEST", {
                  error: "set_workspace",
                  error_description: "a workspace must be chosen before consent",
                });
              }
              return active;
            },

            shouldRedirect: async ({ session, user: person }) => {
              if (pendingOr(await judged(deps, { id: session.id }))) return true;
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
