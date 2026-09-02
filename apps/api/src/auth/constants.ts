import type { CounterRule } from "@better-answers/core/store/postgres";

/**
 * Every pinned number and name the identity module carries, one exported constant
 * each (`[DEPS2]`). A copy anywhere else is a second pin that ages alone.
 */

/**
 * The one header a per-IP limit keys on (grilling Q8, 2026-09-01). Cloudflare's tunnel
 * is the sole ingress and sets it on every request; no host port is published
 * (ADR 0022, `deploy/stores.compose.yaml`), so nothing else can. `X-Forwarded-For` is
 * never read — its leftmost token is the client's to write.
 */
export const CLIENT_IP_HEADER = "cf-connecting-ip";

/** What a request with no client-IP header is keyed as — only reachable off the tunnel. */
export const UNKNOWN_CLIENT_IP = "unknown";

/** Access tokens live one hour (ADR 0018). */
export const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;

/**
 * Refresh tokens rotate and live ninety days sliding — the personal token's number
 * (ADR 0018; grilling Q10, 2026-09-01). Sliding because Better Auth issues a new
 * refresh token with a new expiry on every rotation.
 */
export const REFRESH_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

/** The surface's scopes (ADR 0018): read, and the one write. `offline_access` is OAuth's. */
export const MCP_SCOPES = ["knowledge:read", "feedback:write"] as const;
export const OAUTH_SCOPES = [...MCP_SCOPES, "offline_access"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** The scope every entry needs; the challenge advertises all of `MCP_SCOPES` (prototype 61, trap 3). */
export const MCP_REQUIRED_SCOPE: McpScope = "knowledge:read";

/** The email-code login's factor: six digits, five minutes, three tries. */
export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_LIFETIME_SECONDS = 5 * 60;
export const EMAIL_CODE_ATTEMPTS = 3;

/** Per-IP, in front of `/oauth2/*` and the discovery documents. */
export const OAUTH_IP_RULE: CounterRule = { windowMs: 60_000, max: 60 };
/** Per-IP, in front of the three pages. */
export const PAGE_IP_RULE: CounterRule = { windowMs: 60_000, max: 30 };
/** Per-email, on the sign-in page's code request: five codes in ten minutes. */
export const EMAIL_CODE_EMAIL_RULE: CounterRule = { windowMs: 10 * 60_000, max: 5 };
/** Per-IP, on `/mcp` before any token is verified — the 401 flood. */
export const MCP_UNAUTHENTICATED_IP_RULE: CounterRule = { windowMs: 60_000, max: 60 };
/**
 * In front of the tRPC endpoint, where every call costs a session lookup before it
 * can be refused, so the ceiling sits before the lookup.
 *
 * The four `ip` rules above and this one read **one counter per address per window**
 * (`consumeIngress` keys on scope, key and window; the rule is the threshold it is
 * read against, not a budget of its own). So each surface names the count at which
 * *it* stops answering, and this is the highest of them because a screen is many
 * small queries where a page is one navigation — a person browsing the product is
 * never refused by the pages' lower ceiling, because they are not fetching pages.
 */
export const TRPC_IP_RULE: CounterRule = { windowMs: 60_000, max: 120 };
/** Per-token, on every MCP request (ADR 0018's counter per `(token, window)`). */
export const MCP_TOKEN_RULE: CounterRule = { windowMs: 60_000, max: 120 };

/**
 * Better Auth's own limiter, per IP per path, database-backed. The email-code
 * endpoints take the stricter rules; everything else the global one.
 */
export const BETTER_AUTH_RATE_LIMIT = {
  window: 60,
  max: 100,
  customRules: {
    "/email-otp/send-verification-otp": { window: 600, max: 5 },
    "/email-otp/check-verification-otp": { window: 600, max: 10 },
    "/sign-in/email-otp": { window: 600, max: 10 },
  },
} as const;

/** The CIMD transport's limits (T-004): a metadata document is a few kilobytes and one round trip. */
export const CIMD_FETCH_TIMEOUT_MS = 10_000;
export const CIMD_RESPONSE_CAP_BYTES = 64 * 1024;
