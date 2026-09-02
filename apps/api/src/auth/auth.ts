import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth, type Session } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, jwt, organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { decodeJwt } from "jose";
import type pg from "pg";
import type { Logger } from "pino";
import { z } from "zod";

import type { PlatformPrincipal } from "@better-answers/core/kernel";
import {
  withIdentityWrite,
  withScope,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";

/** The identity provider's own acts (the partition on a self-serve create) are the platform's. */
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
  CLIENT_IP_HEADER,
  EMAIL_CODE_ATTEMPTS,
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_LIFETIME_SECONDS,
  OAUTH_SCOPES,
  REFRESH_TOKEN_LIFETIME_SECONDS,
} from "./constants.ts";
import { accessControl, creatorRole, roles } from "./roles.ts";

/**
 * Better Auth, run in process, as the identity provider and the OAuth 2.1
 * authorization server (ADR 0009): the email-code login, the organisation model mapped
 * onto `workspace`, `@better-auth/oauth-provider` with CIMD client discovery and the
 * lifted Node transport, the JWT plugin's keys, its own limiter database-backed. This
 * file is the one place `better-auth` and `@better-auth/*` are configured; nothing
 * outside `apps/api/src/auth/` imports them (`[DESIGN5]`, lint-enforced).
 *
 * Prototype 61's three silent traps are each a line here with the trap named beside
 * it, and `apps/api/tests/oauth-flow.test.ts` holds each as a regression.
 */

/** One email, as the sign-in page needs to send it. The transport is injected (`[SEC1]`: SMTP is a row later). */
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};
export type EmailSender = (message: EmailMessage) => Promise<void>;

/** The seam the CIMD plugin fetches metadata documents through; production takes the lift. */
export type ClientMetadataFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type AuthDependencies = {
  readonly database: pg.Pool;
  readonly door: PostgresDoor;
  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly secret: string;
  readonly sendEmail: EmailSender;
  readonly fetchClientMetadataResource: ClientMetadataFetch;
  readonly logger: Logger;
};

/** The identity set as the adapter sees it: model name → table. */
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

/** The audit fields every sign-in, pick, consent, issue, refresh and revocation carries (grilling Q12). */
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

/** The three roles Better Auth's own endpoints may write; its owner/admin/member defaults are refused. */
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

const clientIdOfQuery = (query: string | undefined): string | undefined =>
  query === undefined ? undefined : (new URLSearchParams(query).get("client_id") ?? undefined);

