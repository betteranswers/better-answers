import { z } from "zod";

import {
  boundarySchemas,
  COLLECTION,
  collectionOf,
  ids,
  type SUGGESTION_KINDS,
} from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { readableClause, readableParameters } from "../access/index.ts";
import { action, declareActions, record } from "../audit/index.ts";
import {
  admit,
  ADMIN_ALONE,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  ulid,
  type AdminUserPrincipal,
  type KernelRefusal,
  type Principal,
  type RefusalOf,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";

const OWNER_ACTIONS = declareActions("knowledge", {
  named: action("knowledge.owner.named", {
    collection: "collection?",
    iri: "iri?",
    personId: "id?",
  }),
});

export type OwnedConcept = { readonly iri: string | null; readonly path: string };

const OWNER_OF = `SELECT person_id
     FROM concept_owner
    WHERE workspace_id = ${scopeClause(1)}
      AND (iri = $2 OR collection = ${collectionOf("$3::text")})
    ORDER BY iri IS NULL
    LIMIT 1`;

const OWNER_HELD = `${OWNER_OF} FOR SHARE`;

const readOwner = async (
  principal: Principal,
  tx: Tx,
  concept: OwnedConcept,
  held: boolean,
): Promise<UserId | undefined> => {
  const found = await tx.query<{ person_id: UserId }>(held ? OWNER_HELD : OWNER_OF, [
    scopeParameter(principal),
    concept.iri,
    concept.path,
  ]);
  return found.rows[0]?.person_id;
};

export const ownerOf = (
  principal: Principal,
  tx: Tx,
  concept: OwnedConcept,
): Promise<UserId | undefined> => readOwner(principal, tx, concept, false);

export const standingConcept = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: string,
  asked: string,
): Promise<OwnedConcept> => {
  const standing = await tx.query<{ path: string }>(
    "SELECT path FROM concept_index WHERE workspace_id = $1 AND iri = $2",
    [principal.workspaceId, iri],
  );
  return { iri, path: standing.rows[0]?.path ?? asked };
};

export type OwnerRefusal = KernelRefusal<"owner-forbids">;

const HOLDING_THE_CONCEPT = `SELECT 1 FROM concept_identity
    WHERE workspace_id = ${scopeClause(1)} AND iri = $2
      FOR SHARE`;

export const ownerAdmits = async (
  principal: UserPrincipal,
  tx: Tx,
  concept: OwnedConcept,
): Promise<OwnerRefusal | undefined> => {
  if (principal.role === "Admin") return undefined;
  if (concept.iri !== null) {
    await tx.query(HOLDING_THE_CONCEPT, [scopeParameter(principal), concept.iri]);
  }
  const owner = await readOwner(principal, tx, concept, true);
  return owner === principal.userId ? undefined : "owner-forbids";
};

type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export type DeciderRefusal = OwnerRefusal | KernelRefusal<"role-forbids">;

const DECIDED_BY = {
  edit: "owner",
  promotion: "owner",
  "suggested-concept": "Admin",
  "citation-fix": "Admin",
} as const satisfies Record<SuggestionKind, "owner" | "Admin">;

export const deciderAdmits = async (
  principal: UserPrincipal,
  tx: Tx,
  concept: OwnedConcept,
  kind: SuggestionKind,
): Promise<DeciderRefusal | undefined> => {
  if (DECIDED_BY[kind] === "owner") return ownerAdmits(principal, tx, concept);
  return principal.role === "Admin" ? undefined : "role-forbids";
};

type Owns = { readonly collections: readonly string[]; readonly concepts: number };

const ownedByAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids"],
});

const OWNED_BY = `SELECT collection FROM concept_owner WHERE workspace_id = $1 AND person_id = $2`;

const ownsOf = async (principal: UserPrincipal, tx: Tx): Promise<Owns> => {
  const rows = await tx.query<{ collection: string | null }>(OWNED_BY, [
    principal.workspaceId,
    principal.userId,
  ]);
  const collections = rows.rows.flatMap(({ collection }) => collection ?? []);
  return {
    collections: collections.toSorted(byCodeUnit),
    concepts: rows.rows.length - collections.length,
  };
};

export const ownedBy = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<Owns, RefusalOf<typeof ownedByAction> | Error>> => {
  const admitted = admit(ownedByAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  return attempt(() => ownsOf(admitted.value, tx));
};

type CollectionOwned = {
  readonly collection: string;
  readonly owner: { readonly id: UserId; readonly name: string } | null;
  readonly overrides: number;
};

type CollectionsAndOwners = { readonly collections: readonly CollectionOwned[] };

const collectionsAndOwnersAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids", "owner-forbids"],
});

type CollectionsAndOwnersRefusal = RefusalOf<typeof collectionsAndOwnersAction> | Error;

const COLLECTIONS_AND_OWNERS = `SELECT c.collection, o.person_id, u.name AS person_name,
         count(overridden.iri)::int AS overrides
    FROM concept_index c
    LEFT JOIN concept_owner o
           ON o.workspace_id = c.workspace_id AND o.collection = c.collection
    LEFT JOIN "user" u ON u.id = o.person_id
    LEFT JOIN concept_owner overridden
           ON overridden.workspace_id = c.workspace_id AND overridden.iri = c.iri
   WHERE c.workspace_id = $1 AND c.collection IS NOT NULL AND ${readableClause("c", 2)}
   GROUP BY c.collection, o.person_id, u.name`;

