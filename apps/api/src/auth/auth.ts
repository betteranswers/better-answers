import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth, type Session } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, jwt, organization } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth/types";
import { drizzle } from "drizzle-orm/node-postgres";
import { decodeJwt } from "jose";
import type pg from "pg";
import type { Logger } from "pino";
import { z } from "zod";

import { ulid, type PlatformPrincipal } from "@better-answers/core/kernel";
import {
  withIdentityWrite,
  withScope,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";
import { workspacesHeldBy } from "@better-answers/core/workspaces";

const PLATFORM_PRINCIPAL: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-identity",
};
import {
  account,
  invitation,
  jwks,
  member,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  rateLimit,
  session,
  user,
  verification,
  workspace,
} from "@better-answers/schema";

import { ROLES } from "@better-answers/schema";

import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  BETTER_AUTH_RATE_LIMIT,
  CIMD_ALLOWED_CLIENT_HOSTS,
  CLIENT_IP_HEADER,
  EMAIL_CODE_ATTEMPTS,
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_LIFETIME_SECONDS,
  OAUTH_SCOPES,
  REFRESH_TOKEN_LIFETIME_SECONDS,
} from "./constants.ts";
import { accessControl, creatorRole, roles } from "./roles.ts";

type AuthEndpoint = NonNullable<BetterAuthPlugin["endpoints"]>[string];

type WidenedAuthorize<P extends { readonly endpoints: object }> = Omit<P, "endpoints"> & {
  readonly endpoints: Omit<P["endpoints"], "oauth2Authorize"> & {
    readonly oauth2Authorize: AuthEndpoint;
  };
};

const widenAuthorize = <P extends { readonly endpoints: object }>(plugin: P): WidenedAuthorize<P> =>
  // SAFETY: the endpoint is the library's own construction and satisfies this at runtime;
  // only its declaration differs.
  plugin as WidenedAuthorize<P>;

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};
export type EmailSender = (message: EmailMessage) => Promise<void>;

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
};

type AuditEvent =
  | "auth.sign_in"
  | "auth.workspace_pick"
  | "auth.consent"
  | "auth.token_issue"
  | "auth.token_refresh"
  | "auth.revocation";

const AUDITED_PATHS = {
  "/sign-in/email-otp": "auth.sign_in",
  "/organization/set-active": "auth.workspace_pick",
  "/oauth2/consent": "auth.consent",
  "/oauth2/token": "auth.token_issue",
  "/oauth2/revoke": "auth.revocation",
} satisfies Readonly<Record<string, AuditEvent>>;

const auditedEvent = (path: string): AuditEvent | undefined => {
  if (!Object.hasOwn(AUDITED_PATHS, path)) return undefined;

  // SAFETY: `hasOwn` just proved `path` is one of AUDITED_PATHS' own keys.
  return AUDITED_PATHS[path as keyof typeof AUDITED_PATHS];
};

const tokenResponse = z.object({ access_token: z.string() });
const mintedClaims = z.object({
  user: z.string().nullish(),
  sub: z.string().optional(),
  workspace: z.string().nullish(),
  jti: z.string().optional(),
  client_id: z.string().optional(),
  azp: z.string().optional(),
});

const isPlatformRole = (role: string | undefined): boolean =>
  role === undefined || (ROLES as readonly string[]).includes(role);

const refuseForeignRole = (role: string | undefined): void => {
  if (isPlatformRole(role)) return;
  throw new APIError("BAD_REQUEST", {
    error: "invalid_role",
    error_description: `role must be one of ${ROLES.join(", ")}`,
  });
};
const bodyFields = z
  .object({
    client_id: z.string().optional(),
    grant_type: z.string().optional(),
    organizationId: z.string().optional(),
    accept: z.boolean().optional(),
    oauth_query: z.string().optional(),
  })
  .partial();
const signedInUser = z.object({ user: z.object({ id: z.string() }) });

const invitationsNotYet = (): APIError =>
  new APIError("NOT_IMPLEMENTED", {
    error: "invitations_not_yet",
    error_description: "invitations arrive with the People screen (T-027)",
  });

const clientIdOfQuery = (query: string | undefined): string | undefined =>
  query === undefined ? undefined : (new URLSearchParams(query).get("client_id") ?? undefined);