export const createAuth = (deps: AuthDependencies) => {
  const audit = deps.logger.child({ module: "auth" });

  /** The one workspace a person holds, when it is exactly one. */
  const soleMembershipOf = async (userId: string): Promise<string | undefined> => {
    const held = await deps.database.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM member WHERE user_id = $1",
      [userId],
    );
    const [only] = held.rows;
    return held.rows.length === 1 && only !== undefined ? only.workspace_id : undefined;
  };
  const db = drizzle(deps.database, { schema: identitySchema });

  return betterAuth({
    appName: "Better Answers",
    baseURL: deps.publicUrl,
    // The RFC 8414 document sits at the apex, where a host looks for the issuer's.
    basePath: "/",
    secret: deps.secret,
    database: drizzleAdapter(db, { provider: "pg", schema: identitySchema }),
    // This origin alone: a host never posts to these endpoints with a cookie, so it is
    // not a trusted origin for Better Auth's CSRF check.
    trustedOrigins: [deps.publicUrl],
    // The JWT plugin's `/token` and `set-auth-jwt` are for services without an OAuth
    // flow; under an OAuth provider both must be off (Better Auth, "OAuth Provider Mode").
    disabledPaths: ["/token"],
    user: {
      additionalFields: {
        // ADR 0018's revocation instant; written by the platform, never by the person.
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
      // Per-IP limits key on the tunnel's header alone (grilling Q8).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    databaseHooks: {
      session: {
        create: {
          // A person in exactly one workspace never sees the picker: the workspace is
          // their active one from the moment the session exists, so `/me` and a fresh
          // OAuth session both read it (ADR 0009's 2026-08-27 amendment). A person in
          // none or several has none active, and the picker decides.
          before: async (session) => {
            const held = await deps.database.query<{ workspace_id: string }>(
              "SELECT workspace_id FROM member WHERE user_id = $1",
              [session.userId],
            );
            const [only] = held.rows;
            if (held.rows.length !== 1 || only === undefined) return;
            // The organisation plugin's session field is `activeOrganizationId` (mapped
            // to the `active_workspace_id` column); set the field, not the column.
            return { data: { ...session, activeOrganizationId: only.workspace_id } };
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const event = auditedEvent(ctx.path);
        if (event === undefined) return;
        const returned = ctx.context.returned;
        // Better Auth answers a browser flow step by *throwing* a redirect (an APIError
        // with a 3xx status); that is the success path, not a refusal.
        const redirected =
          returned instanceof APIError && returned.statusCode >= 300 && returned.statusCode < 400;
        const refused = !redirected && (returned instanceof APIError || returned instanceof Error);
        const body = bodyFields.safeParse(ctx.body ?? {});
        const fields = body.success ? body.data : {};
        // The endpoint may not have loaded the session onto the context; read it
        // from the request's cookie when it has not.
        const session = ctx.context.session ?? (await getSessionFromCtx(ctx));

        let principal = session?.user.id;
        let workspaceId: string | undefined = undefined;
        let tokenId: string | undefined = undefined;
        let name: AuditEvent = event;
        let clientId = fields.client_id ?? clientIdOfQuery(fields.oauth_query);

        if (event === "auth.token_issue" && !refused) {
          // The response we just minted: decode, never verify or log the token itself.
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
            // The issued token's `jti` on an issue or a refresh — never the token. A
            // revocation carries none: the revoked refresh token is opaque and stored
            // hashed, so there is no `jti` to read; the audit slice threads it by
            // `client_id` and principal.
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
        // Platform-provisioned workspaces (grilling Q11): a person never creates one.
        // `provisionWorkspace` (packages/core/workspaces) is the act; this flag is the
        // "self-serve later" switch.
        allowUserToCreateOrganization: false,

        schema: {
          organization: { modelName: "workspace" },
          member: { fields: { organizationId: "workspaceId" } },
          invitation: { fields: { organizationId: "workspaceId" } },
          session: { fields: { activeOrganizationId: "activeWorkspaceId" } },
        },
        organizationHooks: {
          // The day the switch above flips, a workspace created through Better Auth's
          // own endpoint still gets its partition. Not the atomic act — Better Auth's
          // hook runs after its own writes with no transaction handle (verified in
          // `plugins/organization/routes/crud-org.mjs`); the atomic act is the platform's.
          afterCreateOrganization: async ({ organization }) => {
            await withScope(PLATFORM_PRINCIPAL, deps.door, organization.id, async (tx) => {
              await tx.query("SELECT create_workspace_partition($1)", [organization.id]);
            });
          },
          // Better Auth merges its owner/admin/member defaults into any roles map, so
          // its own endpoints could otherwise assign or invite a role outside the three.
          // The database CHECK on `member.role` is the fence; these give a clean 400
          // instead of a constraint violation. `[GLOSSARY1]`.
          beforeAddMember: async ({ member }) => {
            refuseForeignRole(member.role);
          },
          beforeUpdateMemberRole: async ({ newRole }) => {
            refuseForeignRole(newRole);
          },
          // No invitation can be accepted until the accept page ships with the first
          // screen (T-022), so none is created: an emailed invitation with no way to
          // accept it would only sit pending. Membership today is the platform's act.
          beforeCreateInvitation: async () => {
            throw new APIError("NOT_IMPLEMENTED", {
              error: "invitations_not_yet",
              error_description: "invitations arrive with the People screen",
            });
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
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: [...OAUTH_SCOPES],
        accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
        refreshTokenExpiresIn: REFRESH_TOKEN_LIFETIME_SECONDS,
        // RFC 8707: the token is bound to the MCP URL the person typed (research 80
        // row 25: the row must exist before a connector can authorise).
        resources: [deps.mcpUrl],
        // CIMD only (research 80 F2): dynamic registration stays at its default, off.
        // Trap 1 (prototype 61): a CIMD-discovered client is persisted with the
        // *registration* scopes, and claude.ai appends `offline_access` whenever the
        // metadata advertises it — leave it out here and every connection dies on
        // `invalid_scope`.
        clientRegistrationDefaultScopes: [...OAUTH_SCOPES],
        clientRegistrationAllowedScopes: [...OAUTH_SCOPES],
        // Trap 2: a client is linked to the resources it may ask for; without the link
        // the `resource` claude.ai sends is refused with `invalid_target`.
        clientRegistrationDefaultResources: [deps.mcpUrl],
        clientRegistrationAllowedResources: [deps.mcpUrl],
        postLogin: {
          page: "/choose-workspace",
          // ADR 0018's `workspace` claim: the active workspace, or no token at all.
          consentReferenceId: async ({ session, user: person }) => {
            // The session object here may predate `shouldRedirect`'s write for a
            // sole-membership session, so the fallback is read the same way here.
            const active = activeWorkspaceOf(session) ?? (await soleMembershipOf(person.id));
            if (active === undefined) {
              throw new APIError("BAD_REQUEST", {
                error: "set_workspace",
                error_description: "a workspace must be chosen before consent",
              });
            }
            return active;
          },
          // True sends the person to the picker: more than one membership and none
          // active, or an active one they no longer hold. A person in exactly one
          // workspace never gets here with none active — the session-create hook above
          // set it before the session existed (ADR 0009's 2026-08-27 amendment).
          shouldRedirect: async ({ session, user: person }) => {
            const memberships = await deps.database.query<{ workspace_id: string }>(
              "SELECT workspace_id FROM member WHERE user_id = $1 ORDER BY workspace_id",
              [person.id],
            );
            const held = memberships.rows.map((row) => row.workspace_id);
            const active = activeWorkspaceOf(session);
            if (active !== undefined && held.includes(active)) return false;
            // A session made before the person's one membership existed: the
            // session-create hook could not set it, so it is set here, once, as the
            // platform's own write to the identity set.
            const [only] = held;
            if (held.length === 1 && only !== undefined) {
              await withIdentityWrite(PLATFORM_PRINCIPAL, deps.door, (tx) =>
                tx.query("UPDATE session SET active_workspace_id = $1 WHERE id = $2", [
                  only,
                  session.id,
                ]),
              );
              return false;
            }
            return true;
          },
        },
        // The claims ADR 0018 asserts: `{workspace, user}`. `role` is deliberately
        // absent — it is read per call, in the same transaction as the read.
        customAccessTokenClaims: async ({ user: person, referenceId }) => ({
          workspace: referenceId ?? null,
          user: person?.id ?? null,
        }),
      }),
      cimd({
        fetchClientMetadataResource: deps.fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
        metadataRevalidationInterval: "60m",
      }),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;

const sessionWorkspace = z.object({ activeOrganizationId: z.string().nullish() });

/** The organisation plugin's active id on a session object, read without a cast. */
const activeWorkspaceOf = (session: Session): string | undefined => {
  const parsed = sessionWorkspace.safeParse(session);
  const active = parsed.success ? parsed.data.activeOrganizationId : undefined;
  return active === null || active === undefined || active === "" ? undefined : active;
};
