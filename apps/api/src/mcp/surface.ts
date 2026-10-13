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
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { Logger } from "pino";
import type { z } from "zod";

import { completeRecord, openRecord, type AskSteps } from "@better-answers/core/answering";
import {
  err,
  type Claims,
  type Clock,
  type Result,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import {
  consumeCall,
  folded,
  readWorkspaceConfig,
  withMember,
  withMemberUnheld,
  withPrincipal,
  withPrincipalRead,
  type PostgresDoor,
  type Tx,
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
import { countByAddress, tooManyRequests } from "../ingress/limits.ts";
import { refusalLogged, refusalOf, type RefusalAnswer } from "../refusal.ts";
import { crossing } from "./crossing.ts";
import type { Entry, StepRefusal } from "./entries/define.ts";

export type McpSurfaceDependencies = {
  readonly door: PostgresDoor;
  readonly verifier: OAuthTokenVerifier;
  readonly publicUrl: string;
  readonly mcpUrl: string;
  readonly logger: Logger;
  readonly serverVersion: string;

  readonly clock: Clock;
  readonly entries: readonly Entry<z.ZodObject, z.ZodType>[];
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

/**
 * The door an entry's transaction opens through. Only a declared `true` opens read-only: the
 * host reads an absent hint as a tool that writes.
 */
export const doorOf = ({ readOnlyHint }: ToolAnnotations): typeof withPrincipal =>
  readOnlyHint === true ? withPrincipalRead : withPrincipal;

type ServedEntry = Entry<z.ZodObject, z.ZodType>;

/** What a road opens its transactions with; an entry is handed neither. */
type RoadDoors = Pick<McpSurfaceDependencies, "door" | "clock">;

/** Both readings come sorted from the one member query, so they agree place by place or not at all. */
const inTheSameGroups = (resolved: UserPrincipal, readBack: UserPrincipal): boolean =>
  resolved.groups.length === readBack.groups.length &&
  resolved.groups.every((group, place) => group === readBack.groups[place]);

/**
 * Reads the member again through `open`, which refuses a moved role. Moved groups would read
 * under another predicate than the record keeps.
 */
const steppedAs = async <Value, Refused>(
  open: typeof withMember,
  door: PostgresDoor,
  asker: UserPrincipal,
  work: (member: UserPrincipal, tx: Tx) => Promise<Result<Value, Refused>>,
): Promise<Result<Value, Refused | StepRefusal>> => {
  const opened = await open(
    asker,
    door,
    async (member, tx): Promise<Result<Value, Refused | StepRefusal>> =>
      inTheSameGroups(asker, member) ? work(member, tx) : err("changed-meanwhile"),
  );
  return opened.ok ? opened.value : opened;
};

/** Only the read lends its transaction, and that one opens read-only. */
const stepsFor = ({ door, clock }: RoadDoors, asker: UserPrincipal): AskSteps<StepRefusal> => ({
  openRecord: (opening) =>
    steppedAs(withMember, door, asker, (member, tx) =>
      openRecord(member, tx, { ...opening, transport: "mcp" }),
    ),
  read: (work) => steppedAs(withMemberUnheld, door, asker, (_member, tx) => work(tx)),
  completeRecord: (completion) =>
    steppedAs(withMember, door, asker, (member, tx) =>
      completeRecord(member, tx, { ...completion, completedAt: clock.now() }),
    ),
});

/**
 * One transaction holds the first road's entry. The own-transaction road's member outlives the
 * transaction that resolved it, and each step re-judges it.
 */
const answeredOnItsRoad = async (
  doors: RoadDoors,
  entry: ServedEntry,
  claims: Claims,
  args: z.infer<z.ZodObject>,
): ReturnType<ServedEntry["run"]> => {
  if (entry.road === "resolvers-transaction") {
    return folded(
      await doorOf(entry.annotations)(doors.door, claims, (principal, tx) =>
        entry.run(principal, tx, args, doors.clock.now()),
      ),
    );
  }
  const resolved = await withPrincipalRead(doors.door, claims, async (principal) => principal);
  if (!resolved.ok) return resolved;
  const asker = resolved.value;
  return entry.run(asker, stepsFor(doors, asker), args, doors.clock.now());
};

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

    for (const entry of deps.entries) {
      if (!entry.scopes.every((scope) => scopes.has(scope))) continue;
      server.registerTool(
        entry.name,
        {
          title: entry.title,
          description: entry.description,
          // oxlint-disable-next-line better-answers/mcp-entry-no-workspace-argument -- the one mount over the entries; each input is checked at its own defineEntry
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
                : answeredOnItsRoad(deps, entry, bearer.claims, args),
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
    const flood = await countByAddress(deps, MCP_UNAUTHENTICATED_IP_RULE, "mcp", request.headers);
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
