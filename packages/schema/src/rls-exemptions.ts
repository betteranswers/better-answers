import { GLOBAL_TABLE_NAMES_BEYOND_IDENTITY } from "./counter-tables.ts";
import { IDENTITY_SET } from "./identity-tables.ts";

export const RLS_EXEMPTIONS = {
  "public.user": "Read by id or email at sign-in, before any workspace is known.",
  "public.session": "Read by session token; the read is what resolves a principal at all.",
  "public.account": "Read by provider account id when a social sign-in links an account.",
  "public.verification": "Read by identifier when an email code is redeemed, pre-session.",
  "public.jwks": "The signing key set: one global set, served at /jwks to every client.",
  "public.workspace":
    "The picker lists a person's workspaces before one is chosen, so a scope cannot gate it; it holds a tenant's name, not a secret.",
  "public.member":
    "Carries workspace_id on purpose, and is read across workspaces by person id: the picker asks which workspaces a person holds before any workspace is known, and the membership read that validates a claim runs in the same transaction that sets the scope — so neither read can depend on a scope.",
  "public.invitation":
    "Carries workspace_id on purpose: read by invitation id by a person who is not yet a member of the workspace it names.",
  "public.oauth_client": "Read by client_id URL during registration and authorize, pre-session.",
  "public.oauth_resource": "The MCP surface's own resource record: one row, global by nature.",
  "public.oauth_client_resource": "Joins client to resource; both sides are global records.",
  "public.oauth_refresh_token": "Read by token hash at refresh, before any claim is trusted.",
  "public.oauth_access_token":
    "Read by token hash on every call; the claim it yields is what sets the scope.",
  "public.oauth_consent":
    "Its referenceId is what puts a workspace_id on a credential, so it is read before one exists.",
  "public.oauth_client_assertion":
    "Replay guard, read by assertion id at the token endpoint, pre-session.",
  "public.rate_limit": "Better Auth's own limiter, keyed by request, running before sign-in.",
  "public.ingress_counter":
    "The pre-authentication per-IP and per-email counter: no workspace exists yet to scope it by.",
  "public.contract_stamp":
    "One row saying which tier contract this deploy's api carries: a fact about the deploy, not about a tenant, and the worker reads it before any workspace is in hand.",
  "public.sweep_pass":
    "One row per sweep pass, and a pass covers every workspace at once: a fact about the deploy's schedule that names no tenant and holds counts alone.",
  "public.identity_audit_event":
    "The identity-set ledger: an act on a person's own identity belongs to no workspace, so no scope could hold its row; it names people by person id and acts by their word, never a name or an address.",
} satisfies Record<string, string>;

export const EXEMPT_TABLE_NAMES: readonly string[] = [
  ...IDENTITY_SET,
  ...GLOBAL_TABLE_NAMES_BEYOND_IDENTITY,
];
