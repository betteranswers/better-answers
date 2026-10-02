import type { CounterRule } from "@better-answers/core/store/postgres";

export const CLIENT_IP_HEADER = "cf-connecting-ip";

export const UNKNOWN_CLIENT_IP = "unknown";

export const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;

export const REFRESH_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

export const MCP_SCOPES = ["knowledge:read", "feedback:write"] as const;
export const OAUTH_SCOPES = [...MCP_SCOPES, "offline_access"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const MCP_REQUIRED_SCOPE: McpScope = "knowledge:read";

export const EMAIL_CODE_LIFETIME_SECONDS = 5 * 60;

/**
 * Past any wait to type a code from an email, so one that expired just before the daily sweep
 * still reads as spent.
 */
export const VERIFICATION_KEPT_PAST_EXPIRY_SECONDS = 24 * 60 * 60;

export const OAUTH_IP_RULE: CounterRule = { windowMs: 60_000, max: 60 };

export const PAGE_IP_RULE: CounterRule = { windowMs: 60_000, max: 30 };

export const EMAIL_CODE_EMAIL_RULE: CounterRule = { windowMs: 10 * 60_000, max: 5 };

export const SEND_EMAIL_CODE_PATH = "/email-otp/send-verification-otp";

export const SIGN_IN_PATH = "/sign-in";

/** The SPA's page a sign-in link opens; its token rides in the fragment, which no server sees. */
export const SIGN_IN_LINK_PAGE = "/sign-in/link";

export const SIGN_IN_LINK_DESCRIBE_PATH = "/sign-in-link/describe";

export const SIGN_IN_LINK_SIGN_IN_PATH = "/sign-in-link/sign-in";

/** Ties a link to the browser that asked for its code. */
export const SIGN_IN_LINK_COOKIE = "better-answers.sign-in-link";

export const SIGN_IN_LINK_DESCRIBE_IP_RULE: CounterRule = { windowMs: 60_000, max: 30 };

export const SIGN_IN_LINK_SIGN_IN_IP_RULE: CounterRule = { windowMs: 60_000, max: 10 };

/** Reads and sign-ins of one link together: room for a few reloads, not for a script. */
export const SIGN_IN_LINK_TOKEN_RULE: CounterRule = { windowMs: 10 * 60_000, max: 10 };

export const AUTHENTICATOR_START_PATH = "/authenticator/start";

export const AUTHENTICATOR_FINISH_PATH = "/authenticator/finish";

/**
 * Starts and codes of one person's setup, each counted apart: the library's own limit never
 * reaches a call our route makes.
 */
export const AUTHENTICATOR_PERSON_RULE: CounterRule = { windowMs: 10 * 60_000, max: 10 };

/** Each replacement mails a notice, so a script cannot fill the person's inbox. */
export const RECOVERY_CODES_PERSON_RULE: CounterRule = { windowMs: 60 * 60_000, max: 10 };

export const MCP_UNAUTHENTICATED_IP_RULE: CounterRule = { windowMs: 60_000, max: 60 };

export const TRPC_IP_RULE: CounterRule = { windowMs: 60_000, max: 120 };

export const MCP_TOKEN_RULE: CounterRule = { windowMs: 60_000, max: 120 };

/** Room for a few mistyped slugs, not for a list of guesses. */
export const ASK_TO_JOIN_PERSON_RULE: CounterRule = { windowMs: 60 * 60_000, max: 10 };

/**
 * A known slug's ask writes rows and an unknown one's does not; every answer waits this long, so
 * the time taken says neither.
 */
export const ASK_TO_JOIN_ANSWER_FLOOR_MS = 250;

export const BETTER_AUTH_RATE_LIMIT = {
  window: 60,
  max: 100,
  customRules: {
    "/email-otp/send-verification-otp": { window: 600, max: 5 },
    "/email-otp/check-verification-otp": { window: 600, max: 10 },
    "/sign-in/email-otp": { window: 600, max: 10 },
    /**
     * The link's page reaches the library's handler before the SPA serves it, and the library's
     * own rule for `/sign-in*` allows three loads in ten seconds.
     */
    "/sign-in/link": { window: 60, max: 30 },
  },
} as const;

export const CIMD_ALLOWED_CLIENT_HOSTS = ["claude.ai"] as const;
