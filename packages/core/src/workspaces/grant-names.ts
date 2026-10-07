import { z } from "zod";

import { endedGrant, type AuditEventRow, type EndedGrant } from "../audit/index.ts";
import type { WorkspaceId } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

export type GrantNames = {
  readonly assistants: ReadonlyMap<string, string | null>;
  readonly workspaces: ReadonlyMap<string, string>;
};

/** An ended grant as it is shown: named from the assistant and workspace rows as they stand now. */
export type GrantNamed = {
  readonly assistant: { readonly id: string; readonly name: string };
  readonly workspace: { readonly id: WorkspaceId; readonly name: string } | null;
  readonly issuedAt: string;
};

/** One read of each table, by id, whatever the number of grants. */
export const namesOfGrants = async (tx: Tx, grants: readonly EndedGrant[]): Promise<GrantNames> => {
  const assistantIds = [...new Set(grants.map((grant) => grant.clientId))];
  const workspaceIds = [...new Set(grants.flatMap((grant) => grant.workspaceId ?? []))];
  const assistants = await tx.query<{ client_id: string; name: string | null }>(
    "SELECT client_id, name FROM oauth_client WHERE client_id = ANY($1::text[])",
    [assistantIds],
  );
  const workspaces = await tx.query<{ id: string; name: string }>(
    "SELECT id, name FROM workspace WHERE id = ANY($1::text[])",
    [workspaceIds],
  );
  return {
    assistants: new Map(assistants.rows.map((row) => [row.client_id, row.name])),
    workspaces: new Map(workspaces.rows.map((row) => [row.id, row.name])),
  };
};

/** An assistant or workspace with no name, or gone since, reads as its id, which a reader can look up. */
export const grantNamed = (grant: EndedGrant, names: GrantNames): GrantNamed => ({
  assistant: { id: grant.clientId, name: names.assistants.get(grant.clientId) ?? grant.clientId },
  workspace:
    grant.workspaceId === null
      ? null
      : {
          id: grant.workspaceId,
          name: names.workspaces.get(grant.workspaceId) ?? grant.workspaceId,
        },
  issuedAt: grant.issuedAt,
});

type Detail = NonNullable<AuditEventRow["detail"]>;

const listOfGrants = z.array(endedGrant);

/** A field read once: a list of grants as the grant kind wrote it, or any other value as it was. */
type FieldRead =
  | { readonly field: string; readonly grants: readonly EndedGrant[] }
  | { readonly field: string; readonly value: Detail[string] };

const fieldsOf = (detail: Detail): readonly FieldRead[] =>
  Object.entries(detail).map(([field, value]) => {
    const grants = listOfGrants.safeParse(value);
    return grants.success ? { field, grants: grants.data } : { field, value };
  });

const grantsOf = (fields: readonly FieldRead[]): readonly EndedGrant[] =>
  fields.flatMap((read) => ("grants" in read ? read.grants : []));

const namedField = (read: FieldRead, names: GrantNames): Detail[string] =>
  "grants" in read
    ? read.grants.map((grant) => {
        const named = grantNamed(grant, names);
        return {
          ...grant,
          clientName: named.assistant.name,
          workspaceName: named.workspace?.name ?? null,
        };
      })
    : read.value;

/**
 * Each detail with its grants beside the names their ids hold now, read with one query to each
 * table for all the details together.
 */
export const detailsNamed = async (
  tx: Tx,
  details: readonly Detail[],
): Promise<readonly Detail[]> => {
  const read = details.map(fieldsOf);
  const names = await namesOfGrants(tx, read.flatMap(grantsOf));
  return read.map((fields) =>
    Object.fromEntries(fields.map((each) => [each.field, namedField(each, names)])),
  );
};
