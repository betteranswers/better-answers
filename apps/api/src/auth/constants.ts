import type { CounterRule } from "@better-answers/core/store/postgres";

export const CLIENT_IP_HEADER = "cf-connecting-ip";

export const UNKNOWN_CLIENT_IP = "unknown";

export const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;

export const REFRESH_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

export const MCP_SCOPES = ["knowledge:read", "feedback:write"] as const;
export const OAUTH_SCOPES = [...MCP_SCOPES, "offline_access"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_REQUIRED_SCOPE: McpScope = "knowledge:read";

export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_LIFETIME_SECONDS = 5 * 60;
export const EMAIL_CODE_ATTEMPTS = 3;

export const OAUTH_IP_RULE: CounterRule = { windowMs: 60_000, max: 60 };

export const PAGE_IP_RULE: CounterRule = { windowMs: 60_000, max: 30 };

export const EMAIL_CODE_EMAIL_RULE: CounterRule = { windowMs: 10 * 60_000, max: 5 };

export const SEND_EMAIL_CODE_PATH = "/email-otp/send-verification-otp";

export const MCP_UNAUTHENTICATED_IP_RULE: CounterRule = { windowMs: 60_000, max: 60 };

export const TRPC_IP_RULE: CounterRule = { windowMs: 60_000, max: 120 };

export const MCP_TOKEN_RULE: CounterRule = { windowMs: 60_000, max: 120 };

/** Room for a few mistyped slugs, not for a list of guesses. */
export const ASK_TO_JOIN_PERSON_RULE: CounterRule = { windowMs: 60 * 60_000, max: 10 };

export const BETTER_AUTH_RATE_LIMIT = {
  window: 60,
  max: 100,
  customRules: {
    "/email-otp/send-verification-otp": { window: 600, max: 5 },
    "/email-otp/check-verification-otp": { window: 600, max: 10 },
    "/sign-in/email-otp": { window: 600, max: 10 },
  },
} as const;

export const CIMD_FETCH_TIMEOUT_MS = 10_000;
export const CIMD_RESPONSE_CAP_BYTES = 64 * 1024;

export const CIMD_ALLOWED_CLIENT_HOSTS = ["claude.ai"] as const;
