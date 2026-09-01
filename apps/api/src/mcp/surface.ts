import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
  type AuthInfo,
  type McpRequestContext,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import type { Logger } from "pino";

import type { Claims } from "@better-answers/core/kernel";
import {
  consumeCall,
  readWorkspaceConfig,
  withPrincipal,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";
import {
  TOOLS_LIST_TTL_CONFIG_KEY,
  TOOLS_LIST_TTL_MS_DEFAULT,
} from "@better-answers/core/workspaces";

import {
  MCP_REQUIRED_SCOPE,
  MCP_SCOPES,
  MCP_TOKEN_RULE,
  MCP_UNAUTHENTICATED_IP_RULE,
} from "../auth/constants.ts";
import { bearerOf } from "../auth/verify.ts";
import { clientIpOf, tooManyRequests } from "../ingress/limits.ts";
import { consumeIngress } from "@better-answers/core/store/postgres";
import { ENTRIES } from "./entries/index.ts";

/**
 * The MCP surface behind one fetch-shaped seam (ADR 0030): `(Request) => Response`,
 * mounted in Hono, authentication resolved before the handler and the Principal
 * passed in. No `@modelcontextprotocol/*` type crosses into `packages/core`.
 *
 * Per request: the bearer is verified (signature, issuer, audience, expiry, the
 * required scope); the Principal is resolved once in a short transaction that also
 * counts the call against the token and reads the workspace's `tools/list` TTL — a
 * refused resolve is a 401 the host answers by re-authorising, a passed ceiling a 429;
 * then `createMcpHandler` serves both protocol eras from one tool factory
 * (`legacy: "stateless"`, the SDK's default and load-bearing: claude.ai's
 * unauthenticated pre-flight speaks 2025-11-25 only). The move to `legacy: "reject"`
 * is conditioned on `server/discover` having been observed from every host on the
 * conformance list (research 80 F1) — never on a date. Every `tools/call` then runs
 * under its own `withPrincipal`, so the role is read in the same transaction as the
 * read the entry does.
 */

export type McpSurfaceDependencies = {
  readonly door: PostgresDoor;
  readonly verifier: OAuthTokenVerifier;
  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly logger: Logger;
  readonly serverVersion: string;
};

const CEILING_MESSAGE =
  "This connection has made too many calls this minute; an Admin can raise the ceiling in System.";

export const createMcpSurface = (
  deps: McpSurfaceDependencies,
): ((request: Request) => Promise<Response>) => {
  const log = deps.logger.child({ module: "mcp" });
  const resourceMetadataUrl = `${deps.publicUrl}/.well-known/oauth-protected-resource/mcp`;
  const challengeOptions = { requiredScopes: [...MCP_SCOPES], resourceMetadataUrl };

  const buildServer = (context: McpRequestContext): McpServer => {
    const bearer = context.authInfo === undefined ? undefined : bearerOf(context.authInfo);
    const ttlMs = Number(context.authInfo?.extra?.["toolsListTtlMs"] ?? TOOLS_LIST_TTL_MS_DEFAULT);
    const scopes = new Set(context.authInfo?.scopes ?? []);

    const server = new McpServer(
      { name: "better-answers", version: deps.serverVersion },
      {
        capabilities: { tools: {} },
        // A real TTL, `cacheScope: "private"` because the list varies by the token's
        // scopes (research 80 row 8; F5). The number is the workspace's config row.
        cacheHints: {
          "tools/list": { ttlMs, cacheScope: "private" },
          "server/discover": { ttlMs, cacheScope: "private" },
        },
      },
    );

    for (const entry of ENTRIES) {
      if (!scopes.has(entry.scope)) continue;
      server.registerTool(
        entry.name,
        {
          title: entry.title,
          description: entry.description,
          inputSchema: entry.input,
          outputSchema: entry.output,
          annotations: entry.annotations,
        },
        async (args) => {
          if (bearer === undefined) {
            return refusedResult("This call carried no verified credential.");
          }
          const outcome = await withPrincipal(deps.door, bearer.claims, (principal, tx) =>
            entry.run(principal, tx, args),
          );
          if (!outcome.ok) {
            log.warn(
              { event: "mcp.call_refused", entry: entry.name, reason: outcome.error },
              "call refused",
            );
            return refusedResult("Your credentials were refused. Sign in again.");
          }
          return {
            content: [{ type: "text", text: entry.render(outcome.value) }],
            structuredContent: outcome.value,
          };
        },
      );
    }
    return server;
  };

  const handler = createMcpHandler(buildServer, {
    legacy: "stateless",
    onerror: (error) =>
      log.warn({ event: "mcp.handler_error", message: error.message }, "handler error"),
  });

  return async (request: Request): Promise<Response> => {
    let authInfo: AuthInfo;
    try {
      authInfo = await verifyBearerToken(request.headers.get("authorization"), {
        verifier: deps.verifier,
        requiredScopes: [MCP_REQUIRED_SCOPE],
      });
    } catch (cause) {
      // The 401 flood is per IP, before any token is verified.
      const flood = await consumeIngress(
        deps.door,
        "ip",
        clientIpOf(request.headers),
        MCP_UNAUTHENTICATED_IP_RULE,
      );
      if (!flood.allowed) return tooManyRequests(flood.retryAfterSeconds, CEILING_MESSAGE);
      // Trap 3 (prototype 61): the challenge advertises the whole surface's scopes;
      // the guard above enforces only the one every entry needs.
      return bearerAuthChallengeResponse(cause, challengeOptions);
    }

    const bearer = bearerOf(authInfo);
    if (bearer === undefined) {
      return bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InvalidToken, "the bearer names no principal"),
        challengeOptions,
      );
    }

    const gate = await withPrincipal(deps.door, bearer.claims, async (principal, tx) => ({
      ceiling: await consumeCall(principal, tx, bearer.tokenId, MCP_TOKEN_RULE),
      ttl: await readWorkspaceConfig(principal, tx, TOOLS_LIST_TTL_CONFIG_KEY),
    }));
    if (!gate.ok) {
      log.info(
        { event: "mcp.refused", reason: gate.error, client_id: authInfo.clientId },
        "bearer refused",
      );
      return bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InvalidToken, gate.error),
        challengeOptions,
      );
    }
    if (!gate.value.ceiling.allowed) {
      return tooManyRequests(gate.value.ceiling.retryAfterSeconds, CEILING_MESSAGE);
    }

    const ttlMs = Number(gate.value.ttl ?? TOOLS_LIST_TTL_MS_DEFAULT);
    log.info(
      {
        event: "mcp.request",
        client_id: authInfo.clientId,
        mcp_method: request.headers.get("mcp-method"),
        mcp_name: request.headers.get("mcp-name"),
      },
      "mcp request",
    );
    return handler.fetch(request, {
      authInfo: { ...authInfo, extra: { ...authInfo.extra, toolsListTtlMs: ttlMs } },
    });
  };
};

const refusedResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

/** What a claims-carrying `AuthInfo` looks like to the surface; exported for the tests' synthetic tokens. */
export type SurfaceClaims = Claims;
