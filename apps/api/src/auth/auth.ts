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

import { ulid } from "@better-answers/core/kernel";
import { withIdentityWrite, type PostgresDoor } from "@better-answers/core/store/postgres";
import { hasNoDisplayName, workspacesHeldBy } from "@better-answers/core/workspaces";

import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
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
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a declaration gap: better-auth types `oauth2Authorize`'s openapi metadata outside `Endpoint`; the runtime value fits
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

const AUDITED_PATHS: ReadonlyMap<string, AuditEvent> = new Map([
  ["/sign-in/email-otp", "auth.sign_in"],
  ["/organization/set-active", "auth.workspace_pick"],
  ["/oauth2/consent", "auth.consent"],
  ["/oauth2/token", "auth.token_issue"],
  ["/oauth2/revoke", "auth.revocation"],
]);

const auditedEvent = (path: string): AuditEvent | undefined => AUDITED_PATHS.get(path);

/**
 * Their writes change a membership or a workspace with no audit event; the slug check tells
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

const clientIdOfQuery = (query: string | undefined): string | undefined =>
  query === undefined ? undefined : (new URLSearchParams(query).get("client_id") ?? undefined);

type AuditFields = z.infer<typeof bodyFields>;

type AuditedCall = {
  readonly fields: AuditFields;
  readonly refused: boolean;
  readonly issued: z.infer<typeof tokenResponse>;
  readonly signedIn: z.infer<typeof signedInUser>;
};

type Outcome = "refused" | "declined" | "ok";

type AuditLine = {
  readonly event: AuditEvent;
  readonly principal: string | undefined;
  readonly workspaceId: string | undefined;
  readonly clientId: string | undefined;
  readonly tokenId: string | undefined;
};

const isRedirect = (failure: Error): boolean =>
  failure instanceof APIError && failure.statusCode >= 300 && failure.statusCode < 400;

const openedLine = (
  event: AuditEvent,
  principal: string | undefined,
  fields: AuditFields,
): AuditLine => ({
  event,
  principal,
  workspaceId: undefined,
  clientId: fields.client_id ?? clientIdOfQuery(fields.oauth_query),
  tokenId: undefined,
});

const claimsOfIssued = (issued: AuditedCall["issued"]) => {
  if (issued === undefined) return undefined;
  const claims = mintedClaims.safeParse(decodeJwt(issued.access_token));
  return claims.success ? claims.data : undefined;
};

const issuedLine = (line: AuditLine, call: AuditedCall): AuditLine => {
  const event = call.fields.grant_type === "refresh_token" ? "auth.token_refresh" : line.event;
  const claims = claimsOfIssued(call.issued);
  if (claims === undefined) return { ...line, event };
  return {
    event,
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
  if (call.refused) return line;
  if (line.event === "auth.token_issue") return issuedLine(line, call);
  if (line.event === "auth.sign_in" && call.signedIn !== undefined) {
    return { ...line, principal: call.signedIn.user.id };
  }
  return line;
};

const outcomeOf = (event: AuditEvent, call: AuditedCall): Outcome => {
  if (call.refused) return "refused";
  return event === "auth.consent" && call.fields.accept === false ? "declined" : "ok";
};

const auditRecord = (line: AuditLine, outcome: Outcome) => ({
  event: line.event,
  principal: line.principal ?? null,
  workspace: line.workspaceId ?? null,
  client_id: line.clientId ?? null,
  outcome,
  token_id: line.tokenId ?? null,
});

/**
 * Each sign-in, workspace pick, consent, token issue or refresh and revocation writes an audit
 * line to `logger`.
 */
export const createAuth = (deps: AuthDependencies) => {
  const audit = deps.logger.child({ module: "auth" });

  const membershipsOf = async (userId: string): Promise<readonly string[]> => {
    const held = await workspacesHeldBy(IDENTITY_PRINCIPAL, deps.door, userId);
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
    /**
     * /token serves callers with no OAuth flow, which the library asks off under a provider;
     * /update-user writes a display name past its rule.
     */
    disabledPaths: ["/token", "/update-user", ...CLOSED_ORGANISATION_PATHS],
    user: {
      additionalFields: {
        credentialsRevokedAt: { type: "date", required: false, input: false },
        /** Undeclared, the library would hand the column back on every session it answers. */
        operator: { type: "boolean", required: false, input: false, returned: false },
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
        const { returned } = ctx.context;
        const call: AuditedCall = {
          fields: bodyFields.parse(ctx.body),
          refused: returned instanceof Error && !isRedirect(returned),
          issued: tokenResponse.parse(returned),
          signedIn: signedInUser.parse(returned),
        };
        const session = ctx.context.session ?? (await getSessionFromCtx(ctx));

        const line = auditLineOf(openedLine(event, session?.user.id, call.fields), call);
        audit.info(auditRecord(line, outcomeOf(event, call)), line.event);
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
          /**
           * No page may carry a query of its own: the signed query is appended with an
           * unconditional ?, and a second breaks the signature.
           */
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
              // The post-login page asks for a display name first; skipping it for a sole
              // membership would carry an unnamed person straight to consent.
              if (hasNoDisplayName(person.name)) return true;
              const held = await membershipsOf(person.id);
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
