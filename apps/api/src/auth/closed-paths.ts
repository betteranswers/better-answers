export const CLOSED_ORGANISATION_PATHS = [
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/update-member-role",
  "/organization/remove-member",
  "/organization/leave",
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/check-slug",
] as const;

export const CLOSED_FACTOR_PATHS = [
  "/passkey/delete-passkey",
  "/passkey/generate-authenticate-options",
  "/passkey/generate-register-options",
  "/passkey/list-user-passkeys",
  "/passkey/update-passkey",
  "/passkey/verify-authentication",
  "/passkey/verify-registration",
  "/two-factor/disable",
  "/two-factor/enable",
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
  "/two-factor/send-otp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
  "/two-factor/verify-totp",
] as const;

export const CLOSED_SESSION_PATHS = [
  "/list-sessions",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/unlink-account",
  "/update-session",
] as const;
