import type { CounterRule } from "@better-answers/core/store/postgres";

export const CLIENT_IP_HEADER = "cf-connecting-ip";

export const UNKNOWN_CLIENT_IP = "unknown";

/** The range Anthropic publishes for Claude's servers, which call for every customer from it. */
export const ANTHROPIC_EGRESS_RANGE = { network: "160.79.104.0", prefix: 21 } as const;

export const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;

export const REFRESH_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

export const MCP_SCOPES = ["knowledge:read", "feedback:write"] as const;
export const OAUTH_SCOPES = [...MCP_SCOPES, "offline_access"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const MCP_REQUIRED_SCOPE: McpScope = "knowledge:read";

export const EMAIL_CODE_LIFETIME_SECONDS = 5 * 60;

export const OAUTH_IP_RULE: CounterRule = { windowMs: 60_000, max: 60 };

export const DISCOVERY_PATHS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
] as const;

export const DISCOVERY_CACHE_CONTROL = "public, max-age=300";

export const PAGE_IP_RULE: CounterRule = { windowMs: 60_000, max: 30 };

export const EMAIL_CODE_EMAIL_RULE: CounterRule = { windowMs: 10 * 60_000, max: 5 };

export const SEND_EMAIL_CODE_PATH = "/email-otp/send-verification-otp";

export const SIGN_IN_BY_EMAIL_CODE_PATH = "/sign-in/email-otp";

export const EMAIL_CODE_SEND_IP_RULE: CounterRule = { windowMs: 10 * 60_000, max: 5 };

export const EMAIL_CODE_SIGN_IN_IP_RULE: CounterRule = { windowMs: 10 * 60_000, max: 10 };

export const SIGN_IN_PATH = "/sign-in";

export const SIGN_IN_LINK_PAGE = "/sign-in/link";

export const SIGN_IN_LINK_DESCRIBE_PATH = "/sign-in-link/describe";

export const SIGN_IN_LINK_SIGN_IN_PATH = "/sign-in-link/sign-in";

export const SIGN_IN_LINK_COOKIE = "better-answers.sign-in-link";

export const SIGN_IN_LINK_DESCRIBE_IP_RULE: CounterRule = { windowMs: 60_000, max: 30 };

export const SIGN_IN_LINK_SIGN_IN_IP_RULE: CounterRule = { windowMs: 60_000, max: 10 };

export const SIGN_IN_LINK_TOKEN_RULE: CounterRule = { windowMs: 10 * 60_000, max: 10 };

export const AUTHENTICATOR_START_PATH = "/authenticator/start";

export const AUTHENTICATOR_FINISH_PATH = "/authenticator/finish";

export const AUTHENTICATOR_PERSON_RULE: CounterRule = { windowMs: 10 * 60_000, max: 10 };

export const RECOVERY_CODES_PERSON_RULE: CounterRule = { windowMs: 60 * 60_000, max: 10 };

export const AUTHENTICATOR_STEP_SECONDS = 30;

export const CONFIRM_PASSKEY_OPTIONS_PATH = "/second-factor/confirm/passkey-options";

export const CONFIRM_PASSKEY_PATH = "/second-factor/confirm/passkey";

export const CONFIRM_AUTHENTICATOR_PATH = "/second-factor/confirm/authenticator";

export const RECOVERY_CODE_PATH = "/second-factor/recovery";

export const RESTORE_CODE_PATH = "/second-factor/restore";

export const REPLACE_AUTHENTICATOR_START_PATH = "/second-factor/replace/authenticator-start";

export const REPLACE_AUTHENTICATOR_FINISH_PATH = "/second-factor/replace/authenticator-finish";

export const CONFIRM_PERSON_RULE: CounterRule = { windowMs: 10 * 60_000, max: 10 };

export const SPEND_A_CODE_PERSON_RULE: CounterRule = { windowMs: 60 * 60_000, max: 10 };

export const PASSKEY_ADD_OPTIONS_PATH = "/passkeys/add-options";

export const PASSKEY_ADD_PATH = "/passkeys/add";

export const PASSKEY_SIGN_IN_OPTIONS_PATH = "/passkeys/sign-in-options";

export const PASSKEY_SIGN_IN_PATH = "/passkeys/sign-in";

export const PASSKEY_VERIFY_PATH = "/passkey/verify-authentication";

export const PASSKEY_PERSON_RULE: CounterRule = { windowMs: 10 * 60_000, max: 10 };

export const PASSKEY_SIGN_IN_IP_RULE: CounterRule = { windowMs: 60_000, max: 30 };

export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export const SESSION_RENEWAL_AGE_SECONDS = 24 * 60 * 60;

export const MCP_UNAUTHENTICATED_IP_RULE: CounterRule = { windowMs: 60_000, max: 60 };

export const TRPC_IP_RULE: CounterRule = { windowMs: 60_000, max: 120 };

export const IDENTITY_IP_RULE: CounterRule = { windowMs: 60_000, max: 120 };

export const MCP_TOKEN_RULE: CounterRule = { windowMs: 60_000, max: 120 };

export const AUDIT_EXPORT_PERSON_RULE: CounterRule = { windowMs: 60 * 60_000, max: 10 };

export const ASK_TO_JOIN_PERSON_RULE: CounterRule = { windowMs: 60 * 60_000, max: 10 };

export const ASK_TO_JOIN_ANSWER_FLOOR_MS = 250;

export const CIMD_ALLOWED_CLIENT_HOSTS = ["claude.ai"] as const;
