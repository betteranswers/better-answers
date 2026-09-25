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

import { err, type Clock } from "@better-answers/core/kernel";
import {
  consumeCall,
  consumeIngress,
  folded,
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
import { refusalLogged, refusalOf, type RefusalAnswer } from "../refusal.ts";
import { crossing } from "./crossing.ts";
import { ENTRIES } from "./entries/index.ts";

export type McpSurfaceDependencies = {
  readonly door: PostgresDoor;
  readonly verifier: OAuthTokenVerifier;
  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly logger: Logger;
  readonly serverVersion: string;

  readonly clock: Clock;
};

const THE_BEARER = "the bearer";

const CEILING_MESSAGE =
  "This connection has made too many calls this minute; an Admin can raise the ceiling in System.";

/**
 * The bearer gate's reason stays off the wire; the word and class an agent reads are the tool's,
 * past the gate.
 */
const refused = (): OAuthError =>
  new OAuthError(OAuthErrorCode.InvalidToken, "the bearer was refused");

const toolsListTtlOf = (authInfo: AuthInfo | undefined): number =>
  Number(authInfo?.extra?.["toolsListTtlMs"] ?? TOOLS_LIST_TTL_MS_DEFAULT);

export const createMcpSurface = (
  deps: McpSurfaceDependencies,
): ((request: Request) => Promise<Response>) => {
  const log = deps.logger.child({ module: "mcp" });
  const resourceMetadataUrl = `${deps.publicUrl}/.well-known/oauth-protected-resource/mcp`;
  const challengeOptions = { requiredScopes: [...MCP_SCOPES], resourceMetadataUrl };

  const buildServer = (context: McpRequestContext): McpServer => {
    const bearer = context.authInfo === undefined ? undefined : bearerOf(context.authInfo);
    const ttlMs = toolsListTtlOf(context.authInfo);
    const scopes = new Set(context.authInfo?.scopes ?? []);

    const server = new McpServer(
      { name: "better-answers", version: deps.serverVersion },
      {
        capabilities: { tools: {} },

        cacheHints: {
          "tools/list": { ttlMs, cacheScope: "private" },
          "server/discover": { ttlMs, cacheScope: "private" },
        },
      },
    );

    for (const entry of ENTRIES) {
      if (!entry.scopes.every((scope) => scopes.has(scope))) continue;
      server.registerTool(
        entry.name,
        {
          title: entry.title,
          description: entry.description,
          // oxlint-disable-next-line better-answers/mcp-entry-no-workspace-argument -- the one mount over ENTRIES; each input is checked at its own defineEntry
          inputSchema: entry.input,
          outputSchema: entry.output,
          annotations: entry.annotations,
        },
        async (args) =>
          crossing(
            log,
            entry.name,
            async () =>
              bearer === undefined
                ? err<RefusalAnswer>("no-session")
                : folded(
                    await withPrincipal(deps.door, bearer.claims, (principal, tx) =>
                      entry.run(principal, tx, args, deps.clock.now()),
                    ),
                  ),
            entry.render,
          ),
      );
    }
    return server;
  };

  const handler = createMcpHandler(buildServer, {
    legacy: "stateless",
    onerror: (error) =>
      log.warn({ event: "mcp.handler_error", message: error.message }, "handler error"),
  });

  const flooded = async (request: Request): Promise<Response | undefined> => {
    const flood = await consumeIngress(
      deps.door,
      "ip",
      clientIpOf(request.headers),
      MCP_UNAUTHENTICATED_IP_RULE,
      deps.clock.now(),
    );
    return flood.allowed ? undefined : tooManyRequests(flood.retryAfterSeconds, CEILING_MESSAGE);
  };

  const authenticated = async (request: Request): Promise<AuthInfo | Response> => {
    const authorization = request.headers.get("authorization");
    if (authorization === null || !/^Bearer\s+\S+$/i.test(authorization)) {
      return (
        (await flooded(request)) ??
        bearerAuthChallengeResponse(
          new OAuthError(OAuthErrorCode.InvalidToken, "a bearer token is required"),
          challengeOptions,
        )
      );
    }

    try {
      return await verifyBearerToken(authorization, {
        verifier: deps.verifier,
        requiredScopes: [MCP_REQUIRED_SCOPE],
      });
    } catch (cause) {
      return (await flooded(request)) ?? bearerAuthChallengeResponse(cause, challengeOptions);
    }
  };

  return async (request: Request): Promise<Response> => {
    const authInfo = await authenticated(request);
    if (authInfo instanceof Response) return authInfo;

    const bearer = bearerOf(authInfo);
    if (bearer === undefined) return bearerAuthChallengeResponse(refused(), challengeOptions);

    const gate = await withPrincipal(deps.door, bearer.claims, async (principal, tx) => ({
      ceiling: await consumeCall(principal, tx, bearer.tokenId, MCP_TOKEN_RULE, deps.clock.now()),
      ttl: await readWorkspaceConfig(principal, tx, TOOLS_LIST_TTL_CONFIG_KEY),
    }));
    if (!gate.ok) {
      log.info(
        { event: "mcp.refused", entry: THE_BEARER, ...refusalLogged(refusalOf(gate.error)) },
        "refused",
      );
      return bearerAuthChallengeResponse(refused(), challengeOptions);
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
