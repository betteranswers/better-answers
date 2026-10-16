import type { PlatformPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { identifierCountOf, type SubjectIdentifiers } from "./requests.ts";

export type Suppressed = {
  readonly identifiersWithheld: number;
};

const NAMES_NOBODY: SubjectIdentifiers = { emails: [], names: [], other: [] };

const withTheSignInAddresses = (
  identifiers: SubjectIdentifiers,
  signInAddresses: readonly string[],
): SubjectIdentifiers => {
  const named = new Set(identifiers.emails.map((email) => email.toLowerCase()));
  const added = [...new Set(signInAddresses.map((address) => address.toLowerCase()))].filter(
    (address) => !named.has(address),
  );
  return { ...identifiers, emails: [...identifiers.emails, ...added] };
};

/**
 * The addresses the request's suppression holds, lower-cased. It is written before the identity
 * step and never replaced, so it still holds the sign-in address once the user row is tombstoned.
 */
export const addressesSuppressedFor = async (
  tx: Tx,
  input: { readonly workspaceId: string; readonly erasureRequestId: string },
): Promise<readonly string[]> => {
  const held = await tx.query<{ email: string }>(
    `SELECT lower(email) AS email
       FROM suppression, jsonb_array_elements_text(identifiers -> 'emails') AS email
      WHERE workspace_id = $1 AND erasure_request_id = $2`,
    [input.workspaceId, input.erasureRequestId],
  );
  return held.rows.map((row) => row.email);
};

export const suppressInTheWorkspace = async (
  platform: PlatformPrincipal,
  tx: Tx,
  input: {
    readonly workspaceId: string;
    readonly erasureRequestId: string;
    readonly identifiers: SubjectIdentifiers | null;

    readonly signInAddresses: readonly string[];
  },
): Promise<Suppressed> => {
  const set = withTheSignInAddresses(input.identifiers ?? NAMES_NOBODY, input.signInAddresses);
  if (identifierCountOf(set) > 0) {
    await tx.query(
      `INSERT INTO suppression (workspace_id, erasure_request_id, identifiers)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, erasure_request_id) DO NOTHING`,
      [input.workspaceId, input.erasureRequestId, set],
    );
  }

  const standing = await tx.query<{ withheld: number }>(
    `SELECT jsonb_array_length(identifiers -> 'emails') + jsonb_array_length(identifiers -> 'names')
            + jsonb_array_length(identifiers -> 'other') AS withheld
       FROM suppression WHERE workspace_id = $1 AND erasure_request_id = $2`,
    [input.workspaceId, input.erasureRequestId],
  );
  return { identifiersWithheld: standing.rows[0]?.withheld ?? 0 };
};
