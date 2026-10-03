/** The second factor's contract: core issues and the api checks it, and the web's screens read it. */
export const AUTHENTICATOR_CODE_LENGTH = 6;

export const RECOVERY_CODES_IN_A_SET = 10;

/** Long enough for "Chrome on macOS" and a person's own words, short enough for one row. */
export const PASSKEY_NAME_MAX_LENGTH = 64;

/** What a person types to get past a second factor, each counted on its own; a passkey never is. */
export const THROTTLED_KINDS = ["authenticator", "recovery-code", "restore-code"] as const;
