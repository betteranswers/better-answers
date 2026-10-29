import type { Session } from "better-auth";
import { APIError, getSessionFromCtx, type createAuthMiddleware } from "better-auth/api";
import { decodeJwt } from "jose";
import { z } from "zod";

import type { Result } from "@better-answers/core/kernel";
import type { SignInMethod } from "@better-answers/core/workspaces";

import { PASSKEY_VERIFY_PATH } from "./constants.ts";
import { signInMethodOfThisCall } from "./sign-in/sign-in-link.ts";

export type AuditEvent =
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

export const auditedEvent = (path: string): AuditEvent | undefined => AUDITED_PATHS.get(path);

export const tokenResponse = z.object({ access_token: z.string() }).optional().catch(undefined);
const mintedClaims = z.object({
  user: z.string().nullish(),
  sub: z.string().optional(),
  workspace: z.string().nullish(),
  jti: z.string().optional(),
  client_id: z.string().optional(),
  azp: z.string().optional(),
});

export const bodyFields = z
  .object({
    client_id: z.string().optional(),
    grant_type: z.string().optional(),
    organizationId: z.string().optional(),
    accept: z.boolean().optional(),
    oauth_query: z.string().optional(),
  })
  .partial()
  .catch({});
export const signedInUser = z
  .object({ user: z.object({ id: z.string() }) })
  .optional()
  .catch(undefined);
export const redirectedTo = z.object({ url: z.string() }).optional().catch(undefined);
export const signInAddress = z.object({ email: z.string() }).optional().catch(undefined);

export const presentedCredential = z
  .object({ response: z.object({ id: z.string() }) })
  .optional()
  .catch(undefined);

const carriesACode = (redirect: z.infer<typeof redirectedTo>): boolean =>
  redirect !== undefined && (URL.parse(redirect.url)?.searchParams.has("code") ?? false);

export const sessionOfCall = async (ctx: Parameters<typeof getSessionFromCtx>[0]) =>
  ctx.context.session ?? ctx.context.newSession ?? (await getSessionFromCtx(ctx));

const clientIdOfQuery = (query: string | undefined): string | undefined =>
  query === undefined ? undefined : (new URLSearchParams(query).get("client_id") ?? undefined);

type AuditFields = z.infer<typeof bodyFields>;

export type GateContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export type AuditedCall = {
  readonly fields: AuditFields;
  readonly refused: boolean;
  readonly issued: z.infer<typeof tokenResponse>;
  readonly signedIn: z.infer<typeof signedInUser>;
  readonly redirect: z.infer<typeof redirectedTo>;
};

type Outcome = "refused" | "declined" | "deferred" | "ok";

export type AuditLine = {
  readonly event: AuditEvent;

  readonly path: string;
  readonly principal: string | undefined;
  readonly workspaceId: string | undefined;
  readonly clientId: string | undefined;
  readonly tokenId: string | undefined;
};

export const isRedirect = (failure: Error): boolean =>
  failure instanceof APIError && failure.statusCode >= 300 && failure.statusCode < 400;

export const openedLine = (
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

export const signInMethodOf = (path: string): SignInMethod =>
  path === PASSKEY_VERIFY_PATH ? "passkey" : signInMethodOfThisCall();

const claimsOfIssued = (issued: AuditedCall["issued"]) => {
  if (issued === undefined) return undefined;
  const claims = mintedClaims.safeParse(decodeJwt(issued.access_token));
  return claims.success ? claims.data : undefined;
};

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

export const auditLineOf = (line: AuditLine, call: AuditedCall): AuditLine => {
  if (line.event === "auth.workspace_pick") {
    return { ...line, workspaceId: call.fields.organizationId };
  }
  if (line.event === "auth.token_issue") return tokenLine(line, call);
  if (line.event === "auth.sign_in" && call.signedIn !== undefined) {
    return { ...line, principal: call.signedIn.user.id };
  }
  return line;
};

export const outcomeOf = (event: AuditEvent, call: AuditedCall): Outcome => {
  if (call.refused) return "refused";
  if (event !== "auth.consent") return "ok";
  if (call.fields.accept === false) return "declined";
  return carriesACode(call.redirect) ? "ok" : "deferred";
};

export const auditRecord = (line: AuditLine, outcome: Outcome) => ({
  event: line.event,
  principal: line.principal ?? null,
  workspace: line.workspaceId ?? null,
  client_id: line.clientId ?? null,
  outcome,
  token_id: line.tokenId ?? null,
});

type Written = Result<undefined, string | Error>;

export type Recorder = (line: AuditLine, session: Session | undefined) => Promise<Written>;

export const reasonOf = (error: string | Error): string =>
  error instanceof Error ? error.message : error;