export const createAuth = (deps: AuthDependencies) => {
  const audit = deps.logger.child({ module: "auth" });

  const membershipsOf = async (userId: string): Promise<readonly string[]> => {
    const held = await workspacesHeldBy(PLATFORM_PRINCIPAL, deps.door, userId);
    if (held.ok) return held.value;
    if (held.error instanceof Error) throw held.error;
    audit.warn(
      { event: "auth.membership_read", principal: userId, outcome: held.error },
      "auth.membership_read",
    );
    return [];
  };

  const soleOf = (held: readonly string[]): string | undefined =>
    held.length === 1 ? held[0] : undefined;
  const soleMembershipOf = async (userId: string): Promise<string | undefined> =>
    soleOf(await membershipsOf(userId));
  const db = drizzle(deps.database, { schema: identitySchema });

  return betterAuth({
    appName: "Better Answers",
    baseURL: deps.publicUrl,

    basePath: "/",
    secret: deps.secret,
    database: drizzleAdapter(db, { provider: "pg", schema: identitySchema }),

    trustedOrigins: [deps.publicUrl],

    disabledPaths: ["/token"],
    user: {
      additionalFields: {
        credentialsRevokedAt: { type: "date", required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: BETTER_AUTH_RATE_LIMIT.window,
      max: BETTER_AUTH_RATE_LIMIT.max,
      customRules: { ...BETTER_AUTH_RATE_LIMIT.customRules },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: {
        generateId: () => ulid(),
      },

      disableOriginCheck: false,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const only = await soleMembershipOf(session.userId);
            if (only === undefined) return;

            return { data: { ...session, activeOrganizationId: only } };
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const event = auditedEvent(ctx.path);
        if (event === undefined) return;
        const returned = ctx.context.returned;

        const redirected =
          returned instanceof APIError && returned.statusCode >= 300 && returned.statusCode < 400;
        const refused = !redirected && (returned instanceof APIError || returned instanceof Error);
        const body = bodyFields.safeParse(ctx.body ?? {});
        const fields = body.success ? body.data : {};

        const session = ctx.context.session ?? (await getSessionFromCtx(ctx));

        let principal = session?.user.id;
        let workspaceId: string | undefined = undefined;
        let tokenId: string | undefined = undefined;
        let name: AuditEvent = event;
        let clientId = fields.client_id ?? clientIdOfQuery(fields.oauth_query);

        if (event === "auth.token_issue" && !refused) {
          const issued = tokenResponse.safeParse(returned);
          const claims = issued.success
            ? mintedClaims.safeParse(decodeJwt(issued.data.access_token))
            : undefined;
          if (claims?.success) {
            principal = claims.data.user ?? claims.data.sub;
            workspaceId = claims.data.workspace ?? undefined;
            tokenId = claims.data.jti;
            clientId = clientId ?? claims.data.azp ?? claims.data.client_id;
          }
          if (fields.grant_type === "refresh_token") name = "auth.token_refresh";
        }
        if (event === "auth.sign_in" && !refused) {
          const parsed = signedInUser.safeParse(returned);
          if (parsed.success) principal = parsed.data.user.id;
        }
        if (event === "auth.workspace_pick") workspaceId = fields.organizationId;

        audit.info(
          {
            event: name,
            principal: principal ?? null,
            workspace: workspaceId ?? null,
            client_id: clientId ?? null,
            outcome: refused
              ? "refused"
              : event === "auth.consent" && fields.accept === false
                ? "declined"
                : "ok",

            token_id: tokenId ?? null,
          },
          name,
        );
      }),
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      organization({
        ac: accessControl,
        roles,
        creatorRole,

        allowUserToCreateOrganization: false,

        requireEmailVerificationOnInvitation: true,

        schema: {
          organization: { modelName: "workspace" },
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
        organizationHooks: {
          afterCreateOrganization: async ({ organization }) => {
            await withScope(PLATFORM_PRINCIPAL, deps.door, organization.id, async (tx) => {
              await tx.query("SELECT create_workspace_partition($1)", [organization.id]);
            });
          },

          beforeAddMember: async ({ member }) => {
            refuseForeignRole(member.role);
          },
          beforeUpdateMemberRole: async ({ newRole }) => {
            refuseForeignRole(newRole);
          },

          beforeCreateInvitation: async () => {
            throw invitationsNotYet();
          },

          beforeAcceptInvitation: async () => {
            throw invitationsNotYet();
          },
        },
      }),
      emailOTP({
        otpLength: EMAIL_CODE_LENGTH,
        expiresIn: EMAIL_CODE_LIFETIME_SECONDS,
        allowedAttempts: EMAIL_CODE_ATTEMPTS,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") return;
          await deps.sendEmail({
            to: email,
            subject: "Your Better Answers sign-in code",
            text: `Your code is ${otp}. It is valid for five minutes. If you did not ask for it, ignore this email.`,
          });
        },
      }),
      widenAuthorize(
        oauthProvider({
          loginPage: `${deps.publicUrl}/sign-in`,

          consentPage: `${deps.publicUrl}/consent`,
          scopes: [...OAUTH_SCOPES],
          accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
          refreshTokenExpiresIn: REFRESH_TOKEN_LIFETIME_SECONDS,

          resources: [deps.mcpUrl],

          clientRegistrationDefaultScopes: [...OAUTH_SCOPES],
          clientRegistrationAllowedScopes: [...OAUTH_SCOPES],

          clientRegistrationDefaultResources: [deps.mcpUrl],
          clientRegistrationAllowedResources: [deps.mcpUrl],
          postLogin: {
            page: `${deps.publicUrl}/choose-workspace`,

            consentReferenceId: async ({ session, user: person }) => {
              const held = await membershipsOf(person.id);
              const stillActive = activeWorkspaceOf(session);
              const active =
                stillActive !== undefined && held.includes(stillActive)
                  ? stillActive
                  : soleOf(held);
              if (active === undefined) {
                throw new APIError("BAD_REQUEST", {
                  error: "set_workspace",
                  error_description: "a workspace must be chosen before consent",
                });
              }
              return active;
            },

            shouldRedirect: async ({ session, user: person }) => {
              const held = await membershipsOf(person.id);
              const active = activeWorkspaceOf(session);
              if (active !== undefined && held.includes(active)) return false;

              const only = soleOf(held);
              if (only !== undefined) {
                await withIdentityWrite(PLATFORM_PRINCIPAL, deps.door, (tx) =>
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
      cimd({
        fetchClientMetadataResource: deps.fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
        metadataRevalidationInterval: "60m",

        isMetadataDocumentUrlAllowed: (clientIdUrl) =>
          (CIMD_ALLOWED_CLIENT_HOSTS as readonly string[]).includes(
            URL.parse(clientIdUrl)?.hostname ?? "",
          ),
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
