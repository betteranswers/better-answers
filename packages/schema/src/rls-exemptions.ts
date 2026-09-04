import { GLOBAL_TABLE_NAMES_BEYOND_IDENTITY } from "./counter-tables.ts";
import { IDENTITY_SET } from "./identity-tables.ts";

/**
 * The one place a reviewer looks to see which tables are outside the tenant guarantee,
 * and why each one is (`[SEC3]`; T-015's spec, `apps/docs-site/specs/T-015.md`). A tenant
 * table is every table `src/` declares minus these; adding an entry is a visible diff
 * carrying a reason, and no pattern ever matches a new table quietly.
 *
 * The two arrays this is built from stay where their owners need them — `IDENTITY_SET`
 * beside Better Auth's declarations, `GLOBAL_TABLE_NAMES_BEYOND_IDENTITY` beside the
 * counters — and the RLS coverage test asserts the union both ways against this record
 * (`[TEST7]`), so a name can neither gain an exemption without a reason nor keep one
 * after its array drops it.
 */
export const RLS_EXEMPTIONS = {
  "public.user": "Read by id or email at sign-in, before any workspace is known.",
  "public.session": "Read by session token; the read is what resolves a principal at all.",
  "public.account": "Read by provider account id when a social sign-in links an account.",
  "public.verification": "Read by identifier when an email code is redeemed, pre-session.",
  "public.jwks": "The signing key set: one global set, served at /jwks to every client.",
  "public.workspace":
    "The picker lists a person's workspaces before one is chosen, so a scope cannot gate it; it holds a tenant's name, not a secret.",
  "public.member":
    "Carries workspace_id on purpose: the membership read that validates a claim runs in the same transaction that sets the scope, so it cannot depend on it.",
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
} satisfies Record<string, string>;

/** The union the two source arrays declare — what the exemption record must equal. */
export const EXEMPT_TABLE_NAMES: readonly string[] = [
  ...IDENTITY_SET,
  ...GLOBAL_TABLE_NAMES_BEYOND_IDENTITY,
];