type CollectionRow = {
  readonly collection: string;
  readonly person_id: UserId | null;
  readonly person_name: string | null;
  readonly overrides: number;
};

const ownedRow = (row: CollectionRow): CollectionOwned => ({
  collection: row.collection,
  owner: row.person_id === null ? null : { id: row.person_id, name: row.person_name ?? "" },
  overrides: row.overrides,
});

const OWNS_A_COLLECTION = `SELECT 1 FROM concept_owner
    WHERE workspace_id = $1 AND person_id = $2 AND collection IS NOT NULL
    LIMIT 1`;

const collectionOwnerAdmits = async (
  reader: UserPrincipal,
  tx: Tx,
): Promise<OwnerRefusal | undefined> => {
  if (reader.role === "Admin") return undefined;
  const owning = await tx.query(OWNS_A_COLLECTION, [reader.workspaceId, reader.userId]);
  return owning.rowCount === 0 ? "owner-forbids" : undefined;
};

const collectionsReadBy = async (reader: UserPrincipal, tx: Tx): Promise<CollectionsAndOwners> => {
  const rows = await tx.query<CollectionRow>(COLLECTIONS_AND_OWNERS, [
    reader.workspaceId,
    ...readableParameters(reader),
  ]);
  return {
    collections: rows.rows
      .map(ownedRow)
      .toSorted((one, other) => byCodeUnit(one.collection, other.collection)),
  };
};

export const collectionsAndOwners = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<CollectionsAndOwners, CollectionsAndOwnersRefusal>> => {
  const admitted = admit(collectionsAndOwnersAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  const reader = admitted.value;
  const refused = await attempt(() => collectionOwnerAdmits(reader, tx));
  if (!refused.ok) return err(refused.error);
  if (refused.value !== undefined) return err(refused.value);
  return attempt(() => collectionsReadBy(reader, tx));
};

const OWNER_PERSON = boundarySchemas.conceptOwner.insert.shape.personId.nullable();

export const nameOwnerInput = z.union([
  z.strictObject({ collection: z.string().regex(COLLECTION), personId: OWNER_PERSON }),
  z.strictObject({ iri: ids.conceptIri, personId: OWNER_PERSON }),
]);

export type NameOwnerInput = z.input<typeof nameOwnerInput>;

const nameOwnerAction = declareAction({
  admits: ADMIN_ALONE,
  input: z.custom<NameOwnerInput>(),
  refuses: ["role-forbids", "malformed", "no-such-member", "no-such-concept"],
});

export type NameOwnerRefusal = RefusalOf<typeof nameOwnerAction> | Error;

export type OwnerNamed = {
  readonly auditEventId: string;
  readonly personId: string | null;
};

type Subject = { readonly collection: string } | { readonly iri: string };

const subjectClause = (subject: Subject): readonly [column: "iri" | "collection", value: string] =>
  "iri" in subject ? ["iri", subject.iri] : ["collection", subject.collection];

const refusalBeforeNaming = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  subject: Subject,
  personId: string | null,
): Promise<RefusalOf<typeof nameOwnerAction> | undefined> => {
  if (personId !== null) {
    const member = await tx.query("SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2", [
      admin.workspaceId,
      personId,
    ]);
    if (member.rowCount === 0) return "no-such-member";
  }
  if ("iri" in subject) {
    const known = await tx.query(
      "SELECT 1 FROM concept_identity WHERE workspace_id = $1 AND iri = $2 FOR NO KEY UPDATE",
      [admin.workspaceId, subject.iri],
    );
    if (known.rowCount === 0) return "no-such-concept";
  }
  return undefined;
};

const writeOwner = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  subject: Subject,
  personId: string | null,
): Promise<void> => {
  const [column, value] = subjectClause(subject);
  if (personId === null) {
    await tx.query(`DELETE FROM concept_owner WHERE workspace_id = $1 AND ${column} = $2`, [
      admin.workspaceId,
      value,
    ]);
    return;
  }
  await tx.query(
    `INSERT INTO concept_owner (workspace_id, id, ${column}, person_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, ${column}) WHERE ${column} IS NOT NULL
     DO UPDATE SET person_id = EXCLUDED.person_id`,
    [admin.workspaceId, ulid(), value, personId],
  );
};

const openedAndWritten = async (
  admin: AdminUserPrincipal,
  tx: Tx,
  subject: Subject,
  personId: string | null,
): Promise<RefusalOf<typeof nameOwnerAction> | undefined> => {
  const refusal = await refusalBeforeNaming(admin, tx, subject, personId);
  if (refusal === undefined) await writeOwner(admin, tx, subject, personId);
  return refusal;
};

/** A null person clears the subject's owner. */
export const nameOwner = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NameOwnerInput,
): Promise<Result<OwnerNamed, NameOwnerRefusal>> => {
  const admitted = admit(nameOwnerAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const admin = admitted.value;
  const parsed = nameOwnerInput.safeParse(input);
  if (!parsed.success) return err("malformed");
  const { personId, ...subject } = parsed.data;

  const written = await attempt(() => openedAndWritten(admin, tx, subject, personId));
  if (!written.ok) return err(written.error);
  if (written.value !== undefined) return err(written.value);

  const auditEventId = ulid();
  await record(admin, tx, {
    id: auditEventId,
    action: OWNER_ACTIONS.named,
    subjectId: subjectClause(subject)[1],
    detail: personId === null ? subject : { ...subject, personId },
  });
  return ok({ auditEventId, personId });
};
