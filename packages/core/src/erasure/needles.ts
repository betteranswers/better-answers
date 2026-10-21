import { boundarySchemas } from "@better-answers/schema";

import { ERASED_DOMAIN, type Needles } from "../store/git/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { SubjectRequest } from "./requests.ts";
import { addressesSuppressedFor } from "./suppressions.ts";

const isTombstone = (address: string): boolean => address.endsWith(`@${ERASED_DOMAIN}`);

const lowered = (addresses: readonly string[]): readonly string[] =>
  addresses.map((address) => address.trim().toLowerCase()).filter((address) => address !== "");

const distinct = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

export type SubjectNamed = {
  readonly member: string | null;

  readonly signInAddresses: readonly string[];

  readonly needles: Needles;
};

const MEMBER_HERE = `SELECT u.id AS location
     FROM "user" u
     JOIN member m ON m.user_id = u.id
    WHERE m.workspace_id = $1 AND (u.id = $2 OR lower(u.email) = ANY($3))
    LIMIT 1`;

const ADDRESSES_OF = `SELECT lower(email) AS email FROM "user" WHERE id = ANY($1::text[])`;

const NAMED_PEOPLE = `SELECT id FROM "user" WHERE email = $1 OR lower(email) = ANY($2::text[])`;

const columnOf = async <K extends string>(
  tx: Tx,
  column: K,
  statement: string,
  parameters: readonly unknown[],
): Promise<readonly string[]> => {
  const found = await tx.query<Record<K, string>>(statement, [...parameters]);
  return found.rows.map((row) => row[column]);
};

export const subjectNamedBy = async (
  tx: Tx,
  request: SubjectRequest,
  erasure: { readonly erasureRequestId: string; readonly pseudonym: string } | null,
): Promise<SubjectNamed> => {
  const requested = lowered(request.identifiers.emails);
  const personId =
    request.personId === null ? null : boundarySchemas.user.select.shape.id.parse(request.personId);
  const [member = null] = await columnOf(tx, "location", MEMBER_HERE, [
    request.workspaceId,
    personId,
    requested,
  ]);
  const people = distinct([member, personId].filter((id) => id !== null));
  const signInAddresses = distinct(
    lowered(people.length === 0 ? [] : await columnOf(tx, "email", ADDRESSES_OF, [people])),
  ).filter((address) => !isTombstone(address));
  const suppressed =
    erasure === null
      ? []
      : await addressesSuppressedFor(tx, {
          workspaceId: request.workspaceId,
          erasureRequestId: erasure.erasureRequestId,
        });
  const addresses = distinct([...signInAddresses, ...requested, ...lowered(suppressed)]).filter(
    (address) => !isTombstone(address),
  );
  const named =
    erasure === null
      ? []
      : await columnOf(tx, "id", NAMED_PEOPLE, [
          `${erasure.pseudonym}@${ERASED_DOMAIN}`,
          addresses,
        ]);
  return {
    member,
    signInAddresses,
    needles: { addresses, people: distinct([...people, ...named]) },
  };
};
