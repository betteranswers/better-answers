import { IDENTITY_SET } from "./people/identity-tables.ts";
import { GLOBAL_TABLE_NAMES_BEYOND_IDENTITY } from "./platform/counter-tables.ts";

export const RLS_EXEMPTIONS = {
  "public.user":
    "Sign-in may read this table with no workspace scope because it looks a person up by id or email before any workspace is known.",
  "public.session":
    "The api may read this table with no workspace scope because it reads a session by its token to find out who the caller is, before any workspace is known.",
  "public.account":
    "Social sign-in may read this table with no workspace scope because it looks an account up by the provider's account id when it links the account to a person.",
  "public.verification":
    "Sign-in may read this table with no workspace scope because it looks an email code up by its identifier when the code is redeemed, before a session exists.",
  "public.jwks":
    "Every client may read this table with no workspace scope because it holds the one global signing key set, which the api serves to every client at /jwks.",
  "public.workspace":
    "The workspace picker may read this table with no workspace scope because it lists a person's workspaces before they choose one, and a row holds a tenant's name, not a secret.",
  "public.member":
    "The workspace picker and the claim check may read this table across workspaces, although it carries workspace_id, because the picker finds a person's workspaces by person id before any workspace is known and the claim check reads the member row in the same transaction that sets the scope.",
  "public.invitation":
    "A person may read an invitation by its id, although the table carries workspace_id, because that person is not yet a member of the workspace the invitation names.",
  "public.oauth_client":
    "Client registration and the authorize endpoint may read this table with no workspace scope because they look a client up by its client_id URL before a session exists.",
  "public.oauth_resource":
    "The OAuth code may read this table with no workspace scope because it holds one global row, the MCP server's own resource record.",
  "public.oauth_client_resource":
    "The OAuth code may read this table with no workspace scope because each row links a client to a resource, and both are global records.",
  "public.oauth_refresh_token":
    "Token refresh may read this table with no workspace scope because it looks a token up by its hash before it trusts any claim.",
  "public.oauth_access_token":
    "The api may read this table with no workspace scope because it looks a token up by its hash on every call, and the claim that read returns is what sets the scope.",
  "public.oauth_consent":
    "The OAuth code may read this table with no workspace scope because a consent's referenceId is what ties a credential to a workspace, so the read happens before the credential has one.",
  "public.oauth_client_assertion":
    "The token endpoint may read this table with no workspace scope because it looks an assertion up by its id to refuse a replay, before a session exists.",
  "public.authenticator":
    "Sign-in may read this table with no workspace scope because it reads a person's second factor by person id before any workspace is known, and one second factor serves every workspace.",
  "public.passkey":
    "Passkey sign-in may read this table with no workspace scope because it looks a passkey up by its credential id before any person or workspace is known.",
  "public.passkey_last_use":
    "Passkey sign-in may write this table with no workspace scope because it records the passkey's last use before a session exists, and the passkey itself belongs to no workspace.",
  "public.recovery_code":
    "Sign-in may read and spend a person's recovery codes with no workspace scope because the codes serve every workspace and stand in for a second factor before any workspace is chosen.",
  "public.second_factor_throttle":
    "Sign-in may read and write this table with no workspace scope because it counts a person's failed second-factor confirms across every session while the session is still pending, before any workspace is chosen.",
  "public.ingress_counter":
    "The api may count requests in this table with no workspace scope because it counts per IP address and per email before authentication, when no workspace exists yet.",
  "public.contract_stamp":
    "The worker may read this table with no workspace scope because its one row records which tier contract this deploy's api carries, a fact about the deploy and not a tenant, and the worker reads it before it holds any workspace.",
  "public.sweep_pass":
    "The sweeps may write this table with no workspace scope because each row records one sweep pass over every workspace at once, names no tenant, and holds only counts.",
  "public.backup":
    "The backup scripts may write this table with no workspace scope because each row records one backup, drill, or restore of the deploy's copies and names no tenant.",
  "public.identity_audit_event":
    "The audit slice may write this table with no workspace scope because an action on a person's own identity belongs to no workspace, and each row names people by person id and actions by a word, never by a name or an address.",
  "public.model_price":
    "The llm slice may read this table with no workspace scope because a provider's price for a model is the same for every workspace, so a row names no tenant and holds only rates.",
  "public.decision_threshold":
    "The llm slice may read this table with no workspace scope because the probability at which a decision model's yes counts is a fact about the model, the same for every workspace, so a row names no tenant and holds only a number.",
} satisfies Record<string, string>;

export const EXEMPT_TABLE_NAMES: readonly string[] = [
  ...IDENTITY_SET,
  ...GLOBAL_TABLE_NAMES_BEYOND_IDENTITY,
];
